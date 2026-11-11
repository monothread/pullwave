// Asking a project on GitHub for its latest release (see flaresolverrUpdate.ts): what is read from the network is cut to a size and a time,
// and a version is only taken when it looks like one.

// What is read from the network is cut to this size before it is looked at.
export const MAX_ANSWER_BYTES = 2 * 1024 * 1024;
export const LOOKUP_TIMEOUT_MS = 20_000;

const VERSION_PATTERN = /^v\d{1,3}\.\d{1,3}\.\d{1,6}$/;

export class UpdateLookupError extends Error {}

// A tag of a release the app takes as a version: v2.6.0, v3.5.2 (also the name of a folder or of an image, so nothing else gets through).
export function isVersionTag(value: unknown): value is string {
    return typeof value === 'string' && VERSION_PATTERN.test(value);
}

async function readLimited(response: Response): Promise<string> {
    const body = await response.text();
    if (body.length > MAX_ANSWER_BYTES) {
        throw new UpdateLookupError('The answer is too big');
    }
    return body;
}

// The text at the address; any failure (the network, an answer that is not good, one too big) is an UpdateLookupError.
export async function getText(url: string, fetchImpl: typeof fetch, accept: string): Promise<string> {
    let response: Response;
    try {
        response = await fetchImpl(url, { headers: { Accept: accept, 'User-Agent': 'pullwave' }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    } catch (error) {
        throw new UpdateLookupError(error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) {
        throw new UpdateLookupError(`The server answered ${String(response.status)}`);
    }
    return readLimited(response);
}
