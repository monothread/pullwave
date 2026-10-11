// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { useAutoScroll } from '@renderer/hooks/useAutoScroll';

let frames: Array<(time: number) => void> = [];
const cancel = vi.fn();

function makeElement(scrollHeight = 5000, clientHeight = 500): HTMLElement {
    const element = document.createElement('div');
    Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(element, 'clientHeight', { value: clientHeight, configurable: true });
    return element;
}

function tick(time: number): void {
    const run = frames.splice(0);
    act(() => {
        run.forEach((frame) => {
            frame(time);
        });
    });
}

beforeEach(() => {
    frames = [];
    cancel.mockClear();
    vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
        frames.push(callback);
        return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', cancel);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('useAutoScroll', () => {
    it('does nothing while it is not active', () => {
        const element = makeElement();
        renderHook(() => {
            useAutoScroll(() => {return element}, false, 100, vi.fn());
        });
        expect(frames).toHaveLength(0);
        expect(element.scrollTop).toBe(0);
    });

    it('scrolls by the speed and the time that went by, from the second frame on', () => {
        const element = makeElement();
        renderHook(() => {
            useAutoScroll(() => {return element}, true, 100, vi.fn());
        });
        tick(0);
        expect(element.scrollTop).toBe(0);
        tick(500);
        expect(element.scrollTop).toBe(50);
        tick(1500);
        expect(element.scrollTop).toBe(150);
    });

    it('keeps the fraction of a pixel that the browser cannot scroll, for the next frame', () => {
        const element = makeElement();
        renderHook(() => {
            useAutoScroll(() => {return element}, true, 30, vi.fn());
        });
        tick(0);
        tick(16);
        expect(element.scrollTop).toBe(0);
        tick(32);
        expect(element.scrollTop).toBe(0);
        tick(48);
        expect(element.scrollTop).toBe(1);
    });

    it('calls the end function and stops asking for frames when the bottom is reached', () => {
        const element = makeElement(1000, 500);
        const onEnd = vi.fn();
        renderHook(() => {
            useAutoScroll(() => {return element}, true, 1000, onEnd);
        });
        tick(0);
        tick(1000);
        expect(element.scrollTop).toBe(1000);
        expect(onEnd).toHaveBeenCalledTimes(1);
        expect(frames).toHaveLength(0);
    });

    it('asks the container again every frame, and waits when there is none yet', () => {
        let element: HTMLElement | null = null;
        renderHook(() => {
            useAutoScroll(() => {return element}, true, 100, vi.fn());
        });
        tick(0);
        expect(frames).toHaveLength(1);
        element = makeElement();
        tick(1000);
        expect(element.scrollTop).toBe(100);
        tick(2000);
        expect(element.scrollTop).toBe(200);
    });

    it('stops, cancelling the frame, when it is turned off or removed', () => {
        const element = makeElement();
        const { rerender, unmount } = renderHook(
            ({ active }) => {
                useAutoScroll(() => {return element}, active, 100, vi.fn());
            },
            { initialProps: { active: true } }
        );
        rerender({ active: false });
        expect(cancel).toHaveBeenCalledTimes(1);
        rerender({ active: true });
        unmount();
        expect(cancel).toHaveBeenCalledTimes(2);
    });

    it('starts over with the new speed when the speed changes', () => {
        const element = makeElement();
        const { rerender } = renderHook(
            ({ speed }) => {
                useAutoScroll(() => {return element}, true, speed, vi.fn());
            },
            { initialProps: { speed: 100 } }
        );
        tick(0);
        rerender({ speed: 200 });
        expect(cancel).toHaveBeenCalledTimes(1);
        frames = frames.slice(-1);
        tick(1000);
        tick(2000);
        expect(element.scrollTop).toBe(200);
    });
});
