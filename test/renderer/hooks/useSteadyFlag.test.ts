// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { useSteadyFlag } from '@renderer/hooks/useSteadyFlag';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

function wait(ms: number): void {
    act(() => {
        vi.advanceTimersByTime(ms);
    });
}

describe('useSteadyFlag', () => {
    it('starts false', () => {
        const { result } = renderHook(() => {
            return useSteadyFlag(false, 100, 50);
        });
        expect(result.current).toBe(false);
        wait(1000);
        expect(result.current).toBe(false);
    });

    it('becomes true only after it has been active for the time asked, and false only after it has been inactive for its own time', () => {
        const { result, rerender } = renderHook(
            ({ active }) => {
                return useSteadyFlag(active, 100, 50);
            },
            { initialProps: { active: false } }
        );
        rerender({ active: true });
        wait(99);
        expect(result.current).toBe(false);
        wait(1);
        expect(result.current).toBe(true);
        rerender({ active: false });
        wait(49);
        expect(result.current).toBe(true);
        wait(1);
        expect(result.current).toBe(false);
    });

    it('never becomes true for something that was active for less than the time asked, however often', () => {
        const { result, rerender } = renderHook(
            ({ active }) => {
                return useSteadyFlag(active, 100, 50);
            },
            { initialProps: { active: false } }
        );
        for (let round = 0; round < 5; round += 1) {
            rerender({ active: true });
            wait(99);
            rerender({ active: false });
            wait(10);
        }
        wait(1000);
        expect(result.current).toBe(false);
    });

    it('stays true when it stops for less than the time asked and comes back', () => {
        const { result, rerender } = renderHook(
            ({ active }) => {
                return useSteadyFlag(active, 100, 50);
            },
            { initialProps: { active: true } }
        );
        wait(100);
        expect(result.current).toBe(true);
        for (let round = 0; round < 5; round += 1) {
            rerender({ active: false });
            wait(49);
            rerender({ active: true });
            wait(10);
        }
        wait(1000);
        expect(result.current).toBe(true);
    });

    it('does not leave a timer behind when it is unmounted', () => {
        const { rerender, unmount } = renderHook(
            ({ active }) => {
                return useSteadyFlag(active, 100, 50);
            },
            { initialProps: { active: false } }
        );
        rerender({ active: true });
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});
