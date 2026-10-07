import { SPEECH_PROVIDERS, type LlmCompletionResult, type SpeechProviderId } from '@shared/llm';
import { errorOf, failureOf, type LlmFetch } from './llmProviders';

// A part of the audio is a few megabytes and the service transcribes it, which takes a while.
const REQUEST_TIMEOUT_MS = 300_000;
const AUDIO_TYPE = 'audio/mpeg';

// What the service is asked to do with the audio: write what is said (`transcribe`, in the language that is spoken) or write it in English
// (`translate`: the service answers in English whatever the language is, and it is not told which one is spoken).
export type SpeechTask = 'transcribe' | 'translate';

export interface SpeechRequest {
    provider: SpeechProviderId;
    // Transcribes when not given.
    task?: SpeechTask;
    // Empty to use the address of the service.
    baseUrl: string;
    model: string;
    token: string;
    // The language that is spoken, as the two letters the service takes ("ja"); not used to translate.
    language: string;
    audio: Uint8Array;
    fileName: string;
    // Aborted when the user cancels.
    signal?: AbortSignal;
    timeoutMs?: number;
}

function joinUrl(base: string, path: string): string {
    return `${base.replace(/\/+$/, '')}${path}`;
}

// Asks a service of speech to text (the protocol of OpenAI: `POST <address>/audio/transcriptions`, or `/audio/translations` to have it in
// English, a form with the file) for the subtitle of a part of the audio, in WebVTT with the times from the start of that part. Never
// throws: what went wrong comes back as an error.
export async function transcribeWithSpeechService(request: SpeechRequest, fetchImpl: LlmFetch = fetch): Promise<LlmCompletionResult> {
    const base = request.baseUrl.length > 0 ? request.baseUrl : SPEECH_PROVIDERS[request.provider].defaultBaseUrl;
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(request.audio)], { type: AUDIO_TYPE }), request.fileName);
    const translating = request.task === 'translate';
    form.append('model', request.model);
    if (!translating) {
        form.append('language', request.language);
    }
    form.append('response_format', 'vtt');
    const timeout = AbortSignal.timeout(request.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const signal = request.signal === undefined ? timeout : AbortSignal.any([request.signal, timeout]);
    try {
        const response = await fetchImpl(joinUrl(base, translating ? '/audio/translations' : '/audio/transcriptions'), {
            method: 'POST',
            headers: { Authorization: `Bearer ${request.token}` },
            body: form,
            signal
        });
        const text = await response.text();
        if (!response.ok) {
            return { ok: false, error: failureOf(response, text, request.token) };
        }
        if (!text.trim().startsWith('WEBVTT')) {
            return { ok: false, error: errorOf('BAD_RESPONSE', `The answer is not a WebVTT subtitle: ${text}`, request.token) };
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
