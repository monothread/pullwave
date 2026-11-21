import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunFfmpeg } from '@main/services/cutService';
import {
    buildExplorerPreviewArgs,
    buildExplorerThumbArgs,
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
    });

    it('prunes oldest cached thumbnails when exceeding maxCacheFiles', async () => {
        mkdirSync(cacheDir, { recursive: true });
        const oldFile = join(cacheDir, 'old.jpg');
        const midFile = join(cacheDir, 'mid.jpg');
        writeFileSync(oldFile, 'a');
        writeFileSync(midFile, 'b');
        utimesSync(oldFile, 1000, 1000);
        utimesSync(midFile, 2000, 2000);

        const runFfmpeg: RunFfmpeg = async ({ args }) => {
            writeFileSync(args.at(-1) ?? '', Buffer.from([1, 2, 3]));
            return { code: 0, output: '' };
        };
        const thumbs = new ExplorerThumbnails({
            runFfmpeg: () => {
                return runFfmpeg;
            },
            cacheDirectory: cacheDir,
            previewDirectory: previewDir,
            maxCacheFiles: 2
        });

        await thumbs.thumbnail({ path: '/v/new.mp4', kind: 'video', modifiedAt: 3000, sizeBytes: 10 });
        await vi.waitFor(() => {
            expect(readdirSync(cacheDir).filter((name) => { return name.endsWith('.jpg'); })).toHaveLength(2);
        });
        expect(existsSync(oldFile)).toBe(false);
        expect(existsSync(midFile)).toBe(true);
    });

    it('aborts pending thumbnails on cancelPending and handles preview transcoding and dispose', async () => {
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
            previewDirectory: previewDir
        });

        const pending = thumbs.thumbnail({ path: '/v/slow.mp4', kind: 'video', modifiedAt: 1, sizeBytes: 1 });
        await started;
        thumbs.cancelPending();
        expect(await pending).toBeNull();
        expect(abortCount).toBe(1);

        const preview = await thumbs.preview({ path: '/v/old.avi', kind: 'video', modifiedAt: 10, sizeBytes: 20 });
        expect(preview).toEqual({ ok: true, url: 'pullwave-explorer://preview/1', converted: true });
        expect(thumbs.resolvePreview(1)).toBe(join(previewDir, 'preview-1.mp4'));

        const cachedPreview = await thumbs.preview({ path: '/v/old.avi', kind: 'video', modifiedAt: 10, sizeBytes: 20 });
        expect(cachedPreview).toEqual({ ok: true, url: 'pullwave-explorer://preview/1', converted: true });

        const nextPreview = await thumbs.preview({ path: '/a/song.wma', kind: 'audio', modifiedAt: 30, sizeBytes: 40 });
        expect(nextPreview).toEqual({ ok: true, url: 'pullwave-explorer://preview/2', converted: true });
        expect(existsSync(join(previewDir, 'preview-1.mp4'))).toBe(false);
        expect(thumbs.resolvePreview(1)).toBeNull();
        expect(thumbs.resolvePreview(2)).toBe(join(previewDir, 'preview-2.m4a'));

        thumbs.dispose();
        expect(thumbs.resolvePreview(2)).toBeNull();
        expect(existsSync(previewDir)).toBe(false);
    });
});
