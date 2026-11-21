import type { ConvertRun } from '@shared/convert';
import { ConvertService } from '@main/services/convertService';
import type { FfmpegOutcome, FfmpegRun, RunFfmpeg } from '@main/services/cutService';

const VIDEO_PROBE = [
    '  Duration: 00:01:40.00, start: 0.000000',
    '  Stream #0:0: Video: h264, yuv420p, 1280x720',
    '  Stream #0:1: Audio: aac, 48000 Hz, stereo'
].join('\n');

const SILENT_PROBE = [
    '  Duration: 00:01:00.00',
    '  Stream #0:0: Video: h264, yuv420p, 1280x720'
].join('\n');

const AUDIO_PROBE = [
    '  Duration: 00:02:00.00',
    '  Stream #0:0: Audio: mp3, 44100 Hz, stereo'
].join('\n');

async function waitForDone(updates: ConvertRun[]): Promise<ConvertRun> {
    await vi.waitFor(() => {
        const last = updates.at(-1);
        expect(last?.status === 'done' || last?.status === 'cancelled').toBe(true);
    });
    return updates.at(-1)!;
}

describe('ConvertService', () => {
    it('probes videos and distinguishes not-video, no-audio, unreadable and no-ffmpeg', async () => {
        const outputs: Record<string, FfmpegOutcome> = {
            '/v/ok.mp4': { code: 1, output: VIDEO_PROBE },
            '/v/silent.mp4': { code: 1, output: SILENT_PROBE },
            '/v/song.mp3': { code: 1, output: AUDIO_PROBE },
            '/v/bad.txt': { code: 1, output: 'Invalid data' },
            '/v/missing.mp4': { code: null, output: 'ENOENT' }
        };
        const runFfmpeg: RunFfmpeg = async ({ args }) => {
            const input = args[args.indexOf('-i') + 1] ?? '';
            return outputs[input] ?? { code: 1, output: '' };
        };
        const service = new ConvertService({
            runFfmpeg: () => {
                return runFfmpeg;
            },
            chooseFiles: async () => {
                return null;
            },
            downloadsDir: () => {
                return '/downloads';
            },
            send: vi.fn()
        });

        expect(await service.probe('/v/ok.mp4')).toEqual({
            ok: true,
            media: { path: '/v/ok.mp4', name: 'ok', extension: '.mp4', durationSeconds: 100 }
        });
        expect(await service.probe('/v/silent.mp4')).toEqual({ ok: false, reason: 'no-audio' });
        expect(await service.probe('/v/song.mp3')).toEqual({ ok: false, reason: 'not-video' });
        expect(await service.probe('/v/bad.txt')).toEqual({ ok: false, reason: 'unreadable' });
        expect(await service.probe('/v/missing.mp4')).toEqual({ ok: false, reason: 'no-ffmpeg' });
    });

    it('returns no-ffmpeg when runner is null', async () => {
        const service = new ConvertService({
            runFfmpeg: () => {
                return null;
            },
            chooseFiles: async () => {
                return ['/v/a.mp4'];
            },
            downloadsDir: () => {
                return '/downloads';
            },
            send: vi.fn()
        });

        expect(await service.probe('/v/a.mp4')).toEqual({ ok: false, reason: 'no-ffmpeg' });
        expect(await service.choose()).toEqual({ ok: false, reason: 'no-ffmpeg' });
        expect(await service.start({ paths: ['/v/a.mp4'], format: 'mp3', outputMode: 'downloads' })).toEqual({ ok: false, reason: 'no-ffmpeg' });
    });

    it('chooses multiple videos, keeping valid ones and reporting rejected files', async () => {
        const runFfmpeg: RunFfmpeg = async ({ args }) => {
            const input = args[args.indexOf('-i') + 1] ?? '';
            if (input.endsWith('.mp4')) {
                return { code: 1, output: VIDEO_PROBE };
            }
            return { code: 1, output: AUDIO_PROBE };
        };
        const chooseFiles = vi.fn<() => Promise<string[] | null>>();
        const service = new ConvertService({
            runFfmpeg: () => {
                return runFfmpeg;
            },
            chooseFiles,
            downloadsDir: () => {
                return '/downloads';
            },
            send: vi.fn()
        });

        chooseFiles.mockResolvedValueOnce(null);
        expect(await service.choose()).toEqual({ ok: false, reason: 'cancelled' });

        chooseFiles.mockResolvedValueOnce(['/v/a.mp4', '/v/b.mp3', '/v/c.mp4']);
        expect(await service.choose()).toEqual({
            ok: true,
            media: [
                { path: '/v/a.mp4', name: 'a', extension: '.mp4', durationSeconds: 100 },
                { path: '/v/c.mp4', name: 'c', extension: '.mp4', durationSeconds: 100 }
            ],
            rejected: [{ path: '/v/b.mp3', reason: 'not-video' }]
        });

        chooseFiles.mockResolvedValueOnce(['/v/b.mp3']);
        expect(await service.choose()).toEqual({ ok: false, reason: 'not-video' });
    });

    it('converts a batch to downloads folder, avoids filename collisions, and reports throttled progress', async () => {
        const calls: FfmpegRun[] = [];
        let clock = 1000;
        const updates: ConvertRun[] = [];
        const runFfmpeg: RunFfmpeg = async (run) => {
            calls.push(run);
            if (!run.args.includes('-vn')) {
                return { code: 1, output: VIDEO_PROBE };
            }
            run.onOutput?.('time=00:00:25.00');
            clock += 100;
            run.onOutput?.('time=00:00:50.00');
            clock += 300;
            run.onOutput?.('time=00:00:75.00');
            return { code: 0, output: '' };
        };
        const service = new ConvertService({
            runFfmpeg: () => {
                return runFfmpeg;
            },
            chooseFiles: async () => {
                return null;
            },
            downloadsDir: () => {
                return '/downloads';
            },
            send: (run) => {
                updates.push(run);
            },
            now: () => {
                return clock;
            },
            threads: () => {
                return 2;
            },
            makeDirectory: async () => {
                return undefined;
            },
            listDirectory: async () => {
                return ['/downloads/clip.mp3'];
            },
            reservePath: async () => {
                return true;
            },
            removeFile: async () => {
                return undefined;
            }
        });

        const started = await service.start({
            paths: ['/src/clip.mp4', '/src/clip.mp4', '/other/clip.mkv'],
            format: 'mp3',
            outputMode: 'downloads'
        });
        expect(started.ok).toBe(true);
        const finalRun = await waitForDone(updates);
        expect(calls.length).toBeGreaterThanOrEqual(4);
        expect(finalRun.status).toBe('done');
        expect(finalRun.items).toEqual([
            {
                path: '/src/clip.mp4',
                name: 'clip.mp4',
                status: 'done',
                percent: 100,
                outputPath: '/downloads/clip (2).mp3',
                error: null
            },
            {
                path: '/other/clip.mkv',
                name: 'clip.mkv',
                status: 'done',
                percent: 100,
                outputPath: '/downloads/clip (3).mp3',
                error: null
            }
        ]);
        const progressValues = updates.flatMap((run) => {
            return run.items
                .filter((item) => {
                    return item.status === 'converting' && item.percent > 0;
                })
                .map((item) => {
                    return item.percent;
                });
        });
        expect(progressValues).toContain(25);
        expect(progressValues).toContain(75);
        expect(progressValues).not.toContain(50);

        service.clear();
        expect(service.current()).toBeNull();
    });

    it('supports source and custom output modes and validates requests', async () => {
        const updates: ConvertRun[] = [];
        const outputs: string[] = [];
        const runFfmpeg: RunFfmpeg = async ({ args }) => {
            if (!args.includes('-vn')) {
                return { code: 1, output: VIDEO_PROBE };
            }
            outputs.push(args.at(-1) ?? '');
            return { code: 0, output: '' };
        };
        const makeDirectory = vi.fn(async () => {
            return undefined;
        });
        const service = new ConvertService({
            runFfmpeg: () => {
                return runFfmpeg;
            },
            chooseFiles: async () => {
                return null;
            },
            downloadsDir: () => {
                return '/downloads';
            },
            send: (run) => {
                updates.push(run);
            },
            makeDirectory,
            listDirectory: async () => {
                return [];
            },
            reservePath: async () => {
                return true;
            },
            removeFile: async () => {
                return undefined;
            }
        });

        expect(await service.start({ paths: [], format: 'mp3', outputMode: 'downloads' })).toEqual({ ok: false, reason: 'invalid' });
        expect(await service.start({ paths: ['relative.mp4'], format: 'mp3', outputMode: 'downloads' })).toEqual({ ok: false, reason: 'invalid' });
        expect(await service.start({ paths: ['/v/a.mp4'], format: 'mp3', outputMode: 'custom', outputDirectory: 'relative/path' })).toEqual({ ok: false, reason: 'invalid' });

        makeDirectory.mockRejectedValueOnce(new Error('EACCES'));
        expect(await service.start({ paths: ['/v/a.mp4'], format: 'mp3', outputMode: 'custom', outputDirectory: '/locked' })).toEqual({ ok: false, reason: 'folder' });

        const sourceStart = await service.start({ paths: ['/movies/a.mp4'], format: 'flac', outputMode: 'source' });
        expect(sourceStart.ok).toBe(true);
        await waitForDone(updates);
        expect(outputs).toEqual(['/movies/a.flac']);

        const customStart = await service.start({ paths: ['/movies/b.mp4'], format: 'wav', outputMode: 'custom', outputDirectory: '/custom-out' });
        expect(customStart.ok).toBe(true);
        await waitForDone(updates);
        expect(outputs).toEqual(['/movies/a.flac', '/custom-out/b.wav']);
    });

    it('marks an individual failing item as error and continues remaining items, and supports cancelling', async () => {
        const updates: ConvertRun[] = [];
        let releaseSecond: (() => void) | null = null;
        const runFfmpeg: RunFfmpeg = async ({ args, signal }) => {
            const input = args[args.indexOf('-i') + 1] ?? '';
            if (!args.includes('-vn')) {
                return input === '/v/silent.mp4' ? { code: 1, output: SILENT_PROBE } : { code: 1, output: VIDEO_PROBE };
            }
            return new Promise((resolve) => {
                signal.addEventListener(
                    'abort',
                    () => {
                        resolve({ code: null, output: 'aborted' });
                    },
                    { once: true }
                );
                releaseSecond = () => {
                    resolve({ code: 0, output: '' });
                };
            });
        };
        const service = new ConvertService({
            runFfmpeg: () => {
                return runFfmpeg;
            },
            chooseFiles: async () => {
                return null;
            },
            downloadsDir: () => {
                return '/downloads';
            },
            send: (run) => {
                updates.push(run);
            },
            makeDirectory: async () => {
                return undefined;
            },
            listDirectory: async () => {
                return [];
            },
            reservePath: async () => {
                return true;
            },
            removeFile: async () => {
                return undefined;
            }
        });

        await service.start({ paths: ['/v/silent.mp4', '/v/second.mp4', '/v/third.mp4'], format: 'opus', outputMode: 'downloads' });
        expect(await service.start({ paths: ['/v/other.mp4'], format: 'mp3', outputMode: 'downloads' })).toEqual({ ok: false, reason: 'busy' });
        await vi.waitFor(() => {
            expect(releaseSecond).not.toBeNull();
        });
        service.clear();
        expect(service.current()?.status).toBe('running');
        await service.shutdown();
        const finalRun = await waitForDone(updates);
        expect(finalRun.status).toBe('cancelled');
        expect(finalRun.items[0]).toMatchObject({ status: 'error', error: 'no-audio' });
        expect(finalRun.items[1]).toMatchObject({ status: 'cancelled', percent: 0 });
        expect(finalRun.items[2]).toMatchObject({ status: 'cancelled', percent: 0 });
    });

    it('retries allocation when reservePath collides, cleans up on ffmpeg failure, and guards concurrent start', async () => {
        const updates: ConvertRun[] = [];
        const removed: string[] = [];
        let releaseMkdir: (() => void) | null = null;
        const reservePath = vi.fn<((path: string) => Promise<boolean>)>();
        reservePath.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        const runFfmpeg: RunFfmpeg = async ({ args }) => {
            if (!args.includes('-vn')) {
                return { code: 1, output: VIDEO_PROBE };
            }
            return { code: 1, output: 'encoder failed' };
        };
        const service = new ConvertService({
            runFfmpeg: () => {
                return runFfmpeg;
            },
            chooseFiles: async () => {
                return null;
            },
            downloadsDir: () => {
                return '/downloads';
            },
            send: (run) => {
                updates.push(run);
            },
            makeDirectory: () => {
                return new Promise((resolve) => {
                    releaseMkdir = resolve;
                });
            },
            listDirectory: async () => {
                return [];
            },
            reservePath,
            removeFile: async (path) => {
                removed.push(path);
            }
        });

        const firstStart = service.start({ paths: ['/v/fail.mp4'], format: 'mp3', outputMode: 'downloads' });
        const concurrentStart = await service.start({ paths: ['/v/other.mp4'], format: 'mp3', outputMode: 'downloads' });
        expect(concurrentStart).toEqual({ ok: false, reason: 'busy' });
        releaseMkdir!();
        expect((await firstStart).ok).toBe(true);
        const done = await waitForDone(updates);
        expect(done.items[0]).toEqual({
            path: '/v/fail.mp4',
            name: 'fail.mp4',
            status: 'error',
            percent: 0,
            outputPath: null,
            error: 'encoder failed'
        });
        expect(reservePath).toHaveBeenNthCalledWith(1, '/downloads/fail.mp3');
        expect(reservePath).toHaveBeenNthCalledWith(2, '/downloads/fail (2).mp3');
        expect(removed).toEqual(['/downloads/fail (2).mp3']);
    });
});
