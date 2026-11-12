import type { ReactNode } from 'react';
import { useBlockWindow, WINDOW_ROWS_PER_BLOCK } from '../hooks/useBlockWindow';

// The attribute an item drawn again gets, as the props of its element: `{...windowBack(back)}`.
export function windowBack(back: boolean): { 'data-window-back'?: true } {
    return back ? { 'data-window-back': true } : {};
}

interface WindowedListProps<T> {
    items: readonly T[];
    // What the list is, to find it as tall as it was when it comes back.
    listKey: string;
    // The container: a list (ul, whose items and spacers are li) or a box (div, whose spacers are div).
    as: 'ul' | 'div';
    className?: string;
    // Draws one item, with its key: exactly one element, as the blocks are measured by the elements the items put in the container. `back`
    // says the item is drawn again after its block left the screen: its element gets WINDOW_BACK_ATTRIBUTE, so it shows as it was, with no
    // entrance (see the CSS of .list-window).
    renderItem: (item: T, back: boolean) => ReactNode;
    rowsPerBlock?: number;
}

// A long list drawn by blocks (useBlockWindow): the items of the blocks near the screen, and a spacer as tall as each of the others.
export function WindowedList<T>({ items, listKey, as, className, renderItem, rowsPerBlock = WINDOW_ROWS_PER_BLOCK }: WindowedListProps<T>) {
    const { containerRef, slots, isBack } = useBlockWindow(items, listKey, rowsPerBlock);
    const Container = as;
    const Spacer = as === 'ul' ? 'li' : 'div';
    return (
        <Container ref={containerRef} className={className}>
            {/* One flat list of children: an item keeps its element when it goes to another block (the columns changed). */}
            {slots.flatMap<ReactNode>((slot) => {
                if (slot.kind === 'spacer') {
                    return [<Spacer key={`spacer-${String(slot.block)}`} className="list-window__spacer" aria-hidden="true" data-testid="list-window-spacer" style={{ height: `${String(slot.height)}px` }} />];
                }
                return slot.items.map((item) => {
                    return renderItem(item, isBack(item));
                });
            })}
        </Container>
    );
}
