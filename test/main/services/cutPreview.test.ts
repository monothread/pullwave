import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CutMedia, CutPreviewRequest } from '@shared/cut';
import {
    THUMBNAIL_AT,
    THUMBNAIL_WIDTH,
    CutPreview,
    buildPreviewArgs,
    buildThumbnailArgs,
    createCutMediaHandler,
    cutMediaUrl,
    parseCutMediaUrl
} from '@main/services/cutPreview';
import type { FfmpegOutcome, FfmpegRun, RunFfmpeg } from '@main/services/cutService';
import type { ByteRange, MediaFileSystem } from '@main/services/mediaProtocol';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

const DIRECTORY = '/data/cut-preview';
const VIDEO: CutMedia = { path: '/videos/clip.mkv', name: 'clip', extension: '.mkv', kind: 'video', durationSeconds: 120 };
const AUDIO: CutMedia = { path: '/music/song.flac', name: 'song', extension: '.flac', kind: 'audio', durationSeconds: 200 };
const SEGMENT = { start: 10, end: 25.5 };

interface Deferred {
    resolve: (outcome: FfmpegOutcome) => void;
}

// A preview with ffmpeg replaced: each run answers `outcome`, or waits for the test when `hold` is set.
function setup(options: { ffmpeg?: boolean; outcome?: FfmpegOutcome; hold?: boolean } = {}) {
    const runs: FfmpegRun[] = [];
    const held: Deferred[] = [];
    const run = vi.fn((request: FfmpegRun): Promise<FfmpegOutcome> => {
        runs.push(request);
        if (options.hold === true) {
            return new Promise((resolve) => {
                held.push({ resolve });
            });
        }
        return Promise.resolve(options.outcome ?? { code: 0, output: '' });
    });
    const runFfmpeg = vi.fn((): RunFfmpeg | null => {
        return options.ffmpeg === false ? null : run;
    });
    const makeDirectory = vi.fn();
    const removeDirectory = vi.fn();
    const preview = new CutPreview({ runFfmpeg, directory: DIRECTORY, makeDirectory, removeDirectory });
    return { preview, run, runs, held, runFfmpeg, makeDirectory, removeDirectory };
}

describe('the constants of the preview', () => {
    it('makes pictures 320 wide, from a tenth of a video', () => {
        expect(THUMBNAIL_WIDTH).toBe(320);
        expect(THUMBNAIL_AT).toBe(0.1);
    });
});

describe('cutMediaUrl and parseCutMediaUrl', () => {
    it.each([
        ['media', 1, 'pullwave-cut://media/1'],
        ['preview', 7, 'pullwave-cut://preview/7'],
        ['thumbnail', 42, 'pullwave-cut://thumbnail/42']
    ] as const)('writes and reads the address of the %s %d', (route, id, url) => {
        expect(cutMediaUrl(route, id)).toBe(url);
        expect(parseCutMediaUrl(url)).toEqual({ route, id });
    });

    it.each([
        ['not an address', 'not a url'],
        ['another scheme', 'pullwave-media://media/1'],
        ['another route', 'pullwave-cut://file/1'],
        ['no number', 'pullwave-cut://media/'],
        ['a word for a number', 'pullwave-cut://media/abc'],
        ['a negative number', 'pullwave-cut://media/-1'],
        ['more after the number', 'pullwave-cut://media/1/2'],
        ['a path', 'pullwave-cut://media/%2Fetc%2Fpasswd'],
        ['a way up', 'pullwave-cut://media/../etc/passwd']
    ])('rejects %s', (_what, url) => {
        expect(parseCutMediaUrl(url)).toBeNull();
    });
});

describe('buildThumbnailArgs', () => {
    it('takes a frame of a video at a tenth of its length, 320 wide', () => {
        expect(buildThumbnailArgs(VIDEO, '/out/t.jpg')).toEqual([
            '-hide_banner', '-nostdin', '-y', '-v', 'error',
            '-ss', '12',
            '-i', '/videos/clip.mkv',
            '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4',
            '/out/t.jpg'
        ]);
    });

    it('rounds the moment of the frame to the thousandth', () => {
        expect(buildThumbnailArgs({ ...VIDEO, durationSeconds: 10.12345 }, '/out/t.jpg').slice(5, 7)).toEqual(['-ss', '1.012']);
    });

    it('takes the cover an audio carries, with no seek', () => {
        expect(buildThumbnailArgs(AUDIO, '/out/t.jpg')).toEqual([
            '-hide_banner', '-nostdin', '-y', '-v', 'error',
            '-i', '/music/song.flac',
            '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4',
            '/out/t.jpg'
        ]);
    });
});

describe('buildPreviewArgs', () => {
    it('makes a part of a video into H.264 and AAC, quickly', () => {
        expect(buildPreviewArgs(VIDEO, SEGMENT, '/out/p.mp4')).toEqual([
            '-hide_banner', '-nostdin', '-y', '-v', 'error',
            '-ss', '10', '-i', '/videos/clip.mkv', '-t', '15.5',
            '-map', '0:v:0', '-map', '0:a:0?',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
            '/out/p.mp4'
        ]);
    });

    it('makes a part of an audio into AAC with no picture', () => {
        expect(buildPreviewArgs(AUDIO, { start: 0.25, end: 1.1 }, '/out/p.m4a')).toEqual([
            '-hide_banner', '-nostdin', '-y', '-v', 'error',
            '-ss', '0.25', '-i', '/music/song.flac', '-t', '0.85',
            '-vn', '-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k',
            '/out/p.m4a'
        ]);
    });
});

describe('CutPreview', () => {
    describe('when it is made', () => {
        it('removes what a run before left behind, and nothing else', () => {
            const { removeDirectory, makeDirectory, runFfmpeg } = setup();
            expect(removeDirectory).toHaveBeenCalledTimes(1);
            expect(removeDirectory).toHaveBeenCalledWith(DIRECTORY);
            expect(makeDirectory).not.toHaveBeenCalled();
            expect(runFfmpeg).not.toHaveBeenCalled();
        });
    });

    describe('resolve', () => {
        it('serves the file chosen by its number, and nothing before one is chosen', () => {
            const { preview } = setup();
            expect(preview.resolve('media', 1)).toBeNull();
            preview.select(VIDEO);
            expect(preview.resolve('media', 1)).toBe('/videos/clip.mkv');
            expect(preview.resolve('media', 2)).toBeNull();
            expect(preview.resolve('preview', 1)).toBeNull();
            expect(preview.resolve('thumbnail', 1)).toBeNull();
        });

        it('stops serving the file before once another is chosen', () => {
            const { preview, removeDirectory } = setup();
            preview.select(VIDEO);
            preview.select(AUDIO);
            expect(preview.resolve('media', 1)).toBeNull();
            expect(preview.resolve('media', 2)).toBe('/music/song.flac');
            expect(removeDirectory).toHaveBeenCalledTimes(3);
        });

        it('stops serving anything once cleared', () => {
            const { preview, removeDirectory } = setup();
            preview.select(VIDEO);
            preview.clear();
            expect(preview.resolve('media', 1)).toBeNull();
            expect(removeDirectory).toHaveBeenCalledTimes(3);
            expect(removeDirectory).toHaveBeenLastCalledWith(DIRECTORY);
        });
    });

    describe('thumbnail', () => {
        it('is null with no file chosen, without starting ffmpeg', async () => {
            const { preview, runFfmpeg } = setup();
            await expect(preview.thumbnail()).resolves.toBeNull();
            expect(runFfmpeg).not.toHaveBeenCalled();
        });

        it('is null when ffmpeg cannot be started', async () => {
            const { preview, makeDirectory } = setup({ ffmpeg: false });
            preview.select(VIDEO);
            await expect(preview.thumbnail()).resolves.toBeNull();
            expect(makeDirectory).not.toHaveBeenCalled();
        });

        it('makes the picture in its folder and serves it by its address', async () => {
            const { preview, runs, makeDirectory } = setup();
            preview.select(VIDEO);
            await expect(preview.thumbnail()).resolves.toBe('pullwave-cut://thumbnail/2');
            expect(makeDirectory).toHaveBeenCalledWith(DIRECTORY);
            expect(runs).toEqual([{ args: buildThumbnailArgs(VIDEO, join(DIRECTORY, 'thumbnail-2.jpg')), signal: expect.any(AbortSignal) }]);
            expect(preview.resolve('thumbnail', 2)).toBe(join(DIRECTORY, 'thumbnail-2.jpg'));
        });

        it('is made once for the same file', async () => {
            const { preview, run } = setup();
            preview.select(VIDEO);
            const first = preview.thumbnail();
            const second = preview.thumbnail();
            expect(second).toBe(first);
            await expect(second).resolves.toBe('pullwave-cut://thumbnail/2');
            expect(run).toHaveBeenCalledTimes(1);
        });

        it('is null when ffmpeg fails (an audio with no cover)', async () => {
            const { preview } = setup({ outcome: { code: 1, output: 'Stream map 0:v:0 matches no streams' } });
            preview.select(AUDIO);
            await expect(preview.thumbnail()).resolves.toBeNull();
            expect(preview.resolve('thumbnail', 2)).toBeNull();
        });

        it('is null when another file was chosen while it was made', async () => {
            const { preview, held } = setup({ hold: true });
            preview.select(VIDEO);
            const pending = preview.thumbnail();
            preview.select(AUDIO);
            held[0]?.resolve({ code: 0, output: '' });
            await expect(pending).resolves.toBeNull();
            expect(preview.resolve('thumbnail', 2)).toBeNull();
        });

        it('is made again for the next file', async () => {
            const { preview, run } = setup();
            preview.select(VIDEO);
            await preview.thumbnail();
            preview.select(AUDIO);
            await expect(preview.thumbnail()).resolves.toBe('pullwave-cut://thumbnail/4');
            expect(run).toHaveBeenCalledTimes(2);
            expect(preview.resolve('thumbnail', 2)).toBeNull();
        });
    });

    describe('preview', () => {
        const PLAY: CutPreviewRequest = { segment: SEGMENT, convert: false };
        const CONVERT: CutPreviewRequest = { segment: SEGMENT, convert: true };

        it('says there is no file before one is chosen', async () => {
            const { preview } = setup();
            await expect(preview.preview(PLAY)).resolves.toEqual({ ok: false, reason: 'no-file' });
        });

        it.each([
            ['no request', undefined],
            ['no part', { convert: false }],
            ['a start that is not a number', { segment: { start: '1', end: 5 }, convert: false }],
            ['an end that is not finite', { segment: { start: 1, end: Infinity }, convert: false }],
            ['a start before the file', { segment: { start: -1, end: 5 }, convert: false }],
            ['an end before the start', { segment: { start: 5, end: 5 }, convert: false }],
            ['an end after the file', { segment: { start: 5, end: 120.6 }, convert: false }]
        ])('rejects %s', async (_what, request) => {
            const { preview, runFfmpeg } = setup();
            preview.select(VIDEO);
            await expect(preview.preview(request as CutPreviewRequest)).resolves.toEqual({ ok: false, reason: 'invalid' });
            expect(runFfmpeg).not.toHaveBeenCalled();
        });

        it('takes an end that ffmpeg rounded a little past the file', async () => {
            const { preview } = setup();
            preview.select(VIDEO);
            await expect(preview.preview({ segment: { start: 100, end: 120.5 }, convert: false })).resolves.toEqual({ ok: true, url: 'pullwave-cut://media/1', start: 100, end: 120.5, converted: false });
        });

        it('plays the file itself from the start to the end of the part, without ffmpeg', async () => {
            const { preview, runFfmpeg } = setup();
            preview.select(VIDEO);
            await expect(preview.preview(PLAY)).resolves.toEqual({ ok: true, url: 'pullwave-cut://media/1', start: 10, end: 25.5, converted: false });
            expect(runFfmpeg).not.toHaveBeenCalled();
        });

        it('makes the part of a video into a file the player plays, which plays from its start', async () => {
            const { preview, runs, makeDirectory } = setup();
            preview.select(VIDEO);
            await expect(preview.preview(CONVERT)).resolves.toEqual({ ok: true, url: 'pullwave-cut://preview/2', start: 0, end: 15.5, converted: true });
            expect(makeDirectory).toHaveBeenCalledWith(DIRECTORY);
            expect(runs).toEqual([{ args: buildPreviewArgs(VIDEO, SEGMENT, join(DIRECTORY, 'preview-2.mp4')), signal: expect.any(AbortSignal) }]);
            expect(preview.resolve('preview', 2)).toBe(join(DIRECTORY, 'preview-2.mp4'));
        });

        it('makes the part of an audio into an M4A', async () => {
            const { preview, runs } = setup();
            preview.select(AUDIO);
            await expect(preview.preview(CONVERT)).resolves.toEqual({ ok: true, url: 'pullwave-cut://preview/2', start: 0, end: 15.5, converted: true });
            expect(runs[0]?.args).toEqual(buildPreviewArgs(AUDIO, SEGMENT, join(DIRECTORY, 'preview-2.m4a')));
        });

        it('says ffmpeg is missing when it cannot be found', async () => {
            const { preview } = setup({ ffmpeg: false });
            preview.select(VIDEO);
            await expect(preview.preview(CONVERT)).resolves.toEqual({ ok: false, reason: 'no-ffmpeg' });
        });

        it('says ffmpeg is missing when it could not be started', async () => {
            const { preview } = setup({ outcome: { code: null, output: 'spawn ENOENT' } });
            preview.select(VIDEO);
            await expect(preview.preview(CONVERT)).resolves.toEqual({ ok: false, reason: 'no-ffmpeg' });
        });

        it('says it failed when ffmpeg ends with an error, and serves nothing', async () => {
            const { preview } = setup({ outcome: { code: 1, output: 'Invalid data' } });
            preview.select(VIDEO);
            await expect(preview.preview(CONVERT)).resolves.toEqual({ ok: false, reason: 'failed' });
            expect(preview.resolve('preview', 2)).toBeNull();
        });

        it('ends the conversion before when another one starts', async () => {
            const { preview, runs, held } = setup({ hold: true });
            preview.select(VIDEO);
            const first = preview.preview(CONVERT);
            const second = preview.preview({ segment: { start: 30, end: 40 }, convert: true });
            expect(runs[0]?.signal.aborted).toBe(true);
            expect(runs[1]?.signal.aborted).toBe(false);
            held[0]?.resolve({ code: null, output: '' });
            held[1]?.resolve({ code: 0, output: '' });
            await expect(first).resolves.toEqual({ ok: false, reason: 'cancelled' });
            await expect(second).resolves.toEqual({ ok: true, url: 'pullwave-cut://preview/3', start: 0, end: 10, converted: true });
        });

        it.each([
            ['another file is chosen', (preview: CutPreview) => { preview.select(AUDIO); }],
            ['the cutter is cleared', (preview: CutPreview) => { preview.clear(); }],
            ['the app ends', (preview: CutPreview) => { preview.dispose(); }]
        ])('ends the conversion when %s', async (_when, stop) => {
            const { preview, runs, held } = setup({ hold: true });
            preview.select(VIDEO);
            const pending = preview.preview(CONVERT);
            stop(preview);
            expect(runs[0]?.signal.aborted).toBe(true);
            held[0]?.resolve({ code: 0, output: '' });
            await expect(pending).resolves.toEqual({ ok: false, reason: 'cancelled' });
            expect(preview.resolve('preview', 2)).toBeNull();
        });
    });

    describe('dispose', () => {
        it('removes the files made and stops serving them', async () => {
            const { preview, removeDirectory } = setup();
            preview.select(VIDEO);
            await preview.preview({ segment: SEGMENT, convert: true });
            preview.dispose();
            expect(preview.resolve('preview', 2)).toBeNull();
            expect(removeDirectory).toHaveBeenCalledTimes(3);
            expect(removeDirectory).toHaveBeenLastCalledWith(DIRECTORY);
        });
    });

    describe('with the real disk', () => {
        it('removes the folder of a run before as it starts, and makes it again for a picture', async () => {
            const root = makeTempDir();
            const directory = join(root, 'cut-preview');
            mkdirSync(directory);
            writeFileSync(join(directory, 'preview-9.mp4'), 'old');
            const run = vi.fn(async (): Promise<FfmpegOutcome> => {
                return { code: 0, output: '' };
            });
            const preview = new CutPreview({
                runFfmpeg: () => {
                    return run;
                },
                directory
            });
            expect(existsSync(directory)).toBe(false);
            preview.select(VIDEO);
            await preview.thumbnail();
            expect(existsSync(directory)).toBe(true);
            preview.clear();
            expect(existsSync(directory)).toBe(false);
        });
    });
});

describe('createCutMediaHandler', () => {
    const CONTENT = '0123456789';

    function handlerSetup(path: string | null) {
        const resolve = vi.fn((): string | null => {
            return path;
        });
        const files: MediaFileSystem = {
            size: vi.fn(() => {
                return CONTENT.length;
            }),
            read: vi.fn((_path: string, range: ByteRange): ReadableStream<Uint8Array> => {
                return new Response(CONTENT.slice(range.start, range.end + 1)).body as ReadableStream<Uint8Array>;
            })
        };
        return { handler: createCutMediaHandler({ resolve }, files), resolve, files };
    }

    it('serves the file of an address, with ranges', async () => {
        const { handler, resolve, files } = handlerSetup('/videos/clip.mkv');
        const response = handler(new Request('pullwave-cut://media/1', { headers: { Range: 'bytes=0-3' } }));
        expect(response.status).toBe(206);
        expect(Object.fromEntries(response.headers)).toEqual({
            'accept-ranges': 'bytes',
            'access-control-allow-origin': '*',
            'content-length': '4',
            'content-range': 'bytes 0-3/10',
            'content-type': 'video/x-matroska'
        });
        expect(await response.text()).toBe('0123');
        expect(resolve).toHaveBeenCalledWith('media', 1);
        expect(files.read).toHaveBeenCalledWith('/videos/clip.mkv', { start: 0, end: 3 });
    });

    it('serves a picture whole', async () => {
        const { handler, resolve } = handlerSetup('/data/cut-preview/thumbnail-2.jpg');
        const response = handler(new Request('pullwave-cut://thumbnail/2'));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/jpeg');
        expect(await response.text()).toBe(CONTENT);
        expect(resolve).toHaveBeenCalledWith('thumbnail', 2);
    });

    it('answers 404 for a number it does not serve', () => {
        const { handler, files } = handlerSetup(null);
        expect(handler(new Request('pullwave-cut://preview/5')).status).toBe(404);
        expect(files.size).not.toHaveBeenCalled();
    });

    it('answers 404 to an address it does not understand without looking anything up', () => {
        const { handler, resolve } = handlerSetup('/videos/clip.mkv');
        expect(handler(new Request('pullwave-cut://file/%2Fetc%2Fpasswd')).status).toBe(404);
        expect(handler(new Request('pullwave-cut://media/abc')).status).toBe(404);
        expect(resolve).not.toHaveBeenCalled();
    });
});
