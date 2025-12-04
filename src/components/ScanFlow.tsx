'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Check, AlertTriangle, Loader2, Circle } from 'lucide-react';
import clsx from 'clsx';
import { logger } from '@/utils/logger';

export type ScanStepStatus = 'idle' | 'running' | 'completed' | 'failed';

interface ScanStep {
    id: string;
    label: string;
    icon: ReactNode;
    status: ScanStepStatus;
    issueCount: number;
}

interface ScanFlowProps {
    steps: ScanStep[];
}

export default function ScanFlow({ steps }: ScanFlowProps) {
    const mountDataRef = useRef({ stepCount: steps.length });

    useEffect(() => {
        logger.componentMount('ScanFlow', mountDataRef.current);
        return () => {
            logger.componentUnmount('ScanFlow');
        };
    }, []);

    const prevStepsRef = useRef<ScanStep[]>([]);
    useEffect(() => {
        // Only log if steps actually changed significantly
        const activeSteps = steps.filter(s => s.status === 'running');
        const completedSteps = steps.filter(s => s.status === 'completed');
        const prevCompleted = prevStepsRef.current.filter(s => s.status === 'completed').length;
        
        // Only log when completion count changes (not on every render)
        if (completedSteps.length !== prevCompleted) {
            logger.debug('component', 'ScanFlow steps updated', 'ScanFlow', {
                active: activeSteps.length,
                completed: completedSteps.length,
                total: steps.length
            });
        }
        prevStepsRef.current = steps;
    }, [steps]);

    return (
        <div className="pipeline-container">
            {steps.map((step) => {
                const isActive = step.status === 'running';
                const isDone = step.status === 'completed';
                const hasIssues = step.issueCount > 0;

                return (
                    <div key={step.id} className={clsx("pipeline-step", isActive && "active")}>
                        <div className="step-status-icon">
                            {isActive ? (
                                <Loader2 size={16} className="animate-spin" color="var(--text-main)" />
                            ) : isDone ? (
                                hasIssues ? <AlertTriangle size={16} color="var(--warning)" /> : <Check size={16} color="var(--success)" />
                            ) : (
                                <Circle size={12} strokeWidth={2} />
                            )}
                        </div>

                        <div className="step-label">
                            {step.label}
                        </div>

                        <div className="step-meta">
                            {isActive && "Processing..."}
                            {step.status === 'idle' && "Pending"}
                            {isDone && (
                                hasIssues ? (
                                    <span style={{ color: 'var(--warning)' }}>{step.issueCount} issues</span>
                                ) : (
                                    <span style={{ color: 'var(--success)' }}>Clean</span>
                                )
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
