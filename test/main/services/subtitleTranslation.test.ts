import { join } from 'node:path';
import { MAX_SUBTITLE_BYTES } from '@shared/anime';
import type { LlmCompletionResult } from '@shared/llm';
import type { SubtitleFileSystem } from '@main/services/subtitleFiles';
import { estimateSubtitleTranslation, translateEpisodeSubtitle, type LlmAccess } from '@main/services/subtitleTranslation';
import { systemPromptFor } from '@main/services/subtitleTranslator';

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
        expect(estimateSubtitleTranslation(VIDEO, { trackId: null }, files)).toEqual({ ok: true, cues: 2, batches: 1, approxTokens: Math.ceil(('Hello'.length + 'Bye\nnow'.length) / 4) * 2 + 150 });
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

    it('replaces the translation into the same language that was there', async () => {
        const files = memory({ [VIDEO]: 'v', [DEFAULT_FILE]: VTT, [TRANSLATED_FILE]: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nold\n' });
        const result = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish' }, { llm: () => {return access()}, files }, vi.fn());
        expect(files.written[TRANSLATED_FILE]).toContain('[Hello]');
        expect(result).toMatchObject({ ok: true, translated: { id: 'translated-Spanish' } });
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
