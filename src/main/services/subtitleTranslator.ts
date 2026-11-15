import type { LlmCompletionResult, LlmError } from '@shared/llm';

export const HALVES_FROM_CUES = 60;
export const MAX_BATCH_CUES = 250;
export const MAX_BATCH_CHARACTERS = 9000;
export const MAX_ATTEMPTS = 2;
export const MAX_KEPT_BATCHES = 100;
export const MAX_RATE_LIMIT_WAITS = 4;
export const DEFAULT_RATE_LIMIT_WAIT_SECONDS = 5;
export const MAX_RATE_LIMIT_WAIT_SECONDS = 60;
const CHARACTERS_PER_TOKEN = 4;

export interface TranslatedBatches {
    get: (key: string) => string[] | undefined;
    set: (key: string, texts: string[]) => void;
    delete: (key: string) => void;
}

export function createTranslatedBatches(limit: number = MAX_KEPT_BATCHES): TranslatedBatches {
    const kept = new Map<string, string[]>();
    return {
        get: (key) => {
            return kept.get(key);
        },
        set: (key, texts) => {
            kept.delete(key);
            kept.set(key, texts);
            if (kept.size > limit) {
                kept.delete(kept.keys().next().value as string);
            }
        },
        delete: (key) => {
            kept.delete(key);
        }
    };
}

export interface TranslatorDependencies {
    complete: (system: string, user: string) => Promise<LlmCompletionResult>;
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
    batches?: TranslatedBatches;
}

export type TranslateTextsResult = { ok: true; texts: string[] } | { ok: false; error: LlmError };

const CANCELLED: LlmError = { code: 'CANCELLED', raw: 'The translation was cancelled.' };

export interface RecognizedSpeech {
    title: string | null;
}

function recognizedSpeechPrompt(recognized: RecognizedSpeech): string[] {
    return [
        recognized.title === null ? 'The lines were written from the audio of a video.' : `The lines were written from the audio of the series "${recognized.title}".`,
        'They come from automatic speech recognition and can have mistakes: words heard wrongly (often homophones or near homophones), wrong kanji for names, or a sentence cut between two lines.',
        'Use the context of the nearby lines and of the series to understand what was really said, and translate that.'
    ];
}

export function systemPromptFor(language: string, recognized?: RecognizedSpeech): string {
    return [
        'You are a professional translator of anime subtitles.',
        `The user sends a JSON array of strings, the lines of a subtitle in order. Translate each string into ${language}.`,
        ...(recognized === undefined ? [] : recognizedSpeechPrompt(recognized)),
        'Keep the meaning, the tone and the register of spoken dialogue.',
        'Keep the names of people, places, groups and techniques as they are, written the same way in every line, and keep Japanese honorifics such as -san, -kun, -chan, -sama, -senpai and -sensei attached to the names; do not translate or drop them.',
        'Keep the line breaks (\\n) and any markup tags such as <i>...</i> where they are.',
        'Do not merge, split, add or drop strings, and do not explain anything.',
        'Answer with only a JSON array of strings with exactly as many entries as you received, in the same order, with no code fences.'
    ].join(' ');
}

function charactersOf(texts: readonly string[]): number {
    return texts.reduce((total, text) => {
        return total + text.length;
    }, 0);
}

function batchCountOf(texts: readonly string[]): number {
    const least = texts.length >= HALVES_FROM_CUES ? 2 : 1;
    const count = Math.max(least, Math.ceil(texts.length / MAX_BATCH_CUES), Math.ceil(charactersOf(texts) / MAX_BATCH_CHARACTERS));
    return Math.min(count, texts.length);
}

function withinCharacterLimit(group: string[]): string[][] {
    if (group.length <= 1 || charactersOf(group) <= MAX_BATCH_CHARACTERS) {
        return [group];
    }
    const middle = Math.ceil(group.length / 2);
    return [...withinCharacterLimit(group.slice(0, middle)), ...withinCharacterLimit(group.slice(middle))];
}

export function splitIntoBatches(texts: readonly string[]): string[][] {
    if (texts.length === 0) {
        return [];
    }
    const count = batchCountOf(texts);
    const size = Math.floor(texts.length / count);
    const longer = texts.length % count;
    const groups: string[][] = [];
    let start = 0;
    for (let index = 0; index < count; index += 1) {
        const end = start + size + (index < longer ? 1 : 0);
        groups.push(texts.slice(start, end));
        start = end;
    }
    return groups.flatMap(withinCharacterLimit);
}

export interface TranslationEstimate {
    batches: number;
    approxTokens: number;
}

export const PROMPT_TOKENS = Math.ceil(systemPromptFor('Portuguese (Brazil)').length / CHARACTERS_PER_TOKEN);

export function estimateTranslation(texts: readonly string[]): TranslationEstimate {
    const batches = splitIntoBatches(texts).length;
    return { batches, approxTokens: Math.ceil(charactersOf(texts) / CHARACTERS_PER_TOKEN) * 2 + batches * PROMPT_TOKENS };
}

export function parseAnswer(answer: string): string[] | null {
    const unfenced = answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
        const parsed: unknown = JSON.parse(unfenced);
        if (Array.isArray(parsed) && parsed.every((item) => {
            return typeof item === 'string';
        })) {
            return parsed as string[];
        }
    } catch {
        return null;
    }
    return null;
}

export function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, milliseconds);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
}

export function waitSecondsOf(error: LlmError): number {
    return Math.min(MAX_RATE_LIMIT_WAIT_SECONDS, error.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_WAIT_SECONDS);
}

interface Context {
    system: string;
    dependencies: TranslatorDependencies;
    batches: TranslatedBatches;
    keys: string[];
}

function batchKey(system: string, texts: readonly string[]): string {
    return `${system}\n${JSON.stringify(texts)}`;
}

async function translateBatch(texts: string[], context: Context): Promise<TranslateTextsResult> {
    const key = batchKey(context.system, texts);
    const kept = context.batches.get(key);
    if (kept !== undefined) {
        context.keys.push(key);
        return { ok: true, texts: kept };
    }
    const result = await askForBatch(texts, context);
    if (result.ok) {
        context.batches.set(key, result.texts);
        context.keys.push(key);
    }
    return result;
}

async function askForBatch(texts: string[], context: Context): Promise<TranslateTextsResult> {
    const { dependencies } = context;
    const sleep = dependencies.sleep ?? defaultSleep;
    let rateLimitWaits = 0;
    let attempt = 0;
    while (attempt < MAX_ATTEMPTS) {
        if (dependencies.signal?.aborted === true) {
            return { ok: false, error: CANCELLED };
        }
        const result = await dependencies.complete(context.system, JSON.stringify(texts));
        if (!result.ok) {
            if (result.error.code === 'RATE_LIMITED' && rateLimitWaits < MAX_RATE_LIMIT_WAITS) {
                rateLimitWaits += 1;
                await sleep(waitSecondsOf(result.error) * 1000, dependencies.signal);
                continue;
            }
            return { ok: false, error: result.error };
        }
        const answer = parseAnswer(result.text);
        if (answer !== null && answer.length === texts.length) {
            return { ok: true, texts: answer };
        }
        attempt += 1;
    }
    if (texts.length === 1) {
        return { ok: false, error: { code: 'BAD_RESPONSE', raw: 'The model did not answer with a translation of the line.' } };
    }
    const middle = Math.ceil(texts.length / 2);
    const first = await translateBatch(texts.slice(0, middle), context);
    if (!first.ok) {
        return first;
    }
    const second = await translateBatch(texts.slice(middle), context);
    return second.ok ? { ok: true, texts: [...first.texts, ...second.texts] } : second;
}

export async function translateTexts(texts: readonly string[], language: string, dependencies: TranslatorDependencies, recognized?: RecognizedSpeech): Promise<TranslateTextsResult> {
    const positions = texts.flatMap((text, index) => {
        return text.trim().length > 0 ? [index] : [];
    });
    const translated = [...texts];
    const context: Context = { system: systemPromptFor(language, recognized), dependencies, batches: dependencies.batches ?? createTranslatedBatches(), keys: [] };
    let done = 0;
    dependencies.onProgress?.(0, texts.length);
    for (const batchTexts of splitIntoBatches(positions.map((position) => {
        return texts[position] as string;
    }))) {
        const result = await translateBatch(batchTexts, context);
        if (!result.ok) {
            return result;
        }
        result.texts.forEach((text, offset) => {
            translated[positions[done + offset] as number] = text;
        });
        done += batchTexts.length;
        dependencies.onProgress?.(texts.length - (positions.length - done), texts.length);
    }
    context.keys.forEach((key) => {
        context.batches.delete(key);
    });
    return { ok: true, texts: translated };
}
