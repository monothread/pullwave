import { LogHub, processLogs } from '@main/services/logHub';
import { STREAM_USER_AGENT } from '@main/services/streamProxy';
import { MAX_THUMBNAIL_BYTES, MAX_THUMBNAILS, parseThumbnailAddress, THUMBNAIL_TIMEOUT_MS, VideoThumbnails } from '@main/services/videoThumbnails';

const ADDRESS = 'https://i.ytimg.com/vi/abc/maxresdefault.jpg';
const PICTURE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function picture(bytes: Uint8Array = PICTURE, headers: Record<string, string> = { 'Content-Type': 'image/jpeg' }, status = 200): Response {
    return new Response(new Uint8Array(bytes), { status, headers });
}

function setup(answer: () => Promise<Response> | Response = () => {
    return picture();
}, options: { maxBytes?: number; maxPictures?: number; timeoutMs?: number } = {}) {
    const fetchImpl = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(() => {
        return Promise.resolve(answer());
    });
    const writes: Array<[string, string, string]> = [];
    const log = {
        write: (source: Parameters<LogHub['write']>[0], stream: Parameters<LogHub['write']>[1], text: string) => {
            writes.push([source, stream, text]);
        }
    };
    const thumbnails = new VideoThumbnails({ fetchImpl: fetchImpl as unknown as typeof fetch, log, ...options });
    return { thumbnails, fetchImpl, writes };
}

async function bytesOf(response: Response): Promise<number[]> {
    return Array.from(new Uint8Array(await response.arrayBuffer()));
}

describe('constants', () => {
    it('keeps pictures of up to 5 MB, waits 15 s for one, and keeps at most 50', () => {
        expect(MAX_THUMBNAIL_BYTES).toBe(5 * 1024 * 1024);
        expect(THUMBNAIL_TIMEOUT_MS).toBe(15000);
        expect(MAX_THUMBNAILS).toBe(50);
    });
});

describe('parseThumbnailAddress', () => {
    it('gives the download of an address of a picture', () => {
        expect(parseThumbnailAddress('pullwave-thumb://job/job-1?v=3')).toBe('job-1');
        expect(parseThumbnailAddress('pullwave-thumb://job/a%20b')).toBe('a b');
    });

    it('gives null for any other address', () => {
        expect(parseThumbnailAddress('pullwave-thumb://job/')).toBeNull();
        expect(parseThumbnailAddress('pullwave-thumb://other/job-1')).toBeNull();
        expect(parseThumbnailAddress('pullwave-cut://job/job-1')).toBeNull();
        expect(parseThumbnailAddress('https://job/job-1')).toBeNull();
        expect(parseThumbnailAddress('not an address')).toBeNull();
    });
});

describe('VideoThumbnails.load', () => {
    it('fetches the picture as a browser, keeps it, and gives the address the window shows it at', async () => {
        const { thumbnails, fetchImpl, writes } = setup();
        await expect(thumbnails.load('job-1', ADDRESS)).resolves.toBe('pullwave-thumb://job/job-1?v=1');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [input, init] = fetchImpl.mock.calls[0] ?? [];
        expect(input).toBe(ADDRESS);
        expect(init?.headers).toEqual({ 'User-Agent': STREAM_USER_AGENT, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' });
        expect(init?.redirect).toBe('follow');
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        expect(writes).toEqual([]);
        const response = thumbnails.respond('pullwave-thumb://job/job-1?v=1');
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('image/jpeg');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await bytesOf(response)).toEqual(Array.from(PICTURE));
    });

    it('gives a new address each time, so the window does not show a picture it had before', async () => {
        const { thumbnails } = setup();
        await expect(thumbnails.load('job-1', ADDRESS)).resolves.toBe('pullwave-thumb://job/job-1?v=1');
        await expect(thumbnails.load('job-2', ADDRESS)).resolves.toBe('pullwave-thumb://job/job-2?v=2');
        await expect(thumbnails.load('job-1', ADDRESS)).resolves.toBe('pullwave-thumb://job/job-1?v=3');
    });

    it('keeps the kind of the picture without its parameters', async () => {
        const { thumbnails } = setup(() => {
            return picture(PICTURE, { 'Content-Type': 'Image/WebP; charset=binary' });
        });
        await thumbnails.load('job-1', ADDRESS);
        expect(thumbnails.respond('pullwave-thumb://job/job-1').headers.get('Content-Type')).toBe('image/webp');
    });

    it.each(['image/png', 'image/gif', 'image/avif'])('keeps a picture of kind %s', async (type) => {
        const { thumbnails } = setup(() => {
            return picture(PICTURE, { 'Content-Type': type });
        });
        await expect(thumbnails.load('job-1', ADDRESS)).resolves.toBe('pullwave-thumb://job/job-1?v=1');
    });

    it('refuses an answer that is not ok, and tells the log of yt-dlp why', async () => {
        const { thumbnails, writes } = setup(() => {
            return picture(PICTURE, { 'Content-Type': 'image/jpeg' }, 403);
        });
        await expect(thumbnails.load('job-1', ADDRESS)).resolves.toBeNull();
        expect(writes).toEqual([['yt-dlp', 'event', `the picture of the video could not be fetched (HTTP 403): ${ADDRESS}`]]);
        expect(thumbnails.respond('pullwave-thumb://job/job-1').status).toBe(404);
    });

    it('refuses what is not a picture, with or without a kind', async () => {
        const html = setup(() => {
            return picture(PICTURE, { 'Content-Type': 'text/html' });
        });
        await expect(html.thumbnails.load('job-1', ADDRESS)).resolves.toBeNull();
        expect(html.writes).toEqual([['yt-dlp', 'event', `the picture of the video could not be fetched (not a picture: text/html): ${ADDRESS}`]]);
        const svg = setup(() => {
            return picture(PICTURE, { 'Content-Type': 'image/svg+xml' });
        });
        await expect(svg.thumbnails.load('job-1', ADDRESS)).resolves.toBeNull();
        const none = setup(() => {
            return new Response(new Uint8Array(PICTURE), { status: 200, headers: {} });
        });
        await expect(none.thumbnails.load('job-1', ADDRESS)).resolves.toBeNull();
        expect(none.writes).toEqual([['yt-dlp', 'event', `the picture of the video could not be fetched (not a picture: no type): ${ADDRESS}`]]);
    });

    it('refuses a picture whose announced size is past the limit, without reading it', async () => {
        const { thumbnails, writes } = setup(
            () => {
                return picture(new Uint8Array(4), { 'Content-Type': 'image/jpeg', 'Content-Length': '11' });
            },
            { maxBytes: 10 }
        );
        await expect(thumbnails.load('job-1', ADDRESS)).resolves.toBeNull();
        expect(writes).toEqual([['yt-dlp', 'event', `the picture of the video could not be fetched (too large (11 bytes)): ${ADDRESS}`]]);
    });

    it('stops reading a picture that grows past the limit when its size was not announced', async () => {
        const stream = new ReadableStream<Uint8Array>({
            start: (controller) => {
                controller.enqueue(new Uint8Array(6));
                controller.enqueue(new Uint8Array(6));
                controller.close();
            }
        });
        const { thumbnails, writes } = setup(
            () => {
                return new Response(stream, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
            },
            { maxBytes: 10 }
        );
        await expect(thumbnails.load('job-1', ADDRESS)).resolves.toBeNull();
        expect(writes).toEqual([['yt-dlp', 'event', `the picture of the video could not be fetched (too large (more than 10 bytes)): ${ADDRESS}`]]);
    });

    it('keeps a picture read in pieces whole, at the exact limit', async () => {
        const stream = new ReadableStream<Uint8Array>({
            start: (controller) => {
                controller.enqueue(new Uint8Array([1, 2, 3]));
                controller.enqueue(new Uint8Array([4, 5]));
                controller.close();
            }
        });
        const { thumbnails } = setup(
            () => {
                return new Response(stream, { status: 200, headers: { 'Content-Type': 'image/png' } });
            },
            { maxBytes: 5 }
        );
        await thumbnails.load('job-1', ADDRESS);
        expect(await bytesOf(thumbnails.respond('pullwave-thumb://job/job-1'))).toEqual([1, 2, 3, 4, 5]);
    });

    it('refuses an empty picture', async () => {
        const { thumbnails, writes } = setup(() => {
            return picture(new Uint8Array(0));
        });
        await expect(thumbnails.load('job-1', ADDRESS)).resolves.toBeNull();
        expect(writes).toEqual([['yt-dlp', 'event', `the picture of the video could not be fetched (empty): ${ADDRESS}`]]);
    });

    it('gives null when the address does not answer, and tells the log why', async () => {
        const { thumbnails, writes } = setup(() => {
            return Promise.reject(new TypeError('fetch failed'));
        });
        await expect(thumbnails.load('job-1', ADDRESS)).resolves.toBeNull();
        expect(writes).toEqual([['yt-dlp', 'event', `the picture of the video could not be fetched (fetch failed): ${ADDRESS}`]]);
    });

    it('gives up on an address that takes longer than it waits', async () => {
        const fetchImpl = vi.fn((_input: string, init?: RequestInit) => {
            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                    reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
                });
            });
        });
        const writes: string[] = [];
        const thumbnails = new VideoThumbnails({
            fetchImpl: fetchImpl as unknown as typeof fetch,
            timeoutMs: 20,
            log: {
                write: (_source, _stream, text) => {
                    writes.push(text);
                }
            }
        });
        await expect(thumbnails.load('job-1', ADDRESS)).resolves.toBeNull();
        expect(writes).toEqual([`the picture of the video could not be fetched (The operation was aborted due to timeout): ${ADDRESS}`]);
    });

    it('keeps the earlier picture of a download when a new one cannot be fetched', async () => {
        let fail = false;
        const { thumbnails } = setup(() => {
            return fail ? picture(PICTURE, { 'Content-Type': 'image/jpeg' }, 500) : picture();
        });
        await thumbnails.load('job-1', ADDRESS);
        fail = true;
        await expect(thumbnails.load('job-1', ADDRESS)).resolves.toBeNull();
        expect(thumbnails.respond('pullwave-thumb://job/job-1').status).toBe(200);
    });

    it('drops the oldest pictures past the limit, counting a picture fetched again as new', async () => {
        const { thumbnails } = setup(undefined, { maxPictures: 2 });
        await thumbnails.load('a', ADDRESS);
        await thumbnails.load('b', ADDRESS);
        await thumbnails.load('a', ADDRESS);
        await thumbnails.load('c', ADDRESS);
        expect(thumbnails.respond('pullwave-thumb://job/a').status).toBe(200);
        expect(thumbnails.respond('pullwave-thumb://job/b').status).toBe(404);
        expect(thumbnails.respond('pullwave-thumb://job/c').status).toBe(200);
    });

    it('writes to the log of yt-dlp of the app by default, with the secrets of the address hidden', async () => {
        const hub = new LogHub({
            now: () => {
                return 1;
            }
        });
        const write = vi.spyOn(processLogs, 'write').mockImplementation((source, stream, text) => {
            hub.write(source, stream, text);
        });
        const thumbnails = new VideoThumbnails({
            fetchImpl: (() => {
                return Promise.resolve(picture(PICTURE, { 'Content-Type': 'image/jpeg' }, 404));
            }) as unknown as typeof fetch
        });
        await thumbnails.load('job-1', 'https://cdn.test/p.jpg?sig=secret');
        expect(write).toHaveBeenCalledTimes(1);
        expect(hub.snapshot('yt-dlp')).toEqual([{ id: 1, at: 1, stream: 'event', text: 'the picture of the video could not be fetched (HTTP 404): https://cdn.test/p.jpg?sig=***' }]);
        write.mockRestore();
    });
});

describe('VideoThumbnails.forget and respond', () => {
    it('forgets the picture of a download, which is then not found', async () => {
        const { thumbnails } = setup();
        await thumbnails.load('job-1', ADDRESS);
        await thumbnails.load('job-2', ADDRESS);
        thumbnails.forget('job-1');
        expect(thumbnails.respond('pullwave-thumb://job/job-1?v=1').status).toBe(404);
        expect(thumbnails.respond('pullwave-thumb://job/job-2?v=2').status).toBe(200);
        thumbnails.forget('nobody');
    });

    it('answers 404 with no body for an address that is not of a picture', async () => {
        const { thumbnails } = setup();
        await thumbnails.load('job-1', ADDRESS);
        const response = thumbnails.respond('pullwave-thumb://other/job-1');
        expect(response.status).toBe(404);
        expect(await response.text()).toBe('');
        expect(thumbnails.respond('nonsense').status).toBe(404);
    });
});
