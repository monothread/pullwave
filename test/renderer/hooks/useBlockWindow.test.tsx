// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { columnsOf, layoutBox, layoutForColumns, MAX_CHAINED_UPDATES, scrollParentOf, useBlockWindow, WINDOW_KEEP_MARGIN, WINDOW_ROWS_PER_BLOCK, WINDOW_SCREENS_AROUND, windowSlots, withoutChangedBlocks, type BlockWindowSlot } from '@renderer/hooks/useBlockWindow';

// A fake layout, as jsdom lays nothing out: the scroll area is 300px tall, every row of items is 100px tall (300px when an item of it is
// a tall one, numbered from 100; the items of a row side by side, `columns` of them) and a spacer is a row as tall as its style says. The
// container starts at the top of the scroll area.
const VIEW_HEIGHT = 300;
const ROW_HEIGHT = 100;
const TALL_ROW_HEIGHT = 300;
const FIRST_TALL_ITEM = 100;

let scrollTop = 0;
let columns = 1;
let laidOut = true;
let resizeCallbacks: ResizeObserverCallback[] = [];
let resizeTargets: Element[] = [];
let resizeDisconnects = 0;

function rect(top: number, bottom: number): DOMRect {
    return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => { return {}; } } as DOMRect;
}

// The children of the container in rows: a spacer is a row of its own, the items fill rows of `columns`.
function rowsOf(container: Element): Element[][] {
    const rows: Element[][] = [];
    let row: Element[] = [];
    Array.from(container.children).forEach((child) => {
        if (child.classList.contains('list-window__spacer')) {
            if (row.length > 0) {
                rows.push(row);
                row = [];
            }
            rows.push([child]);
            return;
        }
        row.push(child);
        if (row.length === columns) {
            rows.push(row);
            row = [];
        }
    });
    if (row.length > 0) {
        rows.push(row);
    }
    return rows;
}

function rowHeight(row: readonly Element[]): number {
    const first = row[0] as HTMLElement;
    if (first.classList.contains('list-window__spacer')) {
        return Number.parseFloat(first.style.height);
    }
    return row.some((item) => {
        return Number(item.textContent) >= FIRST_TALL_ITEM;
    })
        ? TALL_ROW_HEIGHT
        : ROW_HEIGHT;
}

// The top and bottom of each child of the container, and the bottom of the container.
function layoutOf(container: Element): { boxes: Map<Element, DOMRect>; bottom: number } {
    const boxes = new Map<Element, DOMRect>();
    let rowTop = -scrollTop;
    rowsOf(container).forEach((row) => {
        const height = rowHeight(row);
        row.forEach((child) => {
            boxes.set(child, rect(rowTop, rowTop + height));
        });
        rowTop += height;
    });
    return { boxes, bottom: rowTop };
}

// What the layout gives as offsets: an item and a spacer are placed from the top of the container (their offset parent), the container is
// as tall as its rows. A transform moves the box of an item (shift) but not its place in the layout.
function isContainer(element: Element): boolean {
    return element.getAttribute('data-testid') === 'container';
}

function childOfContainer(element: Element): HTMLElement | null {
    const parent = element.parentElement;
    return parent !== null && isContainer(parent) ? parent : null;
}

function fakeOffsetParent(this: HTMLElement): Element | null {
    return childOfContainer(this);
}

function fakeOffsetTop(this: HTMLElement): number {
    const container = childOfContainer(this);
    if (!laidOut || container === null) {
        return 0;
    }
    return (layoutOf(container).boxes.get(this)?.top ?? 0) + scrollTop;
}

function fakeOffsetHeight(this: HTMLElement): number {
    if (!laidOut) {
        return 0;
    }
    if (isContainer(this)) {
        return layoutOf(this).bottom + scrollTop;
    }
    const container = childOfContainer(this);
    return container === null ? 0 : (layoutOf(container).boxes.get(this)?.height ?? 0);
}

// How far the items are moved by a transform (the animation of a card that comes in): the box moves, the layout does not.
let itemShift = 0;
// The zoom of the interface (an ultrawide screen magnifies it): the boxes on the screen are magnified by it, the offsets of the layout are not.
let zoom = 1;

function zoomed(box: DOMRect): DOMRect {
    return rect(box.top * zoom, box.bottom * zoom);
}

function fakeRect(this: Element): DOMRect {
    if (!laidOut) {
        return rect(0, 0);
    }
    if (this.getAttribute('data-testid') === 'root') {
        return rect(0, VIEW_HEIGHT);
    }
    if (this.getAttribute('data-testid') === 'container') {
        return zoomed(rect(-scrollTop, layoutOf(this).bottom));
    }
    const container = this.parentElement;
    if (container?.getAttribute('data-testid') === 'container') {
        const box = zoomed(layoutOf(container).boxes.get(this) ?? rect(0, 0));
        return this.classList.contains('list-window__spacer') ? box : rect(box.top + itemShift, box.bottom + itemShift);
    }
    return rect(0, 0);
}

const realComputedStyle = window.getComputedStyle.bind(window);

beforeEach(() => {
    scrollTop = 0;
    columns = 1;
    laidOut = true;
    resizeCallbacks = [];
    resizeTargets = [];
    resizeDisconnects = 0;
    itemShift = 0;
    zoom = 1;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(fakeRect);
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(fakeOffsetParent);
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(fakeOffsetTop);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(fakeOffsetHeight);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => {
        const style = realComputedStyle(element);
        if (element.getAttribute('data-testid') === 'container') {
            return { ...style, gridTemplateColumns: columns > 1 ? Array.from({ length: columns }, () => { return '100px'; }).join(' ') : 'none' } as CSSStyleDeclaration;
        }
        if (element.getAttribute('data-testid') === 'root') {
            return { ...style, overflowY: 'auto' } as CSSStyleDeclaration;
        }
        return style;
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal(
        'ResizeObserver',
        class {
            constructor(callback: ResizeObserverCallback) {
                resizeCallbacks.push(callback);
            }
            observe(target: Element): void {
                resizeTargets.push(target);
            }
            disconnect(): void {
                resizeDisconnects += 1;
            }
        }
    );
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function numbers(length: number): number[] {
    return Array.from({ length }, (_unused, index) => {
        return index + 1;
    });
}

// Draws the list with one screen around the one in view (the geometry of the tests is written for it), unless told otherwise. An item drawn
// again after its block left says so in data-back.
function Probe({ items, listKey, rowsPerBlock, onDraw, screensAround = 1 }: { items: readonly number[]; listKey: string; rowsPerBlock?: number; onDraw?: () => void; screensAround?: number }) {
    const { containerRef, slots, isBack } = useBlockWindow(items, listKey, rowsPerBlock, screensAround);
    onDraw?.();
    return (
        <div data-testid="root">
            <div ref={containerRef} data-testid="container">
                {slots.map((slot) => {
                    if (slot.kind === 'spacer') {
                        return <div key={`spacer-${String(slot.block)}`} className="list-window__spacer" data-block={slot.block} style={{ height: `${String(slot.height)}px` }} />;
                    }
                    return slot.items.map((item) => {
                        return (
                            <div key={item} className="item" data-back={String(isBack(item))}>
                                {item}
                            </div>
                        );
                    });
                })}
            </div>
        </div>
    );
}

function drawnItems(): number[] {
    return Array.from(document.querySelectorAll('.item')).map((item) => {
        return Number(item.textContent);
    });
}

function spacers(): { block: number; height: string }[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.list-window__spacer')).map((spacer) => {
        return { block: Number(spacer.dataset.block), height: spacer.style.height };
    });
}

function scrollTo(position: number): void {
    scrollTop = position;
    act(() => {
        screen.getByTestId('root').dispatchEvent(new Event('scroll'));
    });
}

function range(from: number, to: number): number[] {
    return numbers(to - from + 1).map((offset) => {
        return from + offset - 1;
    });
}

describe('the constants of useBlockWindow', () => {
    it('makes a block of 4 rows and draws two screens around the one in view', () => {
        expect(WINDOW_ROWS_PER_BLOCK).toBe(4);
        expect(WINDOW_SCREENS_AROUND).toBe(2);
    });

    it('keeps a drawn block until it is 64px past the part to draw, and changes the window at most 20 times in a row after a drawing', () => {
        expect(WINDOW_KEEP_MARGIN).toBe(64);
        expect(MAX_CHAINED_UPDATES).toBe(20);
    });
});

describe('layoutBox', () => {
    function element(offsets: { offsetTop: number; offsetHeight: number; offsetParent: Element | null; clientTop?: number }): HTMLElement {
        const made = document.createElement('div');
        Object.defineProperty(made, 'offsetTop', { value: offsets.offsetTop });
        Object.defineProperty(made, 'offsetHeight', { value: offsets.offsetHeight });
        Object.defineProperty(made, 'offsetParent', { value: offsets.offsetParent });
        Object.defineProperty(made, 'clientTop', { value: offsets.clientTop ?? 0 });
        return made;
    }

    it('places an element whose offset parent is the container from the inside of its border', () => {
        const container = element({ offsetTop: 500, offsetHeight: 1000, offsetParent: null, clientTop: 2 });
        const item = element({ offsetTop: 120, offsetHeight: 80, offsetParent: container });
        expect(layoutBox(container, item)).toEqual({ top: 122, bottom: 202 });
    });

    it('places an element that shares the offset parent of the container from the top of the container', () => {
        const parent = document.createElement('section');
        const container = element({ offsetTop: 500, offsetHeight: 1000, offsetParent: parent, clientTop: 2 });
        const item = element({ offsetTop: 620, offsetHeight: 80, offsetParent: parent });
        expect(layoutBox(container, item)).toEqual({ top: 120, bottom: 200 });
    });
});

describe('windowSlots', () => {
    const layout = { columns: 2, heights: [200, 200, 200], fallback: null };

    it('gives nothing for an empty list', () => {
        expect(windowSlots([], layout, { first: 0, last: 0 }, 1)).toEqual([]);
    });

    it('splits the list in blocks of columns times rows, the last one with what is left', () => {
        expect(windowSlots(numbers(5), layout, { first: 0, last: 2 }, 1)).toEqual<BlockWindowSlot<number>[]>([
            { kind: 'items', block: 0, items: [1, 2] },
            { kind: 'items', block: 1, items: [3, 4] },
            { kind: 'items', block: 2, items: [5] }
        ]);
    });

    it('gives a spacer as tall as the block for each measured block outside the range', () => {
        expect(windowSlots(numbers(6), layout, { first: 1, last: 1 }, 1)).toEqual<BlockWindowSlot<number>[]>([
            { kind: 'spacer', block: 0, height: 200 },
            { kind: 'items', block: 1, items: [3, 4] },
            { kind: 'spacer', block: 2, height: 200 }
        ]);
    });

    it('draws a block outside the range whose height is not known when there is no average to give it', () => {
        expect(windowSlots(numbers(6), { columns: 2, heights: [200], fallback: null }, { first: 0, last: 0 }, 1)).toEqual<BlockWindowSlot<number>[]>([
            { kind: 'items', block: 0, items: [1, 2] },
            { kind: 'items', block: 1, items: [3, 4] },
            { kind: 'items', block: 2, items: [5, 6] }
        ]);
    });

    it('gives a block whose height is not known the fallback height', () => {
        expect(windowSlots(numbers(6), { columns: 2, heights: [], fallback: 150 }, { first: 0, last: 0 }, 1)).toEqual<BlockWindowSlot<number>[]>([
            { kind: 'items', block: 0, items: [1, 2] },
            { kind: 'spacer', block: 1, height: 150 },
            { kind: 'spacer', block: 2, height: 150 }
        ]);
    });
});

describe('layoutForColumns', () => {
    const layout = { columns: 1, heights: [200, 200, 200, 200], fallback: null };

    it('keeps the layout when the columns are the same', () => {
        expect(layoutForColumns(layout, 1, 8, 2)).toBe(layout);
    });

    it('drops the heights and splits the height the list had among the blocks of the new columns', () => {
        // 8 items, 2 rows a block: 4 blocks of 200px with one column, 2 blocks with two columns, so 400px each.
        expect(layoutForColumns(layout, 2, 8, 2)).toEqual({ columns: 2, heights: [], fallback: 400 });
    });

    it('counts the blocks never measured with the fallback height', () => {
        expect(layoutForColumns({ columns: 1, heights: [200], fallback: 100 }, 2, 8, 2)).toEqual({ columns: 2, heights: [], fallback: 250 });
    });

    it('counts the blocks never measured with the average height when there is no fallback', () => {
        expect(layoutForColumns({ columns: 1, heights: [200, undefined, 100], fallback: null }, 2, 8, 2)).toEqual({ columns: 2, heights: [], fallback: 300 });
    });

    it('keeps the fallback it had when nothing was ever measured', () => {
        expect(layoutForColumns({ columns: 1, heights: [], fallback: null }, 3, 8, 2)).toEqual({ columns: 3, heights: [], fallback: null });
    });

    it('keeps the fallback it had for an empty list', () => {
        expect(layoutForColumns({ columns: 1, heights: [], fallback: 120 }, 3, 0, 2)).toEqual({ columns: 3, heights: [], fallback: 120 });
    });
});

describe('withoutChangedBlocks', () => {
    const heights = [200, 200, 200];

    it('keeps the same heights when the items are the same list', () => {
        const items = numbers(6);
        expect(withoutChangedBlocks(heights, items, items, 2)).toBe(heights);
    });

    it('keeps the same heights when no item of a measured block changed', () => {
        expect(withoutChangedBlocks(heights, numbers(6), numbers(6), 2)).toBe(heights);
    });

    it('forgets the height of each block that has an item that changed', () => {
        expect(withoutChangedBlocks(heights, [1, 2, 3, 4, 5, 6], [1, 2, 30, 4, 5, 60], 2)).toEqual([200, undefined, undefined]);
    });

    it('forgets the height of the last block when items come at its end', () => {
        expect(withoutChangedBlocks([200, 100], [1, 2, 3], [1, 2, 3, 4, 5], 2)).toEqual([200, undefined]);
    });

    it('forgets the height of a block that lost items, and keeps what was never measured as not measured', () => {
        expect(withoutChangedBlocks([200, undefined, 200], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5], 2)).toEqual([200, undefined, undefined]);
    });
});

describe('columnsOf', () => {
    it('counts the columns of a grid', () => {
        columns = 3;
        render(<Probe items={[]} listKey="list" />);
        expect(columnsOf(screen.getByTestId('container'))).toBe(3);
    });

    it('takes a container that is not a grid as one column', () => {
        columns = 1;
        render(<Probe items={[]} listKey="list" />);
        expect(columnsOf(screen.getByTestId('container'))).toBe(1);
    });

    it('takes a container without columns as one column', () => {
        vi.mocked(window.getComputedStyle).mockImplementation(() => {
            return { gridTemplateColumns: '' } as CSSStyleDeclaration;
        });
        const element = document.createElement('div');
        expect(columnsOf(element)).toBe(1);
    });
});

describe('scrollParentOf', () => {
    it('finds the element above that scrolls', () => {
        render(<Probe items={[]} listKey="list" />);
        expect(scrollParentOf(screen.getByTestId('container'))).toBe(screen.getByTestId('root'));
    });

    it('takes an element that scrolls always (overflow scroll) as well', () => {
        const parent = document.createElement('div');
        const child = document.createElement('div');
        parent.style.overflowY = 'scroll';
        parent.append(child);
        document.body.append(parent);
        expect(scrollParentOf(child)).toBe(parent);
        parent.remove();
    });

    it('finds none when nothing above scrolls (the window does)', () => {
        const child = document.createElement('div');
        document.body.append(child);
        expect(scrollParentOf(child)).toBeNull();
        child.remove();
    });
});

describe('useBlockWindow', () => {
    it('draws only the blocks on the screen and one screen around it, the others being spacers as tall as they were', () => {
        // 20 items in blocks of 2 rows (200px): the screen (0 to 300) and the screen below it (to 600) reach the blocks 0 to 3.
        render(<Probe items={numbers(20)} listKey="list" rowsPerBlock={2} />);
        expect(drawnItems()).toEqual(range(1, 8));
        expect(spacers()).toEqual(
            range(4, 9).map((block) => {
                return { block, height: '200px' };
            })
        );
    });

    it('draws the blocks near where the list is scrolled to, and leaves out the ones that went far', () => {
        render(<Probe items={numbers(20)} listKey="list" rowsPerBlock={2} />);
        scrollTo(1000);
        // The screen is 1000 to 1300, with 700 to 1600 around it: the blocks 3 (600 to 800) to 8 (1600 to 1800).
        expect(drawnItems()).toEqual(range(7, 18));
        expect(spacers()).toEqual([
            { block: 0, height: '200px' },
            { block: 1, height: '200px' },
            { block: 2, height: '200px' },
            { block: 9, height: '200px' }
        ]);
        scrollTo(0);
        expect(drawnItems()).toEqual(range(1, 8));
    });

    it('places the blocks where the layout puts them, not where a transform of their items moves them for a moment', () => {
        render(<Probe items={numbers(20)} listKey="moved" rowsPerBlock={2} />);
        // The cards that come in are moved 80px down by their animation: further than the margin a drawn block is kept with.
        itemShift = 80;
        scrollTo(1000);
        expect(drawnItems()).toEqual(range(7, 18));
        expect(spacers()).toEqual([
            { block: 0, height: '200px' },
            { block: 1, height: '200px' },
            { block: 2, height: '200px' },
            { block: 9, height: '200px' }
        ]);
    });

    it('places the blocks on the screen of an interface that is zoomed, whose layout is not measured in the pixels of the screen', () => {
        // The interface is magnified a fifth: a block of 200px of the layout takes 240px of the screen.
        zoom = 1.2;
        render(<Probe items={numbers(20)} listKey="zoomed" rowsPerBlock={2} />);
        scrollTo(1000);
        // The block k is at (200k - 1000) x 1.2 on the screen: the part to draw is -300 to 600, so the blocks 3 (-480 to -240) to 7 (480 to 720).
        expect(drawnItems()).toEqual(range(7, 16));
        expect(spacers()).toEqual([
            { block: 0, height: '200px' },
            { block: 1, height: '200px' },
            { block: 2, height: '200px' },
            { block: 8, height: '200px' },
            { block: 9, height: '200px' }
        ]);
    });

    it('keeps a drawn block that went less than the margin past the part to draw, and leaves it out past the margin', () => {
        render(<Probe items={numbers(20)} listKey="edge" rowsPerBlock={2} />);
        scrollTo(1000);
        expect(drawnItems()).toEqual(range(7, 18));
        // The part to draw is 840 to 1740: the block 3 (600 to 800) is 40px above it and stays; the block 9 (1800 to 2000), 60px below it and
        // not drawn, does not come in.
        scrollTo(1140);
        expect(drawnItems()).toEqual(range(7, 18));
        expect(spacers().map((spacer) => {
            return spacer.block;
        })).toEqual([0, 1, 2, 9]);
        // The part to draw is 900 to 1800: the block 3 is 100px above it and goes, the block 9 is in it.
        scrollTo(1200);
        expect(drawnItems()).toEqual(range(9, 20));
    });

    it('puts off to the next frame a change that keeps coming after each drawing, instead of drawing the list again without end', () => {
        const frames: FrameRequestCallback[] = [];
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            frames.push(callback);
            return frames.length;
        });
        // A measure that never settles: each look finds the items 1000px lower or higher than the look before.
        let looks = 0;
        const realOffsetTop = fakeOffsetTop;
        vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function wobble(this: HTMLElement) {
            return realOffsetTop.call(this) + (looks % 2 === 0 ? 0 : 1000);
        });
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function counted(this: HTMLElement) {
            if (isContainer(this)) {
                looks += 1;
            }
            return fakeOffsetHeight.call(this);
        });
        let renders = 0;
        const counted = (): void => {
            renders += 1;
        };
        expect(() => {
            render(<Probe items={numbers(40)} listKey="wobble" rowsPerBlock={2} onDraw={counted} />);
        }).not.toThrow();
        expect(renders).toBeLessThanOrEqual(MAX_CHAINED_UPDATES + 2);
        expect(frames).toHaveLength(1);
        const before = renders;
        act(() => {
            frames.shift()?.(0);
        });
        expect(renders).toBeGreaterThan(before);
        expect(renders - before).toBeLessThanOrEqual(MAX_CHAINED_UPDATES + 1);
    });

    it('says an item is back when its block was drawn before and comes back, and keeps what it said while the item stays drawn', () => {
        render(<Probe items={numbers(20)} listKey="back" rowsPerBlock={2} />);
        const backOf = (): Array<[number, string | undefined]> => {
            return Array.from(document.querySelectorAll<HTMLElement>('.item')).map((item) => {
                return [Number(item.textContent), item.dataset['back']];
            });
        };
        // Drawn for the first time: none is back, and none becomes back while it stays drawn.
        expect(backOf()).toEqual(range(1, 8).map((item) => {
            return [item, 'false'];
        }));
        scrollTo(100);
        expect(backOf().filter(([, back]) => {
            return back === 'true';
        })).toEqual([]);
        // Far down: the first blocks leave. The block 3 never left; the blocks 4 to 8 were drawn once when the list was first measured (their
        // height was not known), as all the cards of a list were drawn before, so they are back: their entrance was played then.
        scrollTo(1000);
        expect(backOf()).toEqual([
            [7, 'false'],
            [8, 'false'],
            ...range(9, 18).map((item): [number, string] => {
                return [item, 'true'];
            })
        ]);
        // Back up: the blocks 0 to 2 come back (their items are back), the block 3 never left.
        scrollTo(0);
        expect(backOf()).toEqual([
            ...range(1, 6).map((item): [number, string] => {
                return [item, 'true'];
            }),
            [7, 'false'],
            [8, 'false']
        ]);
    });

    it('forgets the items it drew when the list is drawn again from the start (another visit of the page)', () => {
        const first = render(<Probe items={numbers(20)} listKey="visit" rowsPerBlock={2} />);
        scrollTo(1000);
        scrollTo(0);
        expect(document.querySelector<HTMLElement>('.item')?.dataset['back']).toBe('true');
        first.unmount();
        render(<Probe items={numbers(20)} listKey="visit" rowsPerBlock={2} />);
        expect(Array.from(document.querySelectorAll<HTMLElement>('.item')).every((item) => {
            return item.dataset['back'] === 'false';
        })).toBe(true);
    });

    it('draws two screens around the one in view by default', () => {
        function DefaultAround() {
            const { containerRef, slots } = useBlockWindow(numbers(30), 'default', 2);
            return (
                <div data-testid="root">
                    <div ref={containerRef} data-testid="container">
                        {slots.map((slot) => {
                            if (slot.kind === 'spacer') {
                                return <div key={`spacer-${String(slot.block)}`} className="list-window__spacer" data-block={slot.block} style={{ height: `${String(slot.height)}px` }} />;
                            }
                            return slot.items.map((item) => {
                                return (
                                    <div key={item} className="item">
                                        {item}
                                    </div>
                                );
                            });
                        })}
                    </div>
                </div>
            );
        }
        render(<DefaultAround />);
        scrollTo(1500);
        // The screen is 1500 to 1800, with 900 to 2400 around it: the blocks 4 (800 to 1000) to 12 (2400 to 2600).
        expect(drawnItems()).toEqual(range(9, 26));
    });

    it('makes the blocks of whole rows of the grid', () => {
        columns = 2;
        // 20 items, 2 a row, 2 rows a block: blocks of 4 items, 200px tall; the blocks 0 to 3 are near the screen.
        render(<Probe items={numbers(20)} listKey="grid" rowsPerBlock={2} />);
        expect(drawnItems()).toEqual(range(1, 16));
        expect(spacers()).toEqual([{ block: 4, height: '200px' }]);
    });

    it('draws only the block nearest to the screen when the list is far below it', () => {
        render(<Probe items={numbers(20)} listKey="list" rowsPerBlock={2} />);
        scrollTo(-5000);
        expect(drawnItems()).toEqual([1, 2]);
    });

    it('draws only the last block when the list is far above the screen', () => {
        render(<Probe items={numbers(20)} listKey="list" rowsPerBlock={2} />);
        scrollTo(10_000);
        expect(drawnItems()).toEqual([19, 20]);
    });

    it('comes back as tall as it was for the same key, with the blocks of where it is scrolled to', () => {
        const first = render(<Probe items={numbers(20)} listKey="list" rowsPerBlock={2} />);
        scrollTo(1000);
        first.unmount();
        render(<Probe items={numbers(20)} listKey="list" rowsPerBlock={2} />);
        expect(drawnItems()).toEqual(range(7, 18));
        const total = spacers().reduce((sum, spacer) => {
            return sum + Number.parseFloat(spacer.height);
        }, 0);
        // 4 spacers of 200px and 6 blocks of 200px drawn: the 2000px the list had.
        expect(total + 6 * 200).toBe(2000);
    });

    it('starts from what another key kept, or from nothing', () => {
        const { rerender } = render(<Probe items={numbers(20)} listKey="first" rowsPerBlock={2} />);
        scrollTo(1000);
        expect(drawnItems()).toEqual(range(7, 18));
        rerender(<Probe items={numbers(20)} listKey="second" rowsPerBlock={2} />);
        expect(drawnItems()).toEqual(range(7, 18));
        scrollTo(0);
        expect(drawnItems()).toEqual(range(1, 8));
        rerender(<Probe items={numbers(20)} listKey="first" rowsPerBlock={2} />);
        expect(drawnItems()).toEqual(range(1, 8));
    });

    it('draws the new items that come at the end of the list (a new page of the source)', () => {
        const { rerender } = render(<Probe items={numbers(8)} listKey="list" rowsPerBlock={2} />);
        scrollTo(500);
        rerender(<Probe items={numbers(12)} listKey="list" rowsPerBlock={2} />);
        expect(drawnItems()).toEqual(range(1, 12));
    });

    it('gives the blocks the average height they had when the columns change, until they are measured again', () => {
        render(<Probe items={numbers(40)} listKey="list" rowsPerBlock={2} />);
        scrollTo(3000);
        columns = 2;
        act(() => {
            resizeCallbacks.forEach((callback) => {
                callback([], {} as ResizeObserver);
            });
        });
        // Blocks of 4 items (2 rows of 2), 10 of them: each is given an equal part (400px) of the 4000px the list had, so it stays as
        // tall and the blocks near where it was scrolled are drawn, then measured (200px each).
        expect(drawnItems()).toEqual(range(29, 40));
        expect(spacers()).toEqual([
            ...range(0, 5).map((block) => {
                return { block, height: '400px' };
            }),
            { block: 6, height: '200px' }
        ]);
    });

    it('draws the whole list when nothing of it is laid out (a page that is hidden), as it cannot be measured', () => {
        laidOut = false;
        render(<Probe items={numbers(20)} listKey="list" rowsPerBlock={2} />);
        expect(drawnItems()).toEqual(range(1, 20));
        expect(spacers()).toEqual([]);
    });

    it('measures again a block left out whose items changed, instead of keeping the height it had', () => {
        const { rerender } = render(<Probe items={numbers(20)} listKey="list" rowsPerBlock={2} />);
        scrollTo(1000);
        expect(spacers()[0]).toEqual({ block: 0, height: '200px' });
        // The first two items are now tall ones: the block is drawn to be measured again (600px), and left out with its new height.
        rerender(<Probe items={[100, 101, ...range(3, 20)]} listKey="list" rowsPerBlock={2} />);
        expect(spacers()[0]).toEqual({ block: 0, height: '600px' });
        expect(drawnItems()).not.toContain(100);
    });

    it('keeps the heights of the blocks whose items did not change when a page comes at the end', () => {
        const { rerender } = render(<Probe items={numbers(20)} listKey="list" rowsPerBlock={2} />);
        scrollTo(1000);
        rerender(<Probe items={numbers(22)} listKey="list" rowsPerBlock={2} />);
        expect(spacers()).toEqual([
            { block: 0, height: '200px' },
            { block: 1, height: '200px' },
            { block: 2, height: '200px' },
            { block: 9, height: '200px' },
            { block: 10, height: '200px' }
        ]);
    });

    it('does nothing while the container is not laid out, keeping what it measured before', () => {
        const { rerender } = render(<Probe items={numbers(20)} listKey="list" rowsPerBlock={2} />);
        expect(drawnItems()).toEqual(range(1, 8));
        laidOut = false;
        rerender(<Probe items={numbers(20)} listKey="list" rowsPerBlock={2} />);
        act(() => {
            screen.getByTestId('root').dispatchEvent(new Event('scroll'));
        });
        expect(drawnItems()).toEqual(range(1, 8));
    });

    it('watches the size of the container and of the element that scrolls it, and of the window', () => {
        const add = vi.spyOn(window, 'addEventListener');
        render(<Probe items={numbers(20)} listKey="list" rowsPerBlock={2} />);
        expect(resizeTargets).toEqual([screen.getByTestId('container'), screen.getByTestId('root')]);
        expect(add).toHaveBeenCalledWith('resize', expect.any(Function));
    });

    it('draws the blocks near the screen again when the element that scrolls changes size', () => {
        render(<Probe items={numbers(20)} listKey="list" rowsPerBlock={2} />);
        scrollTo(1000);
        scrollTop = 0;
        act(() => {
            resizeCallbacks.forEach((callback) => {
                callback([], {} as ResizeObserver);
            });
        });
        expect(drawnItems()).toEqual(range(1, 8));
    });

    it('stops following the scroll and the sizes when it is removed', () => {
        const { unmount } = render(<Probe items={numbers(20)} listKey="list" rowsPerBlock={2} />);
        const remove = vi.spyOn(screen.getByTestId('root'), 'removeEventListener');
        const removeFromWindow = vi.spyOn(window, 'removeEventListener');
        unmount();
        expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
        expect(removeFromWindow).toHaveBeenCalledWith('resize', expect.any(Function));
        expect(resizeDisconnects).toBe(1);
    });
});
