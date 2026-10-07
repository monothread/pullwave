import type { LlmCompletionResult, LlmError } from '@shared/llm';

// The texts of a subtitle go to the model in batches: a batch is a JSON array of strings and the model answers with an array of the
// same size. The cues themselves (their times and identifiers) never leave the app.
export const MAX_BATCH_CUES = 40;
export const MAX_BATCH_CHARACTERS = 6000;
// How many times a batch is asked for again when the answer is not a list of the right size.
export const MAX_ATTEMPTS = 3;
// How many times a batch waits and goes on when the provider asks to slow down.
export const MAX_RATE_LIMIT_WAITS = 4;
export const DEFAULT_RATE_LIMIT_WAIT_SECONDS = 5;
export const MAX_RATE_LIMIT_WAIT_SECONDS = 60;
// About how many characters make a token, and the tokens of the instructions each request carries.
const CHARACTERS_PER_TOKEN = 4;
const PROMPT_TOKENS = 150;

export interface TranslatorDependencies {
    // Asks the model; the system text and the user text.
    complete: (system: string, user: string) => Promise<LlmCompletionResult>;
    // Waits (the tests replace it); the default one ends early when the signal is aborted.
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
    signal?: AbortSignal;
    // How many of the texts are translated, out of all of them.
    onProgress?: (done: number, total: number) => void;
}

export type TranslateTextsResult = { ok: true; texts: string[] } | { ok: false; error: LlmError };

const CANCELLED: LlmError = { code: 'CANCELLED', raw: 'The translation was cancelled.' };

export function systemPromptFor(language: string): string {
    return [
        'You are a professional subtitle translator.',
        `The user sends a JSON array of strings, the lines of a subtitle in order. Translate each string into ${language}.`,
        'Keep the meaning, the tone and the register of spoken dialogue, and keep names consistent.',
        'Keep the line breaks (\\n) and any markup tags such as <i>...</i> where they are.',
        'Do not merge, split, add or drop strings, and do not explain anything.',
        'Answer with only a JSON array of strings with exactly as many entries as you received, in the same order, with no code fences.'
    ].join(' ');
}

// The texts in groups that fit a request: at most MAX_BATCH_CUES of them and about MAX_BATCH_CHARACTERS characters.
export function splitIntoBatches(texts: readonly string[]): string[][] {
    const batches: string[][] = [];
    let current: string[] = [];
    let characters = 0;
    texts.forEach((text) => {
        const full = current.length >= MAX_BATCH_CUES || (current.length > 0 && characters + text.length > MAX_BATCH_CHARACTERS);
        if (full) {
            batches.push(current);
            current = [];
            characters = 0;
        }
        current.push(text);
        characters += text.length;
    });
    if (current.length > 0) {
        batches.push(current);
    }
    return batches;
}

export interface TranslationEstimate {
    batches: number;
    approxTokens: number;
}

// About what translating these texts costs in tokens: the text goes and comes back, and each request carries the instructions.
export function estimateTranslation(texts: readonly string[]): TranslationEstimate {
    const batches = splitIntoBatches(texts).length;
    const characters = texts.reduce((total, text) => {
        return total + text.length;
    }, 0);
    return { batches, approxTokens: Math.ceil(characters / CHARACTERS_PER_TOKEN) * 2 + batches * PROMPT_TOKENS };
}

// The list a model answered with, even when it wrapped it in a code fence; null when it is not a list of texts.
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
}

// Asks for one batch. A list of the wrong size is asked for again; when it keeps coming wrong the batch is cut in two and each half
// is asked for on its own, since a shorter list is easier to keep in step.
async function translateBatch(texts: string[], context: Context): Promise<TranslateTextsResult> {
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

// Translates the texts, in order, into a language. The empty ones are not sent.
export async function translateTexts(texts: readonly string[], language: string, dependencies: TranslatorDependencies): Promise<TranslateTextsResult> {
    const positions = texts.flatMap((text, index) => {
        return text.trim().length > 0 ? [index] : [];
    });
    const translated = [...texts];
    const context: Context = { system: systemPromptFor(language), dependencies };
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
    return { ok: true, texts: translated };
}
