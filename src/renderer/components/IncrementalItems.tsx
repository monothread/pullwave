import type { ReactNode } from 'react';
import { INCREMENTAL_STEP, useIncrementalList } from '../hooks/useIncrementalList';
import { ListMore } from './ListMore';

interface IncrementalItemsProps<T> {
    items: readonly T[];
    listKey: string;
    renderItem: (item: T) => ReactNode;
    end: 'li' | 'div';
    step?: number;
}

export function IncrementalItems<T>({ items, listKey, renderItem, end, step = INCREMENTAL_STEP }: IncrementalItemsProps<T>) {
    const { shown, hasMore, endRef } = useIncrementalList(items, listKey, step);
    return (
        <>
            {shown.map(renderItem)}
            <ListMore hasMore={hasMore} endRef={endRef} as={end} />
        </>
    );
}
