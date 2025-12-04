import fs from 'fs';
import path from 'path';

interface ScanTargetOptions {
  workspaceRoot?: string;
  enforceWorkspaceRoot?: boolean;
  baseDir?: string;
}

export function resolveProjectRoot(projectRoot?: string): string {
  if (!projectRoot || typeof projectRoot !== 'string') {
    throw new Error('VALIDATION_ERROR: projectRoot is required');
  }

  const resolvedRoot = path.resolve(projectRoot);
  let stats: fs.Stats;
  try {
    stats = fs.statSync(resolvedRoot);
  } catch {
    throw new Error('PATH_NOT_FOUND: Project root does not exist or is not accessible');
  }

  if (!stats.isDirectory()) {
    throw new Error('VALIDATION_ERROR: projectRoot must be a directory');
  }

  return path.normalize(resolvedRoot);
}

export function resolvePreviewPath(projectRoot: string, filePath?: string): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('VALIDATION_ERROR: filePath is required');
  }

  const normalizedRoot = path.normalize(projectRoot);
  const rootLower = normalizedRoot.toLowerCase();
  const rootWithSepLower = (normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep).toLowerCase();

  const candidateAbsolute = path.isAbsolute(filePath)
    ? path.normalize(path.resolve(filePath))
    : path.normalize(path.resolve(normalizedRoot, filePath));

  const candidateLower = candidateAbsolute.toLowerCase();
  if (
    candidateLower !== rootLower &&
    !candidateLower.startsWith(rootWithSepLower)
  ) {
    throw new Error('SECURITY_ERROR: File path is outside project root');
  }

  return candidateAbsolute;
}

export function resolveScanTarget(
  requestedPath?: string,
  options?: ScanTargetOptions
): string {
  const envRoot = options?.workspaceRoot
    ? path.resolve(options.workspaceRoot)
    : process.env.SANITY_GATE_ROOT
      ? path.resolve(process.env.SANITY_GATE_ROOT)
      : '';

  const normalizedWorkspaceRoot = envRoot ? path.normalize(envRoot) : '';
  const workspaceRootWithSep = normalizedWorkspaceRoot
    ? (normalizedWorkspaceRoot.endsWith(path.sep)
        ? normalizedWorkspaceRoot
        : normalizedWorkspaceRoot + path.sep)
    : '';

  const enforceWorkspaceRoot =
    options?.enforceWorkspaceRoot ??
    ((process.env.SANITY_GATE_ENFORCE_ROOT || '').toLowerCase() === 'true');

  const baseDir = options?.baseDir ?? process.cwd();

  const candidate =
    requestedPath && requestedPath.trim().length > 0 ? requestedPath.trim() : '.';

  const absoluteCandidate = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(baseDir, candidate);

  const normalizedCandidate = path.normalize(absoluteCandidate);

  if (enforceWorkspaceRoot) {
    const rootToUse =
      normalizedWorkspaceRoot || path.normalize(path.resolve(baseDir));
    const rootWithSep =
      workspaceRootWithSep ||
      (rootToUse.endsWith(path.sep) ? rootToUse : rootToUse + path.sep);

    const candidateLower = normalizedCandidate.toLowerCase();
    const rootLower = rootToUse.toLowerCase();
    const rootWithSepLower = rootWithSep.toLowerCase();

    if (
      candidateLower !== rootLower &&
      !candidateLower.startsWith(rootWithSepLower)
    ) {
      throw new Error(
        `SECURITY_ERROR: Path must stay within the workspace root (${rootToUse})`
      );
    }
  }

  return normalizedCandidate;
}

