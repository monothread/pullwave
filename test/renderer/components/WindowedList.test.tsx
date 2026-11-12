// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { WindowedList, windowBack } from '@renderer/components/WindowedList';
import * as blockWindow from '@renderer/hooks/useBlockWindow';

afterEach(() => {
    vi.restoreAllMocks();
});

function renderItem(item: number, back: boolean) {
    return (
        <li key={item} {...windowBack(back)}>
            {`item ${String(item)}`}
        </li>
    );
}

function notBack(): boolean {
    return false;
}

describe('WindowedList', () => {
    it('draws every item in its container when nothing is laid out (all the blocks are drawn)', () => {
        render(<WindowedList as="ul" className="cover-grid" items={[1, 2, 3]} listKey="list" renderItem={renderItem} />);
        const list = screen.getByRole('list');
        expect(list).toHaveClass('cover-grid');
        expect(screen.getAllByRole('listitem').map((item) => {
            return item.textContent;
        })).toEqual(['item 1', 'item 2', 'item 3']);
        expect(screen.queryByTestId('list-window-spacer')).toBeNull();
    });

    it('asks the hook for the items, the key and 4 rows a block by default, and puts its ref on the container', () => {
        const containerRef = vi.fn();
        const hook = vi.spyOn(blockWindow, 'useBlockWindow').mockReturnValue({ containerRef, slots: [], isBack: notBack });
        render(<WindowedList as="div" className="results" items={[1, 2]} listKey="search" renderItem={renderItem} />);
        expect(hook).toHaveBeenCalledWith([1, 2], 'search', 4);
        expect(containerRef).toHaveBeenCalledWith(document.querySelector('.results'));
    });

    it('passes the rows a block asked for', () => {
        const hook = vi.spyOn(blockWindow, 'useBlockWindow').mockReturnValue({ containerRef: vi.fn(), slots: [], isBack: notBack });
        render(<WindowedList as="ul" items={[1]} listKey="search" rowsPerBlock={2} renderItem={renderItem} />);
        expect(hook).toHaveBeenCalledWith([1], 'search', 2);
    });

    it('draws a hidden spacer item as tall as each block left out of a list, and the items of the others', () => {
        vi.spyOn(blockWindow, 'useBlockWindow').mockReturnValue({
            containerRef: vi.fn(),
            slots: [
                { kind: 'spacer', block: 0, height: 320 },
                { kind: 'items', block: 1, items: [5, 6] },
                { kind: 'spacer', block: 2, height: 180.5 }
            ],
            isBack: notBack
        });
        render(<WindowedList as="ul" items={[1, 2, 3, 4, 5, 6, 7]} listKey="list" renderItem={renderItem} />);
        const spacers = screen.getAllByTestId('list-window-spacer');
        expect(spacers.map((spacer) => {
            return { tag: spacer.tagName, height: spacer.style.height, hidden: spacer.getAttribute('aria-hidden'), className: spacer.className };
        })).toEqual([
            { tag: 'LI', height: '320px', hidden: 'true', className: 'list-window__spacer' },
            { tag: 'LI', height: '180.5px', hidden: 'true', className: 'list-window__spacer' }
        ]);
        expect(Array.from(screen.getByRole('list', { hidden: true }).children).map((child) => {
            return child.textContent;
        })).toEqual(['', 'item 5', 'item 6', '']);
    });

    it('keeps the element of an item that goes to another block when the columns change', () => {
        const hook = vi.spyOn(blockWindow, 'useBlockWindow').mockReturnValue({
            containerRef: vi.fn(),
            slots: [
                { kind: 'items', block: 0, items: [1, 2] },
                { kind: 'items', block: 1, items: [3, 4] }
            ],
            isBack: notBack
        });
        const { rerender } = render(<WindowedList as="ul" items={[1, 2, 3, 4]} listKey="list" renderItem={renderItem} />);
        const third = screen.getByText('item 3');
        hook.mockReturnValue({ containerRef: vi.fn(), slots: [{ kind: 'items', block: 0, items: [1, 2, 3, 4] }], isBack: notBack });
        rerender(<WindowedList as="ul" items={[1, 2, 3, 4]} listKey="list" renderItem={renderItem} />);
        expect(screen.getByText('item 3')).toBe(third);
        expect(screen.getAllByRole('listitem').map((item) => {
            return item.textContent;
        })).toEqual(['item 1', 'item 2', 'item 3', 'item 4']);
    });

    it('makes the spacers boxes in a container that is a box', () => {
        vi.spyOn(blockWindow, 'useBlockWindow').mockReturnValue({ containerRef: vi.fn(), slots: [{ kind: 'spacer', block: 0, height: 90 }], isBack: notBack });
        render(<WindowedList as="div" items={[1]} listKey="list" renderItem={renderItem} />);
        expect(screen.getByTestId('list-window-spacer').tagName).toBe('DIV');
    });

    it('tells the items drawn again after their block left the screen, which get the attribute that skips their entrance', () => {
        const isBack = vi.fn((item: unknown) => {
            return item === 2;
        });
        vi.spyOn(blockWindow, 'useBlockWindow').mockReturnValue({ containerRef: vi.fn(), slots: [{ kind: 'items', block: 0, items: [1, 2, 3] }], isBack });
        render(<WindowedList as="ul" items={[1, 2, 3]} listKey="list" renderItem={renderItem} />);
        expect(isBack.mock.calls.map((call) => {
            return call[0];
        })).toEqual([1, 2, 3]);
        expect(screen.getAllByRole('listitem').map((item) => {
            return item.getAttribute('data-window-back');
        })).toEqual([null, 'true', null]);
    });
});

describe('windowBack', () => {
    it('gives the attribute to an item drawn again, and nothing to the others', () => {
        expect(windowBack(true)).toEqual({ 'data-window-back': true });
        expect(windowBack(false)).toEqual({});
    });
});
