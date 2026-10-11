// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { MangaFilter } from '@shared/manga';
import { MangaFilters } from '@renderer/components/MangaFilters';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const FILTERS: MangaFilter[] = [
    { type: 'header', name: 'Only one at a time' },
    { type: 'separator', name: '' },
    { type: 'text', name: 'Author', value: '' },
    { type: 'checkbox', name: 'Has chapters', value: false },
    { type: 'tristate', name: 'Action', value: 'ignore' },
    { type: 'select', name: 'Created within', options: ['Any', 'A day'], value: 0 },
    { type: 'sort', name: 'Sort', options: ['Name', 'Date'], value: { index: 1, ascending: false } },
    { type: 'group', name: 'Genre', filters: [{ type: 'tristate', name: 'Drama', value: 'include' }, { type: 'tristate', name: 'Comedy', value: 'ignore' }] },
    { type: 'group', name: 'Mixed', filters: [{ type: 'text', name: 'Inner text', value: '' }] }
];

function setBrowse(patch: Partial<ReturnType<typeof useMangaStore.getState>['browse']>): void {
    useMangaStore.setState({ browse: { ...useMangaStore.getState().browse, sourceId: '5', mode: 'search', ...patch } });
}

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
    useMangaStore.setState({ ...initialManga });
});

describe('MangaFilters', () => {
    it('shows nothing when the source has no filters', () => {
        setBrowse({ filtersStatus: 'ready', filters: [] });
        const { container } = render(<MangaFilters onApply={() => {return undefined}} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('has a button that opens and closes the panel, and shows nothing of the filters until it is open', async () => {
        const user = userEvent.setup();
        setBrowse({ filtersStatus: 'ready', filters: FILTERS, initialFilters: FILTERS });
        render(<MangaFilters onApply={() => {return undefined}} />);
        expect(screen.queryByLabelText('Author')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'FILTERS' }));
        expect(screen.getByLabelText('Author')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'HIDE FILTERS' })).toHaveAttribute('aria-expanded', 'true');
        await user.click(screen.getByRole('button', { name: 'HIDE FILTERS' }));
        expect(screen.queryByLabelText('Author')).not.toBeInTheDocument();
    });

    it('says while they are read and when they could not be', () => {
        setBrowse({ filtersStatus: 'loading', filtersOpen: true });
        const { rerender } = render(<MangaFilters onApply={() => {return undefined}} />);
        expect(screen.getByText('Loading the filters…')).toBeInTheDocument();
        setBrowse({ filtersStatus: 'error', filtersOpen: true });
        rerender(<MangaFilters onApply={() => {return undefined}} />);
        expect(screen.getByRole('alert')).toHaveTextContent('The filters of this source could not be loaded.');
    });

    it('shows every kind of filter', () => {
        setBrowse({ filtersStatus: 'ready', filters: FILTERS, initialFilters: FILTERS, filtersOpen: true });
        render(<MangaFilters onApply={() => {return undefined}} />);
        expect(screen.getByText('Only one at a time')).toBeInTheDocument();
        expect(screen.getByRole('separator')).toBeInTheDocument();
        expect(screen.getByLabelText('Author')).toHaveValue('');
        expect(screen.getByRole('switch', { name: 'Has chapters' })).not.toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Action' })).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByRole('combobox', { name: 'Created within' })).toHaveValue('Any');
        expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('Date');
        expect(screen.getByRole('button', { name: 'Sort: Descending' })).toHaveTextContent('↓');
        expect(screen.getByText('Genre')).toBeInTheDocument();
    });

    it('sets the text, the box, the list and the order in the store', async () => {
        const user = userEvent.setup();
        setBrowse({ filtersStatus: 'ready', filters: FILTERS, initialFilters: FILTERS, filtersOpen: true });
        render(<MangaFilters onApply={() => {return undefined}} />);
        await user.type(screen.getByLabelText('Author'), 'Oda');
        await user.click(screen.getByRole('switch', { name: 'Has chapters' }));
        await user.click(screen.getByRole('combobox', { name: 'Created within' }));
        await user.click(screen.getByRole('option', { name: 'A day' }));
        await user.click(screen.getByRole('combobox', { name: 'Sort' }));
        await user.click(screen.getByRole('option', { name: 'Name' }));
        await user.click(screen.getByRole('button', { name: 'Sort: Descending' }));
        const filters = useMangaStore.getState().browse.filters;
        expect(filters[2]).toEqual({ type: 'text', name: 'Author', value: 'Oda' });
        expect(filters[3]).toEqual({ type: 'checkbox', name: 'Has chapters', value: true });
        expect(filters[5]).toEqual({ type: 'select', name: 'Created within', options: ['Any', 'A day'], value: 1 });
        expect(filters[6]).toEqual({ type: 'sort', name: 'Sort', options: ['Name', 'Date'], value: { index: 0, ascending: true } });
        expect(screen.getByRole('button', { name: 'Sort: Ascending' })).toHaveTextContent('↑');
    });

    it('goes through the three states of a filter, and sets a filter inside a group', async () => {
        const user = userEvent.setup();
        setBrowse({ filtersStatus: 'ready', filters: FILTERS, initialFilters: FILTERS, filtersOpen: true });
        render(<MangaFilters onApply={() => {return undefined}} />);
        const action = screen.getByRole('checkbox', { name: 'Action' });
        await user.click(action);
        expect(action).toHaveAttribute('aria-checked', 'true');
        expect(action).toHaveAttribute('title', 'Only with this');
        await user.click(action);
        expect(action).toHaveAttribute('aria-checked', 'mixed');
        expect(action).toHaveAttribute('title', 'Without this');
        await user.click(action);
        expect(action).toHaveAttribute('aria-checked', 'false');
        expect(action).toHaveAttribute('title', 'Not used');
    });

    it('shows a group of options as a field to type in, with what is picked as chips', async () => {
        const user = userEvent.setup();
        setBrowse({ filtersStatus: 'ready', filters: FILTERS, initialFilters: FILTERS, filtersOpen: true });
        render(<MangaFilters onApply={() => {return undefined}} />);
        expect(screen.getByRole('combobox', { name: 'Genre' })).toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: 'Drama' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Drama: Only with this' })).toBeInTheDocument();
        await user.click(screen.getByRole('combobox', { name: 'Genre' }));
        await user.click(screen.getByRole('option', { name: 'Comedy' }));
        expect(useMangaStore.getState().browse.filters[7]).toEqual({
            type: 'group',
            name: 'Genre',
            filters: [{ type: 'tristate', name: 'Drama', value: 'include' }, { type: 'tristate', name: 'Comedy', value: 'include' }]
        });
    });

    it('keeps a group that holds other kinds of filter as a list that opens', async () => {
        const user = userEvent.setup();
        setBrowse({ filtersStatus: 'ready', filters: FILTERS, initialFilters: FILTERS, filtersOpen: true });
        render(<MangaFilters onApply={() => {return undefined}} />);
        expect(screen.queryByRole('combobox', { name: 'Mixed' })).not.toBeInTheDocument();
        await user.click(screen.getByText('Mixed'));
        await user.type(screen.getByLabelText('Inner text'), 'x');
        expect(useMangaStore.getState().browse.filters[8]).toEqual({ type: 'group', name: 'Mixed', filters: [{ type: 'text', name: 'Inner text', value: 'x' }] });
    });

    it('applies what was set, and starts over', async () => {
        const user = userEvent.setup();
        const onApply = vi.fn();
        setBrowse({ filtersStatus: 'ready', filters: FILTERS, initialFilters: FILTERS, filtersOpen: true });
        render(<MangaFilters onApply={onApply} />);
        await user.click(screen.getByRole('switch', { name: 'Has chapters' }));
        await user.click(screen.getByRole('button', { name: 'APPLY' }));
        expect(onApply).toHaveBeenCalledTimes(1);
        await user.click(screen.getByRole('button', { name: 'RESET' }));
        expect(useMangaStore.getState().browse.filters).toEqual(FILTERS);
        expect(screen.getByRole('switch', { name: 'Has chapters' })).not.toBeChecked();
    });
});
