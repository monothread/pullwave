import type { LogLine, LogSource } from '@shared/logs';
import { LogHub, MAX_LINE_LENGTH, MAX_LOG_LINES, processLogs, PROGRESS_LOG_INTERVAL_MS, TRUNCATED_MARK } from '@main/services/logHub';

const T0 = 1_700_000_000_000;

function clock(start = T0): { now: () => number; advance: (milliseconds: number) => void } {
    let current = start;
    return {
        now: () => {
            return current;
        },
        advance: (milliseconds) => {
            current += milliseconds;
        }
    };
}

describe('constants', () => {
    it('keeps 2000 lines of 2000 characters and one progress line every 5 seconds', () => {
        expect(MAX_LOG_LINES).toBe(2000);
        expect(MAX_LINE_LENGTH).toBe(2000);
        expect(TRUNCATED_MARK).toBe('…');
        expect(PROGRESS_LOG_INTERVAL_MS).toBe(5000);
    });
});

describe('processLogs', () => {
    it('is a hub shared by the whole app', () => {
        expect(processLogs).toBeInstanceOf(LogHub);
    });
});

describe('LogHub.write and snapshot', () => {
    it('keeps the lines of each program apart, with a growing id, the time and the stream', () => {
        const time = clock();
        const hub = new LogHub({ now: time.now });
        hub.write('yt-dlp', 'stdout', 'one');
        time.advance(10);
        hub.write('ffmpeg', 'stderr', 'two');
        time.advance(10);
        hub.write('yt-dlp', 'event', 'three');
        expect(hub.snapshot('yt-dlp')).toEqual([
            { id: 1, at: T0, stream: 'stdout', text: 'one' },
            { id: 3, at: T0 + 20, stream: 'event', text: 'three' }
        ]);
        expect(hub.snapshot('ffmpeg')).toEqual([{ id: 2, at: T0 + 10, stream: 'stderr', text: 'two' }]);
        expect(hub.snapshot('suwayomi')).toEqual([]);
    });

    it('uses the clock of the machine by default', () => {
        vi.spyOn(Date, 'now').mockReturnValue(T0 + 5);
        const hub = new LogHub();
        hub.write('ani-cli', 'stdout', 'x');
        expect(hub.snapshot('ani-cli')).toEqual([{ id: 1, at: T0 + 5, stream: 'stdout', text: 'x' }]);
        vi.restoreAllMocks();
    });

    it('gives a copy: changing it does not change the log', () => {
        const hub = new LogHub({ now: clock().now });
        hub.write('yt-dlp', 'stdout', 'one');
        const copy = hub.snapshot('yt-dlp');
        copy.pop();
        expect(hub.snapshot('yt-dlp')).toEqual([{ id: 1, at: T0, stream: 'stdout', text: 'one' }]);
    });

    it('drops the oldest lines past the limit', () => {
        const hub = new LogHub({ now: clock().now, maxLines: 3 });
        ['a', 'b', 'c', 'd', 'e'].forEach((text) => {
            hub.write('yt-dlp', 'stdout', text);
        });
        expect(
            hub.snapshot('yt-dlp').map((line) => {
                return [line.id, line.text];
            })
        ).toEqual([
            [3, 'c'],
            [4, 'd'],
            [5, 'e']
        ]);
    });

    it('keeps 2000 lines by default', () => {
        const hub = new LogHub({ now: clock().now });
        for (let index = 0; index < MAX_LOG_LINES + 5; index += 1) {
            hub.write('ffmpeg', 'stderr', `line ${String(index)}`);
        }
        const lines = hub.snapshot('ffmpeg');
        expect(lines).toHaveLength(MAX_LOG_LINES);
        expect(lines[0]).toEqual({ id: 6, at: T0, stream: 'stderr', text: 'line 5' });
        expect(lines.at(-1)).toEqual({ id: MAX_LOG_LINES + 5, at: T0, stream: 'stderr', text: `line ${String(MAX_LOG_LINES + 4)}` });
    });

    it('hides the secrets of a line', () => {
        const hub = new LogHub({ now: clock().now });
        hub.write('yt-dlp', 'stderr', 'GET https://x.test/?token=abc Cookie: a=1');
        expect(hub.snapshot('yt-dlp')).toEqual([{ id: 1, at: T0, stream: 'stderr', text: 'GET https://x.test/?token=*** Cookie: ***' }]);
    });

    it('cuts a long line and marks the cut; a line of the exact length is kept whole', () => {
        const hub = new LogHub({ now: clock().now, maxLineLength: 10 });
        hub.write('yt-dlp', 'stdout', '0123456789');
        hub.write('yt-dlp', 'stdout', '0123456789ABC');
        expect(
            hub.snapshot('yt-dlp').map((line) => {
                return line.text;
            })
        ).toEqual(['0123456789', '0123456789…']);
    });

    it('looks for secrets in a huge line only in the part that can be kept', () => {
        const hub = new LogHub({ now: clock().now, maxLineLength: 30 });
        hub.write('yt-dlp', 'stdout', `https://x.test/?token=abcdefgh ${'z'.repeat(500)}`);
        expect(hub.snapshot('yt-dlp')).toEqual([{ id: 1, at: T0, stream: 'stdout', text: `https://x.test/?token=*** ${'z'.repeat(4)}…` }]);
    });

    it('cuts at 2000 characters by default', () => {
        const hub = new LogHub({ now: clock().now });
        hub.write('yt-dlp', 'stdout', 'x'.repeat(MAX_LINE_LENGTH + 1));
        expect(hub.snapshot('yt-dlp')).toEqual([{ id: 1, at: T0, stream: 'stdout', text: `${'x'.repeat(MAX_LINE_LENGTH)}…` }]);
    });
});

describe('LogHub.clear', () => {
    it('empties the log of one program only, and the ids go on growing', () => {
        const hub = new LogHub({ now: clock().now });
        hub.write('yt-dlp', 'stdout', 'a');
        hub.write('ffmpeg', 'stdout', 'b');
        hub.clear('yt-dlp');
        expect(hub.snapshot('yt-dlp')).toEqual([]);
        expect(hub.snapshot('ffmpeg')).toEqual([{ id: 2, at: T0, stream: 'stdout', text: 'b' }]);
        hub.write('yt-dlp', 'stdout', 'c');
        expect(hub.snapshot('yt-dlp')).toEqual([{ id: 3, at: T0, stream: 'stdout', text: 'c' }]);
    });

    it('does nothing for a program with no lines', () => {
        const hub = new LogHub({ now: clock().now });
        hub.clear('suwayomi');
        expect(hub.snapshot('suwayomi')).toEqual([]);
    });
});

describe('LogHub.onLine', () => {
    it('tells every listener of each line, with its program, until it stops listening', () => {
        const hub = new LogHub({ now: clock().now });
        const first: Array<[LogSource, LogLine]> = [];
        const second: Array<[LogSource, LogLine]> = [];
        const stopFirst = hub.onLine((source, line) => {
            first.push([source, line]);
        });
        hub.onLine((source, line) => {
            second.push([source, line]);
        });
        hub.write('flaresolverr', 'stdout', 'one');
        stopFirst();
        hub.write('suwayomi', 'stderr', 'two');
        expect(first).toEqual([['flaresolverr', { id: 1, at: T0, stream: 'stdout', text: 'one' }]]);
        expect(second).toEqual([
            ['flaresolverr', { id: 1, at: T0, stream: 'stdout', text: 'one' }],
            ['suwayomi', { id: 2, at: T0, stream: 'stderr', text: 'two' }]
        ]);
    });
});

describe('LogHub.open', () => {
    it('writes the command with its secrets hidden and its arguments quoted when they have spaces', () => {
        const hub = new LogHub({ now: clock().now });
        hub.open('yt-dlp').command('/bin/yt-dlp', ['--add-header', 'Cookie:a=1', '-o', '%(title)s [%(id)s].%(ext)s', '--password', 'pw', 'https://x.test/?sig=z']);
        expect(hub.snapshot('yt-dlp')).toEqual([
            { id: 1, at: T0, stream: 'command', text: '/bin/yt-dlp --add-header Cookie:*** -o "%(title)s [%(id)s].%(ext)s" --password *** https://x.test/?sig=***' }
        ]);
    });

    it('cuts a long command', () => {
        const hub = new LogHub({ now: clock().now, maxLineLength: 12 });
        hub.open('ffmpeg').command('ffmpeg', ['-i', 'input.mp4']);
        expect(hub.snapshot('ffmpeg')).toEqual([{ id: 1, at: T0, stream: 'command', text: 'ffmpeg -i in…' }]);
    });

    it('writes the lines of the program and leaves the blank ones out', () => {
        const hub = new LogHub({ now: clock().now });
        const log = hub.open('ani-cli');
        log.line('stdout', 'hello');
        log.line('stderr', '   ');
        log.line('stderr', '');
        log.line('stderr', 'oops');
        expect(hub.snapshot('ani-cli')).toEqual([
            { id: 1, at: T0, stream: 'stdout', text: 'hello' },
            { id: 2, at: T0, stream: 'stderr', text: 'oops' }
        ]);
    });

    it('writes how the program ended: its code, a missing code, or the signal', () => {
        const hub = new LogHub({ now: clock().now });
        const log = hub.open('ffmpeg');
        log.exit(0);
        log.exit(1, null);
        log.exit(null);
        log.exit(null, 'SIGTERM');
        log.exit(143, 'SIGKILL');
        expect(
            hub.snapshot('ffmpeg').map((line) => {
                return [line.stream, line.text];
            })
        ).toEqual([
            ['event', 'exited with code 0'],
            ['event', 'exited with code 1'],
            ['event', 'ended without an exit code'],
            ['event', 'ended by signal SIGTERM'],
            ['event', 'ended by signal SIGKILL']
        ]);
    });

    it('writes a failure as an event, with its secrets hidden', () => {
        const hub = new LogHub({ now: clock().now });
        hub.open('flaresolverr').failure('could not start: spawn docker ENOENT token=1 Authorization: x');
        expect(hub.snapshot('flaresolverr')).toEqual([{ id: 1, at: T0, stream: 'event', text: 'could not start: spawn docker ENOENT token=1 Authorization: ***' }]);
    });

    it('writes one progress line per interval and keeps the last one held back for the end of the run', () => {
        const time = clock();
        const hub = new LogHub({ now: time.now, progressIntervalMs: 1000 });
        const log = hub.open('yt-dlp');
        log.progress('stdout', '10%');
        time.advance(400);
        log.progress('stdout', '20%');
        time.advance(400);
        log.progress('stderr', '30%');
        time.advance(200);
        log.progress('stdout', '40%');
        time.advance(100);
        log.progress('stdout', '50%');
        log.exit(0);
        expect(
            hub.snapshot('yt-dlp').map((line) => {
                return [line.at - T0, line.stream, line.text];
            })
        ).toEqual([
            [0, 'stdout', '10%'],
            [1000, 'stdout', '40%'],
            [1100, 'stdout', '50%'],
            [1100, 'event', 'exited with code 0']
        ]);
    });

    it('writes the progress held back before a failure too, and not twice', () => {
        const time = clock();
        const hub = new LogHub({ now: time.now, progressIntervalMs: 1000 });
        const log = hub.open('ani-cli');
        log.progress('stderr', 'a');
        log.progress('stderr', 'b');
        log.failure('gave up');
        log.exit(1);
        expect(
            hub.snapshot('ani-cli').map((line) => {
                return line.text;
            })
        ).toEqual(['a', 'b', 'gave up', 'exited with code 1']);
    });

    it('holds the progress of each run apart', () => {
        const time = clock();
        const hub = new LogHub({ now: time.now, progressIntervalMs: 1000 });
        const first = hub.open('yt-dlp');
        const second = hub.open('yt-dlp');
        first.progress('stdout', 'first 1');
        second.progress('stdout', 'second 1');
        first.progress('stdout', 'first 2');
        expect(
            hub.snapshot('yt-dlp').map((line) => {
                return line.text;
            })
        ).toEqual(['first 1', 'second 1']);
    });

    it('uses an interval of 5 seconds by default and leaves blank progress out', () => {
        const time = clock();
        const hub = new LogHub({ now: time.now });
        const log = hub.open('yt-dlp');
        log.progress('stdout', '1%');
        log.progress('stdout', '  ');
        time.advance(PROGRESS_LOG_INTERVAL_MS - 1);
        log.progress('stdout', '2%');
        time.advance(1);
        log.progress('stdout', '3%');
        expect(
            hub.snapshot('yt-dlp').map((line) => {
                return line.text;
            })
        ).toEqual(['1%', '3%']);
    });

    it('ends a run with nothing held back with only its end', () => {
        const hub = new LogHub({ now: clock().now });
        hub.open('ffmpeg').exit(0);
        expect(hub.snapshot('ffmpeg')).toEqual([{ id: 1, at: T0, stream: 'event', text: 'exited with code 0' }]);
    });
});
