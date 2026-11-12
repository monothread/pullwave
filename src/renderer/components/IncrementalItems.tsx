import type { ReactNode } from 'react';
import { INCREMENTAL_STEP, useIncrementalList } from '../hooks/useIncrementalList';
import { ListMore } from './ListMore';

interface IncrementalItemsProps<T> {
    items: readonly T[];
    // What the list is, to find it as long as it was when it comes back.
    listKey: string;
    // Draws one item, with its key.
    renderItem: (item: T) => ReactNode;
    // The element of the end of the list: an item (li) inside a list, a box (div) otherwise.
    end: 'li' | 'div';
    step?: number;
}

// The items of a long list drawn a part at a time (useIncrementalList), followed by the end that draws more when it comes into view.
export function IncrementalItems<T>({ items, listKey, renderItem, end, step = INCREMENTAL_STEP }: IncrementalItemsProps<T>) {
    const { shown, hasMore, endRef } = useIncrementalList(items, listKey, step);
    return (
        <>
            {shown.map(renderItem)}
            <ListMore hasMore={hasMore} endRef={endRef} as={end} />
        </>
    );
}
