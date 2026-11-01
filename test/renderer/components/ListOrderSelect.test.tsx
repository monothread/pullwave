// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { ListOrderSelect } from '@renderer/components/ListOrderSelect';
import { DEFAULT_SORT_PREFS, SORT_PREFS_STORAGE_KEY, useSortPrefsStore } from '@renderer/store/sortPrefsStore';

afterEach(() => {
    window.localStorage.removeItem(SORT_PREFS_STORAGE_KEY);
    useSortPrefsStore.setState({ library: { ...DEFAULT_SORT_PREFS.library }, list: { ...DEFAULT_SORT_PREFS.list } });
});

describe('ListOrderSelect', () => {
    it('is a field "Sort by" with the first to the last and the last to the first, the first to the last by default', () => {
        const { container } = render(<ListOrderSelect kind="chapters" />);
        const field = container.querySelector('label') as HTMLLabelElement;
        expect(field).toHaveClass('library-controls__sort', 'list-order');
        expect(field.querySelector('.field__label')).toHaveTextContent('Sort by');
        const select = screen.getByRole('combobox', { name: 'Sort by' });
        expect(select).toHaveClass('input');
        expect(select).toHaveValue('asc');
        expect(
            Array.from(select.querySelectorAll('option')).map((option) => {
                return [option.value, option.textContent];
            })
        ).toEqual([
            ['asc', 'First to last'],
            ['desc', 'Last to first']
        ]);
    });

    it.each(['chapters', 'episodes'] as const)('shows the order kept for the %s', (kind) => {
        useSortPrefsStore.setState({ list: { ...DEFAULT_SORT_PREFS.list, [kind]: 'desc' } });
        render(<ListOrderSelect kind={kind} />);
        expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('desc');
    });

    it('changes the order of its own list only, and keeps it for the next time the app opens', () => {
        render(<ListOrderSelect kind="episodes" />);
        fireEvent.change(screen.getByRole('combobox', { name: 'Sort by' }), { target: { value: 'desc' } });
        expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('desc');
        expect(useSortPrefsStore.getState().list).toEqual({ chapters: 'asc', episodes: 'desc' });
        expect(JSON.parse(window.localStorage.getItem(SORT_PREFS_STORAGE_KEY) ?? 'null')).toEqual({ library: { anime: 'recent', manga: 'recent' }, list: { chapters: 'asc', episodes: 'desc' } });
        fireEvent.change(screen.getByRole('combobox', { name: 'Sort by' }), { target: { value: 'asc' } });
        expect(useSortPrefsStore.getState().list).toEqual({ chapters: 'asc', episodes: 'asc' });
    });
});
