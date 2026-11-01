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

export function TabButton({ label, active, icon, decoration, onClick }: TabButtonProps) {
    const classes = ['tab', icon === undefined ? '' : 'tab--icon', active ? 'tab--active' : ''].filter(Boolean).join(' ');
    return (
        <button
            type="button"
            className={classes}
            aria-current={active ? 'page' : undefined}
            aria-label={icon === undefined ? undefined : label}
            title={icon === undefined ? undefined : label}
            onClick={onClick}
        >
            <TabContent label={label} icon={icon} decoration={decoration} />
        </button>
    );
}
