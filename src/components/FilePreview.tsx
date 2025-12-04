'use client';

import { useState, useEffect, useRef } from 'react';
import { X, FileText, Loader2 } from 'lucide-react';
import { Issue } from '@/lib/scan';
import { logger } from '@/utils/logger';

interface FilePreviewProps {
    issue: Issue | null;
    projectRoot: string;
    projectSignature?: string | null;
    onClose: () => void;
}

interface FileContent {
    filePath: string;
    content: string;
    lines: string[];
    lineCount: number;
    size: number;
}

const getApiHeaders = () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.NEXT_PUBLIC_SANITY_GATE_TOKEN) {
        headers['x-sanity-token'] = process.env.NEXT_PUBLIC_SANITY_GATE_TOKEN;
    }
    return headers;
};

export default function FilePreview({ issue, projectRoot, projectSignature, onClose }: FilePreviewProps) {
    const [fileContent, setFileContent] = useState<FileContent | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const mountedRef = useRef(false);

    useEffect(() => {
        // Only log mount once
        if (!mountedRef.current) {
            logger.componentMount('FilePreview', { 
                issueId: issue?.id,
                filePath: issue?.path,
                projectRoot
            });
            mountedRef.current = true;
        }

        if (!issue || !issue.path || !projectRoot) {
            setFileContent(null);
            return;
        }

        // Abort previous request if exists
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            logger.debug('component', 'Aborted previous file preview request', 'FilePreview');
        }

        // Create new abort controller
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const loadFile = async () => {
            const startTime = performance.now();
            setLoading(true);
            setError(null);
            logger.info('component', 'Loading file preview', 'FilePreview', {
                filePath: issue.path,
                projectRoot
            });

            try {
                logger.apiCall('POST', '/api/file-preview', {
                    filePath: issue.path,
                    projectRoot
                });
                const response = await fetch('/api/file-preview', {
                    method: 'POST',
                    headers: getApiHeaders(),
                    body: JSON.stringify({
                        filePath: issue.path,
                        projectRoot,
                        signature: projectSignature || undefined
                    }),
                    signal: abortController.signal
                });

                const duration = performance.now() - startTime;

                if (!response.ok) {
                    const errorData = await response.json();
                    logger.apiError('POST', '/api/file-preview', errorData);
                    logger.error('component', 'File preview failed', 'FilePreview', {
                        error: errorData.error,
                        duration
                    });
                    throw new Error(errorData.error || 'Failed to load file');
                }

                const data = await response.json();
                logger.apiSuccess('POST', '/api/file-preview', data, duration);
                logger.info('component', 'File preview loaded', 'FilePreview', {
                    lineCount: data.lineCount,
                    size: data.size,
                    duration
                });
                setFileContent(data);
            } catch (err: unknown) {
                const duration = performance.now() - startTime;
                // Check if error is due to abort
                if (err instanceof DOMException && err.name === 'AbortError') {
                    logger.debug('component', 'File preview request aborted', 'FilePreview');
                    return; // Don't set error state if aborted
                }

                const message = err instanceof Error ? err.message : 'Failed to load file';
                logger.error('component', 'File preview error', 'FilePreview', {
                    error: message,
                    duration
                });
                setError(message);
                setFileContent(null);
            } finally {
                setLoading(false);
            }
        };

        loadFile();

        return () => {
            // Abort request on unmount or dependency change
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            // Only log unmount if component is actually being destroyed
            if (mountedRef.current && (!issue || !issue.path || !projectRoot)) {
                logger.componentUnmount('FilePreview');
                mountedRef.current = false;
            }
        };
    }, [issue, projectRoot, projectSignature]);

    // Scroll to relevant line when content loads
    useEffect(() => {
        if (fileContent && scrollRef.current) {
            // Try to find the line with the issue (simple heuristic)
            // For now, scroll to top, but we could enhance this to find specific lines
            scrollRef.current.scrollTop = 0;
        }
    }, [fileContent]);

    if (!issue) return null;

    return (
        <div 
            className="file-preview-overlay"
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    onClose();
                }
            }}
        >
            <div className="file-preview-modal" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="file-preview-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                        <FileText size={18} color="var(--accent-cyan)" />
                        <div>
                            <div style={{ 
                                fontWeight: 600, 
                                fontSize: '0.9rem',
                                color: 'var(--text-main)'
                            }}>
                                {issue.path || 'File Preview'}
                            </div>
                            <div style={{ 
                                fontSize: '0.7rem',
                                color: 'var(--text-muted)',
                                marginTop: '0.25rem'
                            }}>
                                {issue.message}
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => {
                            logger.userAction('close-file-preview', 'FilePreview');
                            onClose();
                        }}
                        style={{
                            padding: '0.5rem',
                            borderRadius: 'var(--radius-sm)',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            transition: 'all 0.15s'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--bg-hover)';
                            e.currentTarget.style.color = 'var(--text-main)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = 'var(--text-muted)';
                        }}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div className="file-preview-body">
                    {loading && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '3rem',
                            color: 'var(--text-muted)',
                            gap: '0.75rem'
                        }}>
                            <Loader2 size={20} className="animate-spin" />
                            <span>Loading file...</span>
                        </div>
                    )}

                    {error && (
                        <div style={{
                            padding: '2rem',
                            textAlign: 'center',
                            color: 'var(--error)'
                        }}>
                            {error}
                        </div>
                    )}

                    {fileContent && !loading && (
                        <div 
                            ref={scrollRef}
                            className="file-preview-content"
                            style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '0.8rem',
                                lineHeight: '1.6',
                                color: 'var(--text-main)'
                            }}
                        >
                            {fileContent.lines.map((line, index) => {
                                const lineNumber = index + 1;
                                // Highlight lines that might be relevant (simple heuristic)
                                // You could enhance this to parse the issue message for line numbers
                                const isHighlighted = issue.snippet && 
                                    line.includes(issue.snippet.split('\n')[0]?.trim() || '');

                                return (
                                    <div
                                        key={index}
                                        style={{
                                            display: 'flex',
                                            padding: '0.25rem 0',
                                            background: isHighlighted 
                                                ? 'rgba(59, 130, 246, 0.1)' 
                                                : 'transparent',
                                            borderLeft: isHighlighted 
                                                ? '3px solid var(--accent-blue)' 
                                                : '3px solid transparent'
                                        }}
                                    >
                                        <div
                                            style={{
                                                minWidth: '50px',
                                                paddingRight: '1rem',
                                                paddingLeft: '0.5rem',
                                                textAlign: 'right',
                                                color: 'var(--text-dim)',
                                                userSelect: 'none',
                                                fontSize: '0.75rem'
                                            }}
                                        >
                                            {lineNumber}
                                        </div>
                                        <div
                                            style={{
                                                flex: 1,
                                                paddingRight: '1rem',
                                                whiteSpace: 'pre',
                                                wordBreak: 'break-all',
                                                overflowWrap: 'break-word'
                                            }}
                                        >
                                            {line || ' '}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {fileContent && (
                        <div style={{
                            padding: '0.75rem 1rem',
                            borderTop: '1px solid var(--border-subtle)',
                            background: 'var(--bg-panel)',
                            fontSize: '0.7rem',
                            color: 'var(--text-muted)',
                            display: 'flex',
                            justifyContent: 'space-between'
                        }}>
                            <span>{fileContent.lineCount} lines</span>
                            <span>{(fileContent.size / 1024).toFixed(2)} KB</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
