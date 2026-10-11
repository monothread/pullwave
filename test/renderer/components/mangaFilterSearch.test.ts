import type { MangaFilter } from '@shared/manga';
import { activateFilter } from '@renderer/components/mangaFilterSearch';

const FILTERS: MangaFilter[] = [
    { type: 'header', name: 'Genres' },
    { type: 'text', name: 'Title', value: '' },
    { type: 'checkbox', name: 'Completed', value: false },
    { type: 'select', name: 'Order', options: ['a'], value: 0 },
    { type: 'group', name: 'Genres', filters: [{ type: 'tristate', name: 'Action', value: 'exclude' }, { type: 'tristate', name: 'Big Ass', value: 'ignore' }] },
    { type: 'group', name: 'Tags', filters: [{ type: 'checkbox', name: 'Sole Female', value: false }, { type: 'tristate', name: 'Action', value: 'ignore' }] }
];

describe('activateFilter', () => {
    it('turns on a tri-state filter inside a group, leaving the others as they are', () => {
        const result = activateFilter(FILTERS, 'Big Ass');
        expect(result).toEqual([
            FILTERS[0],
            FILTERS[1],
            FILTERS[2],
            FILTERS[3],
            { type: 'group', name: 'Genres', filters: [{ type: 'tristate', name: 'Action', value: 'exclude' }, { type: 'tristate', name: 'Big Ass', value: 'include' }] },
            FILTERS[5]
        ]);
    });

    it('turns on a check box inside a group', () => {
        const result = activateFilter(FILTERS, 'Sole Female');
        expect(result?.[5]).toEqual({ type: 'group', name: 'Tags', filters: [{ type: 'checkbox', name: 'Sole Female', value: true }, { type: 'tristate', name: 'Action', value: 'ignore' }] });
    });

    it('turns on a check box that is not in a group', () => {
        expect(activateFilter(FILTERS, 'Completed')?.[2]).toEqual({ type: 'checkbox', name: 'Completed', value: true });
    });

    it('ignores case and the spaces around the name', () => {
        expect(activateFilter(FILTERS, '  big ass ')?.[4]).toMatchObject({ filters: [{ value: 'exclude' }, { name: 'Big Ass', value: 'include' }] });
    });

    it('turns on only the first filter with the name', () => {
        const result = activateFilter(FILTERS, 'action');
        expect(result?.[4]).toEqual({ type: 'group', name: 'Genres', filters: [{ type: 'tristate', name: 'Action', value: 'include' }, { type: 'tristate', name: 'Big Ass', value: 'ignore' }] });
        expect(result?.[5]).toEqual(FILTERS[5]);
    });

    it('does not turn on filters that are not boxes, even with the name', () => {
        expect(activateFilter(FILTERS, 'Title')).toBeNull();
        expect(activateFilter(FILTERS, 'Order')).toBeNull();
        expect(activateFilter(FILTERS, 'Genres')).toBeNull();
    });

    it('gives null when no filter has the name, when the name is empty and when there are no filters', () => {
        expect(activateFilter(FILTERS, 'Romance')).toBeNull();
        expect(activateFilter(FILTERS, '   ')).toBeNull();
        expect(activateFilter([], 'Action')).toBeNull();
    });

    it('does not change the filters it is given', () => {
        const before = JSON.stringify(FILTERS);
        activateFilter(FILTERS, 'Big Ass');
        expect(JSON.stringify(FILTERS)).toBe(before);
    });
});
