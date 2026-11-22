import { join } from 'node:path';
import { IPC } from '@shared/constants';
import type { MergeRun } from '@shared/merge';
import { registerMergeHandlers } from '@main/ipc/registerMergeHandlers';
import type { FfmpegOutcome, FfmpegRun, RunFfmpeg } from '@main/services/cutService';
import { MergeService, type MergeServiceDependencies } from '@main/services/mergeService';

const VIDEO_A_STDERR = [
    '  Duration: 00:00:10.00, start: 0.000000',
    '  Stream #0:0: Video: h264 (High), yuv420p, 1280x720, 30 fps, 15360 tbn',
    '  Stream #0:1: Audio: aac, 48000 Hz, stereo, fltp'
].join('\n');

const VIDEO_B_DIFF_STDERR = [
    '  Duration: 00:00:20.00, start: 0.000000',
    '  Stream #0:0: Video: vp9, yuv420p, 640x360, 24 fps, 1k tbn'
].join('\n');

const AUDIO_ONLY_STDERR = [
    '  Duration: 00:00:15.00, start: 0.000000',
    '  Stream #0:0: Audio: mp3, 44100 Hz, stereo'
].join('\n');

function flush(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

function makeService(overrides: Partial<MergeServiceDependencies> = {}) {
    const runs: MergeRun[] = [];
    const removed: string[] = [];
    const written: Array<{ path: string; content: string }> = [];
    const calls: FfmpegRun[] = [];
    const runFfmpeg = vi.fn<RunFfmpeg>(async (run): Promise<FfmpegOutcome> => {
        calls.push(run);
        if (run.args.includes('-i') && !run.args.includes('-f') && !run.args.includes('-filter_complex')) {
            const target = run.args[run.args.indexOf('-i') + 1] ?? '';
            if (target.includes('audio')) {
                return { code: 1, output: AUDIO_ONLY_STDERR };
            }
            if (target.includes('diff')) {
                return { code: 1, output: VIDEO_B_DIFF_STDERR };
            }
            if (target.includes('bad')) {
                return { code: 1, output: 'Invalid data' };
            }
            return { code: 1, output: VIDEO_A_STDERR };
        }
        run.onOutput?.('frame=100 time=00:00:10.00 speed=2x');
        return { code: 0, output: '' };
    });

    const service = new MergeService({
        runFfmpeg: () => {
            return runFfmpeg;
        },
        chooseFiles: async () => {
            return ['/videos/a.mp4', '/videos/b.mp4'];
        },
        downloadsDir: () => {
            return '/downloads';
        },
        send: (run) => {
            runs.push(run);
        },
        tempDir: () => {
            return '/tmp';
        },
        platform: 'linux',
        threads: () => {
            return 2;
        },
        now: () => {
            return 1000;
        },
        listDirectory: async () => {
            return [];
        },
        makeDirectory: async () => {
            return undefined;
        },
        reservePath: async () => {
            return true;
        },
        writeTextFile: async (path, content) => {
            written.push({ path, content });
        },
        removeFile: async (path) => {
            removed.push(path);
        },
        ...overrides
    });

    return { service, runs, removed, written, calls, runFfmpeg };
}

describe('MergeService', () => {
    it('probes videos and handles unreadable, non-video, and missing ffmpeg cases', async () => {
        const { service } = makeService();
        expect(await service.probe('')).toEqual({ ok: false, reason: 'unreadable' });
        expect(await service.probe('relative.mp4')).toEqual({ ok: false, reason: 'unreadable' });
        expect(await service.probe('/videos/audio.mp3')).toEqual({ ok: false, reason: 'not-video' });
        expect(await service.probe('/videos/bad.mp4')).toEqual({ ok: false, reason: 'unreadable' });

        const ok = await service.probe('/videos/a.mp4');
        expect(ok).toEqual({
            ok: true,
            media: {
                path: '/videos/a.mp4',
                name: 'a',
                extension: '.mp4',
                durationSeconds: 10,
                width: 1280,
                height: 720,
                fps: 30,
                videoCodec: 'h264',
                pixelFormat: 'yuv420p',
                videoTimebase: '15360',
                hasAudio: true,
                audioCodec: 'aac',
                audioSampleRate: 48000,
                audioChannels: 'stereo',
                streamOrder: 'va'
            }
        });

        const noFfmpeg = makeService({
            runFfmpeg: () => {
                return null;
            }
        });
        expect(await noFfmpeg.service.probe('/videos/a.mp4')).toEqual({ ok: false, reason: 'no-ffmpeg' });
    });

    it('chooses files and reports rejected non-videos or cancelled dialog', async () => {
        const cancelled = makeService({
            chooseFiles: async () => {
                return null;
            }
        });
        expect(await cancelled.service.choose()).toEqual({ ok: false, reason: 'cancelled' });

        const mixed = makeService({
            chooseFiles: async () => {
                return ['/videos/a.mp4', '/videos/audio.mp3', '/videos/b.mp4'];
            }
        });
        const chosen = await mixed.service.choose();
        expect(chosen.ok).toBe(true);
        if (chosen.ok) {
            expect(chosen.media.map((item) => {
                return item.path;
            })).toEqual(['/videos/a.mp4', '/videos/b.mp4']);
            expect(chosen.rejected).toEqual([{ path: '/videos/audio.mp3', reason: 'not-video' }]);
        }

        const allBad = makeService({
            chooseFiles: async () => {
                return ['/videos/audio.mp3'];
            }
        });
        expect(await allBad.service.choose()).toEqual({ ok: false, reason: 'not-video' });
    });

    it('merges compatible videos using fast stream copy and cleans up the temporary concat list', async () => {
        const { service, runs, written, removed, calls } = makeService();
        const started = await service.start({
            paths: ['/videos/a.mp4', '/videos/b.mp4'],
            format: 'mp4',
            outputMode: 'downloads'
        });

        expect(started.ok).toBe(true);
        if (started.ok) {
            expect(started.run.method).toBe('copy');
            expect(started.run.outputName).toBe('a - merged.mp4');
            expect(started.run.totalDurationSeconds).toBe(20);
        }

        await flush();
        expect(written).toHaveLength(1);
        expect(written[0]!.content).toBe("file '/videos/a.mp4'\nfile '/videos/b.mp4'");
        expect(calls.at(-1)?.args).toContain('copy');
        expect(removed).toContain(written[0]!.path);
        expect(runs.at(-1)).toMatchObject({
            status: 'done',
            percent: 100,
            method: 'copy',
            outputPath: join('/downloads', 'a - merged.mp4')
        });
    });

    it('falls back automatically from stream copy to reencode when copy fails', async () => {
        let mergeAttempt = 0;
        const { service, runs } = makeService({
            runFfmpeg: () => {
                return async (run) => {
                    if (run.args.includes('-f') && run.args.includes('concat')) {
                        mergeAttempt += 1;
                        return { code: 1, output: 'Non-monotonous DTS' };
                    }
                    if (run.args.includes('-filter_complex')) {
                        mergeAttempt += 1;
                        run.onOutput?.('time=00:00:10.00');
                        return { code: 0, output: '' };
                    }
                    return { code: 1, output: VIDEO_A_STDERR };
                };
            }
        });

        const started = await service.start({
            paths: ['/videos/a.mp4', '/videos/b.mp4'],
            format: 'mp4',
            outputMode: 'source',
            outputName: 'Combined'
        });
        expect(started.ok).toBe(true);
        await flush();

        expect(mergeAttempt).toBe(2);
        expect(runs.at(-1)).toMatchObject({
            status: 'done',
            method: 'reencode',
            percent: 100,
            outputDirectory: '/videos',
            outputPath: join('/videos', 'Combined.mp4')
        });
    });

    it('uses reencode directly when videos differ and supports duplicate paths', async () => {
        const { service, runs, calls } = makeService();
        const started = await service.start({
            paths: ['/videos/a.mp4', '/videos/diff.webm', '/videos/a.mp4'],
            format: 'mkv',
            outputMode: 'custom',
            outputDirectory: '/custom'
        });
        expect(started.ok).toBe(true);
        await flush();

        const probeCalls = calls.filter((call) => {
            return !call.args.includes('-filter_complex') && !call.args.includes('concat');
        });
        expect(probeCalls).toHaveLength(2);
        expect(runs.at(-1)).toMatchObject({
            status: 'done',
            method: 'reencode',
            inputCount: 3,
            totalDurationSeconds: 40,
            outputPath: join('/custom', 'a - merged.mkv')
        });
    });

    it('validates requests and rejects invalid inputs or unavailable directories', async () => {
        const { service } = makeService();
        expect(await service.start({ paths: ['/videos/a.mp4'], format: 'mp4', outputMode: 'downloads' })).toEqual({ ok: false, reason: 'invalid' });
        expect(await service.start({ paths: ['/videos/a.mp4', '/videos/b.mp4'], format: 'mp4', outputMode: 'custom' })).toEqual({ ok: false, reason: 'invalid' });
        expect(await service.start({ paths: ['/videos/a.mp4', '/videos/audio.mp3'], format: 'mp4', outputMode: 'downloads' })).toEqual({ ok: false, reason: 'not-video' });

        const brokenFolder = makeService({
            makeDirectory: async () => {
                throw new Error('EACCES');
            }
        });
        expect(await brokenFolder.service.start({ paths: ['/videos/a.mp4', '/videos/b.mp4'], format: 'mp4', outputMode: 'downloads' })).toEqual({ ok: false, reason: 'folder' });
    });

    it('cancels an active merge, removes partial output, and shuts down cleanly', async () => {
        let resolveRun: ((outcome: FfmpegOutcome) => void) | null = null;
        const { service, runs, removed } = makeService({
            runFfmpeg: () => {
                return (run) => {
                    if (!run.args.includes('concat') && !run.args.includes('-filter_complex')) {
                        return Promise.resolve({ code: 1, output: VIDEO_A_STDERR });
                    }
                    return new Promise((resolve) => {
                        resolveRun = resolve;
                        run.signal.addEventListener('abort', () => {
                            resolve({ code: null, output: '' });
                        });
                    });
                };
            }
        });

        const started = await service.start({
            paths: ['/videos/a.mp4', '/videos/b.mp4'],
            format: 'mp4',
            outputMode: 'downloads'
        });
        expect(started.ok).toBe(true);
        expect(service.hasActiveRun()).toBe(true);
        expect(await service.start({ paths: ['/videos/a.mp4', '/videos/b.mp4'], format: 'mp4', outputMode: 'downloads' })).toEqual({ ok: false, reason: 'busy' });

        await service.shutdown();
        expect(resolveRun).not.toBeNull();
        expect(service.hasActiveRun()).toBe(false);
        expect(runs.at(-1)).toMatchObject({ status: 'cancelled', percent: 0, outputPath: null });
        expect(removed).toContain(join('/downloads', 'a - merged.mp4'));

        service.clear();
        expect(service.current()).toBeNull();
    });

    it('sets run.outputName to the actual collision-free filename allocated on disk', async () => {
        const { service, runs } = makeService({
            listDirectory: async () => {
                return [join('/downloads', 'a - merged.mp4')];
            }
        });

        const started = await service.start({
            paths: ['/videos/a.mp4', '/videos/b.mp4'],
            format: 'mp4',
            outputMode: 'downloads'
        });
        expect(started.ok).toBe(true);
        if (started.ok) {
            expect(started.run.outputName).toBe('a - merged (2).mp4');
        }
        await flush();
        expect(runs.at(-1)).toMatchObject({
            status: 'done',
            outputName: 'a - merged (2).mp4',
            outputPath: join('/downloads', 'a - merged (2).mp4')
        });
    });

    it('cancels and awaits an in-flight probe during shutdown without launching ffmpeg merge afterwards', async () => {
        let mergeInvoked = false;
        let probeStarted: (() => void) | null = null;
        const probeReady = new Promise<void>((resolve) => {
            probeStarted = resolve;
        });
        const { service } = makeService({
            runFfmpeg: () => {
                return (run) => {
                    if (run.args.includes('concat') || run.args.includes('-filter_complex')) {
                        mergeInvoked = true;
                        return Promise.resolve({ code: 0, output: '' });
                    }
                    probeStarted?.();
                    return new Promise((resolve) => {
                        run.signal.addEventListener('abort', () => {
                            resolve({ code: null, output: '' });
                        });
                    });
                };
            }
        });

        const startPromise = service.start({
            paths: ['/videos/a.mp4', '/videos/b.mp4'],
            format: 'mp4',
            outputMode: 'downloads'
        });
        await probeReady;
        expect(service.hasActiveRun()).toBe(true);

        const shutdownPromise = service.shutdown();
        const result = await startPromise;
        await shutdownPromise;

        expect(result).toEqual({ ok: false, reason: 'invalid' });
        expect(mergeInvoked).toBe(false);
        expect(service.hasActiveRun()).toBe(false);
    });

    it('registers all merge IPC handlers cleanly', async () => {
        const handlers = new Map<string, (...args: unknown[]) => unknown>();
        const ipcMain = {
            handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
                handlers.set(channel, handler);
            })
        };
        const { service } = makeService();
        registerMergeHandlers(ipcMain, service);

        expect(Array.from(handlers.keys()).sort()).toEqual([
            IPC.mergeCancel,
            IPC.mergeChoose,
            IPC.mergeClear,
            IPC.mergeCurrent,
            IPC.mergeProbe,
            IPC.mergeStart
        ]);
        expect(await handlers.get(IPC.mergeProbe)!({}, '')).toEqual({ ok: false, reason: 'unreadable' });
        expect(handlers.get(IPC.mergeCurrent)!()).toBeNull();
    });
});
