// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { useZipPhase, ZIP_CLOSE_MS, ZIP_SETTLE_MS, ZIP_SPLIT_MS, type ZipPhase } from '@renderer/hooks/useZipPhase';

function renderZip(joined: boolean) {
    return renderHook(
        ({ value }: { value: boolean }) => {
            return useZipPhase(value);
        },
        { initialProps: { value: joined } }
    );
}

function advance(ms: number): void {
    act(() => {
        vi.advanceTimersByTime(ms);
    });
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useZipPhase', () => {
    it('lasts 420 ms to stretch the bars, 1 s to close the zipper and 350 ms to shrink the box', () => {
        expect([ZIP_SPLIT_MS, ZIP_CLOSE_MS, ZIP_SETTLE_MS]).toEqual([420, 1000, 350]);
    });

    it('keeps the bars apart while the download is not joined, however long it takes', () => {
        const { result } = renderZip(false);
        expect(result.current).toBe('parts');
        advance(10_000);
        expect(result.current).toBe('parts');
    });

    it('shows a download that was already joined when it was first shown as one bar at once, with no joining', () => {
        const { result } = renderZip(true);
        expect(result.current).toBe('joined');
        advance(10_000);
        expect(result.current).toBe('joined');
    });

    it('goes through every moment of the joining, each one at its time, once the download is joined', () => {
        const { result, rerender } = renderZip(false);
        const seen: ZipPhase[] = [];
        rerender({ value: true });
        seen.push(result.current);
        advance(ZIP_SPLIT_MS - 1);
        seen.push(result.current);
        advance(1);
        seen.push(result.current);
        advance(ZIP_CLOSE_MS - 1);
        seen.push(result.current);
        advance(1);
        seen.push(result.current);
        advance(ZIP_SETTLE_MS - 1);
        seen.push(result.current);
        advance(1);
        seen.push(result.current);
        advance(10_000);
        seen.push(result.current);
        expect(seen).toEqual(['split', 'split', 'zip', 'zip', 'settle', 'settle', 'joined', 'joined']);
    });

    it('puts the bars apart again, and stops the joining, when the download goes back to downloading in the middle of it', () => {
        const { result, rerender } = renderZip(false);
        rerender({ value: true });
        advance(ZIP_SPLIT_MS);
        expect(result.current).toBe('zip');
        rerender({ value: false });
        expect(result.current).toBe('parts');
        advance(10_000);
        expect(result.current).toBe('parts');
    });

    it('joins again from the start a download tried again after it was joined', () => {
        const { result, rerender } = renderZip(true);
        rerender({ value: false });
        expect(result.current).toBe('parts');
        rerender({ value: true });
        expect(result.current).toBe('split');
        advance(ZIP_SPLIT_MS);
        advance(ZIP_CLOSE_MS);
        advance(ZIP_SETTLE_MS);
        expect(result.current).toBe('joined');
    });

    it('does not start the joining again when it is rendered again with the same value', () => {
        const { result, rerender } = renderZip(false);
        rerender({ value: true });
        advance(ZIP_SPLIT_MS);
        rerender({ value: true });
        expect(result.current).toBe('zip');
        advance(ZIP_CLOSE_MS);
        expect(result.current).toBe('settle');
    });

    it('leaves no timer behind when it is unmounted in the middle of the joining', () => {
        const { rerender, unmount } = renderZip(false);
        rerender({ value: true });
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});
