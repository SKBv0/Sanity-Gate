#!/usr/bin/env node

import { Command } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { scanProject } from './lib/scan';
import { formatTable, formatJSON } from './lib/formatters';
import { resolveScanTarget } from './utils/path-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const envCandidates = ['.env', '.env.local'];
const loadEnvFiles = async () => {
  for (const file of envCandidates) {
    const envPath = path.join(projectRoot, file);
    const exists = await fs
      .access(envPath)
      .then(() => true)
      .catch(() => false);

    if (exists) {
      dotenv.config({ path: envPath });
    }
  }
};

const program = new Command();

program
  .name('sanity-gate')
  .description('Sanity Gate - Project health scanner')
  .version('0.1.0');

program
  .command('scan')
  .description('Scan a project for issues')
  .argument('[path]', 'Path to project directory (defaults to current directory)')
  .option('-j, --json', 'Output as JSON')
  .option('-o, --output <file>', 'Save report to file')
.action(async (projectPath: string | undefined, options: { json?: boolean; output?: string }) => {
    try {
      await loadEnvFiles();
      // Use current directory if path not provided
      const resolvedPath = resolveScanTarget(projectPath, {
        baseDir: process.cwd(),
        workspaceRoot: process.env.SANITY_GATE_ROOT,
        enforceWorkspaceRoot: (process.env.SANITY_GATE_ENFORCE_ROOT || '').toLowerCase() === 'true'
      });
      
      // Validate path exists
      const pathExists = await fs
        .access(resolvedPath)
        .then(() => true)
        .catch(() => false);
      if (!pathExists) {
        process.stderr.write(`Error: Path does not exist: ${resolvedPath}\n`);
        process.exit(1);
      }

      // Validate it's a directory
      const stats = await fs.stat(resolvedPath);
      if (!stats.isDirectory()) {
        process.stderr.write(`Error: Path must be a directory: ${resolvedPath}\n`);
        process.exit(1);
      }

      // Show progress
      process.stderr.write(`Scanning ${resolvedPath}...\n`);

      // Simple logger for CLI
      const logger = (level: string, category: string, message: string) => {
        if (level === 'info' && category === 'scan' && message.includes('completed')) {
          // Only show completion messages
          process.stderr.write(`  - ${message}\n`);
        }
      };

      // Run scan
      const report = await scanProject(resolvedPath, logger);

      // Format output
      const output = options.json ? formatJSON(report) : formatTable(report);

      // Output or save to file
      if (options.output) {
        await fs.writeFile(options.output, output, 'utf-8');
        process.stdout.write(`\nReport saved to: ${options.output}\n`);
      } else {
        process.stdout.write(`${output}\n`);
      }

      // Exit with appropriate code
      const hasErrors = report.issues.some(i => i.severity === 'error' || i.severity === 'critical');
      process.exit(hasErrors ? 1 : 0);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error: ${message}\n`);
      if (error instanceof Error && error.stack && process.env.DEBUG) {
        process.stderr.write(`${error.stack}\n`);
      }
      process.exit(1);
    }
  });

// Parse arguments
program.parse();
