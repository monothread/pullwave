interface ListMoreProps {
    hasMore: boolean;
    endRef: (element: HTMLElement | null) => void;
    as?: 'li' | 'div';
}

export function ListMore({ hasMore, endRef, as = 'div' }: ListMoreProps) {
    if (!hasMore) {
        return null;
    }
    const Element = as;
    return <Element ref={endRef} className="list-more" aria-hidden="true" data-testid="list-more" />;
}
