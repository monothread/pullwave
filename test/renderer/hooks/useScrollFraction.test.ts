// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { scrollFraction, useScrollFraction } from '@renderer/hooks/useScrollFraction';

function box(top: number, height: number): DOMRect {
    return { top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => { return {}; } } as DOMRect;
}

describe('scrollFraction', () => {
    it('is 0 while the top of the content is at the top of the area', () => {
        expect(scrollFraction({ top: 100, height: 2000 }, { top: 100, height: 500 })).toBe(0);
    });

    it('is 1 when the end of the content is at the bottom of the area', () => {
        expect(scrollFraction({ top: -1500, height: 2000 }, { top: 0, height: 500 })).toBe(1);
    });

    it('is the part of the scrollable distance that was scrolled', () => {
        expect(scrollFraction({ top: -750, height: 2000 }, { top: 0, height: 500 })).toBe(0.5);
    });

    it('stays between 0 and 1 when the content is below or past the area', () => {
        expect(scrollFraction({ top: 400, height: 2000 }, { top: 0, height: 500 })).toBe(0);
        expect(scrollFraction({ top: -5000, height: 2000 }, { top: 0, height: 500 })).toBe(1);
    });

    it('is 1 for content that fits in the area, and 0 for content with no size yet', () => {
        expect(scrollFraction({ top: 0, height: 300 }, { top: 0, height: 500 })).toBe(1);
        expect(scrollFraction({ top: 0, height: 500 }, { top: 0, height: 500 })).toBe(1);
        expect(scrollFraction({ top: 0, height: 0 }, { top: 0, height: 500 })).toBe(0);
    });
});

describe('useScrollFraction', () => {
    function setup(contentTop: { value: number }) {
        const area = document.createElement('div');
        const content = document.createElement('div');
        area.getBoundingClientRect = () => {
            return box(0, 500);
        };
        content.getBoundingClientRect = () => {
            return box(contentTop.value, 2000);
        };
        return { area, content };
    }

    it('follows the scroll of the area', () => {
        const top = { value: 0 };
        const { area, content } = setup(top);
        const { result } = renderHook(() => {
            return useScrollFraction(() => { return area; }, { current: content }, true);
        });
        expect(result.current).toBe(0);
        top.value = -750;
        act(() => {
            area.dispatchEvent(new Event('scroll'));
        });
        expect(result.current).toBe(0.5);
        top.value = -1500;
        act(() => {
            area.dispatchEvent(new Event('scroll'));
        });
        expect(result.current).toBe(1);
    });

    it('is recalculated when the window changes size', () => {
        const top = { value: -750 };
        const { area, content } = setup(top);
        const { result } = renderHook(() => {
            return useScrollFraction(() => { return area; }, { current: content }, true);
        });
        expect(result.current).toBe(0.5);
        top.value = -1500;
        act(() => {
            window.dispatchEvent(new Event('resize'));
        });
        expect(result.current).toBe(1);
    });

    it('is recalculated when the content changes size', () => {
        const top = { value: -750 };
        const { area, content } = setup(top);
        let notify: () => void = () => { return undefined; };
        class FakeResizeObserver {
            constructor(handler: () => void) {
                notify = handler;
            }
            observe = vi.fn();
            disconnect = vi.fn();
        }
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        const { result } = renderHook(() => {
            return useScrollFraction(() => { return area; }, { current: content }, true);
        });
        top.value = -1500;
        act(() => {
            notify();
        });
        expect(result.current).toBe(1);
        vi.unstubAllGlobals();
    });

    it('listens to nothing while it is not active, or when there is no area or content', () => {
        const top = { value: -750 };
        const { area, content } = setup(top);
        const add = vi.spyOn(area, 'addEventListener');
        expect(
            renderHook(() => {
                return useScrollFraction(() => { return area; }, { current: content }, false);
            }).result.current
        ).toBe(0);
        expect(
            renderHook(() => {
                return useScrollFraction(() => { return null; }, { current: content }, true);
            }).result.current
        ).toBe(0);
        expect(
            renderHook(() => {
                return useScrollFraction(() => { return area; }, { current: null }, true);
            }).result.current
        ).toBe(0);
        expect(add).not.toHaveBeenCalled();
    });

    it('stops listening when it is removed', () => {
        const top = { value: 0 };
        const { area, content } = setup(top);
        const remove = vi.spyOn(area, 'removeEventListener');
        const removeWindow = vi.spyOn(window, 'removeEventListener');
        const { unmount } = renderHook(() => {
            return useScrollFraction(() => { return area; }, { current: content }, true);
        });
        unmount();
        expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
        expect(removeWindow).toHaveBeenCalledWith('resize', expect.any(Function));
    });
});
