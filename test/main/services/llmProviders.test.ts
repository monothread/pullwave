import { completeWithLlm, type LlmFetch, type LlmRequest } from '@main/services/llmProviders';

interface Call {
    url: string;
    init: RequestInit;
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

function fakeFetch(response: Response | Error): { fetchImpl: LlmFetch; calls: Call[] } {
    const calls: Call[] = [];
    const fetchImpl: LlmFetch = (url, init) => {
        calls.push({ url, init });
        return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    };
    return { fetchImpl, calls };
}

const BASE: LlmRequest = {
    provider: 'openai',
    baseUrl: '',
    model: 'model-x',
    token: 'sk-secret',
    system: 'You translate.',
    user: 'Hello'
};

function bodyOf(call: Call): unknown {
    return JSON.parse(call.init.body as string);
}

describe('completeWithLlm: the requests', () => {
    it('asks an OpenAI-compatible provider with a bearer token and the chat messages', async () => {
        const { fetchImpl, calls } = fakeFetch(respond(200, { choices: [{ message: { content: 'Olá' } }] }));
        const result = await completeWithLlm(BASE, fetchImpl);
        expect(result).toEqual({ ok: true, text: 'Olá' });
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
        expect(calls[0]?.init.method).toBe('POST');
        expect(calls[0]?.init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-secret' });
        expect(bodyOf(calls[0] as Call)).toEqual({
            model: 'model-x',
            messages: [
                { role: 'system', content: 'You translate.' },
                { role: 'user', content: 'Hello' }
            ]
        });
    });

    it.each([
        ['deepseek', 'https://api.deepseek.com/chat/completions'],
        ['glm', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
        ['kimi', 'https://api.moonshot.ai/v1/chat/completions']
    ] as const)('uses the address of %s with the OpenAI protocol', async (provider, url) => {
        const { fetchImpl, calls } = fakeFetch(respond(200, { choices: [{ message: { content: 'ok' } }] }));
        await completeWithLlm({ ...BASE, provider }, fetchImpl);
        expect(calls[0]?.url).toBe(url);
    });

    it('uses the address the user chose, without doubling the slash', async () => {
        const { fetchImpl, calls } = fakeFetch(respond(200, { choices: [{ message: { content: 'ok' } }] }));
        await completeWithLlm({ ...BASE, provider: 'custom', baseUrl: 'http://localhost:11434/v1/' }, fetchImpl);
        expect(calls[0]?.url).toBe('http://localhost:11434/v1/chat/completions');
    });

    it('asks Anthropic with its key header, version and the system apart', async () => {
        const { fetchImpl, calls } = fakeFetch(respond(200, { content: [{ type: 'text', text: 'Olá ' }, { type: 'text', text: 'mundo' }] }));
        const result = await completeWithLlm({ ...BASE, provider: 'anthropic' }, fetchImpl);
        expect(result).toEqual({ ok: true, text: 'Olá mundo' });
        expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
        expect(calls[0]?.init.headers).toEqual({
            'Content-Type': 'application/json',
            'x-api-key': 'sk-secret',
            'anthropic-version': '2023-06-01'
        });
        expect(bodyOf(calls[0] as Call)).toEqual({
            model: 'model-x',
            max_tokens: 8192,
            system: 'You translate.',
            messages: [{ role: 'user', content: 'Hello' }]
        });
    });

    it('asks Gemini with its key header and the model in the address', async () => {
        const { fetchImpl, calls } = fakeFetch(respond(200, { candidates: [{ content: { parts: [{ text: 'Olá' }, { text: '!' }] } }] }));
        const result = await completeWithLlm({ ...BASE, provider: 'gemini', model: 'gem ini' }, fetchImpl);
        expect(result).toEqual({ ok: true, text: 'Olá!' });
        expect(calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gem%20ini:generateContent');
        expect(calls[0]?.init.headers).toEqual({ 'Content-Type': 'application/json', 'x-goog-api-key': 'sk-secret' });
        expect(bodyOf(calls[0] as Call)).toEqual({
            systemInstruction: { parts: [{ text: 'You translate.' }] },
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }]
        });
    });
});

describe('completeWithLlm: the answers that are not a text', () => {
    async function errorOf(response: Response | Error, request: LlmRequest = BASE) {
        const result = await completeWithLlm(request, fakeFetch(response).fetchImpl);
        if (result.ok) {
            throw new Error('expected an error');
        }
        return result.error;
    }

    it.each([401, 403])('says the token is not accepted on %i', async (status) => {
        expect(await errorOf(respond(status, 'nope'))).toEqual({ code: 'INVALID_TOKEN', raw: 'nope' });
    });

    it('says the token is not accepted when Gemini calls the key not valid', async () => {
        expect(await errorOf(respond(400, 'API key not valid. Please pass a valid API key.'), { ...BASE, provider: 'gemini' })).toEqual({
            code: 'INVALID_TOKEN',
            raw: 'API key not valid. Please pass a valid API key.'
        });
    });

    it('says the credit is over on 402', async () => {
        expect(await errorOf(respond(402, 'Insufficient Balance'))).toEqual({ code: 'QUOTA_EXCEEDED', raw: 'Insufficient Balance' });
    });

    it('says the credit is over on a 429 that talks about the quota', async () => {
        expect(await errorOf(respond(429, 'You exceeded your current quota'))).toEqual({
            code: 'QUOTA_EXCEEDED',
            raw: 'You exceeded your current quota'
        });
    });

    it('says to wait on a 429, with how long the provider asked', async () => {
        expect(await errorOf(respond(429, 'slow down', { 'retry-after': '7' }))).toEqual({
            code: 'RATE_LIMITED',
            raw: 'slow down',
            retryAfterSeconds: 7
        });
    });

    it('says to wait on a 429 without a usable retry-after', async () => {
        expect(await errorOf(respond(429, 'slow down', { 'retry-after': 'soon' }))).toEqual({ code: 'RATE_LIMITED', raw: 'slow down' });
        expect(await errorOf(respond(429, 'slow down'))).toEqual({ code: 'RATE_LIMITED', raw: 'slow down' });
    });

    it('says the model is not there on 404', async () => {
        expect(await errorOf(respond(404, 'no such model'))).toEqual({ code: 'MODEL_NOT_FOUND', raw: 'no such model' });
    });

    it('keeps the status and the text of any other failure', async () => {
        expect(await errorOf(respond(500, 'boom'))).toEqual({ code: 'BAD_RESPONSE', raw: 'HTTP 500: boom' });
    });

    it('never gives back the token, and cuts a long text', async () => {
        const error = await errorOf(respond(500, `sk-secret ${'x'.repeat(800)}`));
        expect(error.raw).not.toContain('sk-secret');
        expect(error.raw.startsWith('HTTP 500: [token] ')).toBe(true);
        expect(error.raw).toHaveLength(500);
    });

    it('says the answer has no text when it is not what the protocol gives', async () => {
        expect(await errorOf(respond(200, { choices: [] }))).toEqual({ code: 'BAD_RESPONSE', raw: 'The answer has no text: {"choices":[]}' });
        expect(await errorOf(respond(200, 'not json'))).toEqual({ code: 'BAD_RESPONSE', raw: 'The answer has no text: not json' });
        expect(await errorOf(respond(200, { content: [{ type: 'tool_use' }] }), { ...BASE, provider: 'anthropic' })).toEqual({
            code: 'BAD_RESPONSE',
            raw: 'The answer has no text: {"content":[{"type":"tool_use"}]}'
        });
        expect(await errorOf(respond(200, { candidates: [{}] }), { ...BASE, provider: 'gemini' })).toEqual({
            code: 'BAD_RESPONSE',
            raw: 'The answer has no text: {"candidates":[{}]}'
        });
        expect(await errorOf(respond(200, { choices: [{ message: { content: null } }] }))).toEqual({
            code: 'BAD_RESPONSE',
            raw: 'The answer has no text: {"choices":[{"message":{"content":null}}]}'
        });
    });

    it('says the provider could not be reached, without the token', async () => {
        expect(await errorOf(new Error('connect ECONNREFUSED sk-secret'))).toEqual({ code: 'NETWORK', raw: 'connect ECONNREFUSED [token]' });
        expect(await errorOf(new Error('')).then((error) => {
            return error.code;
        })).toBe('NETWORK');
    });

    it('says it was cancelled when the user aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        expect(await errorOf(new Error('aborted'), { ...BASE, signal: controller.signal })).toEqual({
            code: 'CANCELLED',
            raw: 'The translation was cancelled.'
        });
    });

    it('says it timed out when the provider did not answer in time', async () => {
        const never: LlmFetch = (_url, init) => {
            return new Promise<Response>((_resolve, reject) => {
                (init.signal as AbortSignal).addEventListener('abort', () => {
                    reject(new Error('aborted'));
                });
            });
        };
        expect(await completeWithLlm({ ...BASE, timeoutMs: 20 }, never)).toEqual({
            ok: false,
            error: { code: 'TIMEOUT', raw: 'The provider did not answer in time.' }
        });
    });
});

describe('completeWithLlm: the signal', () => {
    it('passes a signal to the request, which follows the one of the user', async () => {
        const controller = new AbortController();
        const { fetchImpl, calls } = fakeFetch(respond(200, { choices: [{ message: { content: 'ok' } }] }));
        await completeWithLlm({ ...BASE, signal: controller.signal }, fetchImpl);
        const signal = calls[0]?.init.signal as AbortSignal;
        expect(signal.aborted).toBe(false);
        controller.abort();
        expect(signal.aborted).toBe(true);
    });
});
