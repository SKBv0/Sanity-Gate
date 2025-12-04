/**
 * Centralized Logger Utility
 * Provides structured logging for debugging and analysis
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'performance';
type LogCategory = 
  | 'component' 
  | 'api' 
  | 'user-action' 
  | 'state-change' 
  | 'error' 
  | 'performance'
  | 'scan';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  component?: string;
  action?: string;
  message: string;
  data?: unknown;
  duration?: number;
}

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 1000; // Keep last 1000 logs in memory
  private enabled = true;

  constructor() {
    // Enable logging in development, disable in production
    if (typeof window !== 'undefined') {
      this.enabled = process.env.NODE_ENV === 'development' || 
                     localStorage.getItem('sanity-gate-debug') === 'true';
    }
  }

  private addLog(entry: LogEntry) {
    if (!this.enabled) return;

    this.logs.push(entry);
    
    // Keep only last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Console output with styling
    const style = this.getStyle(entry.level);
    const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.category}]`;
    
    // Format data for better console display
    const dataDisplay = entry.data 
      ? (typeof entry.data === 'object' ? JSON.stringify(entry.data, null, 2) : entry.data)
      : '';
    
    // Only log to console in development mode
    if (process.env.NODE_ENV === 'development') {
      if (entry.component) {
        if (dataDisplay) {
          console.log(`%c${prefix} [${entry.component}] ${entry.message}`, style, dataDisplay);
        } else {
          console.log(`%c${prefix} [${entry.component}] ${entry.message}`, style);
        }
      } else {
        if (dataDisplay) {
          console.log(`%c${prefix} ${entry.message}`, style, dataDisplay);
        } else {
          console.log(`%c${prefix} ${entry.message}`, style);
        }
      }
    }
  }

  private getStyle(level: LogLevel): string {
    const styles: Record<LogLevel, string> = {
      info: 'color: #06b6d4; font-weight: normal',
      warn: 'color: #eab308; font-weight: bold',
      error: 'color: #ef4444; font-weight: bold',
      debug: 'color: #888888; font-weight: normal',
      performance: 'color: #8b5cf6; font-weight: bold',
    };
    return styles[level] || '';
  }

  info(category: LogCategory, message: string, component?: string, data?: unknown) {
    this.addLog({
      timestamp: new Date().toISOString(),
      level: 'info',
      category,
      component,
      message,
      data,
    });
  }

  warn(category: LogCategory, message: string, component?: string, data?: unknown) {
    this.addLog({
      timestamp: new Date().toISOString(),
      level: 'warn',
      category,
      component,
      message,
      data,
    });
  }

  error(category: LogCategory, message: string, component?: string, data?: unknown) {
    this.addLog({
      timestamp: new Date().toISOString(),
      level: 'error',
      category,
      component,
      message,
      data,
    });
  }

  debug(category: LogCategory, message: string, component?: string, data?: unknown) {
    this.addLog({
      timestamp: new Date().toISOString(),
      level: 'debug',
      category,
      component,
      message,
      data,
    });
  }

  performance(action: string, duration: number, component?: string, data?: unknown) {
    this.addLog({
      timestamp: new Date().toISOString(),
      level: 'performance',
      category: 'performance',
      component,
      action,
      message: `Performance: ${action} took ${duration}ms`,
      duration,
      data,
    });
  }

  // Component lifecycle logging
  componentMount(component: string, props?: Record<string, unknown>) {
    this.info('component', `Component mounted: ${component}`, component, { props });
  }

  componentUnmount(component: string) {
    this.info('component', `Component unmounted: ${component}`, component);
  }

  componentUpdate(component: string, changes: Record<string, unknown>) {
    this.debug('component', `Component updated: ${component}`, component, { changes });
  }

  // User action logging
  userAction(action: string, component: string, data?: unknown) {
    this.info('user-action', `User action: ${action}`, component, data);
  }

  // State change logging
  stateChange(component: string, stateName: string, oldValue: unknown, newValue: unknown) {
    // Skip logging if both values are falsy (undefined/null) - initial mount
    if (!oldValue && !newValue) {
      return;
    }
    
    // Skip logging undefined -> null transitions (common in React)
    if (oldValue === undefined && newValue === null) {
      return;
    }
    
    // Skip logging if values are deeply equal (avoid spam)
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
      return;
    }
    
    // Compact logging for large objects (like ScanReport)
    const compactValue = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.length > 5
          ? { length: value.length, preview: value.slice(0, 5) }
          : value;
      }

      if (!value || typeof value !== 'object') {
        return value;
      }

      const record = value as Record<string, unknown>;
      
      // If it's a ScanReport-like object, only log summary
      if (Array.isArray(record.issues) && typeof record.project === 'string') {
        return {
          project: record.project,
          timestamp: record.timestamp,
          issueCount: record.issues.length,
          stats: record.stats
        };
      }

      // For large objects, limit keys
      const keys = Object.keys(record);
      if (keys.length > 10) {
        const compact: Record<string, unknown> = {};
        keys.slice(0, 10).forEach(key => {
          compact[key] = record[key];
        });
        compact['_truncated'] = `${keys.length - 10} more keys`;
        return compact;
      }
      
      return record;
    };
    
    this.debug('state-change', `State changed: ${stateName}`, component, {
      stateName,
      oldValue: compactValue(oldValue),
      newValue: compactValue(newValue),
    });
  }

  // API logging
  apiCall(method: string, endpoint: string, data?: unknown) {
    this.info('api', `API call: ${method} ${endpoint}`, 'api', { method, endpoint, data });
  }

  apiSuccess(method: string, endpoint: string, response: unknown, duration?: number) {
    this.info('api', `API success: ${method} ${endpoint}`, 'api', {
      method,
      endpoint,
      responseSize: JSON.stringify(response).length,
      duration,
    });
  }

  apiError(method: string, endpoint: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.error('api', `API error: ${method} ${endpoint}`, 'api', {
      method,
      endpoint,
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  // Scan specific logging
  scanStart(path: string) {
    this.info('scan', 'Scan started', undefined, { path });
  }

  scanStep(step: string, status: string, issueCount?: number) {
    this.info('scan', `Scan step: ${step} - ${status}`, undefined, { step, status, issueCount });
  }

  scanComplete(issueCount: number, duration: number) {
    this.performance('scan-complete', duration, undefined, { issueCount });
    this.info('scan', 'Scan completed', undefined, { issueCount, duration });
  }

  scanError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.error('scan', 'Scan failed', undefined, { error: message });
  }

  // Get all logs for export
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  // Export logs as JSON
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  // Clear logs
  clearLogs() {
    this.logs = [];
    this.info('component', 'Logs cleared', 'logger');
  }

  // Enable/disable logging
  enable() {
    this.enabled = true;
    this.info('component', 'Logging enabled', 'logger');
  }

  disable() {
    this.enabled = false;
    console.log('[Logger] Logging disabled');
  }
}

// Export singleton instance
export const logger = new Logger();

// Export types for use in components
export type { LogLevel, LogCategory, LogEntry };
