import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import depcheck from 'depcheck';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Shared glob ignore patterns so nested project artifacts like node_modules are skipped everywhere
const DEFAULT_GLOB_IGNORE = [
  'node_modules/**',
  '**/node_modules/**',
  '.git/**',
  '**/.git/**',
  '.next/**',
  '**/.next/**',
  'dist/**',
  '**/dist/**',
  'build/**',
  '**/build/**'
];

const LICENSE_ALLOWLIST_PREFIXES = ['@img/sharp-'];

// Types for our report
export type IssueSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface Issue {
  id: string;
  category: 'filesystem' | 'orphans' | 'dependencies' | 'build' | 'assets' | 'security' | 'code-quality' | 'performance' | 'env' | 'git' | 'seo' | 'accessibility' | 'licenses';
  type: string;
  path?: string;
  message: string;
  severity: IssueSeverity;
  snippet?: string;
  suggestedAction?: string;
}

export interface ScanReport {
  project: string;
  timestamp: string;
  issues: Issue[];
  stats: {
    filesScanned: number;
    orphansFound: number;
    unusedDeps: number;
  };
  rootPath?: string;
  rootSignature?: string;
}

// Optional logger function (can be overridden)
type LogPayload = Record<string, unknown>;
type LoggerFunction = (level: string, category: string, message: string, data?: LogPayload) => void;

const toError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === 'string' ? error : 'Unknown error');
};

// Helper to recursively find empty directories
async function findEmptyDirs(dir: string): Promise<string[]> {
  const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build']);
  const emptyDirectories: string[] = [];

  const traverse = async (currentDir: string): Promise<boolean> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return false;
    }

    if (entries.length === 0) {
      emptyDirectories.push(currentDir);
      return true;
    }

    let hasContent = false;

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const subdirEmpty = await traverse(fullPath);
        if (!subdirEmpty) {
          hasContent = true;
        }
      } else {
        hasContent = true;
      }
    }

    if (!hasContent) {
      emptyDirectories.push(currentDir);
    }

    return !hasContent;
  };

  await traverse(dir);
  return emptyDirectories;
}

async function collectNodeModulePackages(nodeModulesPath: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(nodeModulesPath, { withFileTypes: true });
    const packages: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

      if (entry.name.startsWith('@')) {
        const scopePath = path.join(nodeModulesPath, entry.name);
        try {
          const scopedEntries = await fs.promises.readdir(scopePath, { withFileTypes: true });
          for (const scoped of scopedEntries) {
            if (scoped.isDirectory() && !scoped.name.startsWith('.')) {
              packages.push(path.join(entry.name, scoped.name));
            }
          }
        } catch {
          continue;
        }
      } else {
        packages.push(entry.name);
      }
    }

    return packages;
  } catch {
    return [];
  }
}


/**
 * Core scan function that can be used by both API and CLI
 */
export async function scanProject(
  scanPath: string,
  logger?: LoggerFunction
): Promise<ScanReport> {
  const startTime = Date.now();
  const log = logger || (() => {}); // Default to no-op logger

  // Resolve and normalize path (validation should be done at route/CLI level)
  let resolvedPath: string;
  try {
    resolvedPath = path.resolve(scanPath);
  } catch {
    throw new Error(`VALIDATION_ERROR: Invalid path format: ${scanPath}`);
  }
  
  resolvedPath = path.normalize(resolvedPath);

  // Security: Check if path exists (async)
  try {
    await fs.promises.access(resolvedPath);
  } catch {
    log('error', 'scan', 'Path does not exist', { path: resolvedPath });
    throw new Error(`PATH_NOT_FOUND: Path does not exist: ${resolvedPath}`);
  }

  // Security: Verify it's a directory
  let stats;
  try {
    stats = await fs.promises.stat(resolvedPath);
  } catch {
    throw new Error('PERMISSION_DENIED: Cannot access path');
  }

  if (!stats.isDirectory()) {
    throw new Error('VALIDATION_ERROR: Path must be a directory');
  }

  // Security: Prevent symlink attacks
  try {
    const lstat = await fs.promises.lstat(resolvedPath);
    if (lstat.isSymbolicLink()) {
      throw new Error('SECURITY_ERROR: Symbolic links are not allowed');
    }
  } catch (error: unknown) {
    const err = toError(error);
    if (err.message && err.message.includes('SECURITY_ERROR')) {
      throw err;
    }
    // If lstat fails for other reasons, continue (means it's not a symlink)
  }

  const issues: Issue[] = [];
  log('info', 'scan', 'Starting scan checks', { path: resolvedPath });

  // 1. Git Status Check
  try {
    log('info', 'scan', 'Checking git status');
    const gitStartTime = Date.now();
    const { stdout } = await execAsync('git status --porcelain', { cwd: resolvedPath });
    const gitDuration = Date.now() - gitStartTime;
    if (stdout.trim()) {
      const uncommittedFiles = stdout.trim().split('\n').length;
      log('info', 'scan', 'Git status check completed', { 
        uncommittedFiles, 
        duration: gitDuration 
      });
      issues.push({
        id: 'git-dirty-tree',
        category: 'git',
        type: 'UNCOMMITTED_CHANGES',
        message: `Working tree has ${uncommittedFiles} uncommitted change(s). Commit or stash before deployment.`,
        severity: 'warning',
        snippet: stdout.split('\n').slice(0, 5).join('\n'),
        suggestedAction: 'commit or stash changes'
      });
    }
  } catch (error: unknown) {
    const err = toError(error);
    log('debug', 'scan', 'Git check skipped', { error: err.message || 'Not a git repo' });
  }

  // 2. File System Scan
  log('info', 'scan', 'Starting filesystem scan');
  const srcDir = path.join(resolvedPath, 'src');
  try {
    const srcDirExists = await fs.promises.access(srcDir).then(() => true).catch(() => false);
    if (srcDirExists) {
      // Empty Dirs
      const emptyDirs = await findEmptyDirs(srcDir);
      log('info', 'scan', 'Empty directories found', { count: emptyDirs.length });
      emptyDirs.forEach(dir => {
        issues.push({
          id: `empty-dir-${dir}`,
          category: 'filesystem',
          type: 'EMPTY_DIR',
          path: path.relative(resolvedPath, dir),
          message: 'Directory is empty.',
          severity: 'info',
          suggestedAction: 'delete directory'
        });
      });
    }
  } catch {
    // src dir doesn't exist, skip
  }

  // Zero Byte Files & Large Files - PARALLEL PROCESSING
  const allFiles = await glob('**/*', {
    cwd: resolvedPath,
    nodir: true,
    ignore: DEFAULT_GLOB_IGNORE
  });
  log('info', 'scan', 'Files found for analysis', { count: allFiles.length });

  // Process files in larger parallel batches for better performance
  const BATCH_SIZE = 150; // Increased batch size
  const fileIssues: Issue[] = [];
  
  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    const batch = allFiles.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        const fullPath = path.join(resolvedPath, file);
        try {
          const stats = await fs.promises.stat(fullPath);
          const batchIssues: Issue[] = [];
          
          if (stats.size === 0) {
            batchIssues.push({
              id: `zero-byte-${file}`,
              category: 'filesystem',
              type: 'ZERO_BYTE_FILE',
              path: file,
              message: 'File is empty (0 bytes).',
              severity: 'info',
              suggestedAction: 'delete file'
            });
          }

          // Performance: Large File Check (> 5MB)
          if (stats.size > 5 * 1024 * 1024) {
            batchIssues.push({
              id: `large-file-${file}`,
              category: 'performance',
              type: 'LARGE_FILE',
              path: file,
              message: `File is too large (${(stats.size / 1024 / 1024).toFixed(2)} MB). Consider optimizing or lazy loading.`,
              severity: 'warning',
              suggestedAction: 'optimize file or implement lazy loading'
            });
          }
          
          return batchIssues;
        } catch {
          return [];
        }
      })
    );
    
    fileIssues.push(...batchResults.flat());
  }
  
  issues.push(...fileIssues);

  // Find backup/temp files
  const backupPatterns = [
    '**/*copy*', '**/*backup*', '**/*old*', '**/*.tmp',
    '**/*.bak', '**/*~', '**/*draft*', '**/*deneme*'
  ];
  const backupFiles = await glob(backupPatterns, {
    cwd: resolvedPath,
    ignore: DEFAULT_GLOB_IGNORE
  });

  backupFiles.forEach(file => {
    issues.push({
      id: `backup-file-${file}`,
      category: 'filesystem',
      type: 'BACKUP_FILE',
      path: file,
      message: 'File appears to be a backup or temporary file.',
      severity: 'warning',
      suggestedAction: 'delete file'
    });
  });

  // 3. Assets Scan (Orphan Assets)
  const publicDir = path.join(resolvedPath, 'public');
  try {
    await fs.promises.access(publicDir);
    const assetFiles = await glob('**/*', { cwd: publicDir, nodir: true, ignore: DEFAULT_GLOB_IGNORE });
    
    // Filter out Next.js default assets that are commonly unused
    const defaultNextAssets = ['next.svg', 'vercel.svg', 'window.svg', 'globe.svg', 'file.svg'];
    const filteredAssets = assetFiles.filter(asset => {
      const basename = path.basename(asset);
      return !defaultNextAssets.includes(basename);
    });

    if (filteredAssets.length > 0) {
      const srcFilesForAssets = await glob('src/**/*.{ts,tsx,js,jsx,css,scss}', { cwd: resolvedPath, ignore: DEFAULT_GLOB_IGNORE });

      // Read source files in batches for asset checking (optimized)
      const ASSET_BATCH_SIZE = 40;
      const srcContents: Array<{ file: string; content: string }> = [];
      
      for (let i = 0; i < srcFilesForAssets.length; i += ASSET_BATCH_SIZE) {
        const batch = srcFilesForAssets.slice(i, i + ASSET_BATCH_SIZE);
          const batchContents = await Promise.all(
            batch.map(async (srcFile) => {
              try {
                const content = await fs.promises.readFile(path.join(resolvedPath, srcFile), 'utf-8');
                return { file: srcFile, content };
              } catch {
                return { file: srcFile, content: '' };
              }
            })
          );
        srcContents.push(...batchContents);
      }

      for (const asset of filteredAssets) {
        const assetName = path.basename(asset);

        // Check if asset is referenced in any source file
        const isUsed = srcContents.some(({ content }) =>
          content.includes(assetName) || content.includes(asset)
        );

        if (!isUsed) {
          issues.push({
            id: `orphan-asset-${asset}`,
            category: 'assets',
            type: 'ORPHAN_ASSET',
            path: path.join('public', asset),
            message: `Asset "${assetName}" appears to be unused in src code.`,
            severity: 'info',
            suggestedAction: 'delete asset file'
          });
        }
      }
    }
  } catch {
    // public dir doesn't exist, skip
  }

  // 4. Dependencies Scan (aggressively optimized with timeout)
  const depcheckOptions = {
    ignoreBinPackage: true, // Skip binary packages for speed
    skipMissing: false,
    ignorePatterns: [
      'dist', 'build', '.next', 'node_modules',
      '**/dist/**', '**/build/**', '**/.next/**', '**/node_modules/**',
      '**/*.test.*', '**/*.spec.*', '**/*.test.ts', '**/*.test.tsx',
      '**/*.spec.ts', '**/*.spec.tsx', '**/tests/**', '**/__tests__/**',
      '**/*.stories.*', '**/*.mock.*', '**/coverage/**', '**/.storybook/**'
    ],
    ignoreMatches: [
      'eslint*', '@types/*', '@testing-library/*', 'jest*', 
      'vitest*', 'mocha*', 'chai*', 'sinon*', 'cypress*', 'playwright*',
      'webpack*', 'rollup*', 'vite*', 'tailwindcss*', 'postcss*', 'autoprefixer*'
    ],
  };

  // Run depcheck with aggressive timeout
  let depResults: { dependencies: string[]; devDependencies: string[]; missing: Record<string, string[]> };
  try {
    const depcheckPromise = depcheck(resolvedPath, depcheckOptions);
    const timeoutPromise = new Promise<typeof depResults>((_, reject) => 
      setTimeout(() => reject(new Error('Depcheck timeout')), 8000) // 8 second timeout
    );

    depResults = await Promise.race([depcheckPromise, timeoutPromise]);
  } catch {
    // If depcheck fails or times out, continue with empty results
    depResults = { dependencies: [], devDependencies: [], missing: {} };
  }

  depResults.dependencies.forEach(dep => {
    issues.push({
      id: `unused-dep-${dep}`,
      category: 'dependencies',
      type: 'UNUSED_DEP',
      message: `Unused dependency: "${dep}"`,
      severity: 'warning',
      suggestedAction: 'remove from package.json dependencies'
    });
  });

  depResults.devDependencies.forEach(dep => {
    issues.push({
      id: `unused-dev-dep-${dep}`,
      category: 'dependencies',
      type: 'UNUSED_DEV_DEP',
      message: `Unused devDependency: "${dep}"`,
      severity: 'info',
      suggestedAction: 'remove from package.json devDependencies'
    });
  });

  Object.keys(depResults.missing).forEach(dep => {
    issues.push({
      id: `missing-dep-${dep}`,
      category: 'dependencies',
      type: 'MISSING_DEP',
      message: `Missing dependency: "${dep}"`,
      severity: 'error',
      snippet: `Used in: ${depResults.missing[dep].map(f => path.relative(resolvedPath, f)).join(', ')}`,
      suggestedAction: 'add to package.json dependencies'
    });
  });

  // 5. Dependency Version Pinning Check (async)
  const packageJsonPath = path.join(resolvedPath, 'package.json');
  try {
    await fs.promises.access(packageJsonPath);
    try {
      const packageJsonContent = await fs.promises.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageJsonContent);
      const checkVersions = (deps: Record<string, string>, type: string) => {
        Object.entries(deps || {}).forEach(([name, version]) => {
            if (version === '*' || version === 'latest' || version.includes('^') || version.includes('~')) {
              issues.push({
                id: `unpinned-${type}-${name}`,
                category: 'dependencies',
                type: 'UNPINNED_VERSION',
                message: `${type} "${name}" uses non-deterministic version: "${version}". Consider pinning exact versions.`,
                severity: 'warning',
                suggestedAction: 'pin exact version in package.json'
              });
            }
        });
      };

      checkVersions(packageJson.dependencies, 'dependency');
      checkVersions(packageJson.devDependencies, 'devDependency');
    } catch { }
  } catch {
    // package.json doesn't exist, skip
  }

  // 6. License Audit (async + parallel)
  try {
    const nodeModulesPath = path.join(resolvedPath, 'node_modules');
    try {
      await fs.promises.access(nodeModulesPath);
      const packages = await collectNodeModulePackages(nodeModulesPath);
      const viralLicenses = ['GPL', 'AGPL', 'LGPL'];

      // Process packages in parallel
      const licenseChecks = packages.map(async (pkg) => {
        const normalizedPkgName = pkg.replace(/\\/g, '/');
        try {
          const pkgJsonPath = path.join(nodeModulesPath, pkg, 'package.json');
          try {
            await fs.promises.access(pkgJsonPath);
            const pkgJsonContent = await fs.promises.readFile(pkgJsonPath, 'utf-8');
            const pkgJson = JSON.parse(pkgJsonContent);
            const license = pkgJson.license || '';

            if (viralLicenses.some(vl => license.toUpperCase().includes(vl))) {
              if (LICENSE_ALLOWLIST_PREFIXES.some(prefix => normalizedPkgName.startsWith(prefix))) {
                return null;
              }
              return {
                id: `viral-license-${normalizedPkgName}`,
                category: 'licenses' as const,
                type: 'VIRAL_LICENSE',
                message: `Package "${normalizedPkgName}" uses viral license: ${license}. May require open-sourcing your code.`,
                severity: 'critical' as const,
                suggestedAction: 'review license compatibility or replace package'
              };
            }
          } catch { }
        } catch { }
        return null;
      });

      const licenseIssues = await Promise.all(licenseChecks);
      for (const issue of licenseIssues) {
        if (issue !== null) {
          issues.push(issue);
        }
      }
    } catch {
      // node_modules doesn't exist, skip
    }
  } catch { }

  // 7. Orphan Modules (Optimized with batching)
  // Try to find source files in common locations
  const srcPatterns = [
    '**/src/**/*.{ts,tsx,js,jsx}',
    '**/app/**/*.{ts,tsx,js,jsx}',
    '**/pages/**/*.{ts,tsx,js,jsx}',
    '**/components/**/*.{ts,tsx,js,jsx}',
    '**/lib/**/*.{ts,tsx,js,jsx}',
    '**/utils/**/*.{ts,tsx,js,jsx}'
  ];
  
  const allSrcFiles: string[] = [];
  for (const pattern of srcPatterns) {
    try {
      const files = await glob(pattern, { cwd: resolvedPath, ignore: DEFAULT_GLOB_IGNORE });
      allSrcFiles.push(...files);
    } catch {
      // Pattern doesn't match, continue
    }
  }
  
  // Remove duplicates
  const uniqueSrcFiles = [...new Set(allSrcFiles)];

  // Read all source files in larger batches for better performance
  const CONTENT_BATCH_SIZE = 50; // Increased batch size
  const allSrcContents: Array<{ file: string; content: string }> = [];
  
  for (let i = 0; i < uniqueSrcFiles.length; i += CONTENT_BATCH_SIZE) {
    const batch = uniqueSrcFiles.slice(i, i + CONTENT_BATCH_SIZE);
    const batchContents = await Promise.all(
      batch.map(async (file) => {
        try {
          const content = await fs.promises.readFile(path.join(resolvedPath, file), 'utf-8');
          return { file, content };
        } catch {
          return { file, content: '' };
        }
      })
    );
    allSrcContents.push(...batchContents);
  }

  // Process files in larger batches for content analysis (optimized)
  const ANALYSIS_BATCH_SIZE = 25; // Increased batch size for better throughput
  const contentAnalysisIssues: Issue[] = [];
  
  for (let i = 0; i < allSrcContents.length; i += ANALYSIS_BATCH_SIZE) {
    const batch = allSrcContents.slice(i, i + ANALYSIS_BATCH_SIZE);
    const batchIssues = await Promise.all(
      batch.map(async ({ file, content: currentContent }) => {
        const fileIssues: Issue[] = [];
        const basename = path.basename(file, path.extname(file));
        const normalizedFilePath = file.replace(/\\/g, '/');
        const isAnalyzerSource = normalizedFilePath.endsWith('src/lib/scan.ts');

        // Skip framework-specific files
        if (basename === 'index' || basename === 'page' || basename === 'layout' || basename === 'route' || basename === 'globals') {
          return fileIssues;
        }

        // Check if this file is referenced in any other file
        const isReferenced = allSrcContents.some(({ file: otherFile, content }) => {
          if (file === otherFile) return false;
          return content.includes(basename);
        });

        if (!isReferenced) {
          fileIssues.push({
            id: `orphan-${file}`,
            category: 'orphans',
            type: 'ORPHAN_MODULE',
            path: file,
            message: `Possible orphan module: "${path.basename(file)}"`,
            severity: 'warning',
            snippet: 'No direct text reference found in other source files.',
            suggestedAction: 'delete file or add import reference'
          });
        }

        // --- Content Analysis Checks ---

        if (!isAnalyzerSource) {
          // Security: Hardcoded Secrets
          const ensureGlobalRegex = (pattern: RegExp) => {
            const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
            return new RegExp(pattern.source, flags);
          };

          const secretPatterns = [
            { regex: /AWS_ACCESS_KEY_ID\s*=\s*['"][A-Z0-9]{20}['"]/, name: 'AWS Access Key' },
            { regex: /Bearer\s+[a-zA-Z0-9\-\._~\+\/]+=*/, name: 'Bearer Token' },
            { regex: /ghp_[a-zA-Z0-9]{36}/, name: 'GitHub Personal Access Token' },
            { regex: /sk_live_[0-9a-zA-Z]{24}/, name: 'Stripe Secret Key' },
            { regex: /AIza[0-9A-Za-z-_]{35}/, name: 'Google API Key' }
          ];

          secretPatterns.forEach(({ regex, name }) => {
            const matcher = ensureGlobalRegex(regex);
            let match: RegExpExecArray | null;
            while ((match = matcher.exec(currentContent)) !== null) {
              if (name === 'Bearer Token') {
                const tokenPart = match[0].replace(/Bearer\s+/i, '').trim();
                if (tokenPart.length < 16) {
                  continue;
                }
              }

              fileIssues.push({
                id: `secret-${file}-${name}`,
                category: 'security',
                type: 'HARDCODED_SECRET',
                path: file,
                message: `Potential hardcoded secret found: ${name}`,
                severity: 'critical',
                snippet: '***REDACTED***',
                suggestedAction: 'move to environment variable and remove from code'
              });
              break;
            }
          });
        }

        // Code Quality: Console Logs & TODOs
        // Skip logger.ts files as they intentionally use console.log for debugging
        if (!isAnalyzerSource && !file.includes('logger.ts') && !file.includes('logger.js')) {
          // Check for console.log but ignore if it's wrapped in development check
          const consoleLogRegex = /console\.log\(/g;
          const hasConsoleLog = consoleLogRegex.test(currentContent);
          
          if (hasConsoleLog) {
            // Check if console.log is wrapped in development check
            const lines = currentContent.split('\n');
            let hasDevelopmentCheck = false;
            
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes('console.log(')) {
                // Check previous lines for development check (look back up to 10 lines)
                const beforeLines = lines.slice(Math.max(0, i - 10), i).join('\n');
                if (beforeLines.includes('process.env.NODE_ENV') && 
                    (beforeLines.includes('development') || beforeLines.includes('=== \'development\'') || beforeLines.includes('=== "development"'))) {
                  hasDevelopmentCheck = true;
                  break;
                }
              }
            }
            
            if (!hasDevelopmentCheck) {
              fileIssues.push({
                id: `console-log-${file}`,
                category: 'code-quality',
                type: 'CONSOLE_LOG',
                path: file,
                message: 'Console.log statement found. Remove before production.',
                severity: 'warning',
                suggestedAction: 'remove console.log or wrap in dev check'
              });
            }
          }
        }

        if (!isAnalyzerSource && (currentContent.includes('// TODO:') || currentContent.includes('// FIXME:'))) {
          fileIssues.push({
            id: `todo-${file}`,
            category: 'code-quality',
            type: 'TODO_COMMENT',
            path: file,
            message: 'Unresolved TODO or FIXME comment found.',
            severity: 'info',
            suggestedAction: 'resolve TODO/FIXME or remove comment'
          });
        }

        // Performance: Sync I/O
        if (!isAnalyzerSource && (currentContent.includes('readFileSync') || currentContent.includes('writeFileSync') || currentContent.includes('readdirSync'))) {
          fileIssues.push({
            id: `sync-io-${file}`,
            category: 'performance',
            type: 'SYNC_IO',
            path: file,
            message: 'Synchronous I/O operation detected. Use async alternatives for better performance.',
            severity: 'warning',
            suggestedAction: 'convert to async (readFile, writeFile, readdir)'
          });
        }

        // SEO: Metadata Check (Next.js specific)
        if ((file.includes('page.tsx') || file.includes('layout.tsx')) && file.includes('app/')) {
          const hasMetadata = currentContent.includes('export const metadata') ||
            currentContent.includes('generateMetadata');
          if (!hasMetadata) {
            fileIssues.push({
              id: `missing-metadata-${file}`,
              category: 'seo',
              type: 'MISSING_METADATA',
              path: file,
              message: 'Page/Layout missing metadata export. Add title and description for SEO.',
              severity: 'warning',
              suggestedAction: 'add metadata export with title and description'
            });
          }
        }

        // Accessibility: Basic A11y Checks
        if (file.endsWith('.tsx') || file.endsWith('.jsx')) {
          // Check for images without alt
          const imgWithoutAlt = /<img(?![^>]*alt=)[^>]*>/g;
          if (imgWithoutAlt.test(currentContent)) {
            fileIssues.push({
              id: `missing-alt-${file}`,
              category: 'accessibility',
              type: 'MISSING_ALT',
              path: file,
              message: 'Image tag found without alt attribute. Add alt text for accessibility.',
              severity: 'warning',
              suggestedAction: 'add alt attribute to img tag'
            });
          }

          // Check for inputs without labels
          const inputWithoutLabel = /<input(?![^>]*aria-label)[^>]*>/g;
          const hasLabels = currentContent.includes('<label');
          if (inputWithoutLabel.test(currentContent) && !hasLabels) {
            fileIssues.push({
              id: `missing-label-${file}`,
              category: 'accessibility',
              type: 'MISSING_LABEL',
              path: file,
              message: 'Input field found without associated label or aria-label.',
              severity: 'warning',
              suggestedAction: 'add label element or aria-label attribute'
            });
          }
        }

        return fileIssues;
      })
    );
    contentAnalysisIssues.push(...batchIssues.flat());
  }

  issues.push(...contentAnalysisIssues);

  // 8. Environment Variables Check
  const envVarsUsed = new Set<string>();
  const envRegex = /process\.env\.([A-Z_][A-Z0-9_]*)/g;

  for (const { content } of allSrcContents) {
    let match;
    while ((match = envRegex.exec(content)) !== null) {
      if (match[1] !== 'NODE_ENV') {
        envVarsUsed.add(match[1]);
      }
    }
  }

  // Check .env files
  const definedEnvVars = new Set<string>();
  const envFiles = await glob('.env*', { cwd: resolvedPath, nodir: true, ignore: DEFAULT_GLOB_IGNORE });

  for (const envFile of envFiles) {
    try {
      const content = await fs.promises.readFile(path.join(resolvedPath, envFile), 'utf-8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const parts = trimmed.split('=');
          if (parts.length > 0 && parts[0].trim()) {
            definedEnvVars.add(parts[0].trim());
          }
        }
      });
    } catch { }
  }

  envVarsUsed.forEach(envVar => {
    if (!definedEnvVars.has(envVar)) {
      issues.push({
        id: `missing-env-${envVar}`,
        category: 'env',
        type: 'MISSING_ENV_VAR',
        message: `Environment variable "${envVar}" is used in code but not defined in any .env file.`,
        severity: 'error',
        suggestedAction: 'add to .env file'
      });
    }
  });

  // 9. Build Check
  if (fs.existsSync(path.join(resolvedPath, 'tsconfig.json'))) {
    try {
      await execAsync('npx tsc --noEmit', { cwd: resolvedPath });
    } catch (error: unknown) {
      const err = error as { stdout?: string };
      const stdout = err?.stdout || '';
      const lines = stdout.split('\n').slice(0, 3).join('\n');
      issues.push({
        id: 'build-error',
        category: 'build',
        type: 'BUILD_FAILURE',
        message: 'TypeScript build/check failed.',
        severity: 'error',
        snippet: lines,
        suggestedAction: 'fix TypeScript errors'
      });
    }
  }

  const totalDuration = Date.now() - startTime;
  // Count all scanned files (not just src files)
  const totalFilesScanned = allFiles.length;
  
  const report: ScanReport = {
    project: path.basename(resolvedPath),
    timestamp: new Date().toISOString(),
    issues,
    stats: {
      filesScanned: totalFilesScanned,
      orphansFound: issues.filter(i => i.category === 'orphans').length,
      unusedDeps: depResults.dependencies.length + depResults.devDependencies.length
    },
    rootPath: resolvedPath
  };

  log('info', 'scan', 'Scan completed successfully', {
    project: report.project,
    issueCount: issues.length,
    filesScanned: report.stats.filesScanned,
    duration: totalDuration,
    issuesByCategory: issues.reduce((acc, issue) => {
      acc[issue.category] = (acc[issue.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  });

  return report;
}

