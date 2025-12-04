'use client';

import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { logger } from '@/utils/logger';

export type IssueMapSeverity = 'low' | 'medium' | 'high' | 'none';

export interface IssueMapCategory {
    id: string;
    label: string;
    count: number;
    severity: IssueMapSeverity;
}

interface IssueMapProps {
    categories: IssueMapCategory[];
    selectedCategory: string | null;
    onSelect: (id: string | null) => void;
}

export default function IssueMap({ categories, selectedCategory, onSelect }: IssueMapProps) {
    const mountDataRef = useRef({
        categoryCount: categories.length,
        selectedCategory
    });

    useEffect(() => {
        logger.componentMount('IssueMap', { 
            categoryCount: mountDataRef.current.categoryCount,
            selectedCategory: mountDataRef.current.selectedCategory
        });
        return () => {
            logger.componentUnmount('IssueMap');
        };
    }, []);

    const prevSelectedRef = useRef<string | null>(null);
    useEffect(() => {
        if (prevSelectedRef.current !== selectedCategory) {
            logger.stateChange('IssueMap', 'selectedCategory', prevSelectedRef.current, selectedCategory);
            prevSelectedRef.current = selectedCategory;
        }
    }, [selectedCategory]);

    return (
        <div className="map-grid">
            {categories.map((cat) => (
                <div
                    key={cat.id}
                    className={clsx("map-tile", selectedCategory === cat.id && "selected")}
                    onClick={() => {
                        const newSelection = selectedCategory === cat.id ? null : cat.id;
                        logger.userAction('select-category-tile', 'IssueMap', {
                            category: cat.id,
                            count: cat.count,
                            previousSelection: selectedCategory,
                            newSelection
                        });
                        onSelect(newSelection);
                    }}
                >
                    <div className="tile-header">
                        {cat.label}
                    </div>

                    <div className="tile-value" style={{
                        color: cat.count > 0
                            ? (cat.severity === 'high' ? 'var(--error)' : cat.severity === 'medium' ? 'var(--warning)' : 'var(--text-main)')
                            : 'var(--text-dim)'
                    }}>
                        {cat.count.toString().padStart(2, '0')}
                    </div>
                </div>
            ))}
        </div>
    );
}
