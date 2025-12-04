'use client';

import { useEffect, useRef } from 'react';
import { AlertTriangle, AlertCircle, Info, XCircle, FileText } from 'lucide-react';
import { Issue } from '@/lib/scan';
import clsx from 'clsx';
import { logger } from '@/utils/logger';

interface IssueStackProps {
    issues: Issue[];
    filter: string | null;
    onFilterChange: (category: string | null) => void;
    onIssueClick?: (issue: Issue) => void;
}

const severityIcons = {
    critical: XCircle,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
};

const severityColors = {
    critical: 'sev-critical',
    error: 'sev-error',
    warning: 'sev-warning',
    info: 'sev-info',
};

export default function IssueStack({ 
    issues, 
    filter, 
    onFilterChange, 
    onIssueClick 
}: IssueStackProps) {
    const mountDataRef = useRef({
        totalIssues: issues.length,
        filter
    });

    useEffect(() => {
        logger.componentMount('IssueStack', { 
            totalIssues: mountDataRef.current.totalIssues,
            filter: mountDataRef.current.filter
        });
        return () => {
            logger.componentUnmount('IssueStack');
        };
    }, []);

    const prevIssuesLengthRef = useRef(0);
    useEffect(() => {
        // Only log if issues actually changed (not initial mount)
        if (issues.length !== prevIssuesLengthRef.current && prevIssuesLengthRef.current > 0) {
            logger.debug('component', 'Issues updated', 'IssueStack', {
                count: issues.length,
                categories: Array.from(new Set(issues.map(i => i.category)))
            });
        }
        prevIssuesLengthRef.current = issues.length;
    }, [issues]);

    const prevFilterRef = useRef<string | null>(null);
    useEffect(() => {
        // Only log filter changes, not initial mount
        if (prevFilterRef.current !== null && prevFilterRef.current !== filter) {
            logger.debug('component', 'Filter changed', 'IssueStack', { 
                from: prevFilterRef.current,
                to: filter 
            });
        }
        prevFilterRef.current = filter;
    }, [filter]);

    const filteredIssues = filter 
        ? issues.filter(i => i.category === filter)
        : issues;

    const categories = Array.from(new Set(issues.map(i => i.category)));

    const handleIssueClick = (issue: Issue) => {
        if (onIssueClick && issue.path) {
            logger.userAction('issue-clicked', 'IssueStack', {
                issueId: issue.id,
                category: issue.category,
                path: issue.path,
                severity: issue.severity
            });
            onIssueClick(issue);
        } else {
            logger.debug('component', 'Issue clicked but no path or handler', 'IssueStack', {
                issueId: issue.id,
                hasPath: !!issue.path,
                hasHandler: !!onIssueClick
            });
        }
    };

    return (
        <div className="sidebar">
            {/* Header with Filters */}
            <div className="sidebar-header">
                <button
                    onClick={() => {
                        logger.userAction('filter-all', 'IssueStack');
                        onFilterChange(null);
                    }}
                    className={clsx("filter-pill", !filter && "active")}
                >
                    All ({issues.length})
                </button>
                {categories.map(cat => {
                    const count = issues.filter(i => i.category === cat).length;
                    if (count === 0) return null;
                    return (
                        <button
                            key={cat}
                            onClick={() => {
                                logger.userAction('filter-category', 'IssueStack', { category: cat, count });
                                onFilterChange(cat);
                            }}
                            className={clsx("filter-pill", filter === cat && "active")}
                        >
                            {cat} ({count})
                        </button>
                    );
                })}
            </div>

            {/* Issue List */}
            <div className="issue-list">
                {filteredIssues.length === 0 ? (
                    <div style={{ 
                        padding: '2rem', 
                        textAlign: 'center', 
                        color: 'var(--text-dim)' 
                    }}>
                        No issues found
                    </div>
                ) : (
                    filteredIssues.map((issue) => {
                        const Icon = severityIcons[issue.severity] || Info;
                        const severityClass = severityColors[issue.severity] || 'sev-info';

                        return (
                            <div
                                key={issue.id}
                                className={clsx("issue-item", issue.path && "clickable")}
                                onClick={() => handleIssueClick(issue)}
                                style={{ 
                                    cursor: issue.path ? 'pointer' : 'default' 
                                }}
                            >
                                <div className="issue-row">
                                    <Icon 
                                        size={16} 
                                        className={clsx("issue-icon", severityClass)}
                                        style={{ 
                                            color: `var(--${issue.severity === 'critical' ? 'critical' : issue.severity})` 
                                        }}
                                    />
                                    <div className="issue-content">
                                        {issue.path && (
                                            <div className="issue-path">
                                                <FileText size={12} style={{ 
                                                    display: 'inline', 
                                                    marginRight: '0.35rem',
                                                    verticalAlign: 'middle'
                                                }} />
                                                {issue.path}
                                            </div>
                                        )}
                                        <div className="issue-msg">
                                            {issue.message}
                                        </div>
                                        {issue.snippet && (
                                            <div style={{
                                                marginTop: '0.5rem',
                                                padding: '0.5rem',
                                                background: 'var(--bg-card)',
                                                borderRadius: 'var(--radius-sm)',
                                                fontFamily: 'var(--font-mono)',
                                                fontSize: '0.7rem',
                                                color: 'var(--text-muted)',
                                                whiteSpace: 'pre-wrap',
                                                wordBreak: 'break-all',
                                                maxHeight: '100px',
                                                overflow: 'auto'
                                            }}>
                                                {issue.snippet}
                                            </div>
                                        )}
                                        <div style={{ marginTop: '0.5rem' }}>
                                            <span className={clsx("severity-tag", severityClass)}>
                                                {issue.severity}
                                            </span>
                                            <span style={{ 
                                                marginLeft: '0.5rem', 
                                                fontSize: '0.7rem', 
                                                color: 'var(--text-dim)' 
                                            }}>
                                                {issue.category}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
