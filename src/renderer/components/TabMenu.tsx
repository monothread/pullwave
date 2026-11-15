interface TabMenuProps {
    label: string;
    tabs: ReadonlyArray<{ id: string; label: string }>;
    active: string;
    onSelect: (id: string) => void;
}

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
