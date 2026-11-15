import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ListMemory } from './listMemory';

export const WINDOW_ROWS_PER_BLOCK = 4;
export const WINDOW_SCREENS_AROUND = 2;
const HEIGHT_TOLERANCE = 0.5;
export const WINDOW_KEEP_MARGIN = 64;
export const MAX_CHAINED_UPDATES = 20;
const FIRST_RANGE: BlockRange = { first: 0, last: 0 };

export type BlockWindowSlot<T> = { kind: 'items'; block: number; items: readonly T[] } | { kind: 'spacer'; block: number; height: number };

export interface BlockWindow<T> {
    containerRef: (element: HTMLElement | null) => void;
    slots: readonly BlockWindowSlot<T>[];
    isBack: (item: T) => boolean;
}

interface BlockRange {
    first: number;
    last: number;
}

export interface BlockLayout {
    columns: number;
    heights: readonly (number | undefined)[];
    fallback: number | null;
}

interface DrawnWindow<T> {
    slots: readonly BlockWindowSlot<T>[];
    state: WindowState;
    items: readonly T[];
    measuredItems: readonly T[];
    rowsPerBlock: number;
}

interface WindowState {
    key: string;
    layout: BlockLayout;
    range: BlockRange;
}

const EMPTY_LAYOUT: BlockLayout = { columns: 1, heights: [], fallback: null };

const layouts = new ListMemory<BlockLayout>();

function initialState(key: string): WindowState {
    return { key, layout: layouts.get(key) ?? EMPTY_LAYOUT, range: FIRST_RANGE };
}

export function columnsOf(container: HTMLElement): number {
    const tracks = getComputedStyle(container).gridTemplateColumns.trim();
    if (tracks.length === 0 || tracks === 'none') {
        return 1;
    }
    return Math.max(1, tracks.split(/\s+/).length);
}

export function scrollParentOf(element: HTMLElement): HTMLElement | null {
    let parent = element.parentElement;
    while (parent !== null) {
        const overflow = getComputedStyle(parent).overflowY;
        if (overflow === 'auto' || overflow === 'scroll') {
            return parent;
        }
        parent = parent.parentElement;
    }
    return null;
}

function averageHeight(heights: readonly (number | undefined)[]): number | null {
    const known = heights.filter((height): height is number => {
        return height !== undefined;
    });
    if (known.length === 0) {
        return null;
    }
    return (
        known.reduce((total, height) => {
            return total + height;
        }, 0) / known.length
    );
}

export function windowSlots<T>(items: readonly T[], layout: BlockLayout, range: BlockRange, rowsPerBlock: number): BlockWindowSlot<T>[] {
    const size = layout.columns * rowsPerBlock;
    const slots: BlockWindowSlot<T>[] = [];
    for (let block = 0; block * size < items.length; block += 1) {
        const height = layout.heights[block] ?? layout.fallback;
        if ((block >= range.first && block <= range.last) || height === null) {
            slots.push({ kind: 'items', block, items: items.slice(block * size, (block + 1) * size) });
        } else {
            slots.push({ kind: 'spacer', block, height });
        }
    }
    return slots;
}

function slotElements<T>(container: HTMLElement, slots: readonly BlockWindowSlot<T>[]): HTMLElement[][] {
    const children = Array.from(container.children).filter((child): child is HTMLElement => {
        return child instanceof HTMLElement;
    });
    let position = 0;
    return slots.map((slot) => {
        const length = slot.kind === 'items' ? slot.items.length : 1;
        const elements = children.slice(position, position + length);
        position += length;
        return elements;
    });
}

export function layoutBox(container: HTMLElement, element: HTMLElement): { top: number; bottom: number } {
    const top = element.offsetParent === container ? container.clientTop + element.offsetTop : element.offsetTop - container.offsetTop;
    return { top, bottom: top + element.offsetHeight };
}

function measuredHeight(container: HTMLElement, elements: readonly HTMLElement[]): number | undefined {
    const first = elements[0];
    if (first === undefined) {
        return undefined;
    }
    const top = layoutBox(container, first).top;
    const bottom = elements.reduce((lowest, element) => {
        return Math.max(lowest, layoutBox(container, element).bottom);
    }, top);
    return bottom > top ? bottom - top : undefined;
}

function remeasured<T>(container: HTMLElement, heights: readonly (number | undefined)[], slots: readonly BlockWindowSlot<T>[], elements: readonly HTMLElement[][]): readonly (number | undefined)[] {
    const measured = new Map<number, number>();
    slots.forEach((slot, index) => {
        if (slot.kind !== 'items') {
            return;
        }
        const height = measuredHeight(container, elements[index] ?? []);
        const known = heights[slot.block];
        if (height !== undefined && (known === undefined || Math.abs(known - height) > HEIGHT_TOLERANCE)) {
            measured.set(slot.block, height);
        }
    });
    if (measured.size === 0) {
        return heights;
    }
    const blocks = Math.max(heights.length, ...measured.keys()) + 1;
    return Array.from({ length: blocks }, (_unused, block) => {
        return measured.get(block) ?? heights[block];
    });
}

export function withoutChangedBlocks<T>(heights: readonly (number | undefined)[], before: readonly T[], now: readonly T[], size: number): readonly (number | undefined)[] {
    if (before === now) {
        return heights;
    }
    const changed = (block: number): boolean => {
        const end = Math.max(Math.min((block + 1) * size, Math.max(before.length, now.length)), block * size);
        for (let index = block * size; index < end; index += 1) {
            if (before[index] !== now[index]) {
                return true;
            }
        }
        return false;
    };
    const kept = heights.map((height, block) => {
        return height !== undefined && changed(block) ? undefined : height;
    });
    return kept.every((height, block) => {
        return height === heights[block];
    })
        ? heights
        : kept;
}

function viewBounds(root: HTMLElement | null, screensAround: number): { top: number; bottom: number } {
    const box = root === null ? { top: 0, bottom: window.innerHeight } : root.getBoundingClientRect();
    const around = (box.bottom - box.top) * screensAround;
    return { top: box.top - around, bottom: box.bottom + around };
}

function visibleRange(container: HTMLElement, elements: readonly HTMLElement[][], root: HTMLElement | null, drawnRange: BlockRange, screensAround: number): BlockRange {
    const bounds = viewBounds(root, screensAround);
    const box = container.getBoundingClientRect();
    const layoutHeight = container.offsetHeight;
    const scale = layoutHeight > 0 ? (box.bottom - box.top) / layoutHeight : 1;
    const tops = elements.map((group) => {
        const first = group[0];
        return first === undefined ? box.top : box.top + layoutBox(container, first).top * scale;
    });
    const end = box.bottom;
    let first = -1;
    let last = -1;
    tops.forEach((top, block) => {
        const bottom = tops[block + 1] ?? end;
        const margin = block >= drawnRange.first && block <= drawnRange.last ? WINDOW_KEEP_MARGIN : 0;
        if (bottom >= bounds.top - margin && top <= bounds.bottom + margin) {
            first = first === -1 ? block : first;
            last = block;
        }
    });
    if (first === -1) {
        const below = tops[0] !== undefined && tops[0] > bounds.bottom;
        const nearest = below ? 0 : Math.max(0, tops.length - 1);
        return { first: nearest, last: nearest };
    }
    return { first, last };
}

function sameRange(first: BlockRange, second: BlockRange): boolean {
    return first.first === second.first && first.last === second.last;
}

function totalHeight(layout: BlockLayout, blocks: number): number | null {
    let total = 0;
    for (let block = 0; block < blocks; block += 1) {
        const height = layout.heights[block] ?? layout.fallback ?? averageHeight(layout.heights);
        if (height === null) {
            return null;
        }
        total += height;
    }
    return total;
}

export function layoutForColumns(layout: BlockLayout, columns: number, count: number, rowsPerBlock: number): BlockLayout {
    if (layout.columns === columns) {
        return layout;
    }
    const blocksBefore = Math.ceil(count / (layout.columns * rowsPerBlock));
    const blocksNow = Math.ceil(count / (columns * rowsPerBlock));
    const total = totalHeight(layout, blocksBefore);
    return { columns, heights: [], fallback: total === null || blocksNow === 0 ? layout.fallback : total / blocksNow };
}

function nextLayout(layout: BlockLayout, heights: readonly (number | undefined)[], columns: number, count: number, rowsPerBlock: number): BlockLayout {
    if (layout.columns !== columns) {
        return layoutForColumns(layout, columns, count, rowsPerBlock);
    }
    return heights === layout.heights ? layout : { ...layout, heights };
}

function isNotLaidOut(element: HTMLElement): boolean {
    const box = element.getBoundingClientRect();
    return box.width === 0 && box.height === 0;
}

export function useBlockWindow<T>(items: readonly T[], listKey: string, rowsPerBlock: number = WINDOW_ROWS_PER_BLOCK, screensAround: number = WINDOW_SCREENS_AROUND): BlockWindow<T> {
    const [container, setContainer] = useState<HTMLElement | null>(null);
    const [state, setState] = useState<WindowState>(() => {
        return initialState(listKey);
    });
    const current = state.key === listKey ? state : initialState(listKey);
    const slots = windowSlots(items, current.layout, current.range, rowsPerBlock);
    const drawn = useRef<DrawnWindow<T>>({ slots, state: current, items, measuredItems: items, rowsPerBlock });
    const seen = useRef(new Set<T>());
    const drawnBack = useRef(new Map<T, boolean>());
    const isBack = useCallback((item: T): boolean => {
        return drawnBack.current.get(item) ?? seen.current.has(item);
    }, []);
    const scrollRoot = useRef<{ container: HTMLElement; root: HTMLElement | null } | null>(null);

    const rootOf = useCallback((element: HTMLElement): HTMLElement | null => {
        if (scrollRoot.current?.container !== element) {
            scrollRoot.current = { container: element, root: scrollParentOf(element) };
        }
        return scrollRoot.current.root;
    }, []);

    const update = useCallback((): boolean => {
        if (container === null || isNotLaidOut(container)) {
            return false;
        }
        const { slots: drawnSlots, state: drawnState, items: drawnItems, measuredItems, rowsPerBlock: rows } = drawn.current;
        const elements = slotElements(container, drawnSlots);
        const size = drawnState.layout.columns * rows;
        const kept = withoutChangedBlocks(drawnState.layout.heights, measuredItems, drawnItems, size);
        const heights = remeasured(container, kept, drawnSlots, elements);
        drawn.current = { ...drawn.current, measuredItems: drawnItems };
        const layout = nextLayout(drawnState.layout, heights, columnsOf(container), drawnItems.length, rows);
        const range = visibleRange(container, elements, rootOf(container), drawnState.range, screensAround);
        if (layout === drawnState.layout && sameRange(range, drawnState.range)) {
            return false;
        }
        layouts.set(drawnState.key, layout);
        setState({ key: drawnState.key, layout, range });
        return true;
    }, [container, rootOf, screensAround]);

    const chained = useRef(0);
    const deferred = useRef(0);

    useLayoutEffect(() => {
        drawn.current = { ...drawn.current, slots, state: current, items, rowsPerBlock };
        const back = new Map<T, boolean>();
        slots.forEach((slot) => {
            if (slot.kind === 'items') {
                slot.items.forEach((item) => {
                    back.set(item, isBack(item));
                });
            }
        });
        drawnBack.current = back;
        back.forEach((_back, item) => {
            seen.current.add(item);
        });
        if (chained.current >= MAX_CHAINED_UPDATES) {
            chained.current = 0;
            cancelAnimationFrame(deferred.current);
            deferred.current = requestAnimationFrame(() => {
                update();
            });
            return;
        }
        chained.current = update() ? chained.current + 1 : 0;
    });

    useLayoutEffect(() => {
        return () => {
            cancelAnimationFrame(deferred.current);
        };
    }, []);

    useLayoutEffect(() => {
        if (container === null) {
            return undefined;
        }
        let frame = 0;
        const schedule = (): void => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                update();
            });
        };
        const root = rootOf(container);
        const target: HTMLElement | Window = root ?? window;
        target.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        const resizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
        resizes?.observe(container);
        if (root !== null) {
            resizes?.observe(root);
        }
        return () => {
            cancelAnimationFrame(frame);
            target.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            resizes?.disconnect();
        };
    }, [container, rootOf, update]);

    return { containerRef: setContainer, slots, isBack };
}
