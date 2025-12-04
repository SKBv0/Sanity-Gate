import { NextResponse } from 'next/server';
import fs from 'fs';
import { createServerLogger } from '@/utils/server-logger';
import { resolveProjectRoot, resolvePreviewPath } from '@/utils/path-utils';
import { validateAuth, verifyPathSignature } from '@/utils/security';

const serverLog = createServerLogger('file-preview');

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

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
    const { filePath, projectRoot, signature } = body as { filePath?: string; projectRoot?: string; signature?: string };

    serverLog('info', 'file-preview', 'File preview API called', { filePath, projectRoot });

    let normalizedRoot: string;
    try {
      normalizedRoot = resolveProjectRoot(projectRoot);
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Invalid project root');
      let type: string = 'VALIDATION_ERROR';
      if (message.startsWith('PATH_NOT_FOUND')) {
        type = 'PATH_NOT_FOUND';
      } else if (message.startsWith('VALIDATION_ERROR')) {
        type = 'VALIDATION_ERROR';
      }
      serverLog('error', 'file-preview', 'Project root validation failed', { message });
      return NextResponse.json({
        error: message.replace(`${type}: `, ''),
        type
      }, { status: type === 'PATH_NOT_FOUND' ? 404 : 400 });
    }

    if (!verifyPathSignature(normalizedRoot, signature)) {
      serverLog('error', 'file-preview', 'Signature validation failed', { projectRoot });
      return NextResponse.json({
        error: 'Invalid or expired root signature',
        type: 'SECURITY_ERROR'
      }, { status: 403 });
    }

    let normalizedFullPath: string;
    try {
      normalizedFullPath = resolvePreviewPath(normalizedRoot, filePath);
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Invalid file path');
      const type = message.startsWith('SECURITY_ERROR') ? 'SECURITY_ERROR' : 'VALIDATION_ERROR';
      serverLog('error', 'file-preview', 'File preview path validation failed', { message });
      return NextResponse.json({
        error: message.replace(`${type}: `, ''),
        type
      }, { status: type === 'SECURITY_ERROR' ? 403 : 400 });
    }

    // Security: Check if file exists
    if (!fs.existsSync(normalizedFullPath)) {
      return NextResponse.json({
        error: 'File does not exist',
        type: 'PATH_NOT_FOUND'
      }, { status: 404 });
    }

    // Security: Verify it's a file, not a directory
    const stats = fs.statSync(normalizedFullPath);
    if (!stats.isFile()) {
      return NextResponse.json({
        error: 'Path is not a file',
        type: 'VALIDATION_ERROR'
      }, { status: 400 });
    }

    // Security: Prevent reading large files (> 1MB)
    if (stats.size > 1024 * 1024) {
      return NextResponse.json({
        error: 'File is too large to preview',
        type: 'FILE_TOO_LARGE'
      }, { status: 413 });
    }

    // Read file content
    const readStartTime = Date.now();
    const content = await fs.promises.readFile(normalizedFullPath, 'utf-8');
    const readDuration = Date.now() - readStartTime;
    
    // Split into lines for line-by-line display
    const lines = content.split('\n');

    const totalDuration = Date.now() - startTime;
    serverLog('info', 'file-preview', 'File preview loaded successfully', {
      filePath,
      lineCount: lines.length,
      size: stats.size,
      readDuration,
      totalDuration
    });

    return NextResponse.json({
      filePath: filePath,
      content: content,
      lines: lines,
      lineCount: lines.length,
      size: stats.size
    });

  } catch (error: unknown) {
    const totalDuration = Date.now() - startTime;
    const message = getErrorMessage(error, 'Unknown error');
    serverLog('error', 'file-preview', 'File preview failed', {
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
      duration: totalDuration
    });

    return NextResponse.json({
      error: 'Failed to read file',
      type: 'UNKNOWN_ERROR',
      details: message || 'Unknown error occurred'
    }, { status: 500 });
  }
}
