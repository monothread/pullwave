// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LibraryControls } from '@renderer/library/LibraryControls';

function renderControls(filter: 'all' | 'news' = 'all', sort: 'recent' | 'last' | 'az' = 'recent', kind: 'anime' | 'manga' = 'anime') {
    const onFilter = vi.fn();
    const onSort = vi.fn();
    render(<LibraryControls kind={kind} filter={filter} sort={sort} allCount={12} newsCount={3} onFilter={onFilter} onSort={onSort} />);
    return { onFilter, onSort };
}

describe('LibraryControls', () => {
    it('has the chips ALL and NEW with their counts, the one chosen pressed', () => {
        renderControls();
        const chips = screen.getByRole('group', { name: 'Show' });
        const all = within(chips).getByRole('button', { name: 'ALL (12)' });
        const news = within(chips).getByRole('button', { name: 'NEW (3)' });
        expect(all).toHaveAttribute('aria-pressed', 'true');
        expect(all).toHaveClass('chip-toggle', 'chip-toggle--on');
        expect(news).toHaveAttribute('aria-pressed', 'false');
        expect(news).not.toHaveClass('chip-toggle--on');
        expect(news).toHaveAttribute('title', 'With episodes or chapters that arrived in the last 7 days');
    });

    it('marks NEW when it is the filter', () => {
        renderControls('news');
        expect(screen.getByRole('button', { name: 'NEW (3)' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'ALL (12)' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('chooses a filter', () => {
        const { onFilter } = renderControls();
        fireEvent.click(screen.getByRole('button', { name: 'NEW (3)' }));
        fireEvent.click(screen.getByRole('button', { name: 'ALL (12)' }));
        expect(onFilter.mock.calls).toEqual([['news'], ['all']]);
    });

    it('chooses the order among the ones there are, the last one watched for the anime', () => {
        const { onSort } = renderControls('all', 'az');
        const order = screen.getByRole('combobox', { name: 'Sort by' });
        expect(order).toHaveValue('az');
        expect(Array.from(order.querySelectorAll('option')).map((option) => {
            return [option.value, option.textContent];
        })).toEqual([
            ['recent', 'Recently added'],
            ['last', 'Last watched'],
            ['az', 'A–Z']
        ]);
        fireEvent.change(order, { target: { value: 'last' } });
        fireEvent.change(order, { target: { value: 'recent' } });
        expect(onSort.mock.calls).toEqual([['last'], ['recent']]);
    });

    it('calls it the last one read for the manga', () => {
        renderControls('all', 'last', 'manga');
        const order = screen.getByRole('combobox', { name: 'Sort by' });
        expect(order).toHaveValue('last');
        expect(Array.from(order.querySelectorAll('option')).map((option) => {
            return option.textContent;
        })).toEqual(['Recently added', 'Last read', 'A–Z']);
    });
});
