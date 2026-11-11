import { IPC } from '@shared/constants';
import type { LogBatch } from '@shared/logs';
import type { IpcMainLike } from '@main/ipc/registerHandlers';
import { LOG_BATCH_MS, registerLogHandlers } from '@main/ipc/registerLogHandlers';
import { LogHub, MAX_LOG_LINES } from '@main/services/logHub';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const T0 = 1_700_000_000_000;

function setup(batchMs?: number) {
    const handlers = new Map<string, Handler>();
    const ipcMain: IpcMainLike = {
        handle: (channel, listener) => {
            handlers.set(channel, listener);
        }
    };
    const hub = new LogHub({
        now: () => {
            return T0;
        }
    });
    const sent: Array<[string, LogBatch]> = [];
    const send = vi.fn((channel: string, batch: LogBatch) => {
        sent.push([channel, batch]);
    });
    const watchers = registerLogHandlers(ipcMain, batchMs === undefined ? { hub, send } : { hub, send, batchMs });
    const call = (channel: string, ...args: unknown[]): unknown => {
        const handler = handlers.get(channel);
        if (handler === undefined) {
            throw new Error(`No handler for ${channel}`);
        }
        return handler({}, ...args);
    };
    return { handlers, hub, send, sent, watchers, call };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('LOG_BATCH_MS', () => {
    it('is 150 milliseconds', () => {
        expect(LOG_BATCH_MS).toBe(150);
    });
});

describe('registerLogHandlers', () => {
    it('registers the four channels of the logs', () => {
        const { handlers } = setup();
        expect([...handlers.keys()]).toEqual([IPC.logsSnapshot, IPC.logsClear, IPC.logsWatch, IPC.logsUnwatch]);
        expect([IPC.logsSnapshot, IPC.logsClear, IPC.logsWatch, IPC.logsUnwatch, IPC.eventLogLines]).toEqual(['logs:snapshot', 'logs:clear', 'logs:watch', 'logs:unwatch', 'event:log-lines']);
    });

    it('answers a snapshot with what the log of the program holds', () => {
        const { hub, call } = setup();
        hub.write('yt-dlp', 'stdout', 'one');
        hub.write('ffmpeg', 'stderr', 'two');
        expect(call(IPC.logsSnapshot, 'yt-dlp')).toEqual([{ id: 1, at: T0, stream: 'stdout', text: 'one' }]);
    });

    it('answers a snapshot of something that is not a program with no lines', () => {
        const { hub, call } = setup();
        hub.write('yt-dlp', 'stdout', 'one');
        expect(call(IPC.logsSnapshot, 'docker')).toEqual([]);
        expect(call(IPC.logsSnapshot, undefined)).toEqual([]);
    });

    it('clears the log of the program asked, and ignores something that is not a program', () => {
        const { hub, call } = setup();
        hub.write('yt-dlp', 'stdout', 'one');
        hub.write('ffmpeg', 'stdout', 'two');
        expect(call(IPC.logsClear, 'nope')).toBeUndefined();
        expect(hub.snapshot('yt-dlp')).toHaveLength(1);
        call(IPC.logsClear, 'yt-dlp');
        expect(hub.snapshot('yt-dlp')).toEqual([]);
        expect(hub.snapshot('ffmpeg')).toEqual([{ id: 2, at: T0, stream: 'stdout', text: 'two' }]);
    });

    it('sends nothing for a program no window watches', () => {
        const { hub, send } = setup();
        hub.write('yt-dlp', 'stdout', 'one');
        vi.advanceTimersByTime(LOG_BATCH_MS * 2);
        expect(send).not.toHaveBeenCalled();
    });

    it('sends the new lines of a watched program together, once the batch time has passed', () => {
        const { hub, send, sent, call } = setup();
        call(IPC.logsWatch, 'yt-dlp');
        hub.write('yt-dlp', 'stdout', 'one');
        hub.write('ffmpeg', 'stdout', 'not watched');
        hub.write('yt-dlp', 'stderr', 'two');
        vi.advanceTimersByTime(LOG_BATCH_MS - 1);
        expect(send).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(sent).toEqual([
            [
                'event:log-lines',
                {
                    source: 'yt-dlp',
                    lines: [
                        { id: 1, at: T0, stream: 'stdout', text: 'one' },
                        { id: 3, at: T0, stream: 'stderr', text: 'two' }
                    ]
                }
            ]
        ]);
    });

    it('sends one batch per watched program, and starts a new batch after one was sent', () => {
        const { hub, sent, call } = setup(50);
        call(IPC.logsWatch, 'suwayomi');
        call(IPC.logsWatch, 'flaresolverr');
        hub.write('suwayomi', 'stdout', 'a');
        hub.write('flaresolverr', 'stderr', 'b');
        vi.advanceTimersByTime(50);
        hub.write('suwayomi', 'stdout', 'c');
        vi.advanceTimersByTime(50);
        expect(sent).toEqual([
            ['event:log-lines', { source: 'suwayomi', lines: [{ id: 1, at: T0, stream: 'stdout', text: 'a' }] }],
            ['event:log-lines', { source: 'flaresolverr', lines: [{ id: 2, at: T0, stream: 'stderr', text: 'b' }] }],
            ['event:log-lines', { source: 'suwayomi', lines: [{ id: 3, at: T0, stream: 'stdout', text: 'c' }] }]
        ]);
    });

    it('holds no more lines for the window than the log itself keeps', () => {
        const { hub, sent, call } = setup();
        call(IPC.logsWatch, 'ffmpeg');
        for (let index = 0; index < MAX_LOG_LINES + 3; index += 1) {
            hub.write('ffmpeg', 'stderr', String(index));
        }
        vi.advanceTimersByTime(LOG_BATCH_MS);
        expect(sent).toHaveLength(1);
        const lines = sent[0]?.[1].lines ?? [];
        expect(lines).toHaveLength(MAX_LOG_LINES);
        expect(lines[0]).toEqual({ id: 4, at: T0, stream: 'stderr', text: '3' });
        expect(lines.at(-1)).toEqual({ id: MAX_LOG_LINES + 3, at: T0, stream: 'stderr', text: String(MAX_LOG_LINES + 2) });
    });

    it('stops sending a program that is no longer watched, and drops its lines that were waiting', () => {
        const { hub, send, call } = setup();
        call(IPC.logsWatch, 'ani-cli');
        hub.write('ani-cli', 'stdout', 'waiting');
        call(IPC.logsUnwatch, 'ani-cli');
        hub.write('ani-cli', 'stdout', 'after');
        vi.advanceTimersByTime(LOG_BATCH_MS);
        expect(send).not.toHaveBeenCalled();
    });

    it('drops the lines waiting for a program whose log is cleared', () => {
        const { hub, sent, call } = setup();
        call(IPC.logsWatch, 'yt-dlp');
        hub.write('yt-dlp', 'stdout', 'before');
        call(IPC.logsClear, 'yt-dlp');
        hub.write('yt-dlp', 'stdout', 'after');
        vi.advanceTimersByTime(LOG_BATCH_MS);
        expect(sent).toEqual([['event:log-lines', { source: 'yt-dlp', lines: [{ id: 2, at: T0, stream: 'stdout', text: 'after' }] }]]);
    });

    it('ignores a watch or an unwatch of something that is not a program', () => {
        const { hub, send, call } = setup();
        expect(call(IPC.logsWatch, 'docker')).toBeUndefined();
        expect(call(IPC.logsUnwatch, 42)).toBeUndefined();
        hub.write('yt-dlp', 'stdout', 'one');
        vi.advanceTimersByTime(LOG_BATCH_MS);
        expect(send).not.toHaveBeenCalled();
    });

    it('stops sending every program when the page is loaded again, and cancels the batch waiting', () => {
        const { hub, send, call, watchers } = setup();
        call(IPC.logsWatch, 'yt-dlp');
        call(IPC.logsWatch, 'ffmpeg');
        hub.write('yt-dlp', 'stdout', 'waiting');
        watchers.stopAll();
        vi.advanceTimersByTime(LOG_BATCH_MS);
        hub.write('ffmpeg', 'stdout', 'after');
        vi.advanceTimersByTime(LOG_BATCH_MS);
        expect(send).not.toHaveBeenCalled();
    });

    it('stops every program even when no batch is waiting', () => {
        const { hub, send, call, watchers } = setup();
        call(IPC.logsWatch, 'yt-dlp');
        watchers.stopAll();
        hub.write('yt-dlp', 'stdout', 'after');
        vi.advanceTimersByTime(LOG_BATCH_MS);
        expect(send).not.toHaveBeenCalled();
    });
});
