import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { usePerformanceMode } from '../hooks/usePerformanceMode';

export const SETTINGS_ICON = '⚙︎';

interface TabButtonProps {
    label: string;
    active: boolean;
    icon?: string;
    decoration?: ReactNode;
    sectionId?: string;
    pillId?: string;
    onClick: () => void;
}

function TabContent({ label, icon, decoration }: Pick<TabButtonProps, 'label' | 'icon' | 'decoration'>) {
    if (icon !== undefined) {
        return <span aria-hidden="true">{icon}</span>;
    }
    if (decoration === undefined) {
        return label;
    }
    return (
        <>
            <span className="tab__decoration" aria-hidden="true">
                {decoration}
            </span>
            <span className="tab__label">{label}</span>
        </>
    );
}

function TabPill({ id }: { id: string }) {
    const performanceMode = usePerformanceMode();
    if (performanceMode) {
        return <span className="tab__pill" aria-hidden="true" />;
    }
    return <motion.span layoutId={id} className="tab__pill" aria-hidden="true" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />;
}

export function TabButton({ label, active, icon, decoration, sectionId, pillId, onClick }: TabButtonProps) {
    const classes = ['tab', icon === undefined ? '' : 'tab--icon', active ? 'tab--active' : ''].filter(Boolean).join(' ');
    return (
        <button
            type="button"
            className={classes}
            aria-current={active ? 'page' : undefined}
            data-section-id={sectionId}
            aria-label={icon === undefined ? undefined : label}
            title={icon === undefined ? undefined : label}
            onClick={onClick}
        >
            {active && pillId !== undefined && <TabPill id={pillId} />}
            <TabContent label={label} icon={icon} decoration={decoration} />
        </button>
    );
}
