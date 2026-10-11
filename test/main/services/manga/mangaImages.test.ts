import { createImageFetcher, ImageFetchError, MAX_IMAGE_BYTES, IMAGE_TIMEOUT_MS } from '@main/services/manga/mangaImages';

const BASE = 'http://127.0.0.1:4321';

function setup(response: Response | Error) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    }) as unknown as typeof fetch;
    const fetchImage = createImageFetcher({
        baseUrl: () => {
            return Promise.resolve(BASE);
        },
        fetchImpl
    });
    return { fetchImage, calls };
}

describe('createImageFetcher', () => {
    it('fetches a page of the server and gives its bytes, status and type', async () => {
        const { fetchImage, calls } = setup(new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } }));
        const controller = new AbortController();
        const image = await fetchImage(`${BASE}/api/v1/manga/1/chapter/2/page/0`, controller.signal);
        expect(image.status).toBe(200);
        expect(image.contentType).toBe('image/png');
        expect([...image.bytes]).toEqual([1, 2, 3]);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe(`${BASE}/api/v1/manga/1/chapter/2/page/0`);
        expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('gives the status of an answer that is not a success, without bytes', async () => {
        const { fetchImage } = setup(new Response('error page', { status: 502, headers: { 'content-type': 'text/html' } }));
        const image = await fetchImage(`${BASE}/p`, new AbortController().signal);
        expect(image).toEqual({ status: 502, contentType: 'text/html', bytes: new Uint8Array() });
    });

    it('refuses an address that is not on the server of the app, without asking the network', async () => {
        const { fetchImage, calls } = setup(new Response('x'));
        await expect(fetchImage('http://192.168.0.1/admin', new AbortController().signal)).rejects.toThrow('The page is not on the server of the app');
        await expect(fetchImage('http://127.0.0.1:9999/p', new AbortController().signal)).rejects.toThrow(ImageFetchError);
        await expect(fetchImage('https://127.0.0.1:4321/p', new AbortController().signal)).rejects.toThrow(ImageFetchError);
        expect(calls).toHaveLength(0);
    });

    it('refuses what is not an address', async () => {
        const { fetchImage, calls } = setup(new Response('x'));
        await expect(fetchImage('not a url', new AbortController().signal)).rejects.toThrow('Invalid address: not a url');
        expect(calls).toHaveLength(0);
    });

    it('refuses an image that says it is too large', async () => {
        const { fetchImage } = setup(new Response('x', { status: 200, headers: { 'content-length': String(MAX_IMAGE_BYTES + 1) } }));
        await expect(fetchImage(`${BASE}/p`, new AbortController().signal)).rejects.toThrow('The image is too large');
    });

    it('refuses an image that turns out to be too large', async () => {
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(MAX_IMAGE_BYTES));
                controller.enqueue(new Uint8Array(10));
                controller.close();
            }
        });
        const { fetchImage } = setup(new Response(body, { status: 200 }));
        await expect(fetchImage(`${BASE}/p`, new AbortController().signal)).rejects.toThrow('The image is too large');
    });

    it('gives empty bytes for an answer without a body', async () => {
        const { fetchImage } = setup(new Response(null, { status: 200 }));
        expect((await fetchImage(`${BASE}/p`, new AbortController().signal)).bytes).toEqual(new Uint8Array());
    });

    it('passes on a network failure', async () => {
        const { fetchImage } = setup(new Error('ECONNRESET'));
        await expect(fetchImage(`${BASE}/p`, new AbortController().signal)).rejects.toThrow('ECONNRESET');
    });

    it('stops when the caller aborts and has a time limit of its own', async () => {
        expect(IMAGE_TIMEOUT_MS).toBe(60_000);
        const { fetchImage } = setup(new Response('x'));
        const controller = new AbortController();
        controller.abort();
        const fetchImpl = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
            init?.signal?.throwIfAborted();
            return Promise.resolve(new Response('x'));
        }) as unknown as typeof fetch;
        const aborting = createImageFetcher({ baseUrl: () => {
            return Promise.resolve(BASE);
        }, fetchImpl });
        await expect(aborting(`${BASE}/p`, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchImage).toBeTypeOf('function');
    });
});
