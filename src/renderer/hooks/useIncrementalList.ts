import { useCallback, useState } from 'react';
import { ListMemory } from './listMemory';
import { useInfiniteScroll } from './useInfiniteScroll';

export const INCREMENTAL_STEP = 60;

const revealedCounts = new ListMemory<number>();

export interface IncrementalList<T> {
    shown: readonly T[];
    hasMore: boolean;
    endRef: (element: HTMLElement | null) => void;
}

interface Revealed {
    key: string;
    count: number;
}

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
