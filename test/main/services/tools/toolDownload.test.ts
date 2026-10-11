import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { downloadFile, SIZE_TOLERANCE, ToolDownloadError, type DownloadProgress } from '@main/services/tools/toolDownload';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';

const URL_OK = 'https://example.com/tool.tar.gz';

function sha256(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
}

function streamOf(chunks: Buffer[], headers: Record<string, string> = {}, status = 200): Response {
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            chunks.forEach((chunk) => {
                controller.enqueue(chunk);
            });
            controller.close();
        }
    });
    return new Response(body, { status, headers });
}

function fetchReturning(response: Response | Error): { fetchImpl: typeof fetch; calls: Array<{ url: string; init: RequestInit | undefined }> } {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    });
    return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

afterEach(() => {
    cleanTempDirs();
    vi.useRealTimers();
});

describe('downloadFile', () => {
    it('writes the file, returns its checksum and size and reports the progress', async () => {
        const dir = makeTempDir();
        const destination = join(dir, 'sub', 'tool.part');
        const chunks = [Buffer.from('hello '), Buffer.from('world')];
        const progress: DownloadProgress[] = [];
        const { fetchImpl, calls } = fetchReturning(streamOf(chunks, { 'content-length': '11' }));
        const result = await downloadFile({ url: URL_OK, destination, expectedBytes: 11, fetchImpl, onProgress: (value) => {
            progress.push(value);
        } });
        expect(result).toEqual({ sha256: sha256(Buffer.from('hello world')), bytes: 11 });
        expect(readFileSync(destination, 'utf-8')).toBe('hello world');
        expect(progress).toEqual([
            { bytesDone: 6, bytesTotal: 11 },
            { bytesDone: 11, bytesTotal: 11 }
        ]);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe(URL_OK);
        expect(calls[0]?.init).toMatchObject({ redirect: 'follow' });
    });

    it('uses the size the publisher lists when the server does not tell the length', async () => {
        const dir = makeTempDir();
        const progress: DownloadProgress[] = [];
        const { fetchImpl } = fetchReturning(streamOf([Buffer.from('abc')]));
        await downloadFile({ url: URL_OK, destination: join(dir, 'f'), expectedBytes: 3, fetchImpl, onProgress: (value) => {
            progress.push(value);
        } });
        expect(progress).toEqual([{ bytesDone: 3, bytesTotal: 3 }]);
    });

    it('refuses an address that is not https without asking the network', async () => {
        const dir = makeTempDir();
        const { fetchImpl, calls } = fetchReturning(streamOf([]));
        await expect(downloadFile({ url: 'http://example.com/x', destination: join(dir, 'f'), expectedBytes: 1, fetchImpl })).rejects.toThrow('Only https addresses can be downloaded');
        expect(calls).toHaveLength(0);
    });

    it('fails and leaves no file when the server answers with an error', async () => {
        const dir = makeTempDir();
        const destination = join(dir, 'f');
        const { fetchImpl } = fetchReturning(streamOf([Buffer.from('x')], {}, 404));
        await expect(downloadFile({ url: URL_OK, destination, expectedBytes: 1, fetchImpl })).rejects.toThrow('The server answered 404');
        expect(existsSync(destination)).toBe(false);
    });

    it('fails and leaves no file when the download is larger than listed', async () => {
        const dir = makeTempDir();
        const destination = join(dir, 'f');
        const big = Buffer.alloc(Math.ceil(10 * SIZE_TOLERANCE) + 1, 1);
        const { fetchImpl } = fetchReturning(streamOf([big]));
        await expect(downloadFile({ url: URL_OK, destination, expectedBytes: 10, fetchImpl })).rejects.toThrow('The download is larger than expected');
        expect(existsSync(destination)).toBe(false);
    });

    it('turns a network failure into a download error and leaves no file', async () => {
        const dir = makeTempDir();
        const destination = join(dir, 'f');
        const { fetchImpl } = fetchReturning(new Error('ECONNRESET'));
        const failure = await downloadFile({ url: URL_OK, destination, expectedBytes: 1, fetchImpl }).catch((error: unknown) => {
            return error;
        });
        expect(failure).toBeInstanceOf(ToolDownloadError);
        expect(failure).toMatchObject({ message: 'ECONNRESET' });
        expect(existsSync(destination)).toBe(false);
    });

    it('gives up when nothing arrives for too long', async () => {
        vi.useFakeTimers();
        const dir = makeTempDir();
        const destination = join(dir, 'f');
        // A real fetch ends the body of the answer when its signal is aborted.
        const fetchImpl = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    init?.signal?.addEventListener('abort', () => {
                        controller.error(new Error('aborted'));
                    });
                }
            });
            return Promise.resolve(new Response(body, { status: 200 }));
        }) as unknown as typeof fetch;
        let outcome: unknown = null;
        downloadFile({ url: URL_OK, destination, expectedBytes: 1, fetchImpl, idleTimeoutMs: 1000 }).catch((error: unknown) => {
            outcome = error;
        });
        // The folder is made with real file system calls, so the timer starts a moment after the call: time goes on until it fires.
        await vi.waitFor(
            async () => {
                await vi.advanceTimersByTimeAsync(1100);
                expect(outcome).toBeInstanceOf(ToolDownloadError);
            },
            { timeout: 3000, interval: 20 }
        );
        expect(outcome).toMatchObject({ message: 'The download stopped receiving data' });
        expect(existsSync(destination)).toBe(false);
    });

    it('passes on the abort of the caller as it is and leaves no file', async () => {
        const dir = makeTempDir();
        const destination = join(dir, 'f');
        const controller = new AbortController();
        const abortError = new DOMException('aborted', 'AbortError');
        const fetchImpl = vi.fn(() => {
            controller.abort();
            return Promise.reject(abortError);
        }) as unknown as typeof fetch;
        await expect(downloadFile({ url: URL_OK, destination, expectedBytes: 1, fetchImpl, signal: controller.signal })).rejects.toBe(abortError);
        expect(existsSync(destination)).toBe(false);
    });
});
