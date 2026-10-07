import type { LlmFetch } from '@main/services/llmProviders';
import { transcribeWithSpeechService, type SpeechRequest } from '@main/services/speechProviders';

interface Call {
    url: string;
    init: RequestInit;
}

const VTT = 'WEBVTT\n\n00:01.000 --> 00:03.000\nこんにちは\n';

function respond(status: number, body: string, headers: Record<string, string> = {}): Response {
    return new Response(body, { status, headers });
}

function fakeFetch(response: Response | Error): { fetchImpl: LlmFetch; calls: Call[] } {
    const calls: Call[] = [];
    const fetchImpl: LlmFetch = (url, init) => {
        calls.push({ url, init });
        return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    };
    return { fetchImpl, calls };
}

const AUDIO = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]);
const BASE: SpeechRequest = {
    provider: 'openai',
    baseUrl: '',
    model: 'whisper-1',
    token: 'sk-secret',
    language: 'ja',
    audio: AUDIO,
    fileName: 'part-0.mp3'
};

async function errorOf(response: Response | Error, request: SpeechRequest = BASE) {
    const result = await transcribeWithSpeechService(request, fakeFetch(response).fetchImpl);
    if (result.ok) {
        throw new Error('expected an error');
    }
    return result.error;
}

describe('transcribeWithSpeechService: the request', () => {
    it('sends the part of the audio to the address of OpenAI as a form, with the token as a bearer', async () => {
        const { fetchImpl, calls } = fakeFetch(respond(200, VTT));
        expect(await transcribeWithSpeechService(BASE, fetchImpl)).toEqual({ ok: true, text: VTT });
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe('https://api.openai.com/v1/audio/transcriptions');
        expect(calls[0]?.init.method).toBe('POST');
        // The type of the body (with its boundary) is the one the form brings: it is not set by hand.
        expect(calls[0]?.init.headers).toEqual({ Authorization: 'Bearer sk-secret' });
    });

    it('puts the file, the model, the language and the format in the form', async () => {
        const { fetchImpl, calls } = fakeFetch(respond(200, VTT));
        await transcribeWithSpeechService(BASE, fetchImpl);
        const form = calls[0]?.init.body as FormData;
        expect(form).toBeInstanceOf(FormData);
        expect([...form.keys()]).toEqual(['file', 'model', 'language', 'response_format']);
        expect(form.get('model')).toBe('whisper-1');
        expect(form.get('language')).toBe('ja');
        expect(form.get('response_format')).toBe('vtt');
        const file = form.get('file') as File;
        expect(file.name).toBe('part-0.mp3');
        expect(file.type).toBe('audio/mpeg');
        expect(new Uint8Array(await file.arrayBuffer())).toEqual(AUDIO);
    });

    it('uses the address the user chose, without doubling the slash', async () => {
        const { fetchImpl, calls } = fakeFetch(respond(200, VTT));
        await transcribeWithSpeechService({ ...BASE, provider: 'custom', baseUrl: 'http://localhost:9000/v1/' }, fetchImpl);
        expect(calls[0]?.url).toBe('http://localhost:9000/v1/audio/transcriptions');
    });

    it('prefers the address of the user to the one of OpenAI', async () => {
        const { fetchImpl, calls } = fakeFetch(respond(200, VTT));
        await transcribeWithSpeechService({ ...BASE, baseUrl: 'https://stt.example/v1' }, fetchImpl);
        expect(calls[0]?.url).toBe('https://stt.example/v1/audio/transcriptions');
    });

    it('passes a signal that follows the one of the user', async () => {
        const controller = new AbortController();
        const { fetchImpl, calls } = fakeFetch(respond(200, VTT));
        await transcribeWithSpeechService({ ...BASE, signal: controller.signal }, fetchImpl);
        const signal = calls[0]?.init.signal as AbortSignal;
        expect(signal.aborted).toBe(false);
        controller.abort();
        expect(signal.aborted).toBe(true);
    });
});

describe('transcribeWithSpeechService: translating into English at once', () => {
    it('asks the endpoint of the translations, with no language (the service answers in English whatever is spoken)', async () => {
        const { fetchImpl, calls } = fakeFetch(respond(200, VTT));
        expect(await transcribeWithSpeechService({ ...BASE, task: 'translate' }, fetchImpl)).toEqual({ ok: true, text: VTT });
        expect(calls[0]?.url).toBe('https://api.openai.com/v1/audio/translations');
        expect(calls[0]?.init.method).toBe('POST');
        expect(calls[0]?.init.headers).toEqual({ Authorization: 'Bearer sk-secret' });
        const form = calls[0]?.init.body as FormData;
        expect([...form.keys()]).toEqual(['file', 'model', 'response_format']);
        expect(form.get('model')).toBe('whisper-1');
        expect(form.get('response_format')).toBe('vtt');
        expect((form.get('file') as File).name).toBe('part-0.mp3');
    });

    it('uses the address of the user for the translations too', async () => {
        const { fetchImpl, calls } = fakeFetch(respond(200, VTT));
        await transcribeWithSpeechService({ ...BASE, provider: 'custom', baseUrl: 'http://localhost:9000/v1/', task: 'translate' }, fetchImpl);
        expect(calls[0]?.url).toBe('http://localhost:9000/v1/audio/translations');
    });

    it('transcribes, with the language, when the task is given as transcribe', async () => {
        const { fetchImpl, calls } = fakeFetch(respond(200, VTT));
        await transcribeWithSpeechService({ ...BASE, task: 'transcribe' }, fetchImpl);
        expect(calls[0]?.url).toBe('https://api.openai.com/v1/audio/transcriptions');
        expect((calls[0]?.init.body as FormData).get('language')).toBe('ja');
    });

    it('gives the same errors as for the transcriptions', async () => {
        expect(await errorOf(respond(401, 'nope'), { ...BASE, task: 'translate' })).toEqual({ code: 'INVALID_TOKEN', raw: 'nope' });
        expect(await errorOf(respond(400, 'bad format'), { ...BASE, task: 'translate' })).toEqual({ code: 'BAD_RESPONSE', raw: 'HTTP 400: bad format' });
        expect(await errorOf(respond(200, '{"text":"hi"}'), { ...BASE, task: 'translate' })).toEqual({ code: 'BAD_RESPONSE', raw: 'The answer is not a WebVTT subtitle: {"text":"hi"}' });
    });
});

describe('transcribeWithSpeechService: the answer', () => {
    it('gives the subtitle as it came', async () => {
        const subtitle = 'WEBVTT\n\n00:01:00.000 --> 00:01:02.000\nHola\n';
        expect(await transcribeWithSpeechService(BASE, fakeFetch(respond(200, subtitle)).fetchImpl)).toEqual({ ok: true, text: subtitle });
    });

    it('takes a subtitle with spaces before it, and with a byte order mark, which reading the answer as text takes off', async () => {
        const subtitle = `${String.fromCharCode(0xfeff)}  
WEBVTT

00:01.000 --> 00:02.000
Hi
`;
        expect(await transcribeWithSpeechService(BASE, fakeFetch(respond(200, subtitle)).fetchImpl)).toEqual({ ok: true, text: subtitle.slice(1) });
    });

    it.each([
        ['JSON', '{"text":"hello"}'],
        ['plain text', 'hello'],
        ['SubRip', '1\n00:00:01,000 --> 00:00:02,000\nhello\n'],
        ['nothing', '']
    ])('says the answer is not a subtitle when it is %s', async (_name, body) => {
        expect(await errorOf(respond(200, body))).toEqual({ code: 'BAD_RESPONSE', raw: `The answer is not a WebVTT subtitle: ${body}` });
    });

    it.each([401, 403])('says the token is not accepted on %i', async (status) => {
        expect(await errorOf(respond(status, 'nope'))).toEqual({ code: 'INVALID_TOKEN', raw: 'nope' });
    });

    it('says the credit is over on 402 and on a 429 that talks about the quota', async () => {
        expect(await errorOf(respond(402, 'Insufficient Balance'))).toEqual({ code: 'QUOTA_EXCEEDED', raw: 'Insufficient Balance' });
        expect(await errorOf(respond(429, 'You exceeded your current quota'))).toEqual({ code: 'QUOTA_EXCEEDED', raw: 'You exceeded your current quota' });
    });

    it('says to wait on a 429, with how long the service asked', async () => {
        expect(await errorOf(respond(429, 'slow down', { 'retry-after': '7' }))).toEqual({ code: 'RATE_LIMITED', raw: 'slow down', retryAfterSeconds: 7 });
        expect(await errorOf(respond(429, 'slow down'))).toEqual({ code: 'RATE_LIMITED', raw: 'slow down' });
    });

    it('says the model is not there on 404', async () => {
        expect(await errorOf(respond(404, 'no such model'))).toEqual({ code: 'MODEL_NOT_FOUND', raw: 'no such model' });
    });

    it('keeps the status and the text of any other failure, without the token', async () => {
        expect(await errorOf(respond(500, 'boom'))).toEqual({ code: 'BAD_RESPONSE', raw: 'HTTP 500: boom' });
        const error = await errorOf(respond(500, 'sk-secret leaked'));
        expect(error.raw).toBe('HTTP 500: [token] leaked');
    });

    it('says the service could not be reached, without the token', async () => {
        expect(await errorOf(new Error('connect ECONNREFUSED sk-secret'))).toEqual({ code: 'NETWORK', raw: 'connect ECONNREFUSED [token]' });
    });

    it('says it was cancelled when the user aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        expect(await errorOf(new Error('aborted'), { ...BASE, signal: controller.signal })).toEqual({ code: 'CANCELLED', raw: 'The subtitle was cancelled.' });
    });

    it('says it timed out when the service did not answer in time', async () => {
        const never: LlmFetch = (_url, init) => {
            return new Promise<Response>((_resolve, reject) => {
                (init.signal as AbortSignal).addEventListener('abort', () => {
                    reject(new Error('aborted'));
                });
            });
        };
        expect(await transcribeWithSpeechService({ ...BASE, timeoutMs: 20 }, never)).toEqual({
            ok: false,
            error: { code: 'TIMEOUT', raw: 'The service did not answer in time.' }
        });
    });
});
