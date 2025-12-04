'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Copy, Check } from 'lucide-react';
import clsx from 'clsx';
import { ScanReport, Issue } from '@/lib/scan';
import { logger } from '@/utils/logger';

type TabKey = 'summary' | 'json' | 'prompt';
const TABS: TabKey[] = ['summary', 'json', 'prompt'];

type CompactIssue = {
    id: string;
    category: Issue['category'];
    type: string;
    severity: Issue['severity'];
    suggestedAction: string;
    path?: string;
    snippet?: string;
};

interface EnvGroup {
    count: number;
    vars: string[];
    action: string;
}

interface DependencyGroup {
    unused?: string[];
    unpinned?: string[];
    missing?: string[];
}

interface CompactReportPayload {
    project: string;
    timestamp: string;
    stats: ScanReport['stats'];
    issues: CompactIssue[];
    grouped?: {
        envVars?: EnvGroup;
        dependencies?: DependencyGroup;
    };
}

const actionMap: Record<string, string> = {
    'EMPTY_DIR': 'delete directory',
    'ZERO_BYTE_FILE': 'delete file',
    'BACKUP_FILE': 'delete file',
    'ORPHAN_ASSET': 'delete asset',
    'ORPHAN_MODULE': 'delete file or add import',
    'UNUSED_DEP': 'remove from package.json',
    'UNUSED_DEV_DEP': 'remove from package.json',
    'MISSING_DEP': 'add to package.json',
    'UNPINNED_VERSION': 'pin version in package.json',
    'HARDCODED_SECRET': 'move to environment variable',
    'CONSOLE_LOG': 'remove or wrap in dev check',
    'TODO_COMMENT': 'resolve or remove',
    'SYNC_IO': 'convert to async',
    'MISSING_METADATA': 'add metadata export',
    'MISSING_ALT': 'add alt attribute',
    'MISSING_LABEL': 'add label or aria-label',
    'MISSING_ENV_VAR': 'add to .env file',
    'LARGE_FILE': 'optimize or split',
    'UNCOMMITTED_CHANGES': 'commit or stash',
    'BUILD_FAILURE': 'fix TypeScript errors',
    'VIRAL_LICENSE': 'review license compatibility'
};

const getDefaultAction = (issue: Issue): string =>
    actionMap[issue.type] || 'review and fix';

const buildCompactReport = (report: ScanReport): CompactReportPayload => {
    const compactIssues: CompactIssue[] = report.issues.map(issue => {
        const compact: CompactIssue = {
            id: issue.id,
            category: issue.category,
            type: issue.type,
            severity: issue.severity,
            suggestedAction: issue.suggestedAction || getDefaultAction(issue)
        };
        if (issue.path) compact.path = issue.path;
        if (issue.snippet && !issue.snippet.includes('***REDACTED***') && issue.snippet.length < 200) {
            compact.snippet = issue.snippet;
        }
        return compact;
    });

    const envIssues = compactIssues.filter(i => i.category === 'env');
    const depIssues = compactIssues.filter(i => i.category === 'dependencies');

    const envVars = envIssues
        .map(i => {
            const match = i.id.match(/missing-env-(.+)/);
            return match ? match[1] : null;
        })
        .filter((value): value is string => Boolean(value));

    const unusedDeps = depIssues
        .filter(i => i.type === 'UNUSED_DEP' || i.type === 'UNUSED_DEV_DEP')
        .map(i => {
            const match = i.id.match(/unused-(?:dev-)?dep-(.+)/);
            if (match) return match[1];
            return i.id.replace(/^unused-(?:dev-)?dep-/, '');
        })
        .filter((value): value is string => Boolean(value));

    const unpinnedDeps = depIssues
        .filter(i => i.type === 'UNPINNED_VERSION')
        .map(i => {
            const match = i.id.match(/unpinned-(?:dependency|devDependency)-(.+)/);
            return match ? match[1] : null;
        })
        .filter((value): value is string => Boolean(value));

    const missingDeps = depIssues
        .filter(i => i.type === 'MISSING_DEP')
        .map(i => {
            const match = i.id.match(/missing-dep-(.+)/);
            return match ? match[1] : null;
        })
        .filter((value): value is string => Boolean(value));

    const grouped: CompactReportPayload['grouped'] = {};

    if (envVars.length > 0) {
        grouped.envVars = {
            count: envVars.length,
            vars: envVars,
            action: 'add all to .env file'
        };
    }

    if (unusedDeps.length > 0 || unpinnedDeps.length > 0 || missingDeps.length > 0) {
        grouped.dependencies = {};
        if (unusedDeps.length > 0) grouped.dependencies.unused = unusedDeps;
        if (unpinnedDeps.length > 0) grouped.dependencies.unpinned = unpinnedDeps;
        if (missingDeps.length > 0) grouped.dependencies.missing = missingDeps;
    }

    const result: CompactReportPayload = {
        project: report.project,
        timestamp: report.timestamp,
        stats: report.stats,
        issues: compactIssues
    };

    if (grouped.envVars || grouped.dependencies) {
        result.grouped = grouped;
    }

    return result;
};

const buildSummaryText = (report: ScanReport): string => {
    const categories = ['git', 'filesystem', 'assets', 'orphans', 'dependencies', 'licenses', 'security', 'env', 'seo', 'accessibility', 'code-quality', 'performance', 'build'];
    const categoryLabels: Record<string, string> = {
        'git': 'GIT',
        'filesystem': 'FILESYSTEM',
        'assets': 'ASSETS',
        'orphans': 'ORPHAN MODULES',
        'dependencies': 'DEPENDENCIES',
        'licenses': 'LICENSES',
        'security': 'SECURITY',
        'env': 'ENVIRONMENT',
        'seo': 'SEO',
        'accessibility': 'ACCESSIBILITY',
        'code-quality': 'CODE QUALITY',
        'performance': 'PERFORMANCE',
        'build': 'BUILD'
    };
    const severityOrder: Issue['severity'][] = ['critical', 'error', 'warning', 'info'];
    const severityLabels: Record<Issue['severity'], string> = {
        critical: 'CRITICAL',
        error: 'ERROR',
        warning: 'WARNING',
        info: 'INFO'
    };
    const severityIcons: Record<Issue['severity'], string> = {
        critical: '!!',
        error: 'X',
        warning: '!',
        info: 'i'
    };

    let summary = `Project: ${report.project}\nTimestamp: ${report.timestamp}\n\n`;

    categories.forEach(cat => {
        const catIssues = report.issues.filter(i => i.category === cat);
        if (catIssues.length === 0) return;

        summary += `${categoryLabels[cat]} (${catIssues.length})\n`;

        severityOrder.forEach(sev => {
            const sevIssues = catIssues.filter(i => i.severity === sev);
            if (sevIssues.length === 0) return;

            summary += `  ${severityIcons[sev]} ${severityLabels[sev]} (${sevIssues.length})\n`;

            const details = sevIssues.slice(0, 3);
            details.forEach(issue => {
                const pathInfo = issue.path ? ` [${issue.path}]` : '';
                const action = issue.suggestedAction || getDefaultAction(issue);
                summary += `    - ${issue.message}${pathInfo} -> ${action}\n`;
            });

            if (sevIssues.length > details.length) {
                summary += `    ... ${sevIssues.length - details.length} more\n`;
            }
        });

        summary += '\n';
    });

    return summary;
};

const buildPromptText = (report: ScanReport, compactReport: CompactReportPayload): string => `You are an expert software developer.

I ran a static hygiene tool on my project "${report.project}" and it produced this report:

[REPORT START]
${JSON.stringify(compactReport, null, 2)}
[REPORT END]

TASK:
- For each issue, determine:
  - whether it is safe to auto-fix (based on severity and type)
  - what exact change should be made (file path + specific operation)
- Group fixes by category:
  - filesystem cleanup (empty dirs, backup files, orphan assets)
  - code changes (orphan modules, missing deps, code quality)
  - security fixes (hardcoded secrets, env vars)
  - configuration (dependencies, licenses, build)
- Output format: JSON array with this structure:
  [
    {
      "issueId": "...",
      "safeToAutoFix": true/false,
      "action": "delete_file | remove_import | add_dependency | fix_code | ...",
      "target": "file/path",
      "details": "specific change description"
    }
  ]

Important:
- Do NOT invent new files or features
- Do NOT change build system configuration
- Focus ONLY on the listed issues
- If suggestedAction is provided, use it as guidance
- For grouped.envVars: treat as single batch operation (add all vars to .env)
- For grouped.dependencies: handle unused (remove), unpinned (pin versions), missing (add) separately`;

interface LLMPanelProps {
    report: ScanReport | null;
}

export default function LLMPanel({ report }: LLMPanelProps) {
    const [activeTab, setActiveTab] = useState<TabKey>('prompt');
    const [copied, setCopied] = useState(false);
    const mountInfoRef = useRef({ hasReport: !!report });

    useEffect(() => {
        logger.componentMount('LLMPanel', mountInfoRef.current);
        return () => {
            logger.componentUnmount('LLMPanel');
        };
    }, []);

    const prevTabRef = useRef<TabKey | null>(null);
    useEffect(() => {
        // Only log if tab actually changed (not initial mount)
        if (prevTabRef.current !== null && prevTabRef.current !== activeTab) {
            logger.stateChange('LLMPanel', 'activeTab', prevTabRef.current, activeTab);
        }
        prevTabRef.current = activeTab;
    }, [activeTab]);

    const compactReport = useMemo<CompactReportPayload | null>(() => (
        report ? buildCompactReport(report) : null
    ), [report]);

    if (!report || !compactReport) {
        return null;
    }

    const getContent = (tab: TabKey) => {
        switch (tab) {
            case 'summary':
                return buildSummaryText(report);
            case 'json':
                return JSON.stringify(compactReport, null, 2);
            case 'prompt':
            default:
                return buildPromptText(report, compactReport);
        }
    };

    const handleCopy = () => {
        logger.userAction('copy-llm-content', 'LLMPanel', { tab: activeTab });
        const content = getContent(activeTab);
        navigator.clipboard.writeText(content);
        logger.info('component', 'Content copied to clipboard', 'LLMPanel', {
            tab: activeTab,
            contentLength: content.length
        });
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="terminal-panel">
            {/* Header / Tabs */}
            <div className="terminal-header">
                <div className="term-tabs">
                    {TABS.map((tab) => (
                        <button
                            key={tab}
                            onClick={() => {
                                logger.userAction('switch-llm-tab', 'LLMPanel', {
                                    from: activeTab,
                                    to: tab
                                });
                                setActiveTab(tab);
                            }}
                            className={clsx("term-tab", activeTab === tab && "active")}
                        >
                            {tab === 'prompt' ? 'LLM Prompt' : tab}
                        </button>
                    ))}
                </div>

                <button
                    onClick={handleCopy}
                    className="btn-copy"
                >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? 'Copied' : 'Copy'}
                </button>
            </div>

            {/* Content Area */}
            <div className="terminal-body">
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {getContent(activeTab)}
                </pre>
            </div>
        </div>
    );
}
