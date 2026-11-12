import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ListMemory } from './listMemory';

// How many rows of the grid (or items of a list that is not a grid) make a block, the part that is drawn or left out as a whole.
export const WINDOW_ROWS_PER_BLOCK = 4;
// The blocks drawn are the ones on the screen and the ones up to this many screens above and below it (a scroll fast up or down finds them
// drawn).
export const WINDOW_SCREENS_AROUND = 2;
// The difference of height, in pixels, under which a block is taken as having kept its height.
const HEIGHT_TOLERANCE = 0.5;
// How far, in pixels, past the part to draw a block that is drawn may go and still be kept: a block on the edge is not left out and drawn
// again for a difference of a pixel.
export const WINDOW_KEEP_MARGIN = 64;
// How many times in a row the window may be changed right after a drawing. Past it, the next change waits for the next frame: a measure that
// would never settle cannot draw the list again and again until React stops the app.
export const MAX_CHAINED_UPDATES = 20;
// The blocks drawn when the list is seen for the first time, before anything of it is measured.
const FIRST_RANGE: BlockRange = { first: 0, last: 0 };

export type BlockWindowSlot<T> = { kind: 'items'; block: number; items: readonly T[] } | { kind: 'spacer'; block: number; height: number };

export interface BlockWindow<T> {
    // To put on the element whose children are the items (and the spacers): the grid, or the list.
    containerRef: (element: HTMLElement | null) => void;
    // What goes in it, in order: the blocks that are drawn, and a spacer as tall as each block that is not.
    slots: readonly BlockWindowSlot<T>[];
    // Whether an item that is drawn is back: it was drawn before while the list is open, left with its block, and its block came back. Such an
    // item is shown as it was (its entrance is not played again). It does not change while the item stays drawn.
    isBack: (item: T) => boolean;
}

interface BlockRange {
    first: number;
    last: number;
}

// How tall the blocks were, for the number of columns they were measured with. `fallback` is the height given to a block never measured.
export interface BlockLayout {
    columns: number;
    heights: readonly (number | undefined)[];
    fallback: number | null;
}

interface DrawnWindow<T> {
    slots: readonly BlockWindowSlot<T>[];
    state: WindowState;
    items: readonly T[];
    // The items the heights were last measured (or kept) for.
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

// The columns of the container: the ones of its grid, or one when it is not a grid.
export function columnsOf(container: HTMLElement): number {
    const tracks = getComputedStyle(container).gridTemplateColumns.trim();
    if (tracks.length === 0 || tracks === 'none') {
        return 1;
    }
    return Math.max(1, tracks.split(/\s+/).length);
}

// The element that scrolls the list: the first one above it that scrolls up and down, or none (the window does).
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

// The average of the heights that are known, or null when none is.
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

// The blocks of the list and what is drawn of each: its items when it is in the range or its height is not known, a spacer otherwise.
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

// The elements that each slot put in the container, in order: the items of a block, or its spacer.
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

// Where an element is inside the container (from its top), from the layout alone: a transform does not count. The cards of a block that is
// drawn again come in with an animation that moves them for a moment; measured with it, the block would seem lower than it is, be left out,
// come back in its place as a spacer, and be drawn again, without end.
export function layoutBox(container: HTMLElement, element: HTMLElement): { top: number; bottom: number } {
    const top = element.offsetParent === container ? container.clientTop + element.offsetTop : element.offsetTop - container.offsetTop;
    return { top, bottom: top + element.offsetHeight };
}

// How tall the drawn elements of a block are, from the top of the first to the lowest bottom, or undefined when they take no room (they are
// not laid out: a page that is hidden).
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

// The heights of the blocks after the ones that are drawn were measured again, or the same array when none changed.
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

// The heights without the ones of the blocks whose items changed since they were measured (a source that was searched and now has its
// results, a last block that got the items of a new page): those blocks get the fallback height until they are drawn and measured again.
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

// The part of the screen (with the room around it) where a block has to be drawn, in the coordinates of the window.
function viewBounds(root: HTMLElement | null, screensAround: number): { top: number; bottom: number } {
    const box = root === null ? { top: 0, bottom: window.innerHeight } : root.getBoundingClientRect();
    const around = (box.bottom - box.top) * screensAround;
    return { top: box.top - around, bottom: box.bottom + around };
}

// The blocks that are on the screen or near it. A block reaches from the top of its first element to the top of the next block (the end of
// the container for the last one). A block that is drawn stays drawn until it is WINDOW_KEEP_MARGIN past that part.
function visibleRange(container: HTMLElement, elements: readonly HTMLElement[][], root: HTMLElement | null, drawnRange: BlockRange, screensAround: number): BlockRange {
    const bounds = viewBounds(root, screensAround);
    const box = container.getBoundingClientRect();
    // The layout is measured in the pixels of the page and the screen in the pixels of the window: they differ by the zoom of the interface
    // (an ultrawide screen magnifies it a fifth), so the places in the layout are brought to the scale of the screen before they are compared.
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
        // Nothing is near the screen (the list is above or below it): only the block nearest to it is drawn.
        const below = tops[0] !== undefined && tops[0] > bounds.bottom;
        const nearest = below ? 0 : Math.max(0, tops.length - 1);
        return { first: nearest, last: nearest };
    }
    return { first, last };
}

function sameRange(first: BlockRange, second: BlockRange): boolean {
    return first.first === second.first && first.last === second.last;
}

// How tall the whole list was in a layout: the blocks measured, and the fallback height for the others.
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

// The layout for a number of columns: the heights are known only for the columns they were measured with, so when the columns change they
// are dropped, and the blocks get, until they are measured, an equal part of the height the whole list had (it stays as tall, so the scroll
// that is put back finds its place).
export function layoutForColumns(layout: BlockLayout, columns: number, count: number, rowsPerBlock: number): BlockLayout {
    if (layout.columns === columns) {
        return layout;
    }
    const blocksBefore = Math.ceil(count / (layout.columns * rowsPerBlock));
    const blocksNow = Math.ceil(count / (columns * rowsPerBlock));
    const total = totalHeight(layout, blocksBefore);
    return { columns, heights: [], fallback: total === null || blocksNow === 0 ? layout.fallback : total / blocksNow };
}

// The layout after a drawing: for the columns the container has now, or with the heights measured again.
function nextLayout(layout: BlockLayout, heights: readonly (number | undefined)[], columns: number, count: number, rowsPerBlock: number): BlockLayout {
    if (layout.columns !== columns) {
        return layoutForColumns(layout, columns, count, rowsPerBlock);
    }
    return heights === layout.heights ? layout : { ...layout, heights };
}

// Whether the element takes no room at all: it is not laid out (a page that is hidden), so nothing of it can be measured.
function isNotLaidOut(element: HTMLElement): boolean {
    const box = element.getBoundingClientRect();
    return box.width === 0 && box.height === 0;
}

// Draws a long list a block of rows at a time: only the blocks on the screen and near it are drawn, and each of the others is a spacer as
// tall as it was when it was drawn (as tall as the average block before that). The heights are kept for `listKey`, so the list comes back
// as tall as it was and the scroll can be put back. The blocks are whole rows of the grid, so leaving one out moves nothing around it.
export function useBlockWindow<T>(items: readonly T[], listKey: string, rowsPerBlock: number = WINDOW_ROWS_PER_BLOCK, screensAround: number = WINDOW_SCREENS_AROUND): BlockWindow<T> {
    const [container, setContainer] = useState<HTMLElement | null>(null);
    const [state, setState] = useState<WindowState>(() => {
        return initialState(listKey);
    });
    const current = state.key === listKey ? state : initialState(listKey);
    const slots = windowSlots(items, current.layout, current.range, rowsPerBlock);
    // What was drawn the last time, for the measures taken when the list is scrolled or changes size: the items measured last are kept to
    // know which blocks changed since.
    const drawn = useRef<DrawnWindow<T>>({ slots, state: current, items, measuredItems: items, rowsPerBlock });
    // The items drawn at least once while the list is open, and whether each item drawn now is back (see isBack).
    const seen = useRef(new Set<T>());
    const drawnBack = useRef(new Map<T, boolean>());
    const isBack = useCallback((item: T): boolean => {
        return drawnBack.current.get(item) ?? seen.current.has(item);
    }, []);
    // The element that scrolls the container, looked for once for each container.
    const scrollRoot = useRef<{ container: HTMLElement; root: HTMLElement | null } | null>(null);

    const rootOf = useCallback((element: HTMLElement): HTMLElement | null => {
        if (scrollRoot.current?.container !== element) {
            scrollRoot.current = { container: element, root: scrollParentOf(element) };
        }
        return scrollRoot.current.root;
    }, []);

    // Whether the window changed (and the list is drawn again).
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

    // How many times in a row the window changed right after a drawing, and the frame a change was put off to.
    const chained = useRef(0);
    const deferred = useRef(0);

    // After each drawing: what was drawn is measured, and the blocks to draw are looked at again from where the list now is. After
    // MAX_CHAINED_UPDATES changes in a row the next look waits for the next frame.
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

    // The scroll and the changes of size (the window, the covers that load) move the blocks: they are looked at again at the next frame.
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
        // The screen of the list changes size too (the window, a bar that shows up): more or fewer blocks are near it.
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
