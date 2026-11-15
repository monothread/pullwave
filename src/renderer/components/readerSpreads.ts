export type Spread = readonly number[];

export function buildSpreads(total: number): Spread[] {
    const spreads: Spread[] = [];
    for (let index = 0; index < total; index += 2) {
        spreads.push(index + 1 < total ? [index, index + 1] : [index]);
    }
    return spreads;
}

export function spreadIndexOf(spreads: readonly Spread[], page: number): number {
    const found = spreads.findIndex((spread) => {
        return spread.includes(page);
    });
    if (found >= 0) {
        return found;
    }
    return page < 0 ? 0 : Math.max(0, spreads.length - 1);
}

export function singleSpreads(total: number): Spread[] {
    return Array.from({ length: total }, (_unused, index) => {
        return [index];
    });
}
