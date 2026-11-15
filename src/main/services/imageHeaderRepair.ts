import { closeSync, createReadStream, createWriteStream, openSync, readSync, renameSync, rmSync, statSync } from 'node:fs';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { probeAudio, type FfmpegRunner } from './audioExtractor';
import { imageHeaderLength, MAX_IMAGE_HEADER_BYTES } from './hidingImage';

export type RepairResult = { status: 'repaired'; sizeBytes: number } | { status: 'not-needed' } | { status: 'failed' };

const TEMP_VIDEO = '.pullwave-repair.ts';
const TEMP_RESULT = '.pullwave-repair.mp4';

export class HeaderRemover extends Transform {
    private carry: Buffer = Buffer.alloc(0);
    removed = 0;

    constructor(private readonly header: Buffer) {
        super();
    }

    override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
        const data = Buffer.concat([this.carry, chunk]);
        const kept: Buffer[] = [];
        let start = 0;
        let found = data.indexOf(this.header, start);
        while (found !== -1) {
            kept.push(data.subarray(start, found));
            start = found + this.header.length;
            this.removed += 1;
            found = data.indexOf(this.header, start);
        }
        const hold = Math.min(this.header.length - 1, data.length - start);
        kept.push(data.subarray(start, data.length - hold));
        this.carry = data.subarray(data.length - hold);
        done(null, Buffer.concat(kept));
    }

    override _flush(done: TransformCallback): void {
        done(null, this.carry);
    }
}

export function readImageHeader(path: string): Buffer | null {
    let descriptor: number | null = null;
    try {
        descriptor = openSync(path, 'r');
        const head = Buffer.alloc(Math.min(MAX_IMAGE_HEADER_BYTES, statSync(path).size));
        const read = readSync(descriptor, head, 0, head.length, 0);
        const length = imageHeaderLength(head.subarray(0, read));
        return length === null ? null : Buffer.from(head.subarray(0, length));
    } catch {
        return null;
    } finally {
        if (descriptor !== null) {
            closeSync(descriptor);
        }
    }
}

export async function repairImageHeader(path: string, run: FfmpegRunner): Promise<RepairResult> {
    const header = readImageHeader(path);
    if (header === null) {
        return { status: 'not-needed' };
    }
    const joined = `${path}${TEMP_VIDEO}`;
    const result = `${path}${TEMP_RESULT}`;
    try {
        await pipeline(createReadStream(path), new HeaderRemover(header), createWriteStream(joined));
        const remux = await run(['-hide_banner', '-nostdin', '-y', '-v', 'error', '-i', joined, '-map', '0:v', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', result]);
        if (remux.code !== 0) {
            return { status: 'failed' };
        }
        const probe = await probeAudio(result, run);
        if (!probe.ok && probe.reason !== 'no-audio') {
            return { status: 'failed' };
        }
        renameSync(result, path);
        return { status: 'repaired', sizeBytes: statSync(path).size };
    } catch {
        return { status: 'failed' };
    } finally {
        rmSync(joined, { force: true });
        rmSync(result, { force: true });
    }
}
