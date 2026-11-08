import { buildSpreads, singleSpreads, spreadIndexOf } from '@renderer/components/readerSpreads';

describe('buildSpreads', () => {
    it('is empty for a chapter with no pages', () => {
        expect(buildSpreads(0)).toEqual([]);
    });

    it('pairs the pages from the first one, with no cover alone: 1+2, 3+4, 5+6', () => {
        expect(buildSpreads(6)).toEqual([[0, 1], [2, 3], [4, 5]]);
    });

    it('leaves only the last page alone when the number of pages is odd', () => {
        expect(buildSpreads(5)).toEqual([[0, 1], [2, 3], [4]]);
    });

    it('is one view of one page for a chapter of a single page', () => {
        expect(buildSpreads(1)).toEqual([[0]]);
    });

    it('is one pair for a chapter of two pages', () => {
        expect(buildSpreads(2)).toEqual([[0, 1]]);
    });

    it('holds every page of the chapter exactly once, in order', () => {
        expect(buildSpreads(11).flat()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('does not look at the shape of the pages: it takes nothing but their number', () => {
        expect(buildSpreads.length).toBe(1);
    });
});

describe('singleSpreads', () => {
    it('is a view of its own for each page', () => {
        expect(singleSpreads(3)).toEqual([[0], [1], [2]]);
        expect(singleSpreads(0)).toEqual([]);
    });
});

describe('spreadIndexOf', () => {
    const spreads = buildSpreads(5);

    it('finds the view that holds the page, the first or the second of a pair', () => {
        expect(spreadIndexOf(spreads, 0)).toBe(0);
        expect(spreadIndexOf(spreads, 1)).toBe(0);
        expect(spreadIndexOf(spreads, 2)).toBe(1);
        expect(spreadIndexOf(spreads, 3)).toBe(1);
        expect(spreadIndexOf(spreads, 4)).toBe(2);
    });

    it('falls back to the first view for a page before the chapter and to the last one for a page after it', () => {
        expect(spreadIndexOf(spreads, -3)).toBe(0);
        expect(spreadIndexOf(spreads, 9)).toBe(2);
    });

    it('is 0 when there are no views', () => {
        expect(spreadIndexOf([], 0)).toBe(0);
    });
});
