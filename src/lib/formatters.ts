import { ScanReport, Issue } from './scan';

const severityIcons: Record<string, string> = {
  info: '[i]',
  warning: '[!]',
  error: '[x]',
  critical: '[!!]'
};

const severityColors: Record<string, string> = {
  info: '\x1b[36m', // cyan
  warning: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
  critical: '\x1b[35m' // magenta
};

const resetColor = '\x1b[0m';

/**
 * Formats scan report as a human-readable table
 */
export function formatTable(report: ScanReport): string {
  const lines: string[] = [];
  
  // Header
  lines.push('='.repeat(80));
  lines.push(`  Sanity Gate - Scan Report`);
  lines.push('='.repeat(80));
  lines.push(`  Project: ${report.project}`);
  lines.push(`  Timestamp: ${new Date(report.timestamp).toLocaleString()}`);
  lines.push(`  Total Issues: ${report.issues.length}`);
  lines.push(`  Files Scanned: ${report.stats.filesScanned}`);
  lines.push(`  Orphans Found: ${report.stats.orphansFound}`);
  lines.push(`  Unused Dependencies: ${report.stats.unusedDeps}`);
  lines.push('='.repeat(80));
  lines.push('');

  if (report.issues.length === 0) {
    lines.push('  No issues found!');
    lines.push('');
    return lines.join('\n');
  }

  // Group issues by category
  const issuesByCategory: Record<string, Issue[]> = {};
  for (const issue of report.issues) {
    if (!issuesByCategory[issue.category]) {
      issuesByCategory[issue.category] = [];
    }
    issuesByCategory[issue.category].push(issue);
  }

  // Sort categories by issue count (descending)
  const sortedCategories = Object.entries(issuesByCategory).sort(
    ([, a], [, b]) => b.length - a.length
  );

  // Print issues by category
  for (const [category, categoryIssues] of sortedCategories) {
    lines.push(`  ${category.toUpperCase()} (${categoryIssues.length} issue${categoryIssues.length !== 1 ? 's' : ''})`);
    lines.push('-'.repeat(80));

    // Sort issues by severity (critical > error > warning > info)
    const severityOrder: Record<string, number> = { critical: 0, error: 1, warning: 2, info: 3 };
    const sortedIssues = categoryIssues.sort(
      (a, b) => (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99)
    );

    for (const issue of sortedIssues) {
      const icon = severityIcons[issue.severity] || '-';
      const color = severityColors[issue.severity] || '';
      const pathStr = issue.path ? ` [${issue.path}]` : '';
      
      lines.push(`  ${color}${icon}${resetColor} ${issue.message}${pathStr}`);
      
      if (issue.snippet) {
        const snippetLines = issue.snippet.split('\n').slice(0, 3);
        for (const snippetLine of snippetLines) {
          lines.push(`    ${snippetLine}`);
        }
      }
    }
    
    lines.push('');
  }

  // Summary by severity
  const severityCounts: Record<string, number> = {};
  for (const issue of report.issues) {
    severityCounts[issue.severity] = (severityCounts[issue.severity] || 0) + 1;
  }

  lines.push('-'.repeat(80));
  lines.push('  Summary by Severity:');
  for (const [severity, count] of Object.entries(severityCounts)) {
    const icon = severityIcons[severity] || '-';
    const color = severityColors[severity] || '';
    lines.push(`    ${color}${icon}${resetColor} ${severity.toUpperCase()}: ${count}`);
  }
  lines.push('='.repeat(80));

  return lines.join('\n');
}

/**
 * Formats scan report as JSON
 */
export function formatJSON(report: ScanReport): string {
  return JSON.stringify(report, null, 2);
}


