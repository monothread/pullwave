// @vitest-environment jsdom
import { createRef, type RefObject } from 'react';
import { act, renderHook } from '@testing-library/react';
import { READER_BAR_HIDE_MS, READER_BAR_HOVER_MIN_PX, useReaderFullscreenBar } from '@renderer/hooks/useReaderFullscreenBar';

interface Harness {
    area: HTMLDivElement;
    bar: HTMLElement;
    child: HTMLDivElement;
    barRef: RefObject<HTMLElement | null>;
    getArea: () => HTMLElement;
}

function rect(top: number, height: number): DOMRect {
    return {
        top,
        bottom: top + height,
        left: 0,
        right: 1000,
        width: 1000,
        height,
        x: 0,
        y: top,
        toJSON: () => {
            return {};
        }
    };
}

function makeHarness(barHeight = 0, areaTop = 0): Harness {
    const area = document.createElement('div');
    const bar = document.createElement('header');
    const child = document.createElement('div');
    bar.appendChild(child);
    area.appendChild(bar);
    document.body.appendChild(area);
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue(rect(areaTop, 1000));
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue(rect(areaTop, barHeight));
    const barRef = createRef<HTMLElement>();
    (barRef as { current: HTMLElement | null }).current = bar;
    const getArea = (): HTMLElement => {
        return area;
    };
    return { area, bar, child, barRef, getArea };
}

function advance(ms: number): void {
    act(() => {
        vi.advanceTimersByTime(ms);
    });
}

function moveMouse(target: HTMLElement, clientY: number): void {
    act(() => {
        target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY }));
    });
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('useReaderFullscreenBar', () => {
    it('waits 5 seconds before hiding and uses at least 64 pixels for the top hover zone', () => {
        expect(READER_BAR_HIDE_MS).toBe(5000);
        expect(READER_BAR_HOVER_MIN_PX).toBe(64);
    });

    it('keeps the bar visible outside of fullscreen and attaches no listeners', () => {
        const { area, bar, barRef, getArea } = makeHarness();
        const addArea = vi.spyOn(area, 'addEventListener');
        const addBar = vi.spyOn(bar, 'addEventListener');
        const { result } = renderHook(() => {
            return useReaderFullscreenBar(getArea, barRef, false, false);
        });
        advance(READER_BAR_HIDE_MS * 3);
        expect(result.current).toBe(false);
        expect(addArea).not.toHaveBeenCalled();
        expect(addBar).not.toHaveBeenCalled();
    });

    it('hides the bar after 5 seconds in fullscreen', () => {
        const { barRef, getArea } = makeHarness();
        const { result } = renderHook(
            ({ active, pinned }: { active: boolean; pinned: boolean }) => {
                return useReaderFullscreenBar(getArea, barRef, active, pinned);
            },
            { initialProps: { active: true, pinned: false } }
        );
        advance(READER_BAR_HIDE_MS - 1);
        expect(result.current).toBe(false);
        advance(1);
        expect(result.current).toBe(true);
    });

    it('does not reset the timer or show the bar when the mouse moves outside the top zone', () => {
        const { area, barRef, getArea } = makeHarness();
        const { result } = renderHook(() => {
            return useReaderFullscreenBar(getArea, barRef, true, false);
        });
        advance(3000);
        moveMouse(area, 300);
        advance(2000);
        expect(result.current).toBe(true);

        moveMouse(area, 400);
        expect(result.current).toBe(true);
    });

    it('shows the bar on hover over the top zone, keeps it while hovering, and hides it 5 seconds after leaving', () => {
        const { area, barRef, getArea } = makeHarness();
        const { result } = renderHook(() => {
            return useReaderFullscreenBar(getArea, barRef, true, false);
        });
        advance(READER_BAR_HIDE_MS);
        expect(result.current).toBe(true);

        moveMouse(area, 20);
        expect(result.current).toBe(false);
        advance(READER_BAR_HIDE_MS * 3);
        expect(result.current).toBe(false);

        moveMouse(area, 300);
        expect(result.current).toBe(false);
        advance(READER_BAR_HIDE_MS - 1);
        expect(result.current).toBe(false);
        advance(1);
        expect(result.current).toBe(true);
    });

    it('cancels the countdown when re-entering hover before 5 seconds elapse and starts a fresh 5 seconds upon leaving again', () => {
        const { area, barRef, getArea } = makeHarness();
        const { result } = renderHook(() => {
            return useReaderFullscreenBar(getArea, barRef, true, false);
        });
        moveMouse(area, 20);
        moveMouse(area, 300);
        advance(3000);
        expect(result.current).toBe(false);

        moveMouse(area, 20);
        advance(READER_BAR_HIDE_MS * 2);
        expect(result.current).toBe(false);

        moveMouse(area, 300);
        advance(READER_BAR_HIDE_MS - 1);
        expect(result.current).toBe(false);
        advance(1);
        expect(result.current).toBe(true);
    });

    it('uses the rendered bounding height of the bar (including zoomed displays) when taller than the minimum hover zone', () => {
        const { area, bar, barRef, getArea } = makeHarness(96, 0);
        Object.defineProperty(bar, 'offsetHeight', { configurable: true, value: 80 });
        const { result } = renderHook(() => {
            return useReaderFullscreenBar(getArea, barRef, true, false);
        });
        advance(READER_BAR_HIDE_MS);
        expect(result.current).toBe(true);

        moveMouse(area, 97);
        expect(result.current).toBe(true);
        moveMouse(area, 96);
        expect(result.current).toBe(false);
    });

    it('measures the top hover zone relative to the top edge of the fullscreen area', () => {
        const { area, barRef, getArea } = makeHarness(0, 100);
        const { result } = renderHook(() => {
            return useReaderFullscreenBar(getArea, barRef, true, false);
        });
        advance(READER_BAR_HIDE_MS);
        expect(result.current).toBe(true);

        moveMouse(area, 50);
        expect(result.current).toBe(true);
        moveMouse(area, 165);
        expect(result.current).toBe(true);
        moveMouse(area, 164);
        expect(result.current).toBe(false);
    });

    it('keeps the bar visible while the mouse moves inside a child of the bar even below its own height', () => {
        const { child, barRef, getArea } = makeHarness(60, 0);
        const { result } = renderHook(() => {
            return useReaderFullscreenBar(getArea, barRef, true, false);
        });
        advance(READER_BAR_HIDE_MS);
        expect(result.current).toBe(true);

        moveMouse(child, 250);
        expect(result.current).toBe(false);
        advance(READER_BAR_HIDE_MS * 2);
        expect(result.current).toBe(false);
    });

    it('shows the bar on mouseenter of the bar and hides it 5 seconds after mouseleave', () => {
        const { bar, barRef, getArea } = makeHarness();
        const { result } = renderHook(() => {
            return useReaderFullscreenBar(getArea, barRef, true, false);
        });
        advance(READER_BAR_HIDE_MS);
        expect(result.current).toBe(true);

        act(() => {
            bar.dispatchEvent(new MouseEvent('mouseenter'));
        });
        expect(result.current).toBe(false);
        advance(READER_BAR_HIDE_MS * 2);
        expect(result.current).toBe(false);

        act(() => {
            bar.dispatchEvent(new MouseEvent('mouseleave'));
        });
        advance(READER_BAR_HIDE_MS - 1);
        expect(result.current).toBe(false);
        advance(1);
        expect(result.current).toBe(true);
    });

    it('starts the 5-second countdown when the mouse leaves the fullscreen area', () => {
        const { area, barRef, getArea } = makeHarness();
        const { result } = renderHook(() => {
            return useReaderFullscreenBar(getArea, barRef, true, false);
        });
        moveMouse(area, 10);
        advance(READER_BAR_HIDE_MS * 2);
        expect(result.current).toBe(false);

        act(() => {
            area.dispatchEvent(new MouseEvent('mouseleave'));
        });
        advance(READER_BAR_HIDE_MS - 1);
        expect(result.current).toBe(false);
        advance(1);
        expect(result.current).toBe(true);
    });

    it('keeps the bar visible while pinned and waits 5 seconds after unpinning before hiding', () => {
        const { barRef, getArea } = makeHarness();
        const { result, rerender } = renderHook(
            ({ active, pinned }: { active: boolean; pinned: boolean }) => {
                return useReaderFullscreenBar(getArea, barRef, active, pinned);
            },
            { initialProps: { active: true, pinned: true } }
        );
        advance(READER_BAR_HIDE_MS * 3);
        expect(result.current).toBe(false);

        rerender({ active: true, pinned: false });
        advance(READER_BAR_HIDE_MS - 1);
        expect(result.current).toBe(false);
        advance(1);
        expect(result.current).toBe(true);
    });

    it('reveals a hidden bar when pinned becomes true and gives a fresh 5 seconds after unpinning', () => {
        const { barRef, getArea } = makeHarness();
        const { result, rerender } = renderHook(
            ({ active, pinned }: { active: boolean; pinned: boolean }) => {
                return useReaderFullscreenBar(getArea, barRef, active, pinned);
            },
            { initialProps: { active: true, pinned: false } }
        );
        advance(READER_BAR_HIDE_MS);
        expect(result.current).toBe(true);

        rerender({ active: true, pinned: true });
        expect(result.current).toBe(false);
        rerender({ active: true, pinned: false });
        advance(READER_BAR_HIDE_MS - 1);
        expect(result.current).toBe(false);
        advance(1);
        expect(result.current).toBe(true);
    });

    it('keeps the bar visible after unpinning if the mouse is still hovering the bar', () => {
        const { area, barRef, getArea } = makeHarness();
        const { result, rerender } = renderHook(
            ({ active, pinned }: { active: boolean; pinned: boolean }) => {
                return useReaderFullscreenBar(getArea, barRef, active, pinned);
            },
            { initialProps: { active: true, pinned: true } }
        );
        moveMouse(area, 10);
        rerender({ active: true, pinned: false });
        advance(READER_BAR_HIDE_MS * 2);
        expect(result.current).toBe(false);

        moveMouse(area, 300);
        advance(READER_BAR_HIDE_MS);
        expect(result.current).toBe(true);
    });

    it('shows the bar immediately, removes exact listeners, clears timers when leaving fullscreen, and starts fresh upon re-entering', () => {
        const { area, bar, barRef, getArea } = makeHarness();
        const addArea = vi.spyOn(area, 'addEventListener');
        const removeArea = vi.spyOn(area, 'removeEventListener');
        const addBar = vi.spyOn(bar, 'addEventListener');
        const removeBar = vi.spyOn(bar, 'removeEventListener');
        const { result, rerender } = renderHook(
            ({ active }: { active: boolean }) => {
                return useReaderFullscreenBar(getArea, barRef, active, false);
            },
            { initialProps: { active: true } }
        );
        advance(READER_BAR_HIDE_MS);
        expect(result.current).toBe(true);

        rerender({ active: false });
        expect(result.current).toBe(false);
        expect(addArea).toHaveBeenCalledTimes(2);
        expect(addBar).toHaveBeenCalledTimes(2);
        expect(removeArea.mock.calls).toEqual(addArea.mock.calls);
        expect(removeBar.mock.calls).toEqual(addBar.mock.calls);
        expect(vi.getTimerCount()).toBe(0);
        advance(READER_BAR_HIDE_MS * 2);
        expect(result.current).toBe(false);

        rerender({ active: true });
        expect(result.current).toBe(false);
        advance(READER_BAR_HIDE_MS - 1);
        expect(result.current).toBe(false);
        advance(1);
        expect(result.current).toBe(true);
    });

    it('handles a missing bar ref without failing', () => {
        const { area, getArea } = makeHarness();
        const emptyRef = createRef<HTMLElement>();
        const { result } = renderHook(() => {
            return useReaderFullscreenBar(getArea, emptyRef, true, false);
        });
        advance(READER_BAR_HIDE_MS);
        expect(result.current).toBe(true);

        moveMouse(area, 10);
        expect(result.current).toBe(false);
    });

    it('removes the exact registered listeners and clears pending timers on unmount', () => {
        const { area, bar, barRef, getArea } = makeHarness();
        const addArea = vi.spyOn(area, 'addEventListener');
        const removeArea = vi.spyOn(area, 'removeEventListener');
        const addBar = vi.spyOn(bar, 'addEventListener');
        const removeBar = vi.spyOn(bar, 'removeEventListener');
        const { unmount } = renderHook(() => {
            return useReaderFullscreenBar(getArea, barRef, true, false);
        });
        unmount();

        expect(addArea).toHaveBeenCalledTimes(2);
        expect(addBar).toHaveBeenCalledTimes(2);
        expect(removeArea.mock.calls).toEqual(addArea.mock.calls);
        expect(removeBar.mock.calls).toEqual(addBar.mock.calls);
        expect(vi.getTimerCount()).toBe(0);
    });
});
