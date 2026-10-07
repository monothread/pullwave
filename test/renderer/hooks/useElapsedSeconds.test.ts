// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { useElapsedSeconds } from '@renderer/hooks/useElapsedSeconds';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

async function advance(ms: number): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

describe('useElapsedSeconds', () => {
    it('is zero when it is not running, however long it waits', async () => {
        const { result } = renderHook(() => {
            return useElapsedSeconds(false);
        });
        await advance(5000);
        expect(result.current).toBe(0);
    });

    it('counts the whole seconds that passed since it started running', async () => {
        const { result } = renderHook(() => {
            return useElapsedSeconds(true);
        });
        expect(result.current).toBe(0);
        await advance(999);
        expect(result.current).toBe(0);
        await advance(1);
        expect(result.current).toBe(1);
        await advance(64000);
        expect(result.current).toBe(65);
    });

    it('goes back to zero when it stops running, and counts from zero when it runs again', async () => {
        const { result, rerender } = renderHook(
            ({ running }) => {
                return useElapsedSeconds(running);
            },
            { initialProps: { running: true } }
        );
        await advance(3000);
        expect(result.current).toBe(3);
        rerender({ running: false });
        expect(result.current).toBe(0);
        await advance(5000);
        expect(result.current).toBe(0);
        rerender({ running: true });
        expect(result.current).toBe(0);
        await advance(2000);
        expect(result.current).toBe(2);
    });

    it('stops the timer when it is taken away', async () => {
        const clear = vi.spyOn(globalThis, 'clearInterval');
        const { unmount } = renderHook(() => {
            return useElapsedSeconds(true);
        });
        unmount();
        expect(clear).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
        clear.mockRestore();
    });
});
