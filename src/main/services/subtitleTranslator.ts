import type { LlmCompletionResult, LlmError } from '@shared/llm';

// The texts of a subtitle go to the model in batches: a batch is a JSON array of strings and the model answers with an array of the
// same size. The cues themselves (their times and identifiers) never leave the app. An episode goes in two halves (it usually has two parts,
// around the break in the middle, D-171): fewer requests carry the instructions again, and the model sees more of the story at once. A
// subtitle shorter than HALVES_FROM_CUES lines goes in one request, and a long one (a film) in as many as the limits below ask for (the
// answer of a batch has to fit what the providers give back in one answer, also in languages that take more tokens).
export const HALVES_FROM_CUES = 60;
export const MAX_BATCH_CUES = 250;
export const MAX_BATCH_CHARACTERS = 9000;
// How many times a batch is asked for again when the answer is not a list of the right size, before it is cut in two.
export const MAX_ATTEMPTS = 2;
// How many translated batches are kept to go on from after a translation that failed (the oldest ones go first).
export const MAX_KEPT_BATCHES = 100;
// How many times a batch waits and goes on when the provider asks to slow down.
export const MAX_RATE_LIMIT_WAITS = 4;
export const DEFAULT_RATE_LIMIT_WAIT_SECONDS = 5;
export const MAX_RATE_LIMIT_WAIT_SECONDS = 60;
// About how many characters make a token.
const CHARACTERS_PER_TOKEN = 4;

// The batches already translated, so a translation that failed half way (the provider ran out of credit, the network fell) goes on from
// where it stopped when it is asked for again, instead of paying for those batches twice. A batch is found by the instructions and the texts.
export interface TranslatedBatches {
    get: (key: string) => string[] | undefined;
    set: (key: string, texts: string[]) => void;
    delete: (key: string) => void;
}

// The batches kept while the app is open, the oldest forgotten past `limit`.
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
    // Asks the model; the system text and the user text.
    complete: (system: string, user: string) => Promise<LlmCompletionResult>;
    // Waits (the tests replace it); the default one ends early when the signal is aborted.
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
    signal?: AbortSignal;
    // How many of the texts are translated, out of all of them.
    onProgress?: (done: number, total: number) => void;
    // Where the translated batches are kept between translations (the runtime keeps one for the app); without it nothing is kept.
    batches?: TranslatedBatches;
}

export type TranslateTextsResult = { ok: true; texts: string[] } | { ok: false; error: LlmError };

const CANCELLED: LlmError = { code: 'CANCELLED', raw: 'The translation was cancelled.' };

// Where the lines being translated come from, when they were written by a service of speech to text from the audio (a subtitle that was
// generated): they can have words heard wrongly, which the model is asked to see through. `title` is the name of the series, when known.
export interface RecognizedSpeech {
    title: string | null;
}

// What the model is told about lines written from the audio: measured on an episode, it took the subtitle from 88% to 92% of lines with the
// right meaning (D-138), seeing "白色なこと" as "博識なこと" or "スクヨミ" as "Tsukuyomi".
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

// In how many batches the texts go: two halves (one when they are few), or more when a half would pass the limits.
function batchCountOf(texts: readonly string[]): number {
    const least = texts.length >= HALVES_FROM_CUES ? 2 : 1;
    const count = Math.max(least, Math.ceil(texts.length / MAX_BATCH_CUES), Math.ceil(charactersOf(texts) / MAX_BATCH_CHARACTERS));
    return Math.min(count, texts.length);
}

// A group cut in two halves, again and again, while it has more than one text and passes the limit of characters (long lines bunched together).
function withinCharacterLimit(group: string[]): string[][] {
    if (group.length <= 1 || charactersOf(group) <= MAX_BATCH_CHARACTERS) {
        return [group];
    }
    const middle = Math.ceil(group.length / 2);
    return [...withinCharacterLimit(group.slice(0, middle)), ...withinCharacterLimit(group.slice(middle))];
}

// The texts, in order, in groups of the same number of lines (the first ones one line longer when they do not divide evenly): two halves of
// an episode, or more for a long subtitle; a group whose lines are long enough to pass the limit of characters is cut again.
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

// About how many tokens the instructions of a request take.
export const PROMPT_TOKENS = Math.ceil(systemPromptFor('Portuguese (Brazil)').length / CHARACTERS_PER_TOKEN);

// About what translating these texts costs in tokens: the text goes and comes back, and each request carries the instructions.
export function estimateTranslation(texts: readonly string[]): TranslationEstimate {
    const batches = splitIntoBatches(texts).length;
    return { batches, approxTokens: Math.ceil(charactersOf(texts) / CHARACTERS_PER_TOKEN) * 2 + batches * PROMPT_TOKENS };
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
    batches: TranslatedBatches;
    // The batches translated by this translation (forgotten when it ends well: they were kept only to go on after a failure).
    keys: string[];
}

function batchKey(system: string, texts: readonly string[]): string {
    return `${system}\n${JSON.stringify(texts)}`;
}

// Asks for one batch, unless it was translated already by a translation that failed after it. A list of the wrong size is asked for again;
// when it keeps coming wrong the batch is cut in two and each half is asked for on its own, since a shorter list is easier to keep in step.
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

// Translates the texts, in order, into a language. The empty ones are not sent. `recognized` is given when the texts were written from the
// audio by a service of speech to text.
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
    // The translation is whole: the next one asked for these lines (TRANSLATE again) asks the model anew.
    context.keys.forEach((key) => {
        context.batches.delete(key);
    });
    return { ok: true, texts: translated };
}
