import { SPEECH_PROVIDERS, type LlmCompletionResult } from '@shared/llm';
import { errorOf, failureOf, type LlmFetch } from './llmProviders';
import type { SpeechTask } from './speechProviders';
import { formatVttTime } from './vttCues';

// A part of the audio is a few megabytes and the model writes what is said in it, which takes a while.
const REQUEST_TIMEOUT_MS = 300_000;
const AUDIO_TYPE = 'audio/mp3';

export interface GeminiSpeechRequest {
    // Empty to use the address of Gemini.
    baseUrl: string;
    model: string;
    token: string;
    // Writes what is said in the language it is said (`transcribe`) or in the language that is wanted (`translate`).
    task: SpeechTask;
    // The language that is spoken and the language of the subtitle, by name ("Japanese", "Portuguese (Brazil)").
    audioLanguage: string;
    language: string;
    audio: Uint8Array;
    // Aborted when the user cancels.
    signal?: AbortSignal;
    timeoutMs?: number;
}

interface Segment {
    start: number;
    end: number;
    text: string;
}

// What the model is asked: the subtitle of the audio as a list of lines with their times, in the language that is wanted. The times are asked in
// seconds from the start of the part, since that is what the parts are put together with.
export function promptFor(task: SpeechTask, audioLanguage: string, language: string): string {
    const writing = task === 'translate' ? `translated into ${language}` : `in ${audioLanguage}, the language it is said in`;
    return [
        'You write the subtitles of an episode from its audio.',
        `The audio is spoken in ${audioLanguage}. Write what is said ${writing}.`,
        'Answer with only a JSON array, with no code fence and no comment. Each item is one line of the subtitle: {"start": number, "end": number, "text": string}.',
        '"start" and "end" are the seconds, counted from the start of this audio (decimals are fine), when the line appears and disappears.',
        'Keep the items in order and not overlapping. Each line is a sentence or a short phrase, with at most two lines of about forty characters.',
        'Do not describe sounds or music and do not write the names of who speaks. If nothing is said, answer [].'
    ].join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

// The text the model answered with: the texts of the parts of its first answer, put together.
function answerText(body: unknown): string | null {
    if (!isRecord(body) || !Array.isArray(body.candidates) || !isRecord(body.candidates[0]) || !isRecord(body.candidates[0].content)) {
        return null;
    }
    const parts = body.candidates[0].content.parts;
    if (!Array.isArray(parts)) {
        return null;
    }
    const texts = parts
        .filter((part): part is Record<string, unknown> => {
            return isRecord(part) && typeof part.text === 'string';
        })
        .map((part) => {
            return part.text as string;
        });
    return texts.length > 0 ? texts.join('') : null;
}

// The lines of the answer, or null when it is not a list of lines with times (the model can wrap it in a code fence).
export function parseSegments(answer: string): Segment[] | null {
    const unfenced = answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let parsed: unknown;
    try {
        parsed = JSON.parse(unfenced);
    } catch {
        return null;
    }
    if (!Array.isArray(parsed)) {
        return null;
    }
    const segments: Segment[] = [];
    for (const item of parsed) {
        if (!isRecord(item) || typeof item.start !== 'number' || typeof item.end !== 'number' || typeof item.text !== 'string') {
            return null;
        }
        if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end <= item.start) {
            return null;
        }
        const text = item.text.trim().replace(/\n\s*\n+/g, '\n');
        if (text.length > 0) {
            segments.push({ start: item.start, end: item.end, text });
        }
    }
    return segments;
}

export function segmentsToVtt(segments: readonly Segment[]): string {
    const cues = segments.map((segment) => {
        return `${formatVttTime(segment.start)} --> ${formatVttTime(segment.end)}\n${segment.text}\n`;
    });
    return ['WEBVTT\n', ...cues].join('\n');
}

// Asks Gemini (`POST <address>/models/<model>:generateContent`, with the audio inline and the instructions as text) for the subtitle of a part
// of the audio, and gives it as WebVTT with the times from the start of that part. Never throws: what went wrong comes back as an error.
export async function transcribeWithGemini(request: GeminiSpeechRequest, fetchImpl: LlmFetch = fetch): Promise<LlmCompletionResult> {
    const base = (request.baseUrl.length > 0 ? request.baseUrl : SPEECH_PROVIDERS.gemini.defaultBaseUrl).replace(/\/+$/, '');
    const timeout = AbortSignal.timeout(request.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const signal = request.signal === undefined ? timeout : AbortSignal.any([request.signal, timeout]);
    try {
        const response = await fetchImpl(`${base}/models/${encodeURIComponent(request.model)}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': request.token },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: promptFor(request.task, request.audioLanguage, request.language) },
                            { inlineData: { mimeType: AUDIO_TYPE, data: Buffer.from(request.audio).toString('base64') } }
                        ]
                    }
                ]
            }),
            signal
        });
        const text = await response.text();
        if (!response.ok) {
            return { ok: false, error: failureOf(response, text, request.token) };
        }
        let body: unknown = null;
        try {
            body = JSON.parse(text) as unknown;
        } catch {
            body = null;
        }
        const answer = answerText(body);
        const segments = answer === null ? null : parseSegments(answer);
        if (segments === null) {
            return { ok: false, error: errorOf('BAD_RESPONSE', `The answer is not a list of subtitle lines with times: ${text}`, request.token) };
        }
        return { ok: true, text: segmentsToVtt(segments) };
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
