import { join } from 'node:path';
import { MAX_SUBTITLE_BYTES } from '@shared/anime';
import type { LlmCompletionResult } from '@shared/llm';
import type { SubtitleFileSystem } from '@main/services/subtitleFiles';
import { canBeTranslated, estimateSubtitleTranslation, translateEpisodeSubtitle, type LlmAccess } from '@main/services/subtitleTranslation';
import { PROMPT_TOKENS, systemPromptFor } from '@main/services/subtitleTranslator';

const DIR = join('/lib', 'Naruto');
const VIDEO = join(DIR, 'Naruto Episode 1.mp4');
const DEFAULT_FILE = join(DIR, 'Naruto Episode 1.vtt');
const ENGLISH_FILE = join(DIR, 'Naruto Episode 1.subtitle-English.vtt');
const FRENCH_FILE = join(DIR, 'Naruto Episode 1.subtitle-French.vtt');
const TRANSLATED_FILE = join(DIR, 'Naruto Episode 1.translated-Spanish.vtt');

const VTT = [
    'WEBVTT',
    '',
    '1',
    '00:00:01.000 --> 00:00:03.000',
    'Hello',
    '',
    '00:00:04.000 --> 00:00:06.000 align:start',
    'Bye',
    'now',
    ''
].join('\n');
const SRT = '1\n00:00:01,000 --> 00:00:03,000\nHello\n\n2\n00:00:04,000 --> 00:00:06,000\nBye\n';

function memory(contents: Record<string, string>, overrides: Partial<SubtitleFileSystem> = {}): SubtitleFileSystem & { written: Record<string, string> } {
    const written: Record<string, string> = {};
    return {
        written,
        list: (directory) => {
            return Object.keys({ ...contents, ...written })
                .filter((path) => {
                    return path.startsWith(`${directory}/`) || path.startsWith(`${directory}\\`);
                })
                .map((path) => {
                    return path.slice(directory.length + 1);
                });
        },
        read: (path) => {
            return { ...contents, ...written }[path] ?? null;
        },
        size: (path) => {
            const text = { ...contents, ...written }[path];
            return text === undefined ? null : Buffer.byteLength(text);
        },
        write: (path, content) => {
            written[path] = content;
        },
        ...overrides
    };
}

function bracketing(): ReturnType<typeof vi.fn<(system: string, user: string, signal?: AbortSignal) => Promise<LlmCompletionResult>>> {
    return vi.fn(async (_system: string, user: string): Promise<LlmCompletionResult> => {
        return {
            ok: true,
            text: JSON.stringify((JSON.parse(user) as string[]).map((text) => {
                return `[${text}]`;
            }))
        };
    });
}

function access(ask: Extract<LlmAccess, { ok: true }>['ask'] = bracketing()): LlmAccess {
    return { ok: true, ask };
}

describe('estimateSubtitleTranslation', () => {
    it('counts the cues, the requests and about the tokens of the subtitle that ani-cli picked', () => {
        const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT });
        expect(estimateSubtitleTranslation(VIDEO, { trackId: null }, files)).toEqual({ ok: true, cues: 2, batches: 1, approxTokens: Math.ceil(('Hello'.length + 'Bye\nnow'.length) / 4) * 2 + PROMPT_TOKENS });
    });

    it('reads a SubRip subtitle too', () => {
        const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: SRT });
        expect(estimateSubtitleTranslation(VIDEO, { trackId: null }, files)).toMatchObject({ ok: true, cues: 2, batches: 1 });
    });

    it('says there is no subtitle when the episode has none', () => {
        expect(estimateSubtitleTranslation(VIDEO, { trackId: null }, memory({ [VIDEO]: 'v' }))).toEqual({ ok: false, reason: 'no-source' });
    });

    it('says there is no subtitle when the one asked for is not there', () => {
        const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT });
        expect(estimateSubtitleTranslation(VIDEO, { trackId: 'subtitle-French' }, files)).toEqual({ ok: false, reason: 'no-source' });
    });

    it('uses the subtitle asked for, and the default one when its id is empty', () => {
        const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [FRENCH_FILE]: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nSalut\n' });
        expect(estimateSubtitleTranslation(VIDEO, { trackId: 'subtitle-French' }, files)).toMatchObject({ ok: true, cues: 1 });
        expect(estimateSubtitleTranslation(VIDEO, { trackId: '' }, files)).toMatchObject({ ok: true, cues: 2 });
    });

    it('says the file is too large', () => {
        const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT }, {
            size: () => {
                return MAX_SUBTITLE_BYTES + 1;
            }
        });
        expect(estimateSubtitleTranslation(VIDEO, { trackId: null }, files)).toEqual({ ok: false, reason: 'too-large' });
    });

    it('takes a file of exactly the largest size', () => {
        const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT }, {
            size: () => {
                return MAX_SUBTITLE_BYTES;
            }
        });
        expect(estimateSubtitleTranslation(VIDEO, { trackId: null }, files)).toMatchObject({ ok: true });
    });

    it('says the file is unreadable when it has no size or no text', () => {
        const noSize = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT }, {
            size: () => {
                return null;
            }
        });
        const noText = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT }, {
            read: () => {
                return null;
            }
        });
        expect(estimateSubtitleTranslation(VIDEO, { trackId: null }, noSize)).toEqual({ ok: false, reason: 'unreadable' });
        expect(estimateSubtitleTranslation(VIDEO, { trackId: null }, noText)).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('says the file is unreadable when it is not a subtitle', () => {
        const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: 'just some words' });
        expect(estimateSubtitleTranslation(VIDEO, { trackId: null }, files)).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('says the subtitle is empty when it has no cues', () => {
        const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: 'WEBVTT\n' });
        expect(estimateSubtitleTranslation(VIDEO, { trackId: null }, files)).toEqual({ ok: false, reason: 'empty' });
    });

    describe('picking the subtitle when none was asked for', () => {
        const other = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA\n\n00:00:03.000 --> 00:00:04.000\nB\n\n00:00:05.000 --> 00:00:06.000\nC\n';
        const english = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOnly\n';

        it('takes the English one before the others', () => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: other, [FRENCH_FILE]: other, [ENGLISH_FILE]: english });
            expect(estimateSubtitleTranslation(VIDEO, { trackId: null }, files)).toMatchObject({ ok: true, cues: 1 });
        });

        it('takes the one ani-cli picked when there is no English one', () => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [FRENCH_FILE]: other });
            expect(estimateSubtitleTranslation(VIDEO, { trackId: null }, files)).toMatchObject({ ok: true, cues: 2 });
        });

        it('takes the first one when there is no default and no English one', () => {
            const files = memory({ [VIDEO]: 'v', [FRENCH_FILE]: other });
            expect(estimateSubtitleTranslation(VIDEO, { trackId: null }, files)).toMatchObject({ ok: true, cues: 3 });
        });

        it('never takes a subtitle that is a translation already', () => {
            const files = memory({ [VIDEO]: 'v', [TRANSLATED_FILE]: other });
            expect(estimateSubtitleTranslation(VIDEO, { trackId: null }, files)).toEqual({ ok: false, reason: 'no-source' });
        });

        it('can be told to start from a translation', () => {
            const files = memory({ [VIDEO]: 'v', [TRANSLATED_FILE]: other });
            expect(estimateSubtitleTranslation(VIDEO, { trackId: 'translated-Spanish' }, files)).toMatchObject({ ok: true, cues: 3 });
        });
    });
});

describe('translateEpisodeSubtitle', () => {
    it('translates the text of each cue, keeps the rest and saves it as a subtitle of its own next to the video', async () => {
        const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT });
        const ask = bracketing();
        const onProgress = vi.fn();
        const result = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return access(ask)}, files }, onProgress);
        expect(result).toEqual({
            ok: true,
            tracks: [
                { id: '', label: 'Default', kind: 'default' },
                { id: 'translated-Spanish', label: 'Spanish', kind: 'translated' }
            ],
            translated: { id: 'translated-Spanish', label: 'Spanish', kind: 'translated' }
        });
        expect(files.written).toEqual({
            [TRANSLATED_FILE]: 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\n[Hello]\n\n00:00:04.000 --> 00:00:06.000 align:start\n[Bye\nnow]\n'
        });
        expect(ask).toHaveBeenCalledTimes(1);
        expect(ask).toHaveBeenCalledWith(systemPromptFor('Spanish'), '["Hello","Bye\\nnow"]', undefined);
        expect(onProgress.mock.calls).toEqual([[0, 2], [2, 2]]);
    });

    it('passes the signal to the model', async () => {
        const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT });
        const ask = bracketing();
        const controller = new AbortController();
        await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return access(ask)}, files }, vi.fn(), controller.signal);
        expect(ask).toHaveBeenCalledWith(systemPromptFor('Spanish'), '["Hello","Bye\\nnow"]', controller.signal);
    });

    it('starts from the subtitle asked for', async () => {
        const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [FRENCH_FILE]: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nSalut\n' });
        const ask = bracketing();
        await translateEpisodeSubtitle(VIDEO, { trackId: 'subtitle-French', language: 'Spanish' }, { llm: () => {return access(ask)}, files }, vi.fn());
        expect(ask).toHaveBeenCalledWith(systemPromptFor('Spanish'), '["Salut"]', undefined);
        expect(files.written[TRANSLATED_FILE]).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n[Salut]\n');
    });

    it('translates a SubRip subtitle into WebVTT', async () => {
        const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: SRT });
        await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return access()}, files }, vi.fn());
        expect(files.written[TRANSLATED_FILE]).toBe('WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\n[Hello]\n\n2\n00:00:04.000 --> 00:00:06.000\n[Bye]\n');
    });

    it('keeps the preamble of the subtitle and the cues that have no text', async () => {
        const source = 'WEBVTT - fansub\n\nSTYLE\n::cue { color: red }\n\n00:00:01.000 --> 00:00:02.000\nHi\n\n00:00:03.000 --> 00:00:04.000\n';
        const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: source });
        await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return access()}, files }, vi.fn());
        expect(files.written[TRANSLATED_FILE]).toBe('WEBVTT - fansub\n\nSTYLE\n::cue { color: red }\n\n00:00:01.000 --> 00:00:02.000\n[Hi]\n\n00:00:03.000 --> 00:00:04.000\n\n');
    });

    describe('when the episode has the subtitle in that language already', () => {
        const OLD = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nold\n';

        it('says it exists, asks the model for nothing, and leaves the file as it was', async () => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [TRANSLATED_FILE]: OLD });
            const ask = bracketing();
            const onProgress = vi.fn();
            const result = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return access(ask)}, files }, onProgress);
            expect(result).toEqual({ ok: false, reason: 'exists' });
            expect(ask).not.toHaveBeenCalled();
            expect(onProgress).not.toHaveBeenCalled();
            expect(files.written).toEqual({});
            expect(files.read(TRANSLATED_FILE)).toBe(OLD);
        });

        it('says it exists before looking at the settings and at the subtitle to start from, so nothing else is asked of the user', async () => {
            const llm = vi.fn((): LlmAccess => {
                return { ok: false, reason: 'no-token' };
            });
            const read = vi.fn(() => {
                return VTT;
            });
            const files = memory({ [VIDEO]: 'v', [TRANSLATED_FILE]: OLD }, { read });
            const result = await translateEpisodeSubtitle(VIDEO, { trackId: 'subtitle-English', language: 'Spanish' }, { llm, files }, vi.fn());
            expect(result).toEqual({ ok: false, reason: 'exists' });
            expect(llm).not.toHaveBeenCalled();
            expect(read).not.toHaveBeenCalled();
        });

        it('says it exists whichever subtitle it was asked to start from', async () => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [ENGLISH_FILE]: VTT, [FRENCH_FILE]: VTT, [TRANSLATED_FILE]: OLD });
            const ask = bracketing();
            for (const trackId of [null, 'subtitle-English', 'subtitle-French']) {
                const result = await translateEpisodeSubtitle(VIDEO, { trackId, language: 'Spanish' }, { llm: () => {return access(ask)}, files }, vi.fn());
                expect(result).toEqual({ ok: false, reason: 'exists' });
            }
            expect(ask).not.toHaveBeenCalled();
            expect(files.written).toEqual({});
        });

        it('translates into another language the episode does not have yet, keeping the one it has', async () => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [TRANSLATED_FILE]: OLD });
            const ask = bracketing();
            const result = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'German' }, { llm: () => {return access(ask)}, files }, vi.fn());
            expect(result).toMatchObject({ ok: true, translated: { id: 'translated-German' } });
            expect(ask).toHaveBeenCalledTimes(1);
            expect(Object.keys(files.written)).toEqual([join(DIR, 'Naruto Episode 1.translated-German.vtt')]);
            expect(files.read(TRANSLATED_FILE)).toBe(OLD);
        });

        it.each([
            ['the source', 'Naruto Episode 1.subtitle-Spanish.vtt'],
            ['the source, named in the language itself as the file name writes it', 'Naruto Episode 1.subtitle-Espa_ol.vtt'],
            ['the source, named by a code', 'Naruto Episode 1.subtitle-es-419.vtt'],
            ['the audio', 'Naruto Episode 1.generated-Spanish.vtt'],
            ['a file the user loaded', 'Naruto Episode 1.import-fansub Spanish.vtt']
        ])('asks nothing when a subtitle of %s is in that language already (it is more reliable than a translation)', async (_from, name) => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [join(DIR, name)]: SRT });
            const ask = bracketing();
            const result = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return access(ask)}, files }, vi.fn());
            expect(result).toEqual({ ok: false, reason: 'exists' });
            expect(ask).not.toHaveBeenCalled();
            expect(files.written).toEqual({});
        });

        it('asks nothing for Brazilian Portuguese when the source has the subtitle in Portuguese', async () => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [join(DIR, 'Naruto Episode 1.subtitle-Portuguese - Brazilian Portuguese.vtt')]: SRT });
            const ask = bracketing();
            const result = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Portuguese (Brazil)', replace: false }, { llm: () => {return access(ask)}, files }, vi.fn());
            expect(result).toEqual({ ok: false, reason: 'exists' });
            expect(ask).not.toHaveBeenCalled();
        });

        it('translates from a subtitle of that language that is not a translation when the request says to replace', async () => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [join(DIR, 'Naruto Episode 1.subtitle-Spanish.vtt')]: SRT });
            const ask = bracketing();
            const result = await translateEpisodeSubtitle(VIDEO, { trackId: 'subtitle-Spanish', language: 'Spanish', replace: true }, { llm: () => {return access(ask)}, files }, vi.fn());
            expect(result).toMatchObject({ ok: true, translated: { id: 'translated-Spanish' } });
            expect(ask).toHaveBeenCalledTimes(1);
            expect(files.written[TRANSLATED_FILE]).toContain('[Hello]');
        });

        it('translates when the subtitles of the episode are in other languages only', async () => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [join(DIR, 'Naruto Episode 1.subtitle-English.vtt')]: SRT, [join(DIR, 'Naruto Episode 1.subtitle-Portuguese.vtt')]: SRT });
            const ask = bracketing();
            const result = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return access(ask)}, files }, vi.fn());
            expect(result).toMatchObject({ ok: true, translated: { id: 'translated-Spanish' } });
            expect(ask).toHaveBeenCalledTimes(1);
        });

        it('says it exists when the request says not to replace, as when it says nothing', async () => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [TRANSLATED_FILE]: OLD });
            const ask = bracketing();
            const result = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish', replace: false }, { llm: () => {return access(ask)}, files }, vi.fn());
            expect(result).toEqual({ ok: false, reason: 'exists' });
            expect(ask).not.toHaveBeenCalled();
            expect(files.written).toEqual({});
        });

        it('translates again and replaces the translation that was there when the request says to replace', async () => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [TRANSLATED_FILE]: OLD });
            const ask = bracketing();
            const onProgress = vi.fn();
            const result = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish', replace: true }, { llm: () => {return access(ask)}, files }, onProgress);
            expect(result).toEqual({
                ok: true,
                tracks: [
                    { id: '', label: 'Default', kind: 'default' },
                    { id: 'translated-Spanish', label: 'Spanish', kind: 'translated' }
                ],
                translated: { id: 'translated-Spanish', label: 'Spanish', kind: 'translated' }
            });
            expect(ask).toHaveBeenCalledTimes(1);
            expect(ask).toHaveBeenCalledWith(systemPromptFor('Spanish'), '["Hello","Bye\\nnow"]', undefined);
            expect(onProgress.mock.calls).toEqual([[0, 2], [2, 2]]);
            expect(files.written).toEqual({
                [TRANSLATED_FILE]: 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\n[Hello]\n\n00:00:04.000 --> 00:00:06.000 align:start\n[Bye\nnow]\n'
            });
            expect(files.read(TRANSLATED_FILE)).not.toBe(OLD);
        });

        it('keeps the translation that was there when replacing it fails', async () => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [TRANSLATED_FILE]: OLD });
            const ask = vi.fn(async (): Promise<LlmCompletionResult> => {
                return { ok: false, error: { code: 'INVALID_TOKEN', raw: 'bad key' } };
            });
            const result = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish', replace: true }, { llm: () => {return access(ask)}, files }, vi.fn());
            expect(result).toEqual({ ok: false, reason: 'failed', error: { code: 'INVALID_TOKEN', raw: 'bad key' } });
            expect(files.written).toEqual({});
            expect(files.read(TRANSLATED_FILE)).toBe(OLD);
        });

        it('still needs the settings to replace: with no token nothing is asked and the translation is kept', async () => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [TRANSLATED_FILE]: OLD });
            const result = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish', replace: true }, { llm: () => {return { ok: false, reason: 'no-token' }}, files }, vi.fn());
            expect(result).toEqual({ ok: false, reason: 'no-token' });
            expect(files.written).toEqual({});
            expect(files.read(TRANSLATED_FILE)).toBe(OLD);
        });

        it('translates as usual when the request says to replace and there is nothing to replace', async () => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT });
            const result = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish', replace: true }, { llm: () => {return access()}, files }, vi.fn());
            expect(result).toMatchObject({ ok: true, translated: { id: 'translated-Spanish' } });
            expect(files.written[TRANSLATED_FILE]).toContain('[Hello]');
        });

        it('translates it again after the translation is gone', async () => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT });
            const first = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return access()}, files }, vi.fn());
            expect(first).toMatchObject({ ok: true });
            const second = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return access()}, files }, vi.fn());
            expect(second).toEqual({ ok: false, reason: 'exists' });
        });
    });

    it('keeps the translations into other languages apart', async () => {
        const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [join(DIR, 'Naruto Episode 1.translated-German.vtt')]: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHallo\n' });
        const result = await translateEpisodeSubtitle(VIDEO, { trackId: 'subtitle-English', language: 'Spanish' }, { llm: () => {return access()}, files }, vi.fn());
        expect(result).toEqual({ ok: false, reason: 'no-source' });
        const auto = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return access()}, files }, vi.fn());
        expect(auto).toMatchObject({ ok: true, tracks: [{ kind: 'default' }, { id: 'translated-German' }, { id: 'translated-Spanish' }] });
    });

    it('passes the pause for rate limits on to the translator', async () => {
        const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT });
        const sleep = vi.fn(async () => {
            return undefined;
        });
        const ask = vi.fn<(system: string, user: string, signal?: AbortSignal) => Promise<LlmCompletionResult>>()
            .mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMITED', raw: 'slow', retryAfterSeconds: 2 } })
            .mockResolvedValueOnce({ ok: true, text: '["A","B"]' });
        const result = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return access(ask)}, files, sleep }, vi.fn());
        expect(result).toMatchObject({ ok: true });
        expect(sleep).toHaveBeenCalledWith(2000, undefined);
    });

    describe('when it cannot start', () => {
        it.each(['no-token', 'no-model', 'no-address'] as const)('says the settings lack what "%s" says, and reads and asks for nothing', async (reason) => {
            const read = vi.fn(() => {
                return VTT;
            });
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT }, { read });
            const result = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return { ok: false, reason }}, files }, vi.fn());
            expect(result).toEqual({ ok: false, reason });
            expect(read).not.toHaveBeenCalled();
            expect(files.written).toEqual({});
        });

        it.each([
            ['there is no subtitle', memory({ [VIDEO]: 'v' }), 'no-source'],
            ['the file is too large', memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT }, { size: () => { return MAX_SUBTITLE_BYTES + 1; } }), 'too-large'],
            ['the file cannot be read', memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT }, { read: () => { return null; } }), 'unreadable'],
            ['the file is not a subtitle', memory({ [VIDEO]: 'v', [DEFAULT_FILE]: 'words' }), 'unreadable'],
            ['the subtitle has no cues', memory({ [VIDEO]: 'v', [DEFAULT_FILE]: 'WEBVTT\n' }), 'empty']
        ] as const)('says why when %s, and asks the model for nothing', async (_name, files, reason) => {
            const ask = bracketing();
            const result = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return access(ask)}, files }, vi.fn());
            expect(result).toEqual({ ok: false, reason });
            expect(ask).not.toHaveBeenCalled();
            expect(files.written).toEqual({});
        });
    });

    describe('when it does not work', () => {
        it('gives the error of the provider and saves nothing', async () => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT });
            const ask = vi.fn(async (): Promise<LlmCompletionResult> => {
                return { ok: false, error: { code: 'INVALID_TOKEN', raw: 'bad key' } };
            });
            const result = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return access(ask)}, files }, vi.fn());
            expect(result).toEqual({ ok: false, reason: 'failed', error: { code: 'INVALID_TOKEN', raw: 'bad key' } });
            expect(files.written).toEqual({});
        });

        it('says it was cancelled, and saves nothing, when the signal is aborted', async () => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT });
            const controller = new AbortController();
            controller.abort();
            const ask = bracketing();
            const result = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return access(ask)}, files }, vi.fn(), controller.signal);
            expect(result).toEqual({ ok: false, reason: 'cancelled' });
            expect(ask).not.toHaveBeenCalled();
            expect(files.written).toEqual({});
        });

        it('says it was cancelled when the model answers that it was', async () => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT });
            const ask = vi.fn(async (): Promise<LlmCompletionResult> => {
                return { ok: false, error: { code: 'CANCELLED', raw: 'The translation was cancelled.' } };
            });
            expect(await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return access(ask)}, files }, vi.fn())).toEqual({ ok: false, reason: 'cancelled' });
        });

        it('says the file is unreadable when it cannot be saved', async () => {
            const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT }, {
                write: () => {
                    throw new Error('disk full');
                }
            });
            expect(await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return access()}, files }, vi.fn())).toEqual({ ok: false, reason: 'unreadable' });
        });

        it('says the file is unreadable when it is not among the subtitles after it was saved', async () => {
            const base = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT });
            const files: SubtitleFileSystem = {
                ...base,
                list: (directory) => {
                    return base.list(directory).filter((name) => {
                        return !name.includes('translated-');
                    });
                }
            };
            expect(await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return access()}, files }, vi.fn())).toEqual({ ok: false, reason: 'unreadable' });
        });
    });
});

describe('canBeTranslated', () => {
    it('is true for an episode with a subtitle in another language only', () => {
        expect(canBeTranslated(VIDEO, 'Spanish', memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [join(DIR, 'Naruto Episode 1.subtitle-English.vtt')]: SRT }))).toBe(true);
    });

    it('is false for an episode with no subtitle to start from', () => {
        expect(canBeTranslated(VIDEO, 'Spanish', memory({ [VIDEO]: 'v' }))).toBe(false);
    });

    it('is false for an episode whose only subtitle is a translation into another language', () => {
        expect(canBeTranslated(VIDEO, 'Spanish', memory({ [VIDEO]: 'v', [join(DIR, 'Naruto Episode 1.translated-German.vtt')]: VTT }))).toBe(false);
    });

    it('is false for an episode translated into the language already', () => {
        expect(canBeTranslated(VIDEO, 'Spanish', memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [TRANSLATED_FILE]: VTT }))).toBe(false);
    });

    it.each([
        ['the source', 'Naruto Episode 1.subtitle-Spanish (- Spanish(Latin America)).vtt'],
        ['the source, by a code', 'Naruto Episode 1.subtitle-es-419.vtt'],
        ['the audio', 'Naruto Episode 1.generated-Spanish.vtt'],
        ['a file the user loaded', 'Naruto Episode 1.import-mine Spanish.vtt']
    ])('is false for an episode with a subtitle of %s in the language', (_from, name) => {
        expect(canBeTranslated(VIDEO, 'Spanish', memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [join(DIR, name)]: SRT }))).toBe(false);
    });

    it('takes both kinds of Portuguese for one', () => {
        expect(canBeTranslated(VIDEO, 'Portuguese (Brazil)', memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [join(DIR, 'Naruto Episode 1.subtitle-Portuguese (- Portuguese(Brazil)).vtt')]: SRT }))).toBe(false);
    });
});
