interface TabMenuProps {
    // What the menu is called for the screen readers (the name of the section the tabs are of).
    label: string;
    tabs: ReadonlyArray<{ id: string; label: string }>;
    active: string;
    onSelect: (id: string) => void;
}

// The tabs of a section gathered in one list, for a window too narrow to have them side by side. It is always in the page and the theme
// shows it in place of the tabs (see `.tabs__menu`), so the keyboard and the screen readers have the same choices either way.
export function TabMenu({ label, tabs, active, onSelect }: TabMenuProps) {
    return (
        <select
            className="input tabs__menu"
            aria-label={label}
            value={active}
            onChange={(event) => {
                onSelect(event.target.value);
            }}
        >
            {tabs.map((tab) => {
                return (
                    <option key={tab.id} value={tab.id}>
                        {tab.label}
                    </option>
                );
            })}
        </select>
    );
}
