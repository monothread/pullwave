import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunFfmpeg } from '@main/services/cutService';
import {
    buildExplorerPreviewArgs,
    buildExplorerThumbArgs,
    DEFAULT_THUMB_MAX_AGE_MS,
    EXPLORER_THUMB_SEEK_SECONDS,
    ExplorerThumbnails,
    thumbnailCacheKey
} from '@main/services/explorerThumbnails';

describe('ExplorerThumbnails', () => {
    let workDir: string;
    let cacheDir: string;
    let previewDir: string;

    beforeEach(() => {
        workDir = mkdtempSync(join(tmpdir(), 'pullwave-explorer-thumbs-'));
        cacheDir = join(workDir, 'cache');
        previewDir = join(workDir, 'preview');
    });

    afterEach(() => {
        rmSync(workDir, { recursive: true, force: true });
    });

    it('builds ffmpeg args for thumbnails and video/audio fallback previews', () => {
        expect(buildExplorerThumbArgs('/v/a.mp4', '/c/out.jpg', EXPLORER_THUMB_SEEK_SECONDS)).toEqual([
            '-hide_banner',
            '-nostdin',
            '-y',
            '-v',
            'error',
            '-ss',
            '2',
            '-i',
            '/v/a.mp4',
            '-map',
            '0:v:0',
            '-frames:v',
            '1',
            '-vf',
            'scale=320:-2',
            '-q:v',
            '5',
            '/c/out.jpg'
        ]);
        expect(buildExplorerThumbArgs('/v/a.mp4', '/c/out.jpg', 0)).not.toContain('-ss');
        expect(buildExplorerPreviewArgs({ path: '/v/a.avi', kind: 'video' }, '/p/out.mp4')).toEqual([
            '-hide_banner',
            '-nostdin',
            '-y',
            '-v',
            'error',
            '-i',
            '/v/a.avi',
            '-map',
            '0:v:0',
            '-map',
            '0:a:0?',
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-crf',
            '26',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '160k',
            '-movflags',
            '+faststart',
            '/p/out.mp4'
        ]);
        expect(buildExplorerPreviewArgs({ path: '/a/song.wma', kind: 'audio' }, '/p/out.m4a')).toEqual([
            '-hide_banner',
            '-nostdin',
            '-y',
            '-v',
            'error',
            '-i',
            '/a/song.wma',
            '-vn',
            '-map',
            '0:a:0',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '/p/out.m4a'
        ]);
    });

    it('generates and caches video thumbnails, skips non-videos, and falls back to 0s seek on short videos', async () => {
        const calls: string[][] = [];
        const runFfmpeg: RunFfmpeg = async ({ args }) => {
            calls.push(args);
            const output = args.at(-1) ?? '';
            if (args.includes('-ss')) {
                return { code: 1, output: 'eof' };
            }
            writeFileSync(output, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
            return { code: 0, output: '' };
        };
        const thumbs = new ExplorerThumbnails({
            runFfmpeg: () => {
                return runFfmpeg;
            },
            cacheDirectory: cacheDir,
            previewDirectory: previewDir
        });

        expect(await thumbs.thumbnail({ path: '/a/song.mp3', kind: 'audio', modifiedAt: 1, sizeBytes: 10 })).toBeNull();

        const entry = { path: '/v/short.mp4', kind: 'video' as const, modifiedAt: 1000, sizeBytes: 500 };
        const [first, second] = await Promise.all([thumbs.thumbnail(entry), thumbs.thumbnail(entry)]);
        const expected = join(cacheDir, `${thumbnailCacheKey(entry.path, entry.modifiedAt, entry.sizeBytes)}.jpg`);
        expect(first).toBe(expected);
        expect(second).toBe(expected);
        expect(calls).toHaveLength(2);

        const cached = await thumbs.thumbnail(entry);
        expect(cached).toBe(expected);
        expect(calls).toHaveLength(2);
        thumbs.dispose();
    });

    it('prunes oldest cached thumbnails when exceeding maxCacheFiles and expires thumbnails older than maxAgeMs', async () => {
        let currentNow = 10_000_000;
        let ffmpegRuns = 0;
        const runFfmpeg: RunFfmpeg = async ({ args }) => {
            ffmpegRuns += 1;
            writeFileSync(args.at(-1) ?? '', Buffer.from([1, 2, 3]));
            return { code: 0, output: '' };
        };
        const thumbs = new ExplorerThumbnails({
            runFfmpeg: () => {
                return runFfmpeg;
            },
            cacheDirectory: cacheDir,
            previewDirectory: previewDir,
            maxCacheFiles: 2,
            maxAgeMs: DEFAULT_THUMB_MAX_AGE_MS,
            pruneIntervalMs: 0,
            now: () => {
                return currentNow;
            }
        });

        const firstEntry = { path: '/v/first.mp4', kind: 'video' as const, modifiedAt: 100, sizeBytes: 10 };
        const secondEntry = { path: '/v/second.mp4', kind: 'video' as const, modifiedAt: 200, sizeBytes: 20 };
        const thirdEntry = { path: '/v/third.mp4', kind: 'video' as const, modifiedAt: 300, sizeBytes: 30 };

        const firstPath = await thumbs.thumbnail(firstEntry);
        currentNow += 10_000;
        const secondPath = await thumbs.thumbnail(secondEntry);
        currentNow += 10_000;
        const thirdPath = await thumbs.thumbnail(thirdEntry);

        expect(firstPath).not.toBeNull();
        expect(secondPath).not.toBeNull();
        expect(thirdPath).not.toBeNull();

        await vi.waitFor(() => {
            expect(
                readdirSync(cacheDir).filter((name) => {
                    return name.endsWith('.jpg');
                })
            ).toHaveLength(2);
        });
        expect(existsSync(firstPath!)).toBe(false);
        expect(existsSync(secondPath!)).toBe(true);
        expect(existsSync(thirdPath!)).toBe(true);
        expect(ffmpegRuns).toBe(3);

        await thumbs.thumbnail(secondEntry);
        expect(ffmpegRuns).toBe(3);

        currentNow += DEFAULT_THUMB_MAX_AGE_MS + 5_000;
        const regenerated = await thumbs.thumbnail(secondEntry);
        expect(regenerated).toBe(secondPath);
        expect(ffmpegRuns).toBe(4);
        await vi.waitFor(() => {
            expect(existsSync(thirdPath!)).toBe(false);
        });
        expect(existsSync(secondPath!)).toBe(true);

        await thumbs.evict(secondEntry);
        expect(existsSync(secondPath!)).toBe(false);
        thumbs.dispose();

        let timerNow = 50_000_000;
        const periodic = new ExplorerThumbnails({
            runFfmpeg: () => {
                return runFfmpeg;
            },
            cacheDirectory: cacheDir,
            previewDirectory: previewDir,
            maxAgeMs: 1_000,
            pruneIntervalMs: 15,
            now: () => {
                return timerNow;
            }
        });
        const timedPath = await periodic.thumbnail(firstEntry);
        expect(timedPath).not.toBeNull();
        expect(existsSync(timedPath!)).toBe(true);
        timerNow += 5_000;
        await vi.waitFor(() => {
            expect(existsSync(timedPath!)).toBe(false);
        });
        periodic.dispose();
    });

    it('aborts pending thumbnails on cancelPending, evicts active previews, and cleans cache and preview dirs on startup and dispose', async () => {
        mkdirSync(cacheDir, { recursive: true });
        const staleFromCrash = join(cacheDir, 'stale.jpg');
        writeFileSync(staleFromCrash, 'stale');
        expect(existsSync(staleFromCrash)).toBe(true);

        let abortCount = 0;
        let startedResolve: (() => void) | null = null;
        const started = new Promise<void>((resolve) => {
            startedResolve = resolve;
        });
        const runFfmpeg: RunFfmpeg = async ({ args, signal }) => {
            const output = args.at(-1) ?? '';
            if (output.includes('preview-')) {
                writeFileSync(output, Buffer.from([1, 2, 3, 4]));
                return { code: 0, output: '' };
            }
            if (output.includes('fast')) {
                writeFileSync(output, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
                return { code: 0, output: '' };
            }
            startedResolve?.();
            return new Promise((resolve) => {
                if (signal.aborted) {
                    abortCount += 1;
                    resolve({ code: null, output: 'aborted' });
                    return;
                }
                signal.addEventListener(
                    'abort',
                    () => {
                        abortCount += 1;
                        resolve({ code: null, output: 'aborted' });
                    },
                    { once: true }
                );
            });
        };
        const thumbs = new ExplorerThumbnails({
            runFfmpeg: () => {
                return runFfmpeg;
            },
            cacheDirectory: cacheDir,
            previewDirectory: previewDir,
            pruneIntervalMs: 0
        });
        expect(existsSync(staleFromCrash)).toBe(false);

        const pending = thumbs.thumbnail({ path: '/v/slow.mp4', kind: 'video', modifiedAt: 1, sizeBytes: 1 });
        await started;
        thumbs.cancelPending();
        expect(await pending).toBeNull();
        expect(abortCount).toBe(1);

        const previewEntry = { path: '/v/old.avi', kind: 'video' as const, modifiedAt: 10, sizeBytes: 20 };
        const preview = await thumbs.preview(previewEntry);
        expect(preview).toEqual({ ok: true, url: 'pullwave-explorer://preview/1', converted: true });
        expect(thumbs.resolvePreview(1)).toBe(join(previewDir, 'preview-1.mp4'));

        const cachedPreview = await thumbs.preview(previewEntry);
        expect(cachedPreview).toEqual({ ok: true, url: 'pullwave-explorer://preview/1', converted: true });

        await thumbs.evict(previewEntry);
        expect(thumbs.resolvePreview(1)).toBeNull();
        expect(existsSync(join(previewDir, 'preview-1.mp4'))).toBe(false);

        const nextPreview = await thumbs.preview({ path: '/a/song.wma', kind: 'audio', modifiedAt: 30, sizeBytes: 40 });
        expect(nextPreview).toEqual({ ok: true, url: 'pullwave-explorer://preview/2', converted: true });
        expect(thumbs.resolvePreview(2)).toBe(join(previewDir, 'preview-2.m4a'));

        mkdirSync(cacheDir, { recursive: true });
        writeFileSync(join(cacheDir, 'kept.jpg'), 'x');
        thumbs.dispose();
        expect(thumbs.resolvePreview(2)).toBeNull();
        expect(existsSync(previewDir)).toBe(false);
        expect(existsSync(cacheDir)).toBe(false);
    });
});
