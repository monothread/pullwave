// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { SPEED_SAMPLE_MS, useSpeedHistory } from '@renderer/hooks/useSpeedHistory';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

async function tick(times = 1): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(SPEED_SAMPLE_MS * times);
    });
}

describe('useSpeedHistory', () => {
    it('keeps a reading a second', () => {
        expect(SPEED_SAMPLE_MS).toBe(1000);
    });

    it('starts empty and adds the latest speed every second, 0 when it is not known', async () => {
        const { result, rerender } = renderHook(
            ({ speed }) => {
                return useSpeedHistory('job-1', speed);
            },
            { initialProps: { speed: 100 as number | null } }
        );
        expect(result.current).toEqual([]);
        await tick();
        expect(result.current).toEqual([100]);
        rerender({ speed: 250 });
        await tick();
        rerender({ speed: null });
        await tick();
        expect(result.current).toEqual([100, 250, 0]);
    });

    it('keeps only the last minute', async () => {
        const { result } = renderHook(() => {
            return useSpeedHistory('job-1', 5);
        });
        await tick(65);
        expect(result.current).toHaveLength(60);
    });

    it('starts again for another download', async () => {
        const { result, rerender } = renderHook(
            ({ key }) => {
                return useSpeedHistory(key, 7);
            },
            { initialProps: { key: 'job-1' } }
        );
        await tick(3);
        expect(result.current).toEqual([7, 7, 7]);
        rerender({ key: 'job-2' });
        expect(result.current).toEqual([]);
        await tick();
        expect(result.current).toEqual([7]);
    });

    it('stops reading when it goes away', async () => {
        const { unmount } = renderHook(() => {
            return useSpeedHistory('job-1', 1);
        });
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});
