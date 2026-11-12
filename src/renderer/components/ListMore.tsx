interface ListMoreProps {
    hasMore: boolean;
    endRef: (element: HTMLElement | null) => void;
    // The element it is: an item (li) when it is inside a list, a box (div) otherwise.
    as?: 'li' | 'div';
}

// The end of a list that is drawn a part at a time: when it comes into view, more of the list is drawn. Nothing once all of it is.
export function ListMore({ hasMore, endRef, as = 'div' }: ListMoreProps) {
    if (!hasMore) {
        return null;
    }
    const Element = as;
    return <Element ref={endRef} className="list-more" aria-hidden="true" data-testid="list-more" />;
}
