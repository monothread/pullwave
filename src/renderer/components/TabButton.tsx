import { motion } from 'motion/react';
import type { ReactNode } from 'react';

// The gear of the settings tabs. The text selector (U+FE0E) keeps it a plain glyph that follows the colour of the tab.
export const SETTINGS_ICON = '⚙︎';

interface TabButtonProps {
    label: string;
    active: boolean;
    // A glyph shown in place of the label, which then only names the tab for the screen readers and the tooltip. The tab goes to the
    // right end of its bar.
    icon?: string;
    // A picture shown before the label (the sections of the navigation at the top). It is hidden from the screen readers, so the name of the
    // tab is still the label alone.
    decoration?: ReactNode;
    // The id of the section the tab leads to (the menu uses it to find the tab a cover flies to).
    sectionId?: string;
    // Tabs of one bar that share this id share a soft pill that slides from the tab that was active to the one that is now.
    pillId?: string;
    onClick: () => void;
}

// What the tab shows: the glyph alone, the picture and the label, or the label alone.
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

// The pill behind the active tab; `layoutId` makes it slide between the tabs of the bar.
function TabPill({ id }: { id: string }) {
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
