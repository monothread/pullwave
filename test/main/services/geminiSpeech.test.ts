import { parseSegments, promptFor, segmentsToVtt, transcribeWithGemini, type GeminiSpeechRequest } from '@main/services/geminiSpeech';
import type { LlmFetch } from '@main/services/llmProviders';

interface Call {
    url: string;
    init: RequestInit;
}

const AUDIO = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]);
const BASE: GeminiSpeechRequest = {
    baseUrl: '',
    model: 'gem-model',
    token: 'gem-secret',
    task: 'translate',
    audioLanguage: 'Japanese',
    language: 'Portuguese (Brazil)',
    audio: AUDIO
};

function answerOf(...texts: string[]): Response {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: texts.map((text) => {
        return { text };
    }) } }] }), { status: 200 });
}

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

async function errorOf(response: Response | Error, request: GeminiSpeechRequest = BASE) {
    const result = await transcribeWithGemini(request, fakeFetch(response).fetchImpl);
    if (result.ok) {
        throw new Error('expected an error');
    }
    return result.error;
}

describe('promptFor', () => {
    it('asks for the text in the language that is wanted when it is translated, naming the language that is spoken', () => {
        const prompt = promptFor('translate', 'Japanese', 'Portuguese (Brazil)');
        expect(prompt).toContain('The audio is spoken in Japanese. Write what is said translated into Portuguese (Brazil).');
    });

    it('asks for the text in the language that is spoken when it is only transcribed', () => {
        const prompt = promptFor('transcribe', 'Japanese', 'Spanish');
        expect(prompt).toContain('The audio is spoken in Japanese. Write what is said in Japanese, the language it is said in.');
        expect(prompt).not.toContain('Spanish');
    });

    it.each(['translate', 'transcribe'] as const)('asks for a bare JSON list of lines with their times in seconds from the start of the audio, and for [] when nothing is said (%s)', (task) => {
        const prompt = promptFor(task, 'Japanese', 'Spanish');
        expect(prompt).toContain('Answer with only a JSON array, with no code fence and no comment.');
        expect(prompt).toContain('{"start": number, "end": number, "text": string}');
        expect(prompt).toContain('the seconds, counted from the start of this audio');
        expect(prompt).toContain('Do not describe sounds or music and do not write the names of who speaks. If nothing is said, answer [].');
    });
});

describe('parseSegments', () => {
    it('reads a list of lines with their times', () => {
        expect(parseSegments('[{"start":1,"end":3.5,"text":"Hola"},{"start":4,"end":6,"text":"Adiós"}]')).toEqual([
            { start: 1, end: 3.5, text: 'Hola' },
            { start: 4, end: 6, text: 'Adiós' }
        ]);
    });

    it.each([
        ['a code fence with the language', '```json\n[{"start":1,"end":2,"text":"a"}]\n```'],
        ['a code fence without it', '```\n[{"start":1,"end":2,"text":"a"}]\n```'],
        ['spaces around it', '  \n[{"start":1,"end":2,"text":"a"}]\n  ']
    ])('reads a list inside %s', (_name, text) => {
        expect(parseSegments(text)).toEqual([{ start: 1, end: 2, text: 'a' }]);
    });

    it('trims what is said, keeps the line break inside it and drops the blank lines, which would end the cue', () => {
        expect(parseSegments('[{"start":1,"end":2,"text":"  one\\n\\n\\ntwo  "}]')).toEqual([{ start: 1, end: 2, text: 'one\ntwo' }]);
    });

    it('leaves out the lines with nothing said', () => {
        expect(parseSegments('[{"start":1,"end":2,"text":"  "},{"start":3,"end":4,"text":"b"}]')).toEqual([{ start: 3, end: 4, text: 'b' }]);
    });

    it('gives an empty list for an empty list', () => {
        expect(parseSegments('[]')).toEqual([]);
    });

    it.each([
        ['text that is not JSON', 'Here are the subtitles'],
        ['an object', '{"start":1,"end":2,"text":"a"}'],
        ['nothing', ''],
        ['a list of texts', '["a","b"]'],
        ['a line with no text', '[{"start":1,"end":2}]'],
        ['a line with no start', '[{"end":2,"text":"a"}]'],
        ['a start that is a text', '[{"start":"1","end":2,"text":"a"}]'],
        ['a text that is a number', '[{"start":1,"end":2,"text":5}]'],
        ['a line that ends where it starts', '[{"start":2,"end":2,"text":"a"}]'],
        ['a line that ends before it starts', '[{"start":3,"end":2,"text":"a"}]'],
        ['a start before the beginning', '[{"start":-1,"end":2,"text":"a"}]'],
        ['a good line followed by a bad one', '[{"start":1,"end":2,"text":"a"},{"start":"x","end":2,"text":"b"}]']
    ])('gives null for %s', (_name, text) => {
        expect(parseSegments(text)).toBeNull();
    });
});

describe('segmentsToVtt', () => {
    it('writes each line as a cue with its times', () => {
        expect(
            segmentsToVtt([
                { start: 1, end: 3.5, text: 'Hola' },
                { start: 602.25, end: 604, text: 'Dos\nlíneas' }
            ])
        ).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nHola\n\n00:10:02.250 --> 00:10:04.000\nDos\nlíneas\n');
    });

    it('writes only the header for no lines', () => {
        expect(segmentsToVtt([])).toBe('WEBVTT\n');
    });
});

describe('transcribeWithGemini: the request', () => {
    it('asks the model of the address of Gemini, with the key in the header, the instructions as text and the audio inline', async () => {
        const { fetchImpl, calls } = fakeFetch(answerOf('[]'));
        await transcribeWithGemini(BASE, fetchImpl);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gem-model:generateContent');
        expect(calls[0]?.init.method).toBe('POST');
        expect(calls[0]?.init.headers).toEqual({ 'Content-Type': 'application/json', 'x-goog-api-key': 'gem-secret' });
        expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
            contents: [
                {
                    parts: [
                        { text: promptFor('translate', 'Japanese', 'Portuguese (Brazil)') },
                        { inlineData: { mimeType: 'audio/mp3', data: Buffer.from(AUDIO).toString('base64') } }
                    ]
                }
            ]
        });
    });

    it('puts the model in the address with what an address does not accept written out', async () => {
        const { fetchImpl, calls } = fakeFetch(answerOf('[]'));
        await transcribeWithGemini({ ...BASE, model: 'gem model/1' }, fetchImpl);
        expect(calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gem%20model%2F1:generateContent');
    });

    it('uses the address the user chose, without doubling the slash', async () => {
        const { fetchImpl, calls } = fakeFetch(answerOf('[]'));
        await transcribeWithGemini({ ...BASE, baseUrl: 'http://localhost:9000/v1beta/' }, fetchImpl);
        expect(calls[0]?.url).toBe('http://localhost:9000/v1beta/models/gem-model:generateContent');
    });

    it('asks for the transcription, in the language that is spoken, when the task is to transcribe', async () => {
        const { fetchImpl, calls } = fakeFetch(answerOf('[]'));
        await transcribeWithGemini({ ...BASE, task: 'transcribe' }, fetchImpl);
        const body = JSON.parse(calls[0]?.init.body as string) as { contents: Array<{ parts: Array<{ text?: string }> }> };
        expect(body.contents[0]?.parts[0]?.text).toBe(promptFor('transcribe', 'Japanese', 'Portuguese (Brazil)'));
    });

    it('passes a signal that follows the one of the user', async () => {
        const controller = new AbortController();
        const { fetchImpl, calls } = fakeFetch(answerOf('[]'));
        await transcribeWithGemini({ ...BASE, signal: controller.signal }, fetchImpl);
        const signal = calls[0]?.init.signal as AbortSignal;
        expect(signal.aborted).toBe(false);
        controller.abort();
        expect(signal.aborted).toBe(true);
    });
});

describe('transcribeWithGemini: the answer', () => {
    it('gives the lines of the answer as a WebVTT subtitle', async () => {
        const result = await transcribeWithGemini(BASE, fakeFetch(answerOf('[{"start":1,"end":3,"text":"Olá"},{"start":4.5,"end":6,"text":"Tchau"}]')).fetchImpl);
        expect(result).toEqual({ ok: true, text: 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nOlá\n\n00:00:04.500 --> 00:00:06.000\nTchau\n' });
    });

    it('puts together the texts of the parts of the answer, and takes a list inside a code fence', async () => {
        const result = await transcribeWithGemini(BASE, fakeFetch(answerOf('```json\n[{"start":1,', '"end":3,"text":"Olá"}]\n```')).fetchImpl);
        expect(result).toEqual({ ok: true, text: 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nOlá\n' });
    });

    it('gives a subtitle with no cues when nothing is said', async () => {
        expect(await transcribeWithGemini(BASE, fakeFetch(answerOf('[]')).fetchImpl)).toEqual({ ok: true, text: 'WEBVTT\n' });
    });

    it.each([
        ['an answer that is not JSON', 'not json'],
        ['an answer with no candidates (it was blocked)', '{"promptFeedback":{"blockReason":"SAFETY"}}'],
        ['a candidate with no parts', '{"candidates":[{"content":{}}]}'],
        ['a candidate with parts that have no text', '{"candidates":[{"content":{"parts":[{"inlineData":{}}]}}]}'],
        ['nothing', '']
    ])('says the answer is not a list of lines for %s', async (_name, body) => {
        expect(await errorOf(respond(200, body))).toEqual({ code: 'BAD_RESPONSE', raw: `The answer is not a list of subtitle lines with times: ${body}` });
    });

    it('says the answer is not a list of lines when what the model wrote is not a list', async () => {
        const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Sure! Here you go.' }] } }] });
        expect(await errorOf(new Response(body, { status: 200 }))).toEqual({ code: 'BAD_RESPONSE', raw: `The answer is not a list of subtitle lines with times: ${body}` });
    });

    it('says the token is not accepted when Gemini says the key is not valid, on its 400', async () => {
        expect(await errorOf(respond(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}'))).toEqual({
            code: 'INVALID_TOKEN',
            raw: '{"error":{"message":"API key not valid. Please pass a valid API key."}}'
        });
    });

    it.each([401, 403])('says the token is not accepted on %i', async (status) => {
        expect(await errorOf(respond(status, 'nope'))).toEqual({ code: 'INVALID_TOKEN', raw: 'nope' });
    });

    it('says the credit is over on a 429 that talks about the quota', async () => {
        expect(await errorOf(respond(429, 'You exceeded your current quota'))).toEqual({ code: 'QUOTA_EXCEEDED', raw: 'You exceeded your current quota' });
    });

    it('says to wait on a 429, with how long the service asked', async () => {
        expect(await errorOf(respond(429, 'slow down', { 'retry-after': '7' }))).toEqual({ code: 'RATE_LIMITED', raw: 'slow down', retryAfterSeconds: 7 });
        expect(await errorOf(respond(429, 'slow down'))).toEqual({ code: 'RATE_LIMITED', raw: 'slow down' });
    });

    it('says the model is not there on 404', async () => {
        expect(await errorOf(respond(404, 'models/gem-model is not found'))).toEqual({ code: 'MODEL_NOT_FOUND', raw: 'models/gem-model is not found' });
    });

    it('keeps the status and the text of any other failure, without the token', async () => {
        expect(await errorOf(respond(500, 'boom'))).toEqual({ code: 'BAD_RESPONSE', raw: 'HTTP 500: boom' });
        expect((await errorOf(respond(500, 'gem-secret leaked'))).raw).toBe('HTTP 500: [token] leaked');
    });

    it('says the service could not be reached, without the token', async () => {
        expect(await errorOf(new Error('connect ECONNREFUSED gem-secret'))).toEqual({ code: 'NETWORK', raw: 'connect ECONNREFUSED [token]' });
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
        expect(await transcribeWithGemini({ ...BASE, timeoutMs: 20 }, never)).toEqual({
            ok: false,
            error: { code: 'TIMEOUT', raw: 'The service did not answer in time.' }
        });
    });
});
