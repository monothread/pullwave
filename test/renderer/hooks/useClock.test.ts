// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { CLOCK_TICK_MS, useClock } from '@renderer/hooks/useClock';

const START = new Date(2026, 10, 1, 14, 5, 58);

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
});

afterEach(() => {
    vi.useRealTimers();
});

async function advance(ms: number): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

describe('useClock', () => {
    it('reads the clock every five seconds', () => {
        expect(CLOCK_TICK_MS).toBe(5000);
    });

    it('starts with the time now', () => {
        const { result } = renderHook(() => {
            return useClock();
        });
        expect(result.current).toEqual(START);
    });

    it('keeps the time until the next reading, then takes the new one', async () => {
        const { result } = renderHook(() => {
            return useClock();
        });
        await advance(CLOCK_TICK_MS - 1);
        expect(result.current).toEqual(START);
        await advance(1);
        expect(result.current).toEqual(new Date(START.getTime() + CLOCK_TICK_MS));
        await advance(CLOCK_TICK_MS * 2);
        expect(result.current).toEqual(new Date(START.getTime() + CLOCK_TICK_MS * 3));
    });

    it('stops reading the clock when it leaves the screen', async () => {
        const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
        const { unmount } = renderHook(() => {
            return useClock();
        });
        unmount();
        expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
        clearIntervalSpy.mockRestore();
    });
});
