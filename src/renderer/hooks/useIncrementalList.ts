import { useCallback, useState } from 'react';
import { ListMemory } from './listMemory';
import { useInfiniteScroll } from './useInfiniteScroll';

// How many items a long list shows at first, and how many more each time its end comes into view.
export const INCREMENTAL_STEP = 60;

const revealedCounts = new ListMemory<number>();

export interface IncrementalList<T> {
    // The items to draw: the first ones of the list.
    shown: readonly T[];
    // Whether some items are still not drawn.
    hasMore: boolean;
    // To put on the element after the list: when it comes into view, more items are drawn.
    endRef: (element: HTMLElement | null) => void;
}

interface Revealed {
    key: string;
    count: number;
}

// Draws a list that is all in memory a part at a time: the first `step` items, then `step` more each time the end of what is drawn comes
// into view. How much was drawn is kept for `listKey`, so the list comes back as long as it was (and the scroll can be put back).
export function useIncrementalList<T>(items: readonly T[], listKey: string, step: number = INCREMENTAL_STEP): IncrementalList<T> {
    const [revealed, setRevealed] = useState<Revealed>(() => {
        return { key: listKey, count: revealedCounts.get(listKey) ?? step };
    });
    const count = revealed.key === listKey ? revealed.count : (revealedCounts.get(listKey) ?? step);
    const hasMore = items.length > count;

    const revealMore = useCallback(() => {
        const next = count + step;
        revealedCounts.set(listKey, next);
        setRevealed({ key: listKey, count: next });
    }, [count, listKey, step]);

    const endRef = useInfiniteScroll(revealMore, hasMore, count);
    return { shown: hasMore ? items.slice(0, count) : items, hasMore, endRef };
}
