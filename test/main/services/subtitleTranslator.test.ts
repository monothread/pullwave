import type { LlmCompletionResult } from '@shared/llm';
import {
    createTranslatedBatches,
    DEFAULT_RATE_LIMIT_WAIT_SECONDS,
    estimateTranslation,
    HALVES_FROM_CUES,
    MAX_ATTEMPTS,
    MAX_BATCH_CHARACTERS,
    MAX_BATCH_CUES,
    MAX_KEPT_BATCHES,
    PROMPT_TOKENS,
    MAX_RATE_LIMIT_WAIT_SECONDS,
    MAX_RATE_LIMIT_WAITS,
    parseAnswer,
    splitIntoBatches,
    systemPromptFor,
    translateTexts,
    type TranslatorDependencies
} from '@main/services/subtitleTranslator';

function answer(texts: string[]): LlmCompletionResult {
    return { ok: true, text: JSON.stringify(texts) };
}

// A model that translates by putting the text between brackets, so what was sent can be told from what came back.
function bracketing(): TranslatorDependencies['complete'] {
    return vi.fn(async (_system: string, user: string): Promise<LlmCompletionResult> => {
        return answer((JSON.parse(user) as string[]).map((text) => {
            return `[${text}]`;
        }));
    });
}

describe('systemPromptFor', () => {
    const BASE_PROMPT = [
        'You are a professional translator of anime subtitles.',
        'The user sends a JSON array of strings, the lines of a subtitle in order. Translate each string into Spanish.',
        'Keep the meaning, the tone and the register of spoken dialogue.',
        'Keep the names of people, places, groups and techniques as they are, written the same way in every line, and keep Japanese honorifics such as -san, -kun, -chan, -sama, -senpai and -sensei attached to the names; do not translate or drop them.',
        'Keep the line breaks (\\n) and any markup tags such as <i>...</i> where they are.',
        'Do not merge, split, add or drop strings, and do not explain anything.',
        'Answer with only a JSON array of strings with exactly as many entries as you received, in the same order, with no code fences.'
    ];
    const RECOGNIZED = [
        'They come from automatic speech recognition and can have mistakes: words heard wrongly (often homophones or near homophones), wrong kanji for names, or a sentence cut between two lines.',
        'Use the context of the nearby lines and of the series to understand what was really said, and translate that.'
    ];

    it('says the lines are of an anime, and keeps the names and the honorifics', () => {
        const prompt = systemPromptFor('Portuguese (Brazil)');
        expect(prompt).toContain('translator of anime subtitles');
        expect(prompt).toContain('Keep the names of people, places, groups and techniques as they are');
        expect(prompt).toContain('-san, -kun, -chan, -sama, -senpai and -sensei');
    });

    it('names the language to translate into and asks for a list of the same size', () => {
        const prompt = systemPromptFor('Spanish');
        expect(prompt).toContain('Translate each string into Spanish.');
        expect(prompt).toContain('exactly as many entries as you received');
        expect(prompt).toContain('JSON array of strings');
    });

    it('says nothing of speech recognition for the lines of a subtitle that was not written from the audio', () => {
        expect(systemPromptFor('Spanish')).toBe(BASE_PROMPT.join(' '));
    });

    it('says the lines were written from the audio of the series, and can have words heard wrongly to see through', () => {
        expect(systemPromptFor('Spanish', { title: 'Tsukimichi -Moonlit Fantasy-' })).toBe(
            [...BASE_PROMPT.slice(0, 2), 'The lines were written from the audio of the series "Tsukimichi -Moonlit Fantasy-".', ...RECOGNIZED, ...BASE_PROMPT.slice(2)].join(' ')
        );
    });

    it('says the lines were written from the audio of a video when the series has no name', () => {
        expect(systemPromptFor('Spanish', { title: null })).toBe([...BASE_PROMPT.slice(0, 2), 'The lines were written from the audio of a video.', ...RECOGNIZED, ...BASE_PROMPT.slice(2)].join(' '));
    });
});

describe('splitIntoBatches', () => {
    it('gives nothing for no texts', () => {
        expect(splitIntoBatches([])).toEqual([]);
    });

    it('keeps few short texts in one batch', () => {
        expect(splitIntoBatches(['a', 'b', 'c'])).toEqual([['a', 'b', 'c']]);
    });

    function lines(count: number): string[] {
        return Array.from({ length: count }, (_value, index) => {
            return `t${index}`;
        });
    }

    it('has the limits of the halves and of a batch', () => {
        expect([HALVES_FROM_CUES, MAX_BATCH_CUES, MAX_BATCH_CHARACTERS]).toEqual([60, 250, 9000]);
    });

    it('keeps a subtitle shorter than the halves in one batch', () => {
        const texts = lines(HALVES_FROM_CUES - 1);
        expect(splitIntoBatches(texts)).toEqual([texts]);
    });

    it('cuts an episode in two halves of the same size', () => {
        const texts = lines(300);
        expect(splitIntoBatches(texts)).toEqual([texts.slice(0, 150), texts.slice(150)]);
    });

    it('gives the first half the line left over when they do not divide evenly', () => {
        const texts = lines(HALVES_FROM_CUES + 1);
        expect(splitIntoBatches(texts)).toEqual([texts.slice(0, 31), texts.slice(31)]);
    });

    it('cuts a subtitle in more parts of the same size when a half would pass the most lines a batch takes', () => {
        const texts = lines(MAX_BATCH_CUES * 2 + 1);
        const batches = splitIntoBatches(texts);
        expect(batches.map((batch) => {
            return batch.length;
        })).toEqual([167, 167, 167]);
        expect(batches.flat()).toEqual(texts);
    });

    it('cuts a subtitle in more parts when the halves would pass the most characters a batch takes', () => {
        const texts = Array.from({ length: 100 }, () => {
            return 'x'.repeat(200);
        });
        expect(splitIntoBatches(texts).map((batch) => {
            return batch.length;
        })).toEqual([34, 33, 33]);
    });

    it('cuts again a part whose lines are long enough to pass the most characters', () => {
        const long = 'x'.repeat(MAX_BATCH_CHARACTERS - 1);
        // Two parts by the characters: [long, 'ab'] passes the limit and is cut again.
        expect(splitIntoBatches([long, 'ab', 'cd'])).toEqual([[long], ['ab'], ['cd']]);
    });

    it('gives a text that is longer than a batch a batch of its own', () => {
        const huge = 'y'.repeat(MAX_BATCH_CHARACTERS + 10);
        expect(splitIntoBatches([huge, 'a'])).toEqual([[huge], ['a']]);
    });

    it('keeps the order of the texts', () => {
        const texts = Array.from({ length: MAX_BATCH_CUES * 2 + 3 }, (_value, index) => {
            return `t${index}`;
        });
        expect(splitIntoBatches(texts).flat()).toEqual(texts);
    });
});

describe('estimateTranslation', () => {
    it('counts the instructions by their length', () => {
        expect(PROMPT_TOKENS).toBe(Math.ceil(systemPromptFor('Portuguese (Brazil)').length / 4));
    });

    it('counts the requests and about the tokens of what goes and what comes back, plus the instructions', () => {
        expect(estimateTranslation(['abcd', 'efgh'])).toEqual({ batches: 1, approxTokens: 2 * 2 + PROMPT_TOKENS });
    });

    it('rounds the tokens of the text up', () => {
        expect(estimateTranslation(['abcde'])).toEqual({ batches: 1, approxTokens: 2 * 2 + PROMPT_TOKENS });
    });

    it('adds the instructions again for every request: twice for an episode in two halves', () => {
        const texts = Array.from({ length: HALVES_FROM_CUES }, () => {
            return 'abcd';
        });
        expect(estimateTranslation(texts)).toEqual({ batches: 2, approxTokens: HALVES_FROM_CUES * 2 + 2 * PROMPT_TOKENS });
    });

    it('is nothing for no text', () => {
        expect(estimateTranslation([])).toEqual({ batches: 0, approxTokens: 0 });
    });
});

describe('parseAnswer', () => {
    it('reads a list of texts', () => {
        expect(parseAnswer('["a","b\\nc"]')).toEqual(['a', 'b\nc']);
    });

    it.each([
        ['a code fence with the language', '```json\n["a","b"]\n```'],
        ['a code fence without it', '```\n["a","b"]\n```'],
        ['spaces around it', '  \n["a","b"]\n  ']
    ])('reads a list inside %s', (_name, text) => {
        expect(parseAnswer(text)).toEqual(['a', 'b']);
    });

    it.each([
        ['text that is not JSON', 'Here you go: a, b'],
        ['an object', '{"a":"b"}'],
        ['a list with something that is not text', '["a", 2]'],
        ['a list of lists', '[["a"]]'],
        ['nothing', '']
    ])('gives null for %s', (_name, text) => {
        expect(parseAnswer(text)).toBeNull();
    });
});

describe('translateTexts', () => {
    it('sends the texts as a JSON list with the instructions for the language and gives them back in order', async () => {
        const complete = bracketing();
        const result = await translateTexts(['Hello', 'Bye\nnow'], 'Spanish', { complete });
        expect(result).toEqual({ ok: true, texts: ['[Hello]', '[Bye\nnow]'] });
        expect(complete).toHaveBeenCalledTimes(1);
        expect(complete).toHaveBeenCalledWith(systemPromptFor('Spanish'), '["Hello","Bye\\nnow"]');
    });

    it('tells the model the texts were written from the audio of the series when that is said', async () => {
        const complete = bracketing();
        const result = await translateTexts(['こんにちは'], 'Spanish', { complete }, { title: 'Naruto' });
        expect(result).toEqual({ ok: true, texts: ['[こんにちは]'] });
        expect(complete).toHaveBeenCalledTimes(1);
        expect(complete).toHaveBeenCalledWith(systemPromptFor('Spanish', { title: 'Naruto' }), '["こんにちは"]');
    });

    it('asks once for each batch and keeps the order across them', async () => {
        const complete = bracketing();
        const texts = Array.from({ length: MAX_BATCH_CUES + 5 }, (_value, index) => {
            return `t${index}`;
        });
        const result = await translateTexts(texts, 'French', { complete });
        expect(complete).toHaveBeenCalledTimes(2);
        expect(result).toEqual({
            ok: true,
            texts: texts.map((text) => {
                return `[${text}]`;
            })
        });
    });

    it('does not send the empty texts and keeps them where they were', async () => {
        const complete = bracketing();
        const result = await translateTexts(['', 'Hi', '  ', 'Yo'], 'German', { complete });
        expect(complete).toHaveBeenCalledWith(systemPromptFor('German'), '["Hi","Yo"]');
        expect(result).toEqual({ ok: true, texts: ['', '[Hi]', '  ', '[Yo]'] });
    });

    it('asks for nothing when there is nothing to translate', async () => {
        const complete = bracketing();
        expect(await translateTexts(['', ' '], 'German', { complete })).toEqual({ ok: true, texts: ['', ' '] });
        expect(await translateTexts([], 'German', { complete })).toEqual({ ok: true, texts: [] });
        expect(complete).not.toHaveBeenCalled();
    });

    it('tells how far it is, counting the empty texts as done', async () => {
        const onProgress = vi.fn();
        const texts = ['', ...Array.from({ length: 80 }, (_value, index) => {
            return `t${index}`;
        })];
        await translateTexts(texts, 'Italian', { complete: bracketing(), onProgress });
        expect(onProgress.mock.calls).toEqual([
            [0, texts.length],
            [41, texts.length],
            [texts.length, texts.length]
        ]);
    });

    describe('when the list that comes back is wrong', () => {
        it('asks again for the same batch and takes the right answer', async () => {
            const complete = vi.fn<TranslatorDependencies['complete']>()
                .mockResolvedValueOnce(answer(['only one']))
                .mockResolvedValueOnce(answer(['A', 'B']));
            expect(await translateTexts(['a', 'b'], 'Spanish', { complete })).toEqual({ ok: true, texts: ['A', 'B'] });
            expect(MAX_ATTEMPTS).toBe(2);
            expect(complete).toHaveBeenCalledTimes(2);
            expect(complete.mock.calls.map((call) => {
                return call[1];
            })).toEqual(['["a","b"]', '["a","b"]']);
        });

        it('cuts the batch in two when it keeps coming wrong, and asks for each half', async () => {
            const complete = vi.fn(async (_system: string, user: string): Promise<LlmCompletionResult> => {
                const texts = JSON.parse(user) as string[];
                return texts.length > 2 ? answer(['wrong size']) : answer(texts.map((text) => {
                    return text.toUpperCase();
                }));
            });
            const result = await translateTexts(['a', 'b', 'c', 'd'], 'Spanish', { complete });
            expect(result).toEqual({ ok: true, texts: ['A', 'B', 'C', 'D'] });
            expect(complete.mock.calls.map((call) => {
                return call[1];
            })).toEqual([
                ...Array.from({ length: MAX_ATTEMPTS }, () => {
                    return '["a","b","c","d"]';
                }),
                '["a","b"]',
                '["c","d"]'
            ]);
        });

        it('cuts an odd batch with the bigger half first', async () => {
            const complete = vi.fn(async (_system: string, user: string): Promise<LlmCompletionResult> => {
                const texts = JSON.parse(user) as string[];
                return texts.length > 2 ? answer([]) : answer(texts);
            });
            await translateTexts(['a', 'b', 'c'], 'Spanish', { complete });
            expect(complete.mock.calls.slice(MAX_ATTEMPTS).map((call) => {
                return call[1];
            })).toEqual(['["a","b"]', '["c"]']);
        });

        it('fails when a single line keeps coming wrong', async () => {
            const complete = vi.fn(async (): Promise<LlmCompletionResult> => {
                return { ok: true, text: 'nope' };
            });
            expect(await translateTexts(['a'], 'Spanish', { complete })).toEqual({
                ok: false,
                error: { code: 'BAD_RESPONSE', raw: 'The model did not answer with a translation of the line.' }
            });
            expect(complete).toHaveBeenCalledTimes(MAX_ATTEMPTS);
        });

        it('fails with the error of the second half when the first half went well', async () => {
            const complete = vi.fn(async (_system: string, user: string): Promise<LlmCompletionResult> => {
                const texts = JSON.parse(user) as string[];
                if (texts.length > 2) {
                    return answer([]);
                }
                return texts[0] === 'a' ? answer(['A', 'B']) : { ok: false, error: { code: 'QUOTA_EXCEEDED', raw: 'no credit' } };
            });
            expect(await translateTexts(['a', 'b', 'c', 'd'], 'Spanish', { complete })).toEqual({
                ok: false,
                error: { code: 'QUOTA_EXCEEDED', raw: 'no credit' }
            });
        });
    });

    describe('when the provider fails', () => {
        it.each(['INVALID_TOKEN', 'QUOTA_EXCEEDED', 'MODEL_NOT_FOUND', 'TIMEOUT', 'NETWORK', 'BAD_RESPONSE'] as const)('stops at once on %s, without asking again', async (code) => {
            const complete = vi.fn(async (): Promise<LlmCompletionResult> => {
                return { ok: false, error: { code, raw: 'x' } };
            });
            const texts = Array.from({ length: MAX_BATCH_CUES + 1 }, () => {
                return 'a';
            });
            expect(await translateTexts(texts, 'Spanish', { complete })).toEqual({ ok: false, error: { code, raw: 'x' } });
            expect(complete).toHaveBeenCalledTimes(1);
        });

        it('waits as long as the provider asked and asks again when it is limiting the requests', async () => {
            const sleep = vi.fn(async () => {
                return undefined;
            });
            const complete = vi.fn<TranslatorDependencies['complete']>()
                .mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMITED', raw: 'slow', retryAfterSeconds: 7 } })
                .mockResolvedValueOnce(answer(['A']));
            expect(await translateTexts(['a'], 'Spanish', { complete, sleep })).toEqual({ ok: true, texts: ['A'] });
            expect(sleep).toHaveBeenCalledTimes(1);
            expect(sleep).toHaveBeenCalledWith(7000, undefined);
        });

        it('waits a default time when the provider did not say how long, and never more than the longest wait', async () => {
            const sleep = vi.fn(async () => {
                return undefined;
            });
            const complete = vi.fn<TranslatorDependencies['complete']>()
                .mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMITED', raw: 'slow' } })
                .mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMITED', raw: 'slow', retryAfterSeconds: 3600 } })
                .mockResolvedValueOnce(answer(['A']));
            await translateTexts(['a'], 'Spanish', { complete, sleep });
            expect(sleep.mock.calls).toEqual([[DEFAULT_RATE_LIMIT_WAIT_SECONDS * 1000, undefined], [MAX_RATE_LIMIT_WAIT_SECONDS * 1000, undefined]]);
        });

        it('passes the signal to the wait', async () => {
            const sleep = vi.fn(async () => {
                return undefined;
            });
            const controller = new AbortController();
            const complete = vi.fn<TranslatorDependencies['complete']>()
                .mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMITED', raw: 'slow', retryAfterSeconds: 1 } })
                .mockResolvedValueOnce(answer(['A']));
            await translateTexts(['a'], 'Spanish', { complete, sleep, signal: controller.signal });
            expect(sleep).toHaveBeenCalledWith(1000, controller.signal);
        });

        it('gives up after waiting as many times as it may', async () => {
            const sleep = vi.fn(async () => {
                return undefined;
            });
            const limited: LlmCompletionResult = { ok: false, error: { code: 'RATE_LIMITED', raw: 'slow', retryAfterSeconds: 1 } };
            const complete = vi.fn(async (): Promise<LlmCompletionResult> => {
                return limited;
            });
            expect(await translateTexts(['a'], 'Spanish', { complete, sleep })).toEqual(limited);
            expect(sleep).toHaveBeenCalledTimes(MAX_RATE_LIMIT_WAITS);
            expect(complete).toHaveBeenCalledTimes(MAX_RATE_LIMIT_WAITS + 1);
        });

        it('does not count the waits as attempts at a wrong list', async () => {
            const sleep = vi.fn(async () => {
                return undefined;
            });
            const complete = vi.fn<TranslatorDependencies['complete']>()
                .mockResolvedValueOnce(answer([]))
                .mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMITED', raw: 'slow', retryAfterSeconds: 1 } })
                .mockResolvedValueOnce(answer(['A']));
            expect(await translateTexts(['a'], 'Spanish', { complete, sleep })).toEqual({ ok: true, texts: ['A'] });
            expect(complete).toHaveBeenCalledTimes(3);
        });

        it('waits for real, and ends the wait early when the signal is aborted', async () => {
            const controller = new AbortController();
            const complete = vi.fn<TranslatorDependencies['complete']>()
                .mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMITED', raw: 'slow', retryAfterSeconds: 30 } })
                .mockResolvedValueOnce(answer(['A']));
            const pending = translateTexts(['a'], 'Spanish', { complete, signal: controller.signal });
            await vi.waitFor(() => {
                expect(complete).toHaveBeenCalledTimes(1);
            });
            controller.abort();
            expect(await pending).toEqual({ ok: false, error: { code: 'CANCELLED', raw: 'The translation was cancelled.' } });
            expect(complete).toHaveBeenCalledTimes(1);
        });

        it('really waits the time before asking again', async () => {
            vi.useFakeTimers();
            try {
                const complete = vi.fn<TranslatorDependencies['complete']>()
                    .mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMITED', raw: 'slow', retryAfterSeconds: 2 } })
                    .mockResolvedValueOnce(answer(['A']));
                const pending = translateTexts(['a'], 'Spanish', { complete });
                await vi.advanceTimersByTimeAsync(1999);
                expect(complete).toHaveBeenCalledTimes(1);
                await vi.advanceTimersByTimeAsync(1);
                expect(await pending).toEqual({ ok: true, texts: ['A'] });
                expect(complete).toHaveBeenCalledTimes(2);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('when it is cancelled', () => {
        it('does not ask when the signal was aborted already', async () => {
            const controller = new AbortController();
            controller.abort();
            const complete = bracketing();
            expect(await translateTexts(['a'], 'Spanish', { complete, signal: controller.signal })).toEqual({
                ok: false,
                error: { code: 'CANCELLED', raw: 'The translation was cancelled.' }
            });
            expect(complete).not.toHaveBeenCalled();
        });

        it('stops before the next batch', async () => {
            const controller = new AbortController();
            const complete = vi.fn(async (_system: string, user: string): Promise<LlmCompletionResult> => {
                controller.abort();
                return answer(JSON.parse(user) as string[]);
            });
            const texts = Array.from({ length: MAX_BATCH_CUES + 1 }, () => {
                return 'a';
            });
            expect(await translateTexts(texts, 'Spanish', { complete, signal: controller.signal })).toEqual({
                ok: false,
                error: { code: 'CANCELLED', raw: 'The translation was cancelled.' }
            });
            expect(complete).toHaveBeenCalledTimes(1);
        });
    });
});

describe('createTranslatedBatches', () => {
    it('keeps a batch, gives it back and forgets it when asked', () => {
        const batches = createTranslatedBatches();
        expect(batches.get('a')).toBeUndefined();
        batches.set('a', ['A']);
        expect(batches.get('a')).toEqual(['A']);
        batches.delete('a');
        expect(batches.get('a')).toBeUndefined();
    });

    it('forgets the oldest batch past its limit, counting a batch kept again as new', () => {
        const batches = createTranslatedBatches(2);
        batches.set('a', ['A']);
        batches.set('b', ['B']);
        batches.set('a', ['A2']);
        batches.set('c', ['C']);
        expect(batches.get('b')).toBeUndefined();
        expect(batches.get('a')).toEqual(['A2']);
        expect(batches.get('c')).toEqual(['C']);
    });

    it('keeps a hundred batches by default', () => {
        expect(MAX_KEPT_BATCHES).toBe(100);
        const batches = createTranslatedBatches();
        Array.from({ length: MAX_KEPT_BATCHES + 1 }, (_value, index) => {
            batches.set(`k${index}`, [`${index}`]);
            return index;
        });
        expect(batches.get('k0')).toBeUndefined();
        expect(batches.get('k1')).toEqual(['1']);
        expect(batches.get(`k${MAX_KEPT_BATCHES}`)).toEqual([`${MAX_KEPT_BATCHES}`]);
    });
});

describe('translateTexts going on after a failure', () => {
    const EPISODE = Array.from({ length: 80 }, (_value, index) => {
        return `line ${index}`;
    });

    it('does not ask again for the half that was translated when the other one failed, and asks anew once the translation was whole', async () => {
        const batches = createTranslatedBatches();
        const failing = vi.fn(async (_system: string, user: string): Promise<LlmCompletionResult> => {
            const texts = JSON.parse(user) as string[];
            if (texts[0] === 'line 40') {
                return { ok: false, error: { code: 'QUOTA_EXCEEDED', raw: 'no credit' } };
            }
            return answer(texts.map((text) => {
                return text.toUpperCase();
            }));
        });
        expect(await translateTexts(EPISODE, 'Spanish', { complete: failing, batches })).toEqual({ ok: false, error: { code: 'QUOTA_EXCEEDED', raw: 'no credit' } });
        expect(failing).toHaveBeenCalledTimes(2);

        const working = bracketing();
        const result = await translateTexts(EPISODE, 'Spanish', { complete: working, batches });
        expect(result).toEqual({
            ok: true,
            texts: EPISODE.map((text, index) => {
                return index < 40 ? text.toUpperCase() : `[${text}]`;
            })
        });
        expect(working).toHaveBeenCalledTimes(1);
        expect(vi.mocked(working).mock.calls[0]?.[1]).toBe(JSON.stringify(EPISODE.slice(40)));

        const again = bracketing();
        await translateTexts(EPISODE, 'Spanish', { complete: again, batches });
        expect(again).toHaveBeenCalledTimes(2);
    });

    it('does not take a batch kept for another language', async () => {
        const batches = createTranslatedBatches();
        const failing = vi.fn(async (_system: string, user: string): Promise<LlmCompletionResult> => {
            const texts = JSON.parse(user) as string[];
            return texts[0] === 'line 40' ? { ok: false, error: { code: 'NETWORK', raw: 'down' } } : answer(texts);
        });
        await translateTexts(EPISODE, 'Spanish', { complete: failing, batches });

        const german = bracketing();
        await translateTexts(EPISODE, 'German', { complete: german, batches });
        expect(german).toHaveBeenCalledTimes(2);
    });

    it('keeps nothing between translations when it is given nowhere to keep the batches', async () => {
        const failing = vi.fn(async (_system: string, user: string): Promise<LlmCompletionResult> => {
            const texts = JSON.parse(user) as string[];
            return texts[0] === 'line 40' ? { ok: false, error: { code: 'NETWORK', raw: 'down' } } : answer(texts);
        });
        await translateTexts(EPISODE, 'Spanish', { complete: failing });

        const working = bracketing();
        await translateTexts(EPISODE, 'Spanish', { complete: working });
        expect(working).toHaveBeenCalledTimes(2);
    });
});
