import { createHash } from 'node:crypto';
import { createWriteStream, rmSync, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// A download that sends nothing for this long is given up.
export const IDLE_TIMEOUT_MS = 30_000;
// The archive may be this much larger than the size the publisher lists before it is refused.
export const SIZE_TOLERANCE = 1.1;

export class ToolDownloadError extends Error {}

export interface DownloadProgress {
    bytesDone: number;
    bytesTotal: number;
}

export interface DownloadOptions {
    url: string;
    destination: string;
    // The size the publisher lists: the transfer stops if it goes well past it.
    expectedBytes: number;
    onProgress?: (progress: DownloadProgress) => void;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    idleTimeoutMs?: number;
}

export interface DownloadResult {
    sha256: string;
    bytes: number;
}

function ignore(): void {
    return undefined;
}

function writeChunk(stream: WriteStream, chunk: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
        stream.write(chunk, (error) => {
            if (error === null || error === undefined) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}

function endStream(stream: WriteStream): Promise<void> {
    return new Promise((resolve, reject) => {
        stream.end((error?: Error | null) => {
            if (error === null || error === undefined) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}

// Downloads a file to the disk, hashing it as it arrives. Only https; the file is deleted if anything goes wrong.
export async function downloadFile(options: DownloadOptions): Promise<DownloadResult> {
    const { url, destination, expectedBytes, onProgress, signal, fetchImpl = fetch, idleTimeoutMs = IDLE_TIMEOUT_MS } = options;
    if (!url.startsWith('https://')) {
        throw new ToolDownloadError('Only https addresses can be downloaded');
    }
    await mkdir(dirname(destination), { recursive: true });
    const idle = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const restartTimer = (): void => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            idle.abort();
        }, idleTimeoutMs);
    };
    const combined = signal === undefined ? idle.signal : AbortSignal.any([signal, idle.signal]);
    const hash = createHash('sha256');
    let file: WriteStream | null = null;
    try {
        restartTimer();
        const response = await fetchImpl(url, { signal: combined, redirect: 'follow' });
        if (!response.ok || response.body === null) {
            throw new ToolDownloadError(`The server answered ${response.status}`);
        }
        // The file is only opened once there is something worth keeping; the errors of the stream come back through the writes.
        const output = createWriteStream(destination);
        output.on('error', ignore);
        file = output;
        const headerLength = Number(response.headers.get('content-length'));
        const bytesTotal = Number.isFinite(headerLength) && headerLength > 0 ? headerLength : expectedBytes;
        const limit = Math.ceil(expectedBytes * SIZE_TOLERANCE);
        let bytesDone = 0;
        const reader = response.body.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            restartTimer();
            bytesDone += value.byteLength;
            if (bytesDone > limit) {
                await reader.cancel();
                throw new ToolDownloadError('The download is larger than expected');
            }
            hash.update(value);
            await writeChunk(output, value);
            onProgress?.({ bytesDone, bytesTotal });
        }
        await endStream(output);
        return { sha256: hash.digest('hex'), bytes: bytesDone };
    } catch (error) {
        file?.destroy();
        rmSync(destination, { force: true });
        if (error instanceof ToolDownloadError) {
            throw error;
        }
        if (signal?.aborted === true) {
            throw error;
        }
        throw new ToolDownloadError(idle.signal.aborted ? 'The download stopped receiving data' : error instanceof Error ? error.message : String(error));
    } finally {
        clearTimeout(timer);
    }
}
