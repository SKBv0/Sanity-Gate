import { NextResponse } from 'next/server';
import { scanProject } from '@/lib/scan';
import { createServerLogger } from '@/utils/server-logger';
import { validateAuth, signPath } from '@/utils/security';
import { resolveScanTarget } from '@/utils/path-utils';

const serverLog = createServerLogger('scan');

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const getErrorStack = (error: unknown) =>
  error instanceof Error ? error.stack : undefined;

export async function POST(request: Request) {
  const startTime = Date.now();
  try {
    try {
      validateAuth(request.headers);
    } catch (authError: unknown) {
      const message = getErrorMessage(authError, 'Unauthorized');
      return NextResponse.json({
        error: 'Unauthorized',
        type: 'AUTH_ERROR',
        details: message
      }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const scanPath = body.path as string | undefined;
    
    serverLog('info', 'scan', 'Scan API called', { path: scanPath });

    let resolvedScanPath: string;
    try {
      resolvedScanPath = resolveScanTarget(scanPath, {
        workspaceRoot: process.env.SANITY_GATE_ROOT,
        enforceWorkspaceRoot: (process.env.SANITY_GATE_ENFORCE_ROOT || '').toLowerCase() === 'true',
        baseDir: process.cwd()
      });
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Invalid path');
      serverLog('error', 'scan', 'Workspace constraint violation', { message });
      return NextResponse.json({
        error: message.includes('SECURITY_ERROR') ? 'Path is outside the workspace root' : 'Invalid scan path',
        type: message.includes('SECURITY_ERROR') ? 'SECURITY_ERROR' : 'VALIDATION_ERROR'
      }, { status: message.includes('SECURITY_ERROR') ? 403 : 400 });
    }

    // Use shared scan function
    const report = await scanProject(resolvedScanPath, serverLog);

    const totalDuration = Date.now() - startTime;
    serverLog('info', 'scan', 'Scan completed successfully', {
      project: report.project,
      issueCount: report.issues.length,
      filesScanned: report.stats.filesScanned,
      duration: totalDuration,
      issuesByCategory: report.issues.reduce((acc, issue) => {
        acc[issue.category] = (acc[issue.category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    });

    const normalizedRoot = report.rootPath || resolvedScanPath;
    const rootSignature = signPath(normalizedRoot) || report.rootSignature;
    return NextResponse.json({
      ...report,
      rootPath: normalizedRoot,
      rootSignature: rootSignature || undefined
    });

  } catch (error: unknown) {
    const totalDuration = Date.now() - startTime;
    
    // Parse error message to determine error type
    let errorType = 'UNKNOWN_ERROR';
    let errorMessage = getErrorMessage(error, 'Unknown error occurred');
    
    if (errorMessage.includes('VALIDATION_ERROR')) {
      errorType = 'VALIDATION_ERROR';
      errorMessage = errorMessage.replace('VALIDATION_ERROR: ', '');
    } else if (errorMessage.includes('PATH_NOT_FOUND')) {
      errorType = 'PATH_NOT_FOUND';
      errorMessage = errorMessage.replace('PATH_NOT_FOUND: ', '');
    } else if (errorMessage.includes('PERMISSION_DENIED')) {
      errorType = 'PERMISSION_DENIED';
      errorMessage = errorMessage.replace('PERMISSION_DENIED: ', '');
    } else if (errorMessage.includes('SECURITY_ERROR')) {
      errorType = 'SECURITY_ERROR';
      errorMessage = errorMessage.replace('SECURITY_ERROR: ', '');
    }

    serverLog('error', 'scan', 'Scan failed with exception', {
      error: errorMessage,
      type: errorType,
      stack: getErrorStack(error),
      duration: totalDuration
    });

    const statusCode = errorType === 'VALIDATION_ERROR' || errorType === 'PATH_NOT_FOUND' ? 400 :
                      errorType === 'PERMISSION_DENIED' || errorType === 'SECURITY_ERROR' ? 403 : 500;

    return NextResponse.json({
      error: 'Scan failed',
      type: errorType,
      details: errorMessage,
      timestamp: new Date().toISOString()
    }, { status: statusCode });
  }
}
