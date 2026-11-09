import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FfmpegResult, FfmpegRunner } from '@main/services/audioExtractor';
import { HeaderRemover, readImageHeader, repairImageHeader } from '@main/services/imageHeaderRepair';

function chunk(type: string, size: number): Buffer {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(size, 0);
    head.write(type, 4, 'ascii');
    return Buffer.concat([head, Buffer.alloc(size, 7), Buffer.alloc(4, 0xcd)]);
}

// The picture the sources put in front of every segment: a PNG of 1x1 pixel, 70 bytes.
const PICTURE = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', 13), chunk('IDAT', 13), chunk('IEND', 0)]);
const SEGMENTS = [1, 2, 3, 4, 5].map((fill) => {
    return Buffer.concat([Buffer.from([0x47]), Buffer.alloc(1999, fill)]);
});
const VIDEO = Buffer.concat(SEGMENTS);
// What yt-dlp leaves when every segment has the picture in front of it.
const HIDDEN = Buffer.concat(
    SEGMENTS.map((segment) => {
        return Buffer.concat([PICTURE, segment]);
    })
);

const READABLE = `Input #0, mov,mp4, from 'x':
  Duration: 00:24:17.01, start: 0.000000, bitrate: 2000 kb/s
  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1920x1080
  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo, fltp`;
const READABLE_NO_AUDIO = `Input #0, mov,mp4, from 'x':
  Duration: 00:24:17.01, start: 0.000000, bitrate: 2000 kb/s
  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1920x1080`;
const UNREADABLE = 'x: Invalid data found when processing input';

let folder: string;

beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'pullwave-repair-test-'));
});

afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
});

// An ffmpeg that does what the repair asks of it: the remux copies its input to its output, and the look at the result answers what it is told.
function ffmpegWith(options: { remux?: FfmpegResult | Error; look?: string } = {}) {
    return vi.fn<FfmpegRunner>(async (args) => {
        if (args.includes('-f')) {
            if (options.remux instanceof Error) {
                throw options.remux;
            }
            const result = options.remux ?? { code: 0, stderr: '' };
            if (result.code === 0) {
                writeFileSync(args[args.length - 1] as string, readFileSync(args[args.indexOf('-i') + 1] as string));
            }
            return result;
        }
        return { code: 1, stderr: options.look ?? READABLE };
    });
}

function file(name: string, content: Buffer): string {
    const path = join(folder, name);
    writeFileSync(path, content);
    return path;
}

describe('HeaderRemover', () => {
    async function remove(parts: Buffer[]): Promise<{ output: Buffer; removed: number }> {
        const remover = new HeaderRemover(PICTURE);
        const output: Buffer[] = [];
        await pipeline(Readable.from(parts), remover, async function (source) {
            for await (const part of source) {
                output.push(part as Buffer);
            }
        });
        return { output: Buffer.concat(output), removed: remover.removed };
    }

    function pieces(bytes: Buffer, size: number): Buffer[] {
        const result: Buffer[] = [];
        for (let start = 0; start < bytes.length; start += size) {
            result.push(bytes.subarray(start, start + size));
        }
        return result;
    }

    it('takes every copy of the header out and counts them', async () => {
        const { output, removed } = await remove([HIDDEN]);

        expect(output).toEqual(VIDEO);
        expect(removed).toBe(5);
    });

    it.each([1, 3, 69, 70, 71, 1000, 4097])('does the same when the file arrives in pieces of %i byte(s), also when a copy is cut between two of them', async (size) => {
        const { output, removed } = await remove(pieces(HIDDEN, size));

        expect(output).toEqual(VIDEO);
        expect(removed).toBe(5);
    });

    it('takes out a copy that is at the very end', async () => {
        const { output, removed } = await remove([Buffer.concat([VIDEO, PICTURE])]);

        expect(output).toEqual(VIDEO);
        expect(removed).toBe(1);
    });

    it('takes out copies that follow one another', async () => {
        const { output, removed } = await remove([Buffer.concat([PICTURE, PICTURE, PICTURE, VIDEO])]);

        expect(output).toEqual(VIDEO);
        expect(removed).toBe(3);
    });

    it('leaves data that has no copy of the header as it is, and the end of a copy that is not complete', async () => {
        const partial = Buffer.concat([VIDEO, PICTURE.subarray(0, 40)]);
        const { output, removed } = await remove(pieces(partial, 7));

        expect(output).toEqual(partial);
        expect(removed).toBe(0);
    });

    it('gives nothing for nothing', async () => {
        expect(await remove([])).toEqual({ output: Buffer.alloc(0), removed: 0 });
    });
});

describe('readImageHeader', () => {
    it('gives the picture at the start of a video that is hidden behind one', () => {
        expect(readImageHeader(file('hidden.mp4', HIDDEN))).toEqual(PICTURE);
    });

    it('gives null for a video that is not hidden behind a picture', () => {
        expect(readImageHeader(file('plain.mp4', VIDEO))).toBeNull();
    });

    it('gives null for a file that is only a picture, for an empty one and for one that is not there', () => {
        expect(readImageHeader(file('picture.png', PICTURE))).toBeNull();
        expect(readImageHeader(file('empty.mp4', Buffer.alloc(0)))).toBeNull();
        expect(readImageHeader(join(folder, 'gone.mp4'))).toBeNull();
    });
});

describe('repairImageHeader', () => {
    it('leaves a video that is not hidden behind a picture as it is, without asking ffmpeg for anything', async () => {
        const path = file('plain.mp4', VIDEO);
        const run = ffmpegWith();

        expect(await repairImageHeader(path, run)).toEqual({ status: 'not-needed' });

        expect(run).not.toHaveBeenCalled();
        expect(readFileSync(path)).toEqual(VIDEO);
        expect(readdirSync(folder)).toEqual(['plain.mp4']);
    });

    it('says a file that is not there needs nothing', async () => {
        expect(await repairImageHeader(join(folder, 'gone.mp4'), ffmpegWith())).toEqual({ status: 'not-needed' });
    });

    it('takes the pictures out, puts the video in an MP4 without encoding it again, and the new file takes the place of the old one', async () => {
        const path = file('episode.mp4', HIDDEN);
        const run = ffmpegWith();

        expect(await repairImageHeader(path, run)).toEqual({ status: 'repaired', sizeBytes: VIDEO.length });

        expect(readFileSync(path)).toEqual(VIDEO);
        expect(run).toHaveBeenCalledTimes(2);
        expect(run).toHaveBeenNthCalledWith(1, [
            '-hide_banner',
            '-nostdin',
            '-y',
            '-v',
            'error',
            '-i',
            `${path}.pullwave-repair.ts`,
            '-map',
            '0:v',
            '-map',
            '0:a?',
            '-c',
            'copy',
            '-movflags',
            '+faststart',
            '-f',
            'mp4',
            `${path}.pullwave-repair.mp4`
        ]);
        expect(run).toHaveBeenNthCalledWith(2, ['-hide_banner', '-nostdin', '-i', `${path}.pullwave-repair.mp4`]);
        expect(readdirSync(folder)).toEqual(['episode.mp4']);
    });

    it('counts a video with no audio as repaired: it reads', async () => {
        const path = file('episode.mp4', HIDDEN);

        expect(await repairImageHeader(path, ffmpegWith({ look: READABLE_NO_AUDIO }))).toEqual({ status: 'repaired', sizeBytes: VIDEO.length });

        expect(readFileSync(path)).toEqual(VIDEO);
    });

    it('keeps the file as it was, and takes the temporary files away, when ffmpeg cannot make the MP4', async () => {
        const path = file('episode.mp4', HIDDEN);

        expect(await repairImageHeader(path, ffmpegWith({ remux: { code: 1, stderr: 'Invalid data' } }))).toEqual({ status: 'failed' });

        expect(readFileSync(path)).toEqual(HIDDEN);
        expect(readdirSync(folder)).toEqual(['episode.mp4']);
    });

    it('keeps the file as it was when the new one does not read as a video', async () => {
        const path = file('episode.mp4', HIDDEN);

        expect(await repairImageHeader(path, ffmpegWith({ look: UNREADABLE }))).toEqual({ status: 'failed' });

        expect(readFileSync(path)).toEqual(HIDDEN);
        expect(readdirSync(folder)).toEqual(['episode.mp4']);
    });

    it('keeps the file as it was when ffmpeg cannot be run', async () => {
        const path = file('episode.mp4', HIDDEN);

        expect(await repairImageHeader(path, ffmpegWith({ remux: new Error('spawn ffmpeg ENOENT') }))).toEqual({ status: 'failed' });

        expect(readFileSync(path)).toEqual(HIDDEN);
        expect(existsSync(`${path}.pullwave-repair.ts`)).toBe(false);
        expect(existsSync(`${path}.pullwave-repair.mp4`)).toBe(false);
    });

    it('keeps the file as it was when the pictures cannot be taken out (the folder cannot be written to)', async () => {
        const path = file('episode.mp4', HIDDEN);
        const missingFolder = join(folder, 'no', 'such', 'folder', 'episode.mp4');

        expect(await repairImageHeader(missingFolder, ffmpegWith())).toEqual({ status: 'not-needed' });
        expect(readFileSync(path)).toEqual(HIDDEN);
    });
});
