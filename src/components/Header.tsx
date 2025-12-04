'use client';

import { useState, useEffect, useRef } from 'react';
import { Scan, Zap, ChevronDown, Clock, Folder, Download } from 'lucide-react';
import { logger } from '@/utils/logger';

interface HeaderProps {
    projectName: string;
    isScanning: boolean;
    onScan: () => void;
    scanPath: string;
    onPathChange: (path: string) => void;
    onExport?: () => void;
    hasReport?: boolean;
}

export default function Header({ projectName, isScanning, onScan, scanPath, onPathChange, onExport, hasReport }: HeaderProps) {
    const [showRecent, setShowRecent] = useState(false);
    const [recentPaths, setRecentPaths] = useState<string[]>([]);
    const [storageError, setStorageError] = useState<string | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const mountPropsRef = useRef({ projectName, hasReport });

    useEffect(() => {
        logger.componentMount('Header', mountPropsRef.current);
        return () => {
            logger.componentUnmount('Header');
        };
    }, []);

    useEffect(() => {
        // Load recent paths from localStorage
        try {
            const stored = localStorage.getItem('sanity-gate-recent-paths');
            if (stored) {
                try {
                    const paths = JSON.parse(stored);
                    // eslint-disable-next-line react-hooks/set-state-in-effect
                    setRecentPaths(paths);
                    logger.info('component', `Loaded ${paths.length} recent paths`, 'Header', { count: paths.length });
                    setStorageError(null);
                } catch (error) {
                    logger.error('component', 'Failed to parse recent paths from localStorage', 'Header', { error });
                    setStorageError('Failed to read saved folder paths. The list may have been cleared.');
                }
            }
        } catch (error) {
            logger.error('component', 'Unable to access localStorage', 'Header', { error });
            setStorageError('Cannot access browser storage; recent folders will not be saved.');
        }
    }, []);

    const persistRecentPaths = (paths: string[]) => {
        try {
            localStorage.setItem('sanity-gate-recent-paths', JSON.stringify(paths));
            setStorageError(null);
        } catch (error) {
            logger.error('component', 'Failed to persist recent paths', 'Header', { error });
            setStorageError('Failed to save recent folders (browser may be blocking storage).');
        }
    };

    useEffect(() => {
        // Close dropdown when clicking outside
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowRecent(false);
                logger.userAction('close-recent-dropdown', 'Header');
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const addToRecent = (path: string) => {
        if (!path.trim()) return;
        const updated = [path, ...recentPaths.filter(p => p !== path)].slice(0, 5);
        setRecentPaths(updated);
        persistRecentPaths(updated);
        logger.info('component', 'Added path to recent', 'Header', { path, totalRecent: updated.length });
    };

    const handleScan = () => {
        logger.userAction('scan-button-clicked', 'Header', { scanPath });
        addToRecent(scanPath);
        onScan();
    };

    const selectPath = (path: string) => {
        logger.userAction('select-recent-path', 'Header', { path });
        onPathChange(path);
        setShowRecent(false);
    };
    return (
        <>
        <header className="header">
            {/* Brand */}
            <div className="brand">
                <Zap size={18} className="brand-icon" />
                <span>Sanity Gate</span>
            </div>

            {/* Path Input with Dropdown */}
            <div className="path-input-container" style={{ position: 'relative', flex: 1, maxWidth: '480px' }} ref={dropdownRef}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <label htmlFor="scan-path-input" className="sr-only">
                        Project Path
                    </label>
                    <input
                        id="scan-path-input"
                        type="text"
                        className="path-input"
                        placeholder="Enter path to scan (e.g., D:\\projects\\app or ./packages/api)"
                        value={scanPath}
                        onChange={(e) => {
                            logger.userAction('path-input-changed', 'Header', { 
                                oldValue: scanPath, 
                                newValue: e.target.value 
                            });
                            onPathChange(e.target.value);
                        }}
                        disabled={isScanning}
                        style={{ flex: 1 }}
                        aria-label="Enter project path to scan"
                    />
                    {/* Recent Paths Button */}
                    {recentPaths.length > 0 && (
                        <button
                            onClick={() => {
                                logger.userAction('toggle-recent-dropdown', 'Header', { 
                                    willShow: !showRecent 
                                });
                                setShowRecent(!showRecent);
                            }}
                            disabled={isScanning}
                            className="btn-scan"
                            style={{
                                background: 'var(--bg-panel)',
                                border: '1px solid var(--border-subtle)',
                                padding: '0 0.75rem',
                                opacity: showRecent ? 1 : 0.7
                            }}
                            title="Recent Paths"
                        >
                            <ChevronDown size={14} color="var(--text-muted)" style={{
                                transform: showRecent ? 'rotate(180deg)' : 'none',
                                transition: 'transform 0.2s'
                            }} />
                        </button>
                    )}
                </div>

                {/* Recent Paths Dropdown */}
                {showRecent && recentPaths.length > 0 && (
                    <div style={{
                        position: 'absolute',
                        top: 'calc(100% + 0.5rem)',
                        left: 0,
                        right: 0,
                        background: 'var(--bg-panel)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        zIndex: 100,
                        maxHeight: '200px',
                        overflowY: 'auto',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                    }}>
                        <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.7rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Clock size={12} />
                            <span>RECENT PATHS</span>
                        </div>
                        {recentPaths.map((path, idx) => (
                            <button
                                key={idx}
                                onClick={() => selectPath(path)}
                                style={{
                                    width: '100%',
                                    padding: '0.75rem',
                                    textAlign: 'left',
                                    background: 'transparent',
                                    border: 'none',
                                    borderBottom: idx < recentPaths.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                                    color: 'var(--text-main)',
                                    fontSize: '0.8rem',
                                    fontFamily: 'var(--font-mono)',
                                    cursor: 'pointer',
                                    transition: 'background 0.15s',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.75rem'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            >
                                <Folder size={14} color="var(--text-dim)" />
                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {path}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {storageError && (
                <div style={{
                    fontSize: '0.75rem',
                    color: 'var(--warning)',
                    marginTop: '0.25rem'
                }}>
                    {storageError}
                </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
                {hasReport && onExport && (
                    <button
                        onClick={() => {
                            logger.userAction('export-button-clicked', 'Header');
                            onExport?.();
                        }}
                        className="btn-scan"
                        style={{
                            background: 'var(--bg-panel)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-main)'
                        }}
                        title="Export Report"
                    >
                        <Download size={14} />
                        <span>Export</span>
                    </button>
                )}

                <button
                    onClick={handleScan}
                    disabled={isScanning}
                    className="btn-scan"
                >
                    {isScanning ? (
                        <span>Scanning...</span>
                    ) : (
                        <>
                            <Scan size={14} />
                            <span>Execute Scan</span>
                        </>
                    )}
                </button>
            </div>
        </header>
        </>
    );
}
