// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabMenu } from '@renderer/components/TabMenu';

const TABS = [
    { id: 'browse', label: 'BROWSE' },
    { id: 'library', label: 'LIBRARY' },
    { id: 'history', label: 'HISTORY' }
];

describe('TabMenu', () => {
    it('is a list named after the section, with every tab as an option in the order they are given, and the active one chosen', () => {
        render(<TabMenu label="Manga" tabs={TABS} active="library" onSelect={vi.fn()} />);
        const menu = screen.getByRole('combobox', { name: 'Manga' });
        expect(menu).toHaveClass('input', 'tabs__menu');
        expect(menu).toHaveValue('library');
        expect(
            within(menu)
                .getAllByRole('option')
                .map((option) => {
                    return [option.getAttribute('value'), option.textContent];
                })
        ).toEqual([
            ['browse', 'BROWSE'],
            ['library', 'LIBRARY'],
            ['history', 'HISTORY']
        ]);
    });

    it('says which tab was chosen', async () => {
        const user = userEvent.setup();
        const onSelect = vi.fn();
        render(<TabMenu label="Manga" tabs={TABS} active="browse" onSelect={onSelect} />);
        await user.selectOptions(screen.getByRole('combobox', { name: 'Manga' }), 'history');
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('history');
    });

    it('shows the tab that is active from outside', () => {
        const { rerender } = render(<TabMenu label="Manga" tabs={TABS} active="browse" onSelect={vi.fn()} />);
        rerender(<TabMenu label="Manga" tabs={TABS} active="history" onSelect={vi.fn()} />);
        expect(screen.getByRole('combobox', { name: 'Manga' })).toHaveValue('history');
    });
});
