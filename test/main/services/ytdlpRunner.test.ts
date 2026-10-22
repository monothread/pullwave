import type { DownloadInfo, PostProcessEvent, ProgressInfo } from '@shared/types';
import { createLineSplitter, defaultSpawn, EXIT_GRACE_MS, KILL_ESCALATION_MS, runYtdlp, STOP_ESCALATION_MS } from '@main/services/ytdlpRunner';
import { createFakeChild } from '../../helpers/fakeChild';

describe('createLineSplitter', () => {
    it('emits complete lines and buffers partial ones', () => {
        const lines: string[] = [];
        const splitter = createLineSplitter((line) => {
            lines.push(line);
        });
        splitter.push('one\ntw');
        splitter.push('o\r\nthree');
        expect(lines).toEqual(['one', 'two']);
        splitter.flush();
        expect(lines).toEqual(['one', 'two', 'three']);
    });

    it('also ends a line at a bare carriage return, as yt-dlp rewrites its counters', () => {
        const lines: string[] = [];
        const splitter = createLineSplitter((line) => {
            lines.push(line);
        });
        splitter.push('[wait] Remaining time: 00:00:03\r[wait] Remaining time: 00:00:02\r[wait] Remaining');
        expect(lines).toEqual(['[wait] Remaining time: 00:00:03', '[wait] Remaining time: 00:00:02']);
        splitter.push(' time: 00:00:01\r\nnext\n');
        expect(lines).toEqual(['[wait] Remaining time: 00:00:03', '[wait] Remaining time: 00:00:02', '[wait] Remaining time: 00:00:01', 'next']);
    });

    it('does not emit anything on flush with an empty buffer', () => {
        const onLine = vi.fn();
        const splitter = createLineSplitter(onLine);
        splitter.push('a\n');
        onLine.mockClear();
        splitter.flush();
        expect(onLine).not.toHaveBeenCalled();
    });
});

describe('runYtdlp', () => {
    function start(): { fake: ReturnType<typeof createFakeChild>; spawnFn: ReturnType<typeof vi.fn>; progress: ProgressInfo[]; infos: DownloadInfo[]; run: ReturnType<typeof runYtdlp> } {
        const fake = createFakeChild();
        const spawnFn = vi.fn(() => {
            return fake.child;
        });
        const progress: ProgressInfo[] = [];
        const infos: DownloadInfo[] = [];
        const run = runYtdlp({
            binary: 'yt-dlp',
            args: ['--newline', 'https://x.com/v'],
            env: { PATH: '/bundled:/usr/bin' },
            spawnFn,
            onProgress: (info) => {
                progress.push(info);
            },
            onInfo: (info) => {
                infos.push(info);
            }
        });
        return { fake, spawnFn, progress, infos, run };
    }

    it('spawns the binary with the exact arguments and environment', () => {
        const { spawnFn } = start();
        expect(spawnFn).toHaveBeenCalledWith('yt-dlp', ['--newline', 'https://x.com/v'], { PATH: '/bundled:/usr/bin' });
    });

    it('reports progress and resolves done with the file path', async () => {
        const { fake, progress, run } = start();
        fake.stdout.write('CYBERPROG|  10.0%|1MiB/s|00:09|1000|1.5|False|Title\nCYBERPROG| 100.0%|2MiB/s|00:00|2000|3.5|False|Title\n');
        fake.stdout.write('CYBERFILE|/d/Title [id].mp4\n');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        fake.emitter.emit('close', 0);
        await expect(run.result).resolves.toEqual({ status: 'done', filePath: '/d/Title [id].mp4' });
        expect(progress).toEqual([
            { percent: 10, speed: '1MiB/s', eta: '00:09', title: 'Title', downloadedBytes: 1000, elapsedSeconds: 1.5, live: false },
            { percent: 100, speed: '2MiB/s', eta: '00:00', title: 'Title', downloadedBytes: 2000, elapsedSeconds: 3.5, live: false }
        ]);
    });

    it('tells where the stream can be fetched from, and does not take that line for anything else', async () => {
        const fake = createFakeChild();
        const onStream = vi.fn();
        const infos: DownloadInfo[] = [];
        const run = runYtdlp({
            binary: 'yt-dlp',
            args: [],
            spawnFn: () => {
                return fake.child;
            },
            onProgress: vi.fn(),
            onInfo: (info) => {
                infos.push(info);
            },
            onStream
        });
        fake.stdout.write('CYBERINFO|True|/d/Live [abc].mp4\n');
        fake.stdout.write(`CYBERSTREAM|${JSON.stringify({ is_live: true, url: 'https://cdn.test/live.m3u8', protocol: 'm3u8_native', http_headers: { Referer: 'https://site.test/' } })}\n`);
        fake.stdout.write('CYBERSTREAM|{broken\n');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        expect(infos).toEqual([{ live: true, filePath: '/d/Live [abc].mp4' }]);
        expect(onStream).toHaveBeenCalledTimes(1);
        expect(onStream).toHaveBeenCalledWith({
            live: true,
            sources: [{ url: 'https://cdn.test/live.m3u8', protocol: 'm3u8_native', headers: { Referer: 'https://site.test/' } }]
        });
        fake.emitter.emit('close', 0);
        await expect(run.result).resolves.toEqual({ status: 'done', filePath: null });
    });

    it('tells that yt-dlp is waiting for a scheduled live stream, once per "[wait]" line', async () => {
        const fake = createFakeChild();
        const onWaiting = vi.fn();
        const infos: DownloadInfo[] = [];
        const run = runYtdlp({
            binary: 'yt-dlp',
            args: [],
            spawnFn: () => {
                return fake.child;
            },
            onProgress: vi.fn(),
            onInfo: (info) => {
                infos.push(info);
            },
            onWaiting
        });
        fake.stdout.write('[FakeLive] Extracting URL: https://x.test/a\n[wait] Waiting for 00:59:59 - Press Ctrl+C to try now\n');
        fake.stdout.write('[wait] Remaining time until next attempt: 00:59:59\r[wait] Remaining time until next attempt: 00:59:58\r');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        expect(onWaiting).toHaveBeenCalledTimes(3);
        fake.stdout.write('CYBERINFO|True|/d/Live [abc].mp4\n');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        expect(onWaiting).toHaveBeenCalledTimes(3);
        expect(infos).toEqual([{ live: true, filePath: '/d/Live [abc].mp4' }]);
        fake.emitter.emit('close', 0);
        await run.result;
    });

    it('reports when each post-processor starts and finishes, in order, without mistaking them for the file path', async () => {
        const fake = createFakeChild();
        const events: PostProcessEvent[] = [];
        const progress: ProgressInfo[] = [];
        const run = runYtdlp({
            binary: 'yt-dlp',
            args: [],
            spawnFn: () => {
                return fake.child;
            },
            onProgress: (item) => {
                progress.push(item);
            },
            onPostProcess: (event) => {
                events.push(event);
            }
        });
        fake.stdout.write('CYBERPROG|100.0%|6.61MiB/s|NA|26225|0.003|NA|sample\nCYBERPP|started|ExtractAudio\nCYBERPP|fini');
        fake.stdout.write('shed|ExtractAudio\nCYBERPP|started|MoveFiles\nCYBERPP|finished|MoveFiles\nCYBERFILE|/d/sample [sample].mp3\n');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        expect(progress).toHaveLength(1);
        expect(events).toEqual([
            { status: 'started', processor: 'ExtractAudio' },
            { status: 'finished', processor: 'ExtractAudio' },
            { status: 'started', processor: 'MoveFiles' },
            { status: 'finished', processor: 'MoveFiles' }
        ]);
        fake.emitter.emit('close', 0);
        await expect(run.result).resolves.toEqual({ status: 'done', filePath: '/d/sample [sample].mp3' });
    });

    it('reports the post-processors that yt-dlp writes to stderr, as it does in quiet mode', async () => {
        const fake = createFakeChild();
        const events: PostProcessEvent[] = [];
        const progress: ProgressInfo[] = [];
        const run = runYtdlp({
            binary: 'yt-dlp',
            args: [],
            spawnFn: () => {
                return fake.child;
            },
            onProgress: (item) => {
                progress.push(item);
            },
            onPostProcess: (event) => {
                events.push(event);
            }
        });
        fake.stdout.write('CYBERPROG|100.0%|6.61MiB/s|NA|26225|0.003|NA|sample\n');
        fake.stderr.write('CYBERPP|started|ExtractAudio\nCYBERPP|fini');
        fake.stderr.write('shed|ExtractAudio\r\nCYBERPP|started|MoveFiles\nCYBERPP|finished|MoveFiles\n');
        fake.stdout.write('CYBERFILE|/d/sample [sample].mp3\n');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        expect(progress).toHaveLength(1);
        expect(events).toEqual([
            { status: 'started', processor: 'ExtractAudio' },
            { status: 'finished', processor: 'ExtractAudio' },
            { status: 'started', processor: 'MoveFiles' },
            { status: 'finished', processor: 'MoveFiles' }
        ]);
        fake.emitter.emit('close', 0);
        await expect(run.result).resolves.toEqual({ status: 'done', filePath: '/d/sample [sample].mp3' });
    });

    it('reports a post-process line that is the last thing on stderr, without a line end', async () => {
        const fake = createFakeChild();
        const events: PostProcessEvent[] = [];
        const run = runYtdlp({
            binary: 'yt-dlp',
            args: [],
            spawnFn: () => {
                return fake.child;
            },
            onProgress: vi.fn(),
            onPostProcess: (event) => {
                events.push(event);
            }
        });
        fake.stderr.write('CYBERPP|started|Merger');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        expect(events).toEqual([]);
        fake.emitter.emit('close', 0);
        await run.result;
        expect(events).toEqual([{ status: 'started', processor: 'Merger' }]);
    });

    it('keeps the post-process lines out of the error text of a failed download', async () => {
        const fake = createFakeChild();
        const events: PostProcessEvent[] = [];
        const run = runYtdlp({
            binary: 'yt-dlp',
            args: [],
            spawnFn: () => {
                return fake.child;
            },
            onProgress: vi.fn(),
            onPostProcess: (event) => {
                events.push(event);
            }
        });
        fake.stderr.write('CYBERPP|started|ExtractAudio\nERROR: Video unavailable\n');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        fake.emitter.emit('close', 1);
        await expect(run.result).resolves.toEqual({
            status: 'error',
            error: {
                code: 'UNAVAILABLE',
                title: 'Video unavailable',
                hint: 'The video may be private, removed or blocked in your region.',
                raw: 'ERROR: Video unavailable'
            }
        });
        expect(events).toEqual([{ status: 'started', processor: 'ExtractAudio' }]);
    });

    it('works without a post-process listener', async () => {
        const { fake, run, progress } = start();
        fake.stdout.write('CYBERPP|started|Merger\nCYBERFILE|/d/a.mp4\n');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        fake.emitter.emit('close', 0);
        await expect(run.result).resolves.toEqual({ status: 'done', filePath: '/d/a.mp4' });
        expect(progress).toEqual([]);
    });

    it('works without a waiting listener', async () => {
        const { fake, run } = start();
        fake.stdout.write('[wait] Waiting for 00:00:30 - Press Ctrl+C to try now\n');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        fake.emitter.emit('close', 0);
        await expect(run.result).resolves.toEqual({ status: 'done', filePath: null });
    });

    it('resolves done with a null file path when none was printed', async () => {
        const { fake, run } = start();
        fake.emitter.emit('close', 0);
        await expect(run.result).resolves.toEqual({ status: 'done', filePath: null });
    });

    it('handles a final line without newline on close', async () => {
        const { fake, run } = start();
        fake.stdout.write('CYBERFILE|/d/last.mp4');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        fake.emitter.emit('close', 0);
        await expect(run.result).resolves.toEqual({ status: 'done', filePath: '/d/last.mp4' });
    });

    it('resolves with a mapped error on non-zero exit', async () => {
        const { fake, run } = start();
        fake.stderr.write('ERROR: Video unavailable\n');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        fake.emitter.emit('close', 1);
        await expect(run.result).resolves.toEqual({
            status: 'error',
            error: {
                code: 'UNAVAILABLE',
                title: 'Video unavailable',
                hint: 'The video may be private, removed or blocked in your region.',
                raw: 'ERROR: Video unavailable'
            }
        });
    });

    it('resolves with BINARY_MISSING when spawn fails with ENOENT', async () => {
        const { fake, run } = start();
        fake.emitter.emit('error', Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' }));
        await expect(run.result).resolves.toEqual({
            status: 'error',
            error: {
                code: 'BINARY_MISSING',
                title: 'yt-dlp not found',
                hint: 'Install yt-dlp or set its path in the settings.',
                raw: 'spawn yt-dlp ENOENT'
            }
        });
    });

    it('reports the start of each download, telling whether it is live and where the file goes', async () => {
        const { fake, progress, infos, run } = start();
        fake.stdout.write('CYBERINFO|True|/d/Live [x].mp4\nCYBERPROG|NA|1MiB/s|NA|10|1.0|True|Live\n');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        fake.emitter.emit('close', 0);
        await run.result;
        expect(infos).toEqual([{ live: true, filePath: '/d/Live [x].mp4' }]);
        expect(progress).toHaveLength(1);
        expect(progress[0]?.live).toBe(true);
    });

    it('does not report an info line that has no path', async () => {
        const { fake, infos, run } = start();
        fake.stdout.write('CYBERINFO|True|\n');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        fake.emitter.emit('close', 0);
        await run.result;
        expect(infos).toEqual([]);
    });

    it('works without an info listener', async () => {
        const fake = createFakeChild();
        const run = runYtdlp({ binary: 'yt-dlp', args: [], spawnFn: () => {return fake.child}, onProgress: () => {return undefined} });
        fake.stdout.write('CYBERINFO|True|/d/v.mp4\n');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        fake.emitter.emit('close', 0);
        await expect(run.result).resolves.toEqual({ status: 'done', filePath: null });
    });

    it('stop sends SIGINT so yt-dlp finishes and keeps the recording, which then completes normally', async () => {
        const { fake, run } = start();
        fake.stdout.write('CYBERINFO|True|/d/Live.mp4\n');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        run.stop();
        expect(fake.kill).toHaveBeenCalledWith('SIGINT');
        fake.stdout.write('CYBERFILE|/d/Live.mp4\n');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        fake.emitter.emit('close', 0);
        await expect(run.result).resolves.toEqual({ status: 'done', filePath: '/d/Live.mp4' });
    });

    it('stop is not a cancellation: a failure after it is still reported as an error', async () => {
        const { fake, run } = start();
        run.stop();
        fake.stderr.write('ERROR: Interrupted by user\n');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        fake.emitter.emit('close', 1);
        const result = await run.result;
        expect(result.status).toBe('error');
    });

    it('kills the process with SIGTERM and resolves cancelled', async () => {
        const { fake, run } = start();
        run.cancel();
        expect(fake.kill).toHaveBeenCalledWith('SIGTERM');
        fake.emitter.emit('close', null);
        await expect(run.result).resolves.toEqual({ status: 'cancelled' });
    });
});

describe('runYtdlp on Linux (process groups and escalation)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function startOnLinux(withPid = true) {
        const fake = createFakeChild();
        if (withPid) {
            Object.assign(fake.child, { pid: 4242 });
        }
        const killGroup = vi.fn();
        const destroyOut = vi.spyOn(fake.stdout, 'destroy');
        const destroyErr = vi.spyOn(fake.stderr, 'destroy');
        const run = runYtdlp({
            binary: 'yt-dlp',
            args: ['https://x.com/live'],
            platform: 'linux',
            killGroup,
            spawnFn: () => {
                return fake.child;
            },
            onProgress: () => {
                return undefined;
            }
        });
        return { fake, killGroup, destroyOut, destroyErr, run };
    }

    describe('cancel', () => {
        it('ends the whole process group, so the ffmpeg of yt-dlp does not stay behind', async () => {
            const { fake, killGroup, run } = startOnLinux();
            run.cancel();
            expect(killGroup).toHaveBeenCalledTimes(1);
            expect(killGroup).toHaveBeenCalledWith(4242, 'SIGTERM');
            expect(fake.kill).not.toHaveBeenCalled();
            fake.emitter.emit('close', null);
            await expect(run.result).resolves.toEqual({ status: 'cancelled' });
        });

        it('kills whatever is still there after a while', async () => {
            const { killGroup, run } = startOnLinux();
            run.cancel();
            await vi.advanceTimersByTimeAsync(KILL_ESCALATION_MS - 1);
            expect(killGroup).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(killGroup).toHaveBeenCalledTimes(2);
            expect(killGroup).toHaveBeenNthCalledWith(2, 4242, 'SIGKILL');
        });

        it('does not kill again when the process ended in time', async () => {
            const { fake, killGroup, run } = startOnLinux();
            run.cancel();
            fake.emitter.emit('close', null);
            await run.result;
            await vi.advanceTimersByTimeAsync(KILL_ESCALATION_MS * 3);
            expect(killGroup).toHaveBeenCalledTimes(1);
        });

        it('signals the process alone when it has no pid', async () => {
            const { fake, killGroup, run } = startOnLinux(false);
            run.cancel();
            expect(killGroup).not.toHaveBeenCalled();
            expect(fake.kill).toHaveBeenCalledWith('SIGTERM');
            await vi.advanceTimersByTimeAsync(KILL_ESCALATION_MS);
            expect(fake.kill).toHaveBeenLastCalledWith('SIGKILL');
        });

        it('does nothing once the run has ended', async () => {
            const { fake, killGroup, run } = startOnLinux();
            fake.emitter.emit('close', 0);
            await run.result;
            run.cancel();
            expect(killGroup).not.toHaveBeenCalled();
            expect(fake.kill).not.toHaveBeenCalled();
        });
    });

    describe('stop', () => {
        it('asks yt-dlp alone to finish with Ctrl+C and waits for it', async () => {
            const { fake, killGroup, run } = startOnLinux();
            run.stop();
            expect(fake.kill).toHaveBeenCalledTimes(1);
            expect(fake.kill).toHaveBeenCalledWith('SIGINT');
            expect(killGroup).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(STOP_ESCALATION_MS - 1);
            expect(killGroup).not.toHaveBeenCalled();
            fake.stdout.write('CYBERFILE|/d/Live.mp4\n');
            fake.emitter.emit('close', 0);
            await expect(run.result).resolves.toEqual({ status: 'done', filePath: '/d/Live.mp4' });
        });

        it('does not end anything when yt-dlp finishes in time', async () => {
            const { fake, killGroup, run } = startOnLinux();
            run.stop();
            fake.emitter.emit('close', 0);
            await run.result;
            await vi.advanceTimersByTimeAsync(STOP_ESCALATION_MS * 3);
            expect(killGroup).not.toHaveBeenCalled();
        });

        it('ends the whole group when yt-dlp does not finish, and reports stopped so the recording is salvaged', async () => {
            const { fake, killGroup, run } = startOnLinux();
            run.stop();
            await vi.advanceTimersByTimeAsync(STOP_ESCALATION_MS);
            expect(killGroup).toHaveBeenCalledTimes(1);
            expect(killGroup).toHaveBeenCalledWith(4242, 'SIGTERM');
            fake.emitter.emit('close', null);
            await expect(run.result).resolves.toEqual({ status: 'stopped' });
        });

        it('kills the group when it ignores even that', async () => {
            const { killGroup, run } = startOnLinux();
            run.stop();
            await vi.advanceTimersByTimeAsync(STOP_ESCALATION_MS + KILL_ESCALATION_MS);
            expect(killGroup).toHaveBeenCalledTimes(2);
            expect(killGroup).toHaveBeenNthCalledWith(2, 4242, 'SIGKILL');
        });

        it('does nothing once the run has ended', async () => {
            const { fake, run } = startOnLinux();
            fake.emitter.emit('close', 0);
            await run.result;
            run.stop();
            expect(fake.kill).not.toHaveBeenCalled();
        });

        it('a cancel after a stop wins', async () => {
            const { fake, run } = startOnLinux();
            run.stop();
            run.cancel();
            fake.emitter.emit('close', null);
            await expect(run.result).resolves.toEqual({ status: 'cancelled' });
        });
    });

    describe('a process left behind with the pipes open', () => {
        it('gives the result a moment after yt-dlp exited even though the pipes never closed, and ends what is left', async () => {
            const { fake, killGroup, destroyOut, destroyErr, run } = startOnLinux();
            fake.stdout.write('CYBERFILE|/d/Video.mp4\n');
            fake.emitter.emit('exit', 0);
            await vi.advanceTimersByTimeAsync(EXIT_GRACE_MS - 1);
            expect(killGroup).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            await expect(run.result).resolves.toEqual({ status: 'done', filePath: '/d/Video.mp4' });
            expect(killGroup).toHaveBeenCalledWith(4242, 'SIGTERM');
            expect(destroyOut).toHaveBeenCalledTimes(1);
            expect(destroyErr).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(KILL_ESCALATION_MS);
            expect(killGroup).toHaveBeenLastCalledWith(4242, 'SIGKILL');
        });

        it('reports the error of a failed run in the same way', async () => {
            const { fake, run } = startOnLinux();
            fake.stderr.write('ERROR: Video unavailable\n');
            await vi.advanceTimersByTimeAsync(0);
            fake.emitter.emit('exit', 1);
            await vi.advanceTimersByTimeAsync(EXIT_GRACE_MS);
            const result = await run.result;
            expect(result.status).toBe('error');
        });

        it('reports a cancel that left the pipes open as cancelled', async () => {
            const { fake, run } = startOnLinux();
            run.cancel();
            fake.emitter.emit('exit', null);
            await vi.advanceTimersByTimeAsync(EXIT_GRACE_MS);
            await expect(run.result).resolves.toEqual({ status: 'cancelled' });
        });

        it('does not wait or end anything when the pipes close right after the exit', async () => {
            const { fake, killGroup, destroyOut, run } = startOnLinux();
            fake.emitter.emit('exit', 0);
            fake.emitter.emit('close', 0);
            await expect(run.result).resolves.toEqual({ status: 'done', filePath: null });
            await vi.advanceTimersByTimeAsync(EXIT_GRACE_MS * 3);
            expect(killGroup).not.toHaveBeenCalled();
            expect(destroyOut).not.toHaveBeenCalled();
        });

        it('ignores an exit after the process failed to start', async () => {
            const { fake, killGroup, run } = startOnLinux();
            fake.emitter.emit('error', Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' }));
            const result = await run.result;
            expect(result.status).toBe('error');
            fake.emitter.emit('exit', null);
            await vi.advanceTimersByTimeAsync(EXIT_GRACE_MS * 3);
            expect(killGroup).not.toHaveBeenCalled();
        });
    });
});

describe('runYtdlp on Windows', () => {
    function startOnWindows() {
        const fake = createFakeChild();
        Object.assign(fake.child, { pid: 777 });
        const taskkill = vi.fn();
        const run = runYtdlp({
            binary: 'yt-dlp.exe',
            args: ['https://x.com/live'],
            platform: 'win32',
            taskkill,
            spawnFn: () => {
                return fake.child;
            },
            onProgress: () => {
                return undefined;
            }
        });
        return { fake, taskkill, run };
    }

    it('cancel ends the whole process tree (yt-dlp and the ffmpeg it started) and resolves cancelled', async () => {
        const { fake, taskkill, run } = startOnWindows();
        run.cancel();
        expect(taskkill).toHaveBeenCalledTimes(1);
        expect(taskkill).toHaveBeenCalledWith('taskkill', ['/PID', '777', '/T', '/F']);
        expect(fake.kill).not.toHaveBeenCalled();
        fake.emitter.emit('close', 1);
        await expect(run.result).resolves.toEqual({ status: 'cancelled' });
    });

    it('stop cannot send Ctrl+C there: it ends the process tree and resolves stopped so the file can be salvaged', async () => {
        const { fake, taskkill, run } = startOnWindows();
        run.stop();
        expect(taskkill).toHaveBeenCalledTimes(1);
        expect(taskkill).toHaveBeenCalledWith('taskkill', ['/PID', '777', '/T', '/F']);
        expect(fake.kill).not.toHaveBeenCalledWith('SIGINT');
        fake.emitter.emit('close', 1);
        await expect(run.result).resolves.toEqual({ status: 'stopped' });
    });

    it('a cancel after a stop wins', async () => {
        const { fake, run } = startOnWindows();
        run.stop();
        run.cancel();
        fake.emitter.emit('close', 1);
        await expect(run.result).resolves.toEqual({ status: 'cancelled' });
    });

    it('a download that ends by itself is not reported as stopped', async () => {
        const { fake, run } = startOnWindows();
        fake.stdout.write('CYBERFILE|C:\\d\\Video.mp4\n');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        fake.emitter.emit('close', 0);
        await expect(run.result).resolves.toEqual({ status: 'done', filePath: 'C:\\d\\Video.mp4' });
    });
});

describe('defaultSpawn', () => {
    it('passes the given environment to the process', async () => {
        const child = defaultSpawn(process.execPath, ['-e', 'process.stdout.write(process.env.CYBER_TEST ?? "unset")'], { CYBER_TEST: 'yes' });
        const output = await new Promise<string>((resolve) => {
            let data = '';
            child.stdout.on('data', (chunk: Buffer) => {
                data += chunk.toString();
            });
            child.on('close', () => {
                resolve(data);
            });
        });
        expect(output).toBe('yes');
    });

    it('spawns a real process', async () => {
        const child = defaultSpawn(process.execPath, ['-e', 'process.stdout.write("ok")']);
        const output = await new Promise<string>((resolve) => {
            let data = '';
            child.stdout.on('data', (chunk: Buffer) => {
                data += chunk.toString();
            });
            child.on('close', () => {
                resolve(data);
            });
        });
        expect(output).toBe('ok');
    });
});

describe('defaultSpawn process group', () => {
    it.skipIf(process.platform === 'win32')('leads a process group of its own outside Windows, so it can be ended together with what it starts', async () => {
        const child = defaultSpawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
        const pid = child.pid ?? 0;
        expect(() => {
            process.kill(-pid, 0);
        }).not.toThrow();
        const closed = new Promise((resolve) => {
            child.once('close', resolve);
        });
        process.kill(-pid, 'SIGTERM');
        await closed;
    });
});

describe('defaultSpawn on every platform', () => {
    it('does not open a console window for the process it starts', async () => {
        const child = defaultSpawn(process.execPath, ['-e', 'process.stdout.write("hidden")']);
        expect(child.spawnargs).toEqual([process.execPath, '-e', 'process.stdout.write("hidden")']);
        await new Promise((resolve) => {
            child.on('close', resolve);
        });
    });
});

