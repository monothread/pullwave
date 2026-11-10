// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { ListOrderSelect } from '@renderer/components/ListOrderSelect';
import { DEFAULT_SORT_PREFS, SORT_PREFS_STORAGE_KEY, useSortPrefsStore } from '@renderer/store/sortPrefsStore';

const RECENT_EVERYWHERE = { all: 'recent', news: 'recent', complete: 'recent', ongoing: 'recent' } as const;

afterEach(() => {
    window.localStorage.removeItem(SORT_PREFS_STORAGE_KEY);
    useSortPrefsStore.setState({ library: DEFAULT_SORT_PREFS.library, list: DEFAULT_SORT_PREFS.list });
});

describe('ListOrderSelect', () => {
    it('is a field "Sort by" with the first to the last and the last to the first, the first to the last by default', () => {
        const { container } = render(<ListOrderSelect kind="chapters" itemKey="src-1:42" />);
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

    it.each([
        ['chapters', 'src-1:42'],
        ['episodes', 'sub|Frieren']
    ] as const)('shows the order kept for that title of the %s', (kind, itemKey) => {
        useSortPrefsStore.setState({ list: { ...DEFAULT_SORT_PREFS.list, [kind]: { [itemKey]: 'desc' } } });
        render(<ListOrderSelect kind={kind} itemKey={itemKey} />);
        expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('desc');
    });

    it('shows the default order for a title that has none kept, even when another title has one', () => {
        useSortPrefsStore.setState({ list: { chapters: {}, episodes: { 'sub|Frieren': 'desc' } } });
        render(<ListOrderSelect kind="episodes" itemKey="sub|One Piece" />);
        expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('asc');
    });

    it('changes the order of its own title only, and keeps it for the next time the app opens', () => {
        render(<ListOrderSelect kind="episodes" itemKey="sub|Frieren" />);
        fireEvent.change(screen.getByRole('combobox', { name: 'Sort by' }), { target: { value: 'desc' } });
        expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('desc');
        expect(useSortPrefsStore.getState().list).toEqual({ chapters: {}, episodes: { 'sub|Frieren': 'desc' } });
        expect(JSON.parse(window.localStorage.getItem(SORT_PREFS_STORAGE_KEY) ?? 'null')).toEqual({
            library: { anime: RECENT_EVERYWHERE, manga: RECENT_EVERYWHERE },
            list: { chapters: {}, episodes: { 'sub|Frieren': 'desc' } }
        });
        fireEvent.change(screen.getByRole('combobox', { name: 'Sort by' }), { target: { value: 'asc' } });
        expect(useSortPrefsStore.getState().list).toEqual({ chapters: {}, episodes: { 'sub|Frieren': 'asc' } });
    });

    it('shows another title with its own order when the title changes', () => {
        useSortPrefsStore.setState({ list: { chapters: {}, episodes: { 'sub|Frieren': 'desc', 'sub|One Piece': 'asc' } } });
        const { rerender } = render(<ListOrderSelect kind="episodes" itemKey="sub|Frieren" />);
        expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('desc');
        rerender(<ListOrderSelect kind="episodes" itemKey="sub|One Piece" />);
        expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('asc');
    });
});
