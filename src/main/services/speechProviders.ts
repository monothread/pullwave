import { SPEECH_PROVIDERS, type LlmCompletionResult, type LlmError, type SpeechProviderId } from '@shared/llm';
import { errorOf, failureOf, type LlmFetch } from './llmProviders';

// A part of the audio is a few megabytes and the service transcribes it, which takes a while.
const REQUEST_TIMEOUT_MS = 300_000;
const AUDIO_TYPE = 'audio/mpeg';
// What OpenAI answers (400) to a model that cannot give WebVTT: "response_format 'vtt' is not compatible with model 'gpt-transcribe-…'. Use
// 'json' or 'text' instead."
const NO_SUBTITLE_FORMAT = /response_format/i;
// What it answers (404) to a model that has no endpoint of translations (only whisper-1 has one): "Invalid URL (POST /v1/audio/translations)".
const NO_TRANSLATIONS = /invalid url/i;

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

// What an answer that is not a success means for a subtitle. A model that cannot write the times of the lines says so; one with no endpoint
// of translations is a refusal (`BAD_RESPONSE`), so the audio goes again as a transcription, to be translated afterwards (see
// generateEpisodeSubtitle).
function speechFailureOf(response: Response, text: string, token: string, translating: boolean): LlmError {
    if (response.status === 400 && NO_SUBTITLE_FORMAT.test(text)) {
        return errorOf('NO_TIMESTAMPS', text, token);
    }
    if (translating && response.status === 404 && NO_TRANSLATIONS.test(text)) {
        return errorOf('BAD_RESPONSE', `HTTP 404: ${text}`, token);
    }
    return failureOf(response, text, token);
}

// What is sent besides the file: the fields of the form, and where (the transcriptions or the translations into English).
interface AudioForm {
    path: '/audio/transcriptions' | '/audio/translations';
    fields: ReadonlyArray<[string, string]>;
}

// Sends the audio to a service of the protocol of OpenAI and gives back what it answered when it said yes. Never throws: what went wrong
// comes back as an error.
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

// Asks a service of speech to text (the protocol of OpenAI: `POST <address>/audio/transcriptions`, or `/audio/translations` to have it in
// English, a form with the file) for the subtitle of a part of the audio, in WebVTT with the times from the start of that part. Never
// throws: what went wrong comes back as an error.
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

// A piece of the audio to be transcribed, with what helps the model hear it: the name of the series and what was said just before it.
export interface SpeechTextRequest extends Omit<SpeechRequest, 'task'> {
    prompt: string;
}

// The text of an answer in JSON (`{"text": "…"}`), or null when it is not one.
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

// Asks OpenAI what is said in a piece of the audio, in the language that is spoken, as text with no times (`response_format: json`, the
// only one gpt-transcribe gives): the times come from where the piece was cut. The text is empty when nothing was said. Never throws.
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
