import { getText, isVersionTag, LOOKUP_TIMEOUT_MS, MAX_ANSWER_BYTES, UpdateLookupError } from '@main/services/tools/releaseLookup';

const URL_OF_RELEASE = 'https://api.github.com/repos/FlareSolverr/FlareSolverr/releases/latest';

function fakeFetch(body: string, status = 200) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const impl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return Promise.resolve(new Response(body, { status }));
    }) as unknown as typeof fetch;
    return { impl, calls };
}

describe('the limits of a lookup', () => {
    it('reads at most two megabytes, for at most twenty seconds', () => {
        expect(MAX_ANSWER_BYTES).toBe(2 * 1024 * 1024);
        expect(LOOKUP_TIMEOUT_MS).toBe(20_000);
    });
});

describe('isVersionTag', () => {
    it.each(['v2.6.0', 'v2.4.2366', 'v10.0.1', 'v3.5.2'])('accepts %s', (tag) => {
        expect(isVersionTag(tag)).toBe(true);
    });

    it.each(['2.6.0', 'v2.6', 'latest', 'v2.6.0-beta', 'v2.6.0/../x', 'v1234.0.0', 'v1.0.1234567', '', 5, null, undefined])('refuses %j', (tag) => {
        expect(isVersionTag(tag)).toBe(false);
    });
});

describe('getText', () => {
    it('asks with the type it accepts and the name of the app, and gives the text', async () => {
        const { impl, calls } = fakeFetch('{"tag_name":"v3.5.2"}');
        await expect(getText(URL_OF_RELEASE, impl, 'application/vnd.github+json')).resolves.toBe('{"tag_name":"v3.5.2"}');
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe(URL_OF_RELEASE);
        expect(calls[0]?.init?.headers).toEqual({ Accept: 'application/vnd.github+json', 'User-Agent': 'pullwave' });
        expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('takes an answer of exactly the largest size', async () => {
        await expect(getText(URL_OF_RELEASE, fakeFetch('x'.repeat(MAX_ANSWER_BYTES)).impl, 'text/plain')).resolves.toHaveLength(MAX_ANSWER_BYTES);
    });

    it('refuses an answer that is not good, saying its status', async () => {
        const error = await getText(URL_OF_RELEASE, fakeFetch('', 503).impl, 'text/plain').catch((caught: unknown) => {
            return caught;
        });
        expect(error).toBeInstanceOf(UpdateLookupError);
        expect((error as Error).message).toBe('The server answered 503');
    });

    it('refuses an answer that is too big', async () => {
        await expect(getText(URL_OF_RELEASE, fakeFetch('x'.repeat(MAX_ANSWER_BYTES + 1)).impl, 'text/plain')).rejects.toThrow(new UpdateLookupError('The answer is too big'));
    });

    it('turns a failure of the network into a failure of the lookup, with its words', async () => {
        const failing = vi.fn(() => {
            return Promise.reject(new Error('getaddrinfo ENOTFOUND api.github.com'));
        }) as unknown as typeof fetch;
        const error = await getText(URL_OF_RELEASE, failing, 'text/plain').catch((caught: unknown) => {
            return caught;
        });
        expect(error).toBeInstanceOf(UpdateLookupError);
        expect((error as Error).message).toBe('getaddrinfo ENOTFOUND api.github.com');
    });

    it('turns a failure that is not an Error into words too', async () => {
        const failing = vi.fn(() => {
            return Promise.reject('aborted');
        }) as unknown as typeof fetch;
        await expect(getText(URL_OF_RELEASE, failing, 'text/plain')).rejects.toThrow(new UpdateLookupError('aborted'));
    });
});
