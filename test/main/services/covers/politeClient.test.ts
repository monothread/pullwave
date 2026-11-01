import { COVER_ATTEMPTS, COVER_TIMEOUT_MS, CoverFetchError, MAX_RETRY_WAIT_MS, PoliteClient, readJson } from '@main/services/covers/politeClient';

type Answer = Response | Error;

function status(code: number, headers: Record<string, string> = {}): Response {
    return new Response('{}', { status: code, headers });
}

function setup(answers: Answer[], intervalMs = 500) {
    const queue = [...answers];
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const sleeps: number[] = [];
    let running = 0;
    let peak = 0;
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        running += 1;
        peak = Math.max(peak, running);
        calls.push({ url: String(url), init: init as RequestInit });
        await Promise.resolve();
        running -= 1;
        const next = queue.shift();
        if (next === undefined) {
            throw new Error('No answer was left for this request.');
        }
        if (next instanceof Error) {
            throw next;
        }
        return next;
    }) as unknown as typeof fetch;
    const sleep = vi.fn(async (milliseconds: number): Promise<void> => {
        sleeps.push(milliseconds);
    });
    const client = new PoliteClient({ service: 'Kitsu', intervalMs, fetchFn, sleep });
    return { client, fetchFn, calls, sleeps, peak: () => {
        return peak;
    } };
}

describe('the constants', () => {
    it('tries three times, waits a minute and a half at most and gives a request fifteen seconds', () => {
        expect(COVER_ATTEMPTS).toBe(3);
        expect(MAX_RETRY_WAIT_MS).toBe(90_000);
        expect(COVER_TIMEOUT_MS).toBe(15_000);
    });
});

describe('PoliteClient', () => {
    it('makes the request with what it was given and a time limit, and gives the answer', async () => {
        const answer = status(200);
        const { client, calls } = setup([answer]);
        await expect(client.request('https://kitsu.example/anime?x=1', { headers: { Accept: 'application/vnd.api+json' } })).resolves.toBe(answer);
        expect(calls).toEqual([{ url: 'https://kitsu.example/anime?x=1', init: { headers: { Accept: 'application/vnd.api+json' }, signal: expect.any(AbortSignal) } }]);
    });

    it('makes a request with no options too', async () => {
        const { client, calls } = setup([status(200)]);
        await client.request('https://kitsu.example/a');
        expect(calls).toEqual([{ url: 'https://kitsu.example/a', init: { signal: expect.any(AbortSignal) } }]);
    });

    it('uses the time limit it was given', async () => {
        const timeout = vi.spyOn(AbortSignal, 'timeout');
        const fetchFn = vi.fn(async (): Promise<Response> => {
            return status(200);
        }) as unknown as typeof fetch;
        await new PoliteClient({ service: 'Jikan', intervalMs: 0, fetchFn, timeoutMs: 1234, sleep: async () => {} }).request('https://j.example');
        expect(timeout).toHaveBeenCalledWith(1234);
        await new PoliteClient({ service: 'Jikan', intervalMs: 0, fetchFn, sleep: async () => {} }).request('https://j.example');
        expect(timeout).toHaveBeenLastCalledWith(COVER_TIMEOUT_MS);
        timeout.mockRestore();
    });

    it('gives null when the service does not know what was asked for (404)', async () => {
        const { client } = setup([status(404)]);
        await expect(client.request('https://kitsu.example/a')).resolves.toBeNull();
    });

    it('fails with the status when the service answers with an error', async () => {
        const { client } = setup([status(500)]);
        await expect(client.request('https://kitsu.example/a')).rejects.toEqual(new CoverFetchError('Kitsu answered with status 500.'));
    });

    it('fails with the reason when the service cannot be reached, and with the text of what was thrown when it is not an error', async () => {
        const offline = setup([new Error('offline')]);
        await expect(offline.client.request('https://kitsu.example/a')).rejects.toEqual(new CoverFetchError('Kitsu could not be reached: offline'));
        const fetchFn = vi.fn(async (): Promise<Response> => {
            throw 'refused';
        }) as unknown as typeof fetch;
        await expect(new PoliteClient({ service: 'Jikan', intervalMs: 0, fetchFn, sleep: async () => {} }).request('https://j.example')).rejects.toEqual(new CoverFetchError('Jikan could not be reached: refused'));
    });

    it('lets one request go at a time, an interval after the one before', async () => {
        const { client, sleeps, peak } = setup([status(200), status(200), status(200)], 500);
        await Promise.all([client.request('https://a'), client.request('https://b'), client.request('https://c')]);
        expect(peak()).toBe(1);
        expect(sleeps).toEqual([500, 500, 500]);
    });

    it('waits as long as the service asks after a refusal, and then asks the same thing again', async () => {
        const answer = status(200);
        const { client, calls, sleeps } = setup([status(429, { 'retry-after': '7' }), answer]);
        await expect(client.request('https://kitsu.example/a')).resolves.toBe(answer);
        expect(calls.map((call) => {
            return call.url;
        })).toEqual(['https://kitsu.example/a', 'https://kitsu.example/a']);
        expect(sleeps).toEqual([500, 7000, 500]);
    });

    it('waits an interval when the service refuses without saying how long, and never longer than a minute and a half', async () => {
        const first = setup([status(429), status(200)]);
        await first.client.request('https://a');
        expect(first.sleeps).toEqual([500, 500, 500]);
        const second = setup([status(429, { 'retry-after': '3600' }), status(200)]);
        await second.client.request('https://a');
        expect(second.sleeps).toEqual([500, MAX_RETRY_WAIT_MS, 500]);
    });

    it('makes the requests that come after a refusal wait too', async () => {
        const { client, sleeps } = setup([status(429, { 'retry-after': '2' }), status(200), status(200)]);
        await Promise.all([client.request('https://a'), client.request('https://b')]);
        expect(sleeps).toEqual([500, 500, 2000, 500]);
    });

    it('gives up after a few refusals in a row, with the status of the last one', async () => {
        const { client, fetchFn } = setup([status(429), status(429), status(429)]);
        await expect(client.request('https://a')).rejects.toEqual(new CoverFetchError('Kitsu answered with status 429.'));
        expect(fetchFn).toHaveBeenCalledTimes(COVER_ATTEMPTS);
    });
});

describe('readJson', () => {
    it('reads the body of an answer', async () => {
        await expect(readJson(new Response('{"data":[1]}'))).resolves.toEqual({ data: [1] });
    });

    it('gives null with no answer or a body that is not JSON', async () => {
        await expect(readJson(null)).resolves.toBeNull();
        await expect(readJson(new Response('<html>'))).resolves.toBeNull();
    });
});
