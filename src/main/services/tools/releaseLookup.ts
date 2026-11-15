export const MAX_ANSWER_BYTES = 2 * 1024 * 1024;
export const LOOKUP_TIMEOUT_MS = 20_000;

const VERSION_PATTERN = /^v\d{1,3}\.\d{1,3}\.\d{1,6}$/;

export class UpdateLookupError extends Error {}

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
