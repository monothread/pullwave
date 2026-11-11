// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { LogLine, LogSource } from '@shared/logs';
import { useLogLines } from '@renderer/hooks/useLogLines';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

const AT = 1_700_000_000_000;

function line(id: number, text: string): LogLine {
    return { id, at: AT, stream: 'stdout', text };
}

// A snapshot that answers only when the test says so, to send lines before it arrives.
function deferredSnapshot(mock: MockApiHandle): (lines: LogLine[]) => Promise<void> {
    let answer: (lines: LogLine[]) => void = () => {
        return undefined;
    };
    mock.api.logs.snapshot.mockImplementation(() => {
        return new Promise<LogLine[]>((resolve) => {
            answer = resolve;
        });
    });
    return async (lines) => {
        await act(async () => {
            answer(lines);
            await Promise.resolve();
        });
    };
}

let mock: MockApiHandle;

beforeEach(() => {
    mock = installMockApi();
});

describe('useLogLines', () => {
    it('watches the new lines before it asks for what the log holds, and shows what it holds', async () => {
        mock.api.logs.snapshot.mockResolvedValue([line(1, 'a'), line(2, 'b')]);
        const { result } = renderHook(() => {
            return useLogLines('yt-dlp');
        });
        expect(result.current.lines).toEqual([]);
        expect(result.current.loaded).toBe(false);
        expect(mock.api.logs.watch).toHaveBeenCalledTimes(1);
        expect(mock.api.logs.watch).toHaveBeenCalledWith('yt-dlp', expect.any(Function));
        expect(mock.api.logs.snapshot).toHaveBeenCalledTimes(1);
        expect(mock.api.logs.snapshot).toHaveBeenCalledWith('yt-dlp');
        expect(mock.api.logs.watch.mock.invocationCallOrder[0]).toBeLessThan(mock.api.logs.snapshot.mock.invocationCallOrder[0] ?? 0);
        await waitFor(() => {
            expect(result.current.loaded).toBe(true);
        });
        expect(result.current.lines).toEqual([line(1, 'a'), line(2, 'b')]);
    });

    it('adds the new lines as they come', async () => {
        mock.api.logs.snapshot.mockResolvedValue([line(1, 'a')]);
        const { result } = renderHook(() => {
            return useLogLines('ffmpeg');
        });
        await waitFor(() => {
            expect(result.current.loaded).toBe(true);
        });
        act(() => {
            mock.emitLogLines('ffmpeg', [line(2, 'b'), line(3, 'c')]);
            mock.emitLogLines('yt-dlp', [line(4, 'other program')]);
        });
        expect(result.current.lines).toEqual([line(1, 'a'), line(2, 'b'), line(3, 'c')]);
    });

    it('keeps the lines that came before what the log held arrived, without the ones it already had', async () => {
        const answer = deferredSnapshot(mock);
        const { result } = renderHook(() => {
            return useLogLines('ani-cli');
        });
        act(() => {
            mock.emitLogLines('ani-cli', [line(2, 'b'), line(3, 'c')]);
        });
        expect(result.current.lines).toEqual([]);
        await answer([line(1, 'a'), line(2, 'b')]);
        expect(result.current.lines).toEqual([line(1, 'a'), line(2, 'b'), line(3, 'c')]);
        expect(result.current.loaded).toBe(true);
    });

    it('stops watching when it is no longer used, and ignores a snapshot that arrives after', async () => {
        const answer = deferredSnapshot(mock);
        const { result, unmount } = renderHook(() => {
            return useLogLines('suwayomi');
        });
        const stop = mock.api.logs.watch.mock.results[0]?.value as ReturnType<typeof vi.fn>;
        unmount();
        expect(stop).toHaveBeenCalledTimes(1);
        await answer([line(1, 'late')]);
        expect(result.current.lines).toEqual([]);
        expect(result.current.loaded).toBe(false);
    });

    it('empties the log in the app and on the screen', async () => {
        mock.api.logs.snapshot.mockResolvedValue([line(1, 'a')]);
        const { result } = renderHook(() => {
            return useLogLines('flaresolverr');
        });
        await waitFor(() => {
            expect(result.current.lines).toEqual([line(1, 'a')]);
        });
        await act(async () => {
            await result.current.clear();
        });
        expect(mock.api.logs.clear).toHaveBeenCalledTimes(1);
        expect(mock.api.logs.clear).toHaveBeenCalledWith('flaresolverr');
        expect(result.current.lines).toEqual([]);
        expect(result.current.loaded).toBe(true);
        act(() => {
            mock.emitLogLines('flaresolverr', [line(2, 'after')]);
        });
        expect(result.current.lines).toEqual([line(2, 'after')]);
    });

    it('shows no line of the program it showed before when it is given another one, and watches the new one', async () => {
        mock.api.logs.snapshot.mockImplementation((source: LogSource) => {
            return Promise.resolve(source === 'suwayomi' ? [line(1, 'server')] : [line(2, 'helper')]);
        });
        const { result, rerender } = renderHook(
            ({ source }: { source: LogSource }) => {
                return useLogLines(source);
            },
            { initialProps: { source: 'suwayomi' as LogSource } }
        );
        await waitFor(() => {
            expect(result.current.lines).toEqual([line(1, 'server')]);
        });
        const stopFirst = mock.api.logs.watch.mock.results[0]?.value as ReturnType<typeof vi.fn>;
        rerender({ source: 'flaresolverr' });
        expect(result.current.lines).toEqual([]);
        expect(result.current.loaded).toBe(false);
        expect(stopFirst).toHaveBeenCalledTimes(1);
        expect(mock.api.logs.watch).toHaveBeenLastCalledWith('flaresolverr', expect.any(Function));
        await waitFor(() => {
            expect(result.current.lines).toEqual([line(2, 'helper')]);
        });
    });

    it('still waits for what the log holds when it is cleared before that arrived', async () => {
        const answer = deferredSnapshot(mock);
        const { result } = renderHook(() => {
            return useLogLines('yt-dlp');
        });
        await act(async () => {
            await result.current.clear();
        });
        expect(result.current.loaded).toBe(false);
        await answer([]);
        expect(result.current.loaded).toBe(true);
    });
});
