import type { ReactNode } from 'react';
import { useBlockWindow, WINDOW_ROWS_PER_BLOCK } from '../hooks/useBlockWindow';

export function windowBack(back: boolean): { 'data-window-back'?: true } {
    return back ? { 'data-window-back': true } : {};
}

interface WindowedListProps<T> {
    items: readonly T[];
    listKey: string;
    as: 'ul' | 'div';
    className?: string;
    renderItem: (item: T, back: boolean) => ReactNode;
    rowsPerBlock?: number;
}

export function WindowedList<T>({ items, listKey, as, className, renderItem, rowsPerBlock = WINDOW_ROWS_PER_BLOCK }: WindowedListProps<T>) {
    const { containerRef, slots, isBack } = useBlockWindow(items, listKey, rowsPerBlock);
    const Container = as;
    const Spacer = as === 'ul' ? 'li' : 'div';
    return (
        <Container ref={containerRef} className={className}>
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
