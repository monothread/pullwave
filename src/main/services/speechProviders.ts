import { SPEECH_PROVIDERS, type LlmCompletionResult, type LlmError, type SpeechProviderId } from '@shared/llm';
import { errorOf, failureOf, type LlmFetch } from './llmProviders';

const REQUEST_TIMEOUT_MS = 300_000;
const AUDIO_TYPE = 'audio/mpeg';
const NO_SUBTITLE_FORMAT = /response_format/i;
const NO_TRANSLATIONS = /invalid url/i;

export type SpeechTask = 'transcribe' | 'translate';

export interface SpeechRequest {
    provider: SpeechProviderId;
    task?: SpeechTask;
    baseUrl: string;
    model: string;
    token: string;
    language: string;
    audio: Uint8Array;
    fileName: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}

function joinUrl(base: string, path: string): string {
    return `${base.replace(/\/+$/, '')}${path}`;
}

function speechFailureOf(response: Response, text: string, token: string, translating: boolean): LlmError {
    if (response.status === 400 && NO_SUBTITLE_FORMAT.test(text)) {
        return errorOf('NO_TIMESTAMPS', text, token);
    }
    if (translating && response.status === 404 && NO_TRANSLATIONS.test(text)) {
        return errorOf('BAD_RESPONSE', `HTTP 404: ${text}`, token);
    }
    return failureOf(response, text, token);
}

interface AudioForm {
    path: '/audio/transcriptions' | '/audio/translations';
    fields: ReadonlyArray<[string, string]>;
}

async function sendAudio(request: SpeechRequest, form: AudioForm, fetchImpl: LlmFetch): Promise<LlmCompletionResult> {
    const base = request.baseUrl.length > 0 ? request.baseUrl : SPEECH_PROVIDERS[request.provider].defaultBaseUrl;
    const body = new FormData();
    body.append('file', new Blob([new Uint8Array(request.audio)], { type: AUDIO_TYPE }), request.fileName);
    for (const [name, value] of form.fields) {
        body.append(name, value);
    }
    const timeout = AbortSignal.timeout(request.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const signal = request.signal === undefined ? timeout : AbortSignal.any([request.signal, timeout]);
    try {
        const response = await fetchImpl(joinUrl(base, form.path), {
            method: 'POST',
            headers: { Authorization: `Bearer ${request.token}` },
            body,
            signal
        });
        const text = await response.text();
        if (!response.ok) {
            return { ok: false, error: speechFailureOf(response, text, request.token, form.path === '/audio/translations') };
        }
        return { ok: true, text };
    } catch (error) {
        if (request.signal?.aborted === true) {
            return { ok: false, error: { code: 'CANCELLED', raw: 'The subtitle was cancelled.' } };
        }
        if (timeout.aborted) {
            return { ok: false, error: { code: 'TIMEOUT', raw: 'The service did not answer in time.' } };
        }
        return { ok: false, error: errorOf('NETWORK', error instanceof Error ? error.message : String(error), request.token) };
    }
}

export async function transcribeWithSpeechService(request: SpeechRequest, fetchImpl: LlmFetch = fetch): Promise<LlmCompletionResult> {
    const translating = request.task === 'translate';
    const fields: Array<[string, string]> = [['model', request.model]];
    if (!translating) {
        fields.push(['language', request.language]);
    }
    fields.push(['response_format', 'vtt']);
    const result = await sendAudio(request, { path: translating ? '/audio/translations' : '/audio/transcriptions', fields }, fetchImpl);
    if (result.ok && !result.text.trim().startsWith('WEBVTT')) {
        return { ok: false, error: errorOf('BAD_RESPONSE', `The answer is not a WebVTT subtitle: ${result.text}`, request.token) };
    }
    return result;
}

export interface SpeechTextRequest extends Omit<SpeechRequest, 'task'> {
    prompt: string;
}

function textOfJson(answer: string): string | null {
    try {
        const parsed: unknown = JSON.parse(answer);
        if (typeof parsed === 'object' && parsed !== null && 'text' in parsed && typeof parsed.text === 'string') {
            return parsed.text;
        }
        return null;
    } catch {
        return null;
    }
}

export async function transcribeTextWithSpeechService(request: SpeechTextRequest, fetchImpl: LlmFetch = fetch): Promise<LlmCompletionResult> {
    const fields: Array<[string, string]> = [
        ['model', request.model],
        ['language', request.language],
        ['response_format', 'json']
    ];
    if (request.prompt.length > 0) {
        fields.push(['prompt', request.prompt]);
    }
    const result = await sendAudio(request, { path: '/audio/transcriptions', fields }, fetchImpl);
    if (!result.ok) {
        return result;
    }
    const text = textOfJson(result.text);
    if (text === null) {
        return { ok: false, error: errorOf('BAD_RESPONSE', `The answer is not the text of the audio: ${result.text}`, request.token) };
    }
    return { ok: true, text: text.trim() };
}
