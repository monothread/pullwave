import { SPEECH_PROVIDERS, type LlmCompletionResult, type LlmError } from '@shared/llm';
import { errorOf, failureOf, retryAfterOf, type LlmFetch } from './llmProviders';
import type { SpeechTask } from './speechProviders';
import { formatVttTime } from './vttCues';

const REQUEST_TIMEOUT_MS = 300_000;
const AUDIO_TYPE = 'audio/mp3';
const RESPONSE_SCHEMA = {
    type: 'ARRAY',
    items: {
        type: 'OBJECT',
        properties: {
            start: { type: 'NUMBER' },
            end: { type: 'NUMBER' },
            text: { type: 'STRING' }
        },
        required: ['start', 'end', 'text']
    }
} as const;

export interface GeminiSpeechRequest {
    baseUrl: string;
    model: string;
    token: string;
    task: SpeechTask;
    audioLanguage: string;
    language: string;
    audio: Uint8Array;
    maxSeconds?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
}

interface Segment {
    start: number;
    end: number;
    text: string;
}

export function promptFor(task: SpeechTask, audioLanguage: string, language: string): string {
    const writing = task === 'translate' ? `translated into ${language}` : `in ${audioLanguage}, the language it is said in`;
    return [
        'You write the subtitles of an episode from its audio.',
        `The audio is spoken in ${audioLanguage}. Write what is said ${writing}.`,
        ...(task === 'translate' ? [`Every subtitle line must be written in ${language}; do not leave any line in ${audioLanguage}.`] : []),
        'Answer with only a JSON array, with no code fence and no comment. Each item is one line of the subtitle: {"start": number, "end": number, "text": string}.',
        '"start" and "end" are the seconds, counted from the start of this audio (decimals are fine), when the line appears and disappears.',
        'Keep the items in order and not overlapping. Each line is a sentence or a short phrase, with at most two lines of about forty characters.',
        'Do not describe sounds or music and do not write the names of who speaks. If nothing is said, answer [].'
    ].join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

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
            return isRecord(part) && part.thought !== true && typeof part.text === 'string';
        })
        .map((part) => {
            return part.text as string;
        });
    return texts.length > 0 ? texts.join('') : null;
}

export function parseSegments(answer: string, maxSeconds?: number): Segment[] | null {
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
    let droppedOutOfBounds = false;
    for (const item of parsed) {
        if (!isRecord(item) || typeof item.start !== 'number' || typeof item.end !== 'number' || typeof item.text !== 'string') {
            return null;
        }
        if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end <= item.start) {
            return null;
        }
        const text = item.text.trim().replace(/\n\s*\n+/g, '\n');
        if (text.length === 0) {
            continue;
        }
        if (maxSeconds !== undefined && item.start >= maxSeconds) {
            droppedOutOfBounds = true;
            continue;
        }
        const end = maxSeconds !== undefined ? Math.min(item.end, maxSeconds) : item.end;
        segments.push({ start: item.start, end, text });
    }
    if (segments.length === 0 && droppedOutOfBounds) {
        return null;
    }
    return segments;
}

export function segmentsToVtt(segments: readonly Segment[]): string {
    const cues = segments.map((segment) => {
        return `${formatVttTime(segment.start)} --> ${formatVttTime(segment.end)}\n${segment.text}\n`;
    });
    return ['WEBVTT\n', ...cues].join('\n');
}

function geminiFailureOf(response: Response, text: string, token: string): LlmError {
    if (response.status === 503) {
        return errorOf('RATE_LIMITED', `HTTP 503: ${text}`, token, retryAfterOf(response));
    }
    return failureOf(response, text, token);
}

export async function transcribeWithGemini(request: GeminiSpeechRequest, fetchImpl: LlmFetch = fetch): Promise<LlmCompletionResult> {
    const base = (request.baseUrl.length > 0 ? request.baseUrl : SPEECH_PROVIDERS.gemini.defaultBaseUrl).replace(/\/+$/, '');
    const model = request.model.replace(/^models\//, '');
    const timeout = AbortSignal.timeout(request.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const signal = request.signal === undefined ? timeout : AbortSignal.any([request.signal, timeout]);
    try {
        const response = await fetchImpl(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
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
                ],
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: RESPONSE_SCHEMA
                }
            }),
            signal
        });
        const text = await response.text();
        if (!response.ok) {
            return { ok: false, error: geminiFailureOf(response, text, request.token) };
        }
        let body: unknown = null;
        try {
            body = JSON.parse(text) as unknown;
        } catch {
            body = null;
        }
        const answer = answerText(body);
        const segments = answer === null ? null : parseSegments(answer, request.maxSeconds);
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
