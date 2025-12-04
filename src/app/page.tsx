'use client';

import { useState, useEffect } from 'react';
import Header from '@/components/Header';
import ScanFlow, { ScanStepStatus } from '@/components/ScanFlow';
import IssueMap, { IssueMapCategory } from '@/components/IssueMap';
import IssueStack from '@/components/IssueStack';
import LLMPanel from '@/components/LLMPanel';
import FilePreview from '@/components/FilePreview';
import { FolderOpen, Link2, Package, PlayCircle, Image as ImageIcon, Shield, Zap, Code, GitBranch, Search, Eye, Scale } from 'lucide-react';
import { ScanReport, Issue } from '@/lib/scan';
import { logger } from '@/utils/logger';

type SanityGateWindow = Window & {
  sanityGateLogger?: typeof logger;
};

const getErrorDetails = (error: unknown) => {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: typeof error === 'string' ? error : 'Unknown error', stack: undefined };
};

const getApiHeaders = () => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.NEXT_PUBLIC_SANITY_GATE_TOKEN) {
    headers['x-sanity-token'] = process.env.NEXT_PUBLIC_SANITY_GATE_TOKEN;
  }
  return headers;
};

export default function Home() {
  const [isScanning, setIsScanning] = useState(false);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [scanPath, setScanPath] = useState('');
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [resolvedProjectRoot, setResolvedProjectRoot] = useState('');
  const [rootSignature, setRootSignature] = useState<string | null>(null);

  useEffect(() => {
    logger.componentMount('Home');
    
    // Make logger available globally for debugging
    if (typeof window !== 'undefined') {
      (window as SanityGateWindow).sanityGateLogger = logger;
      logger.info('component', 'Logger exposed to window.sanityGateLogger', 'Home');
    }

    return () => {
      logger.componentUnmount('Home');
    };
  }, []);

  // Scan Steps State - Updated with new categories
  const [steps, setSteps] = useState([
    { id: 'git', label: 'Git Status', icon: <GitBranch size={16} />, status: 'idle' as ScanStepStatus, issueCount: 0 },
    { id: 'filesystem', label: 'File System', icon: <FolderOpen size={16} />, status: 'idle' as ScanStepStatus, issueCount: 0 },
    { id: 'assets', label: 'Assets', icon: <ImageIcon size={16} />, status: 'idle' as ScanStepStatus, issueCount: 0 },
    { id: 'orphans', label: 'Orphans', icon: <Link2 size={16} />, status: 'idle' as ScanStepStatus, issueCount: 0 },
    { id: 'dependencies', label: 'Dependencies', icon: <Package size={16} />, status: 'idle' as ScanStepStatus, issueCount: 0 },
    { id: 'licenses', label: 'Licenses', icon: <Scale size={16} />, status: 'idle' as ScanStepStatus, issueCount: 0 },
    { id: 'security', label: 'Security', icon: <Shield size={16} />, status: 'idle' as ScanStepStatus, issueCount: 0 },
    { id: 'env', label: 'Env Check', icon: <Shield size={16} />, status: 'idle' as ScanStepStatus, issueCount: 0 },
    { id: 'seo', label: 'SEO', icon: <Search size={16} />, status: 'idle' as ScanStepStatus, issueCount: 0 },
    { id: 'accessibility', label: 'A11y', icon: <Eye size={16} />, status: 'idle' as ScanStepStatus, issueCount: 0 },
    { id: 'code-quality', label: 'Code Quality', icon: <Code size={16} />, status: 'idle' as ScanStepStatus, issueCount: 0 },
    { id: 'performance', label: 'Performance', icon: <Zap size={16} />, status: 'idle' as ScanStepStatus, issueCount: 0 },
    { id: 'build', label: 'Build', icon: <PlayCircle size={16} />, status: 'idle' as ScanStepStatus, issueCount: 0 },
  ]);

  const runScan = async () => {
    const scanStartTime = performance.now();
    logger.scanStart(scanPath);
    logger.userAction('scan-initiated', 'Home', { scanPath });
    
    setIsScanning(true);
    setReport(null);
    setSelectedIssue(null);
    setResolvedProjectRoot('');
    setRootSignature(null);

    // Reset steps
    setSteps(s => s.map(step => ({ ...step, status: 'idle', issueCount: 0 })));
    logger.info('component', 'Scan steps reset', 'Home');

    try {
      // Simulate step-by-step progress for visual feedback
      const updateStep = (id: string, status: ScanStepStatus) => {
        setSteps(prev => prev.map(s => s.id === id ? { ...s, status } : s));
        logger.scanStep(id, status);
      };

      updateStep('git', 'running');
      // Removed initial delay - API call starts immediately

      // Start actual fetch
      const sanitizedPath = scanPath.trim();
      logger.apiCall('POST', '/api/scan', { path: sanitizedPath || '.' });
      const apiStartTime = performance.now();
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({ path: sanitizedPath || '.' })
      });
      const apiDuration = performance.now() - apiStartTime;

      // Handle error responses
      if (!res.ok) {
        const errorData = await res.json();
        const errorMessage = errorData.details || errorData.error || 'Scan failed';
        const errorType = errorData.type || 'UNKNOWN';

        logger.apiError('POST', '/api/scan', errorData);
        logger.scanError(errorData);

        // User-friendly error messages
        let userMessage = errorMessage;
        if (errorType === 'PATH_NOT_FOUND') {
          userMessage = `Path not found: ${errorData.path || scanPath}`;
        } else if (errorType === 'PERMISSION_DENIED') {
          userMessage = 'Permission denied. Try running as administrator or choose a different path.';
        } else if (errorType === 'SECURITY_ERROR') {
          userMessage = errorMessage + ' Please choose a project directory.';
        } else if (errorType === 'VALIDATION_ERROR') {
          userMessage = errorMessage;
        }

        alert(`Scan Error:\n\n${userMessage}`);
        setSteps(s => s.map(step => step.status === 'running' ? { ...step, status: 'failed' } : step));
        return;
      }

      const data: ScanReport = await res.json();
      logger.apiSuccess('POST', '/api/scan', data, apiDuration);
      logger.info('scan', `Scan API returned ${data.issues.length} issues`, 'Home', {
        issueCount: data.issues.length,
        project: data.project,
        filesScanned: data.stats.filesScanned
      });

      // Update steps sequentially for effect (reduced delay for better performance)
      const categories = ['git', 'filesystem', 'assets', 'orphans', 'dependencies', 'licenses', 'security', 'env', 'seo', 'accessibility', 'code-quality', 'performance', 'build'];

      // Batch update all steps at once for better performance
      const stepUpdates = categories.map(cat => {
        const count = data.issues.filter(i => i.category === cat).length;
        return { id: cat, count };
      });

      // Update steps with progressive delay for visual feedback
      for (let i = 0; i < categories.length; i++) {
        const cat = categories[i];
        updateStep(cat, 'running');
        
        // Progressive delay: first steps slower, later steps faster
        let delay = 40;
        if (i < 3) delay = 30; // First 3 steps: 30ms
        else if (i < 10) delay = 20; // Middle steps: 20ms
        else delay = 10; // Last steps: 10ms
        
        await new Promise(r => setTimeout(r, delay));
        const count = stepUpdates[i].count;
        setSteps(prev => prev.map(s => s.id === cat ? { ...s, status: 'completed', issueCount: count } : s));
        logger.scanStep(cat, 'completed', count);
      }

      setReport(data);
      setResolvedProjectRoot(data.rootPath || '');
      setRootSignature(data.rootSignature || null);
      logger.stateChange('Home', 'report', null, data);

      const totalDuration = performance.now() - scanStartTime;
      logger.scanComplete(data.issues.length, totalDuration);
      logger.performance('full-scan', totalDuration, 'Home', {
        issueCount: data.issues.length,
        categoriesProcessed: categories.length
      });

    } catch (error: unknown) {
      const { message, stack } = getErrorDetails(error);
      logger.error('scan', 'Scan failed with exception', 'Home', { 
        error: message,
        stack
      });
      logger.scanError(error);

      const errorMessage = message || 'Network error or server unavailable';
      alert(`Scan Failed:\n\n${errorMessage}\n\nPlease check the console for details.`);

      setSteps(s => s.map(step => step.status === 'running' ? { ...step, status: 'failed' } : step));
    } finally {
      setIsScanning(false);
      logger.stateChange('Home', 'isScanning', true, false);
    }
  };

  const handleExport = () => {
    if (!report) {
      logger.warn('component', 'Export attempted but no report available', 'Home');
      return;
    }
    
    logger.userAction('export-report', 'Home', { 
      project: report.project,
      issueCount: report.issues.length 
    });
    
    const jsonString = JSON.stringify(report, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filename = `sanity-report-${report.project}-${new Date().toISOString().slice(0, 10)}.json`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    logger.info('component', 'Report exported', 'Home', { filename, size: jsonString.length });
  };

  // Derived state for IssueMap
  const categories: IssueMapCategory[] = [
    {
      id: 'git',
      label: 'Git',
      count: report?.issues.filter(i => i.category === 'git').length || 0,
      severity: report?.issues.some(i => i.category === 'git' && i.severity === 'error') ? 'high' : 'medium'
    },
    {
      id: 'filesystem',
      label: 'File System',
      count: report?.issues.filter(i => i.category === 'filesystem').length || 0,
      severity: report?.issues.some(i => i.category === 'filesystem' && i.severity === 'error') ? 'high' : 'low'
    },
    {
      id: 'assets',
      label: 'Assets',
      count: report?.issues.filter(i => i.category === 'assets').length || 0,
      severity: 'low'
    },
    {
      id: 'orphans',
      label: 'Orphans',
      count: report?.issues.filter(i => i.category === 'orphans').length || 0,
      severity: 'medium'
    },
    {
      id: 'dependencies',
      label: 'Dependencies',
      count: report?.issues.filter(i => i.category === 'dependencies').length || 0,
      severity: 'high'
    },
    {
      id: 'licenses',
      label: 'Licenses',
      count: report?.issues.filter(i => i.category === 'licenses').length || 0,
      severity: 'high'
    },
    {
      id: 'security',
      label: 'Security',
      count: report?.issues.filter(i => i.category === 'security').length || 0,
      severity: 'high'
    },
    {
      id: 'env',
      label: 'Env',
      count: report?.issues.filter(i => i.category === 'env').length || 0,
      severity: 'high'
    },
    {
      id: 'seo',
      label: 'SEO',
      count: report?.issues.filter(i => i.category === 'seo').length || 0,
      severity: 'medium'
    },
    {
      id: 'accessibility',
      label: 'A11y',
      count: report?.issues.filter(i => i.category === 'accessibility').length || 0,
      severity: 'medium'
    },
    {
      id: 'code-quality',
      label: 'Code Quality',
      count: report?.issues.filter(i => i.category === 'code-quality').length || 0,
      severity: 'medium'
    },
    {
      id: 'performance',
      label: 'Performance',
      count: report?.issues.filter(i => i.category === 'performance').length || 0,
      severity: 'medium'
    },
    {
      id: 'build',
      label: 'Build',
      count: report?.issues.filter(i => i.category === 'build').length || 0,
      severity: 'none'
    },
  ];

  return (
    <div className="app-layout">
      <Header
        projectName={report?.project || 'Sanity Gate'}
        isScanning={isScanning}
        onScan={runScan}
        scanPath={scanPath}
        onPathChange={setScanPath}
        onExport={handleExport}
        hasReport={!!report}
      />

      <main className="main-stage">
        {/* Left/Center Stage: Flow & Map */}
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <ScanFlow steps={steps} />

            <div style={{
              opacity: isScanning || report ? 1 : 0.3,
              pointerEvents: isScanning || report ? 'auto' : 'none',
              transition: 'opacity 0.3s',
              marginBottom: '2rem'
            }}>
              <IssueMap
                categories={categories}
                selectedCategory={selectedCategory}
                onSelect={(id) => {
                  logger.userAction('select-category', 'Home', { 
                    category: id,
                    previousCategory: selectedCategory 
                  });
                  logger.stateChange('Home', 'selectedCategory', selectedCategory, id);
                  setSelectedCategory(id);
                }}
              />
            </div>
          </div>

          {/* Bottom Panel */}
          <LLMPanel report={report} />
        </div>

        {/* Right Sidebar: Issue Stack */}
        <div style={{ height: '100%', overflow: 'hidden' }}>
          <IssueStack
            issues={report?.issues || []}
            filter={selectedCategory}
            onFilterChange={(category) => {
              logger.userAction('filter-issues', 'Home', { category });
              logger.stateChange('Home', 'selectedCategory', selectedCategory, category);
              setSelectedCategory(category);
            }}
            onIssueClick={(issue) => {
              logger.userAction('select-issue', 'Home', { 
                issueId: issue.id,
                category: issue.category,
                path: issue.path 
              });
              setSelectedIssue(issue);
            }}
          />
        </div>
      </main>

      {/* File Preview Modal */}
      {selectedIssue && resolvedProjectRoot && (
        <FilePreview
          issue={selectedIssue}
          projectRoot={resolvedProjectRoot}
          projectSignature={rootSignature}
          onClose={() => {
            logger.userAction('close-file-preview', 'Home');
            setSelectedIssue(null);
          }}
        />
      )}
    </div>
  );
}
