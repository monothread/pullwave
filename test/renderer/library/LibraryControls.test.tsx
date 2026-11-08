// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LibraryControls } from '@renderer/library/LibraryControls';
import type { LibraryFilter, LibrarySort } from '@renderer/spotlight/spotlightData';

function renderControls(filter: LibraryFilter = 'all', sort: LibrarySort = 'recent', kind: 'anime' | 'manga' = 'anime', airing = false) {
    const onFilter = vi.fn();
    const onSort = vi.fn();
    render(<LibraryControls kind={kind} filter={filter} sort={sort} allCount={12} newsCount={3} completeCount={airing ? 7 : undefined} ongoingCount={airing ? 5 : undefined} onFilter={onFilter} onSort={onSort} />);
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

    it('has only ALL and NEW when the releases are not counted, as in the manga library', () => {
        renderControls('all', 'recent', 'manga');
        const chips = screen.getByRole('group', { name: 'Show' });
        expect(
            within(chips)
                .getAllByRole('button')
                .map((chip) => {
                    return chip.textContent;
                })
        ).toEqual(['ALL (12)', 'NEW (3)']);
        expect(screen.queryByRole('button', { name: /COMPLETE/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /ONGOING/ })).not.toBeInTheDocument();
    });

    it('has the chips COMPLETE and ONGOING with their counts and hints after ALL and NEW when the releases are counted', () => {
        renderControls('all', 'recent', 'anime', true);
        const chips = screen.getByRole('group', { name: 'Show' });
        expect(
            within(chips)
                .getAllByRole('button')
                .map((chip) => {
                    return chip.textContent;
                })
        ).toEqual(['ALL (12)', 'NEW (3)', 'COMPLETE (7)', 'ONGOING (5)']);
        const complete = within(chips).getByRole('button', { name: 'COMPLETE (7)' });
        const ongoing = within(chips).getByRole('button', { name: 'ONGOING (5)' });
        expect(complete).toHaveAttribute('title', 'With every season over: AniList says it ended, or you set it as complete');
        expect(ongoing).toHaveAttribute('title', 'Still coming out, or AniList does not know yet');
        expect(complete).toHaveClass('chip-toggle');
        expect(complete).not.toHaveClass('chip-toggle--on');
        expect(ongoing).not.toHaveClass('chip-toggle--on');
        expect(within(chips).getByRole('button', { name: 'ALL (12)' })).not.toHaveAttribute('title');
    });

    it.each([
        ['complete', 'COMPLETE (7)', 'ONGOING (5)'],
        ['ongoing', 'ONGOING (5)', 'COMPLETE (7)']
    ] as const)('marks only %s when it is the filter', (filter, pressed, other) => {
        renderControls(filter, 'recent', 'anime', true);
        expect(screen.getByRole('button', { name: pressed })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: pressed })).toHaveClass('chip-toggle--on');
        expect(screen.getByRole('button', { name: other })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'ALL (12)' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'NEW (3)' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('chooses COMPLETE and ONGOING', () => {
        const { onFilter } = renderControls('all', 'recent', 'anime', true);
        fireEvent.click(screen.getByRole('button', { name: 'COMPLETE (7)' }));
        fireEvent.click(screen.getByRole('button', { name: 'ONGOING (5)' }));
        expect(onFilter.mock.calls).toEqual([['complete'], ['ongoing']]);
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
            ['az', 'A–Z'],
            ['za', 'Z–A']
        ]);
        fireEvent.change(order, { target: { value: 'last' } });
        fireEvent.change(order, { target: { value: 'recent' } });
        fireEvent.change(order, { target: { value: 'za' } });
        expect(onSort.mock.calls).toEqual([['last'], ['recent'], ['za']]);
    });

    it('calls it the last one read for the manga', () => {
        renderControls('all', 'last', 'manga');
        const order = screen.getByRole('combobox', { name: 'Sort by' });
        expect(order).toHaveValue('last');
        expect(Array.from(order.querySelectorAll('option')).map((option) => {
            return option.textContent;
        })).toEqual(['Recently added', 'Last read', 'A–Z', 'Z–A']);
    });

    it('shows the order from Z when it is the one chosen', () => {
        renderControls('all', 'za', 'manga');
        expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('za');
        expect(screen.getByRole('option', { name: 'Z–A' })).toHaveProperty('selected', true);
    });
});
