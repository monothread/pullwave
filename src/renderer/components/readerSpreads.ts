// The pages of a chapter shown two at a time, side by side (the single page mode with the option "two pages" on).

// The pages that are on screen together, in the order they are read: [first, second] or [first] for a page that is alone.
export type Spread = readonly number[];

// Pairs the pages from the first one: 1+2, 3+4 and so on (the cover is not alone). Only the last page is alone, when the number of pages is odd.
// The shape of a page does not matter: a page that came cut by its source (a strip, wider than it is tall) goes beside its pair like any other.
export function buildSpreads(total: number): Spread[] {
    const spreads: Spread[] = [];
    for (let index = 0; index < total; index += 2) {
        spreads.push(index + 1 < total ? [index, index + 1] : [index]);
    }
    return spreads;
}

// The pages shown when the chapter is on `page`: the pair that holds it (the page that opens a chapter may be the second of a pair).
export function spreadIndexOf(spreads: readonly Spread[], page: number): number {
    const found = spreads.findIndex((spread) => {
        return spread.includes(page);
    });
    if (found >= 0) {
        return found;
    }
    return page < 0 ? 0 : Math.max(0, spreads.length - 1);
}

// One page per view: every page is a view of its own.
export function singleSpreads(total: number): Spread[] {
    return Array.from({ length: total }, (_unused, index) => {
        return [index];
    });
}
