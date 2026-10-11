export const IMAGE_TIMEOUT_MS = 60_000;
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

export class ImageFetchError extends Error {}

export interface FetchedImage {
    status: number;
    contentType: string | null;
    bytes: Uint8Array;
}

export type ImageFetcher = (url: string, signal: AbortSignal) => Promise<FetchedImage>;

export interface ImageFetcherDependencies {
    // The address of the server the pages come from: nothing else is fetched.
    baseUrl: () => Promise<string>;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}

async function readLimited(response: Response): Promise<Uint8Array> {
    if (response.body === null) {
        return new Uint8Array();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        total += value.byteLength;
        if (total > MAX_IMAGE_BYTES) {
            await reader.cancel();
            throw new ImageFetchError('The image is too large');
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

// Fetches the pages from the server of the app, and only from it: the address of a page comes from a site through an extension, so
// it is not trusted to name any other machine.
export function createImageFetcher(dependencies: ImageFetcherDependencies): ImageFetcher {
    return async (url, signal) => {
        const base = new URL(await dependencies.baseUrl());
        let target: URL;
        try {
            target = new URL(url);
        } catch {
            throw new ImageFetchError(`Invalid address: ${url}`);
        }
        if (target.origin !== base.origin) {
            throw new ImageFetchError('The page is not on the server of the app');
        }
        const combined = AbortSignal.any([signal, AbortSignal.timeout(dependencies.timeoutMs ?? IMAGE_TIMEOUT_MS)]);
        const response = await (dependencies.fetchImpl ?? fetch)(target, { signal: combined });
        const length = Number(response.headers.get('content-length'));
        if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) {
            await response.body?.cancel();
            throw new ImageFetchError('The image is too large');
        }
        const bytes = response.status === 200 ? await readLimited(response) : new Uint8Array();
        if (response.status !== 200) {
            await response.body?.cancel();
        }
        return { status: response.status, contentType: response.headers.get('content-type'), bytes };
    };
}
