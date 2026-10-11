// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { useScrolledDown } from '@renderer/hooks/useScrolledDown';

function scroll(element: HTMLElement, top: number): void {
    element.scrollTop = top;
    act(() => {
        element.dispatchEvent(new Event('scroll'));
    });
}

describe('useScrolledDown', () => {
    it('says whether the container is scrolled further than the limit, as it scrolls', () => {
        const element = document.createElement('div');
        const { result } = renderHook(() => {
            return useScrolledDown(() => {return element}, 400);
        });
        expect(result.current).toBe(false);
        scroll(element, 400);
        expect(result.current).toBe(false);
        scroll(element, 401);
        expect(result.current).toBe(true);
        scroll(element, 10);
        expect(result.current).toBe(false);
    });

    it('starts with the position the container is at already', () => {
        const element = document.createElement('div');
        element.scrollTop = 900;
        const { result } = renderHook(() => {
            return useScrolledDown(() => {return element}, 400);
        });
        expect(result.current).toBe(true);
    });

    it('listens to nothing when there is no container', () => {
        const { result } = renderHook(() => {
            return useScrolledDown(() => {return null}, 400);
        });
        expect(result.current).toBe(false);
    });

    it('stops listening when it is removed', () => {
        const element = document.createElement('div');
        const remove = vi.spyOn(element, 'removeEventListener');
        const { unmount } = renderHook(() => {
            return useScrolledDown(() => {return element}, 400);
        });
        unmount();
        expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    });
});
