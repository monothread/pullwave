import { join } from 'node:path';
import type { LlmCompletionResult } from '@shared/llm';
import type { AudioFiles, FfmpegRunner } from '@main/services/audioExtractor';
import type { SubtitleFileSystem } from '@main/services/subtitleFiles';
import {
    estimateSubtitleGeneration,
    generateEpisodeSubtitle,
    type GenerationProgressExtra,
    type SpeechAccess,
    type SubtitleGenerationDependencies
} from '@main/services/subtitleGeneration';
import type { LlmAccess } from '@main/services/subtitleTranslation';
import { systemPromptFor } from '@main/services/subtitleTranslator';

const DIR = join('/lib', 'Naruto');
const VIDEO = join(DIR, 'Naruto Episode 1.mp4');
const WORK = join('/tmp', 'work');

function generatedFile(language: string): string {
    return join(DIR, `Naruto Episode 1.generated-${language}.vtt`);
}

const FIRST_PART = 'WEBVTT\n\n1\n00:01.000 --> 00:03.000\nこんにちは\n\n2\n00:04.000 --> 00:06.000 align:start\nまたね\n';
const SECOND_PART = 'WEBVTT\n\n1\n00:02.000 --> 00:04.500\nただいま\n';
const TRANSCRIBED = [
    'WEBVTT',
    '',
    '00:00:01.000 --> 00:00:03.000',
    'こんにちは',
    '',
    '00:00:04.000 --> 00:00:06.000 align:start',
    'またね',
    '',
    '00:10:02.000 --> 00:10:04.500',
    'ただいま',
    ''
].join('\n');
const PART_SIZES: Record<string, number> = { 'part-000.mp3': 1000, 'part-001.mp3': 600 };

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

function audioFiles(names: string[] = ['part-000.mp3', 'part-001.mp3']): AudioFiles & { removed: string[] } {
    const removed: string[] = [];
    return {
        removed,
        makeDirectory: vi.fn(() => {
            return WORK;
        }),
        list: vi.fn(() => {
            return names;
        }),
        read: vi.fn((path: string) => {
            return new TextEncoder().encode(path);
        }),
        size: vi.fn((path: string) => {
            return PART_SIZES[path.slice(WORK.length + 1)] ?? 0;
        }),
        remove: vi.fn((directory: string) => {
            removed.push(directory);
        })
    };
}

function ffmpegOk(): ReturnType<typeof vi.fn<FfmpegRunner>> {
    return vi.fn<FfmpegRunner>(async () => {
        return { code: 0, stderr: '' };
    });
}

type Ask = Extract<SpeechAccess, { ok: true }>['ask'];
type Translates = 'english' | 'any';
type Translate = Extract<LlmAccess, { ok: true }>['ask'];

function speaking(...answers: Array<string | LlmCompletionResult>): ReturnType<typeof vi.fn<Ask>> {
    const queue = [...answers];
    return vi.fn<Ask>(async (): Promise<LlmCompletionResult> => {
        const next = queue.shift() ?? 'WEBVTT\n';
        return typeof next === 'string' ? { ok: true, text: next } : next;
    });
}

// A model that translates by putting the text between brackets.
function translating(): ReturnType<typeof vi.fn<Translate>> {
    return vi.fn<Translate>(async (_system, user): Promise<LlmCompletionResult> => {
        return { ok: true, text: JSON.stringify((JSON.parse(user) as string[]).map((text) => {
            return `[${text}]`;
        })) };
    });
}

function setup(ask: ReturnType<typeof vi.fn<Ask>>, translate: ReturnType<typeof vi.fn<Translate>> = translating(), extra: Partial<SubtitleGenerationDependencies> = {}, translatesTo: Translates = 'english') {
    const files = memory({ [VIDEO]: 'v' });
    const audio = audioFiles();
    const ffmpeg = ffmpegOk();
    const translation = vi.fn((): LlmAccess => {
        return { ok: true, ask: translate };
    });
    const dependencies: SubtitleGenerationDependencies = {
        speech: () => {
            return { ok: true, translatesTo, ask };
        },
        translation,
        ffmpeg,
        audio,
        files,
        ...extra
    };
    return { files, audio, ffmpeg, translation, translate, dependencies };
}

describe('estimateSubtitleGeneration', () => {
    const WITH_AUDIO = (duration: string): string => {
        return `  Duration: ${duration}, start: 0.000000\n  Stream #0:1: Audio: aac (LC), 48000 Hz, stereo`;
    };

    it('says how long the audio is, in how many parts of ten minutes it goes and about how many bytes that is', async () => {
        const ffmpeg = vi.fn<FfmpegRunner>(async () => {
            return { code: 1, stderr: WITH_AUDIO('00:24:03.52') };
        });
        expect(await estimateSubtitleGeneration(VIDEO, ffmpeg)).toEqual({ ok: true, seconds: 24 * 60 + 3.52, parts: 3, approxBytes: Math.round((24 * 60 + 3.52) * 4000) });
        expect(ffmpeg).toHaveBeenCalledWith(['-hide_banner', '-nostdin', '-i', VIDEO]);
    });

    it.each([
        ['00:10:00.00', 1],
        ['00:10:00.01', 2],
        ['00:00:05.00', 1],
        ['00:00:00.00', 1],
        ['01:00:00.00', 6]
    ])('goes in the right number of parts for %s', async (duration, parts) => {
        const ffmpeg = vi.fn<FfmpegRunner>(async () => {
            return { code: 1, stderr: WITH_AUDIO(duration) };
        });
        expect(await estimateSubtitleGeneration(VIDEO, ffmpeg)).toMatchObject({ ok: true, parts });
    });

    it.each(['no-audio', 'extract-failed'] as const)('says why when the audio cannot be measured (%s)', async (reason) => {
        const stderr = reason === 'no-audio' ? '  Duration: 00:24:03.52, start: 0.0\n  Stream #0:0: Video: h264' : 'garbage';
        const ffmpeg = vi.fn<FfmpegRunner>(async () => {
            return { code: 1, stderr };
        });
        expect(await estimateSubtitleGeneration(VIDEO, ffmpeg)).toEqual({ ok: false, reason });
    });
});

describe('generateEpisodeSubtitle: transcribing, when the subtitle is in the language that is spoken', () => {
    it('takes the audio out, sends each part, puts the cues together with the times of each part moved to where it starts, and saves them', async () => {
        const ask = speaking(FIRST_PART, SECOND_PART);
        const { files, audio, ffmpeg, translation, dependencies } = setup(ask);
        const result = await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, vi.fn());
        expect(result).toEqual({
            ok: true,
            tracks: [{ id: 'generated-Japanese', label: 'Japanese', kind: 'generated' }],
            generated: { id: 'generated-Japanese', label: 'Japanese', kind: 'generated' }
        });
        expect(files.written).toEqual({ [generatedFile('Japanese')]: TRANSCRIBED });
        expect(ffmpeg).toHaveBeenCalledTimes(1);
        expect(ffmpeg.mock.calls[0]?.[0]).toContain(VIDEO);
        expect(ffmpeg.mock.calls[0]?.[0].at(-1)).toBe(join(WORK, 'part-%03d.mp3'));
        expect(audio.removed).toEqual([WORK]);
        expect(translation).not.toHaveBeenCalled();
    });

    it('asks each part to be transcribed, with its audio, a name for the file, the two letters of the language and the signal, one after the other', async () => {
        const ask = speaking(FIRST_PART, SECOND_PART);
        const { dependencies } = setup(ask);
        const controller = new AbortController();
        await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'English', language: 'English' }, dependencies, vi.fn(), controller.signal);
        expect(ask.mock.calls).toEqual([
            [{ task: 'transcribe', audio: new TextEncoder().encode(join(WORK, 'part-000.mp3')), fileName: 'part-0.mp3', languageCode: 'en', audioLanguage: 'English', language: 'English', signal: controller.signal }],
            [{ task: 'transcribe', audio: new TextEncoder().encode(join(WORK, 'part-001.mp3')), fileName: 'part-1.mp3', languageCode: 'en', audioLanguage: 'English', language: 'English', signal: controller.signal }]
        ]);
    });

    it('does not wait for the next part before the answer of the one before', async () => {
        const order: string[] = [];
        const ask = vi.fn<Ask>(async (input): Promise<LlmCompletionResult> => {
            order.push(`start ${input.fileName}`);
            await Promise.resolve();
            order.push(`end ${input.fileName}`);
            return { ok: true, text: 'WEBVTT\n' };
        });
        const { dependencies } = setup(ask);
        await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, vi.fn());
        expect(order).toEqual(['start part-0.mp3', 'end part-0.mp3', 'start part-1.mp3', 'end part-1.mp3']);
    });

    it('tells the phase and the plan at every step, with how many parts and bytes were sent', async () => {
        const { dependencies } = setup(speaking(FIRST_PART, SECOND_PART));
        const onProgress = vi.fn<(done: number, total: number, extra: GenerationProgressExtra) => void>();
        await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, onProgress);
        expect(onProgress.mock.calls).toEqual([
            [0, 1, { phase: 'extracting', plan: 'transcribe' }],
            [0, 2, { phase: 'sending', plan: 'transcribe', sentBytes: 0, totalBytes: 1600 }],
            [1, 2, { phase: 'sending', plan: 'transcribe', sentBytes: 1000, totalBytes: 1600 }],
            [2, 2, { phase: 'sending', plan: 'transcribe', sentBytes: 1600, totalBytes: 1600 }],
            [0, 1, { phase: 'saving', plan: 'transcribe' }]
        ]);
    });

    it('only transcribes Portuguese audio for a subtitle in Brazilian Portuguese, and names the subtitle after the one that is wanted', async () => {
        const ask = speaking(FIRST_PART, SECOND_PART);
        const { files, translation, dependencies } = setup(ask);
        await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Portuguese', language: 'Portuguese (Brazil)' }, dependencies, vi.fn());
        expect(ask.mock.calls.map((call) => {
            return [call[0].task, call[0].languageCode];
        })).toEqual([['transcribe', 'pt'], ['transcribe', 'pt']]);
        expect(Object.keys(files.written)).toEqual([generatedFile('Portuguese (Brazil)')]);
        expect(translation).not.toHaveBeenCalled();
    });

    it('replaces the subtitle that was there for the language', async () => {
        const existing = memory({ [VIDEO]: 'v', [generatedFile('Japanese')]: 'WEBVTT\n\n00:01.000 --> 00:02.000\nold\n' });
        const { dependencies } = setup(speaking(FIRST_PART, SECOND_PART), translating(), { files: existing });
        await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, vi.fn());
        expect(existing.written[generatedFile('Japanese')]).toBe(TRANSCRIBED);
    });
});

describe('generateEpisodeSubtitle: having the audio translated into English at once', () => {
    it('asks each part to be translated, without translating the text afterwards, and saves only the subtitle in English', async () => {
        const ask = speaking('WEBVTT\n\n1\n00:01.000 --> 00:03.000\nHello\n', 'WEBVTT\n\n00:02.000 --> 00:04.000\nI am home\n');
        const { files, translation, dependencies } = setup(ask);
        const onProgress = vi.fn<(done: number, total: number, extra: GenerationProgressExtra) => void>();
        const result = await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'English' }, dependencies, onProgress);
        expect(result).toMatchObject({ ok: true, generated: { id: 'generated-English', label: 'English', kind: 'generated' } });
        expect(ask.mock.calls.map((call) => {
            return [call[0].task, call[0].fileName];
        })).toEqual([['translate', 'part-0.mp3'], ['translate', 'part-1.mp3']]);
        expect(files.written).toEqual({ [generatedFile('English')]: 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello\n\n00:10:02.000 --> 00:10:04.000\nI am home\n' });
        expect(translation).not.toHaveBeenCalled();
        expect(onProgress.mock.calls.map((call) => {
            return [call[2].phase, call[2].plan];
        })).toEqual([['extracting', 'direct'], ['sending', 'direct'], ['sending', 'direct'], ['sending', 'direct'], ['saving', 'direct']]);
    });

    it('does not ask for the translation of the text when the audio is already in English', async () => {
        const ask = speaking(FIRST_PART, SECOND_PART);
        const { translation, dependencies } = setup(ask);
        await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'English', language: 'English' }, dependencies, vi.fn());
        expect(ask.mock.calls.map((call) => {
            return call[0].task;
        })).toEqual(['transcribe', 'transcribe']);
        expect(translation).not.toHaveBeenCalled();
    });

    describe('when the service refuses to do it', () => {
        const REFUSED: LlmCompletionResult = { ok: false, error: { code: 'BAD_RESPONSE', raw: 'HTTP 400: response_format vtt is not supported' } };

        it('sends the audio again to be transcribed, and translates the text into English afterwards', async () => {
            const ask = speaking(REFUSED, FIRST_PART, SECOND_PART);
            const { files, translation, translate, dependencies } = setup(ask);
            const onProgress = vi.fn<(done: number, total: number, extra: GenerationProgressExtra) => void>();
            const result = await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'English' }, dependencies, onProgress);
            expect(result).toMatchObject({ ok: true, generated: { id: 'generated-English' } });
            expect(ask.mock.calls.map((call) => {
                return [call[0].task, call[0].fileName, call[0].languageCode];
            })).toEqual([['translate', 'part-0.mp3', 'ja'], ['transcribe', 'part-0.mp3', 'ja'], ['transcribe', 'part-1.mp3', 'ja']]);
            expect(translation).toHaveBeenCalledTimes(1);
            expect(translate).toHaveBeenCalledTimes(1);
            expect(translate.mock.calls[0]?.[0]).toBe(systemPromptFor('English'));
            expect(translate.mock.calls[0]?.[1]).toBe(JSON.stringify(['こんにちは', 'またね', 'ただいま']));
            expect(files.written[generatedFile('English')]).toContain('[こんにちは]');
            expect(onProgress.mock.calls.map((call) => {
                return [call[2].phase, call[2].plan];
            })).toEqual([
                ['extracting', 'direct'],
                ['sending', 'direct'],
                ['sending', 'transcribe-translate'],
                ['sending', 'transcribe-translate'],
                ['sending', 'transcribe-translate'],
                ['translating', 'transcribe-translate'],
                ['translating', 'transcribe-translate'],
                ['translating', 'transcribe-translate'],
                ['saving', 'transcribe-translate']
            ]);
        });

        it.each([
            ['no-token', 'no-translation-token'],
            ['no-model', 'no-translation-model'],
            ['no-address', 'no-translation-address']
        ] as const)('says the translation lacks what "%s" says, when there is nothing to translate the text with', async (lack, reason) => {
            const ask = speaking(REFUSED, FIRST_PART);
            const { files, audio, dependencies } = setup(ask, translating(), {
                translation: () => {
                    return { ok: false, reason: lack };
                }
            });
            expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'English' }, dependencies, vi.fn())).toEqual({ ok: false, reason });
            expect(ask).toHaveBeenCalledTimes(1);
            expect(files.written).toEqual({});
            expect(audio.removed).toEqual([WORK]);
        });

        it('does not go on with a transcription when the refusal is of another kind', async () => {
            const ask = speaking({ ok: false, error: { code: 'INVALID_TOKEN', raw: 'bad key' } });
            const { translation, dependencies } = setup(ask);
            expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'English' }, dependencies, vi.fn())).toEqual({
                ok: false,
                reason: 'failed',
                error: { code: 'INVALID_TOKEN', raw: 'bad key' }
            });
            expect(ask).toHaveBeenCalledTimes(1);
            expect(translation).not.toHaveBeenCalled();
        });

        it('does not go on with a transcription when it is the second part that is refused', async () => {
            const ask = speaking(FIRST_PART, REFUSED);
            const { translation, dependencies } = setup(ask);
            expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'English' }, dependencies, vi.fn())).toEqual({
                ok: false,
                reason: 'failed',
                error: REFUSED.ok ? { code: 'BAD_RESPONSE', raw: '' } : REFUSED.error
            });
            expect(ask).toHaveBeenCalledTimes(2);
            expect(translation).not.toHaveBeenCalled();
        });
    });
});

describe('generateEpisodeSubtitle: having the audio written in any language at once, for a service that can', () => {
    const REFUSED: LlmCompletionResult = { ok: false, error: { code: 'BAD_RESPONSE', raw: 'The answer is not a list of subtitle lines with times' } };

    it('asks each part to be written in the language of the subtitle, whichever it is, and never translates the text afterwards', async () => {
        const ask = speaking(FIRST_PART, SECOND_PART);
        const { files, translation, dependencies } = setup(ask, translating(), {}, 'any');
        const onProgress = vi.fn<(done: number, total: number, extra: GenerationProgressExtra) => void>();
        const result = await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Portuguese (Brazil)' }, dependencies, onProgress);
        expect(result).toMatchObject({ ok: true, generated: { id: 'generated-Portuguese (Brazil)', label: 'Portuguese (Brazil)', kind: 'generated' } });
        expect(
            ask.mock.calls.map((call) => {
                return [call[0].task, call[0].fileName, call[0].audioLanguage, call[0].language, call[0].languageCode];
            })
        ).toEqual([
            ['translate', 'part-0.mp3', 'Japanese', 'Portuguese (Brazil)', 'ja'],
            ['translate', 'part-1.mp3', 'Japanese', 'Portuguese (Brazil)', 'ja']
        ]);
        expect(files.written).toEqual({ [generatedFile('Portuguese (Brazil)')]: TRANSCRIBED });
        expect(translation).not.toHaveBeenCalled();
        expect(
            onProgress.mock.calls.map((call) => {
                return [call[2].phase, call[2].plan];
            })
        ).toEqual([['extracting', 'direct'], ['sending', 'direct'], ['sending', 'direct'], ['sending', 'direct'], ['saving', 'direct']]);
    });

    it('does the same for English, which the other services also do at once', async () => {
        const ask = speaking(FIRST_PART, SECOND_PART);
        const { dependencies } = setup(ask, translating(), {}, 'any');
        await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'English' }, dependencies, vi.fn());
        expect(
            ask.mock.calls.map((call) => {
                return call[0].task;
            })
        ).toEqual(['translate', 'translate']);
    });

    it.each([
        ['Japanese', 'Japanese'],
        ['Portuguese', 'Portuguese (Brazil)']
    ] as const)('only transcribes audio in %s for a subtitle in %s', async (audioLanguage, language) => {
        const ask = speaking(FIRST_PART, SECOND_PART);
        const { translation, dependencies } = setup(ask, translating(), {}, 'any');
        await generateEpisodeSubtitle(VIDEO, { audioLanguage, language }, dependencies, vi.fn());
        expect(
            ask.mock.calls.map((call) => {
                return call[0].task;
            })
        ).toEqual(['transcribe', 'transcribe']);
        expect(translation).not.toHaveBeenCalled();
    });

    it('does not look for the translation before sending, since the plan does not need it', async () => {
        const translation = vi.fn((): LlmAccess => {
            return { ok: false, reason: 'no-token' };
        });
        const { dependencies } = setup(speaking(FIRST_PART, SECOND_PART), translating(), { translation }, 'any');
        expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Spanish' }, dependencies, vi.fn())).toMatchObject({ ok: true });
        expect(translation).not.toHaveBeenCalled();
    });

    it('sends the audio again to be transcribed, and translates the text, when the first part is answered with something that is not a subtitle', async () => {
        const ask = speaking(REFUSED, FIRST_PART, SECOND_PART);
        const { files, translate, dependencies } = setup(ask, translating(), {}, 'any');
        const onProgress = vi.fn<(done: number, total: number, extra: GenerationProgressExtra) => void>();
        const result = await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Spanish' }, dependencies, onProgress);
        expect(result).toMatchObject({ ok: true, generated: { id: 'generated-Spanish' } });
        expect(
            ask.mock.calls.map((call) => {
                return [call[0].task, call[0].fileName];
            })
        ).toEqual([['translate', 'part-0.mp3'], ['transcribe', 'part-0.mp3'], ['transcribe', 'part-1.mp3']]);
        expect(translate).toHaveBeenCalledTimes(1);
        expect(translate.mock.calls[0]?.[0]).toBe(systemPromptFor('Spanish'));
        expect(files.written[generatedFile('Spanish')]).toContain('[こんにちは]');
        expect(onProgress.mock.calls.at(-2)?.[2]).toEqual({ phase: 'translating', plan: 'transcribe-translate' });
    });

    it('says the translation lacks what it lacks, when the answer is refused and there is nothing to translate the text with', async () => {
        const ask = speaking(REFUSED, FIRST_PART);
        const { files, audio, dependencies } = setup(ask, translating(), {
            translation: () => {
                return { ok: false, reason: 'no-model' };
            }
        }, 'any');
        expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Spanish' }, dependencies, vi.fn())).toEqual({ ok: false, reason: 'no-translation-model' });
        expect(ask).toHaveBeenCalledTimes(1);
        expect(files.written).toEqual({});
        expect(audio.removed).toEqual([WORK]);
    });
});

describe('generateEpisodeSubtitle: transcribing and translating the text, when the language of the subtitle is another one', () => {
    it('transcribes in the language that is spoken, translates the text into the language that is wanted, keeps the times and saves only that subtitle', async () => {
        const ask = speaking(FIRST_PART, SECOND_PART);
        const { files, translate, dependencies } = setup(ask);
        const result = await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Spanish' }, dependencies, vi.fn());
        expect(result).toEqual({
            ok: true,
            tracks: [{ id: 'generated-Spanish', label: 'Spanish', kind: 'generated' }],
            generated: { id: 'generated-Spanish', label: 'Spanish', kind: 'generated' }
        });
        expect(ask.mock.calls.map((call) => {
            return [call[0].task, call[0].languageCode];
        })).toEqual([['transcribe', 'ja'], ['transcribe', 'ja']]);
        expect(translate).toHaveBeenCalledTimes(1);
        expect(translate.mock.calls[0]?.[0]).toBe(systemPromptFor('Spanish'));
        expect(translate.mock.calls[0]?.[1]).toBe(JSON.stringify(['こんにちは', 'またね', 'ただいま']));
        expect(files.written).toEqual({
            [generatedFile('Spanish')]: TRANSCRIBED.replace('こんにちは', '[こんにちは]').replace('またね', '[またね]').replace('ただいま', '[ただいま]')
        });
    });

    it('tells how far the transcription and then the translation are', async () => {
        const { dependencies } = setup(speaking(FIRST_PART, SECOND_PART));
        const onProgress = vi.fn<(done: number, total: number, extra: GenerationProgressExtra) => void>();
        await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Spanish' }, dependencies, onProgress);
        const plan = 'transcribe-translate';
        expect(onProgress.mock.calls).toEqual([
            [0, 1, { phase: 'extracting', plan }],
            [0, 2, { phase: 'sending', plan, sentBytes: 0, totalBytes: 1600 }],
            [1, 2, { phase: 'sending', plan, sentBytes: 1000, totalBytes: 1600 }],
            [2, 2, { phase: 'sending', plan, sentBytes: 1600, totalBytes: 1600 }],
            [0, 3, { phase: 'translating', plan }],
            [0, 3, { phase: 'translating', plan }],
            [3, 3, { phase: 'translating', plan }],
            [0, 1, { phase: 'saving', plan }]
        ]);
    });

    it('gives the error of the translation and saves nothing, not even what was transcribed', async () => {
        const translate = vi.fn<Translate>(async (): Promise<LlmCompletionResult> => {
            return { ok: false, error: { code: 'QUOTA_EXCEEDED', raw: 'no credit' } };
        });
        const { files, audio, dependencies } = setup(speaking(FIRST_PART, SECOND_PART), translate);
        expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Spanish' }, dependencies, vi.fn())).toEqual({
            ok: false,
            reason: 'failed',
            error: { code: 'QUOTA_EXCEEDED', raw: 'no credit' }
        });
        expect(files.written).toEqual({});
        expect(audio.removed).toEqual([WORK]);
    });

    it('says it was cancelled when the translation was', async () => {
        const translate = vi.fn<Translate>(async (): Promise<LlmCompletionResult> => {
            return { ok: false, error: { code: 'CANCELLED', raw: 'The translation was cancelled.' } };
        });
        const { dependencies } = setup(speaking(FIRST_PART, SECOND_PART), translate);
        expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Spanish' }, dependencies, vi.fn())).toEqual({ ok: false, reason: 'cancelled' });
    });

    it('does not translate when the user cancels while the last part is answered', async () => {
        const controller = new AbortController();
        const ask = vi.fn<Ask>(async (): Promise<LlmCompletionResult> => {
            controller.abort();
            return { ok: true, text: FIRST_PART };
        });
        const { files, translate, dependencies } = setup(ask, translating(), { audio: audioFiles(['part-000.mp3']) });
        expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Spanish' }, dependencies, vi.fn(), controller.signal)).toEqual({ ok: false, reason: 'cancelled' });
        expect(translate).not.toHaveBeenCalled();
        expect(files.written).toEqual({});
    });
});

describe('generateEpisodeSubtitle: before anything is sent', () => {
    it.each(['no-token', 'no-model', 'no-address'] as const)('says the settings lack what "%s" says for the speech to text, and takes no audio out', async (reason) => {
        const ask = speaking();
        const { audio, ffmpeg, files, dependencies } = setup(ask, translating(), {
            speech: () => {
                return { ok: false, reason };
            }
        });
        expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, vi.fn())).toEqual({ ok: false, reason });
        expect(audio.makeDirectory).not.toHaveBeenCalled();
        expect(ffmpeg).not.toHaveBeenCalled();
        expect(ask).not.toHaveBeenCalled();
        expect(files.written).toEqual({});
    });

    it.each([
        ['no-token', 'no-translation-token'],
        ['no-model', 'no-translation-model'],
        ['no-address', 'no-translation-address']
    ] as const)('says the settings lack what "%s" says for the translation, when the plan needs it, before the audio is taken out or sent', async (lack, reason) => {
        const ask = speaking();
        const { audio, ffmpeg, dependencies } = setup(ask, translating(), {
            translation: () => {
                return { ok: false, reason: lack };
            }
        });
        expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Spanish' }, dependencies, vi.fn())).toEqual({ ok: false, reason });
        expect(audio.makeDirectory).not.toHaveBeenCalled();
        expect(ffmpeg).not.toHaveBeenCalled();
        expect(ask).not.toHaveBeenCalled();
    });

    it.each([
        ['Japanese', 'Japanese'],
        ['Japanese', 'English']
    ] as const)('does not look for the translation when the audio in %s goes to a subtitle in %s', async (audioLanguage, language) => {
        const translation = vi.fn((): LlmAccess => {
            return { ok: false, reason: 'no-token' };
        });
        const { dependencies } = setup(speaking(FIRST_PART, SECOND_PART), translating(), { translation });
        const result = await generateEpisodeSubtitle(VIDEO, { audioLanguage, language }, dependencies, vi.fn());
        expect(result).toMatchObject({ ok: true });
        expect(translation).not.toHaveBeenCalled();
    });

    it('says it was cancelled, and takes no audio out, when the signal was aborted already', async () => {
        const { audio, ffmpeg, dependencies } = setup(speaking());
        const controller = new AbortController();
        controller.abort();
        expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, vi.fn(), controller.signal)).toEqual({ ok: false, reason: 'cancelled' });
        expect(audio.makeDirectory).not.toHaveBeenCalled();
        expect(ffmpeg).not.toHaveBeenCalled();
    });
});

describe('generateEpisodeSubtitle: when the audio cannot be taken out', () => {
    it.each(['extract-failed', 'no-audio'] as const)('says why (%s), sends nothing and removes the folder', async (reason) => {
        const ask = speaking();
        const ffmpeg = vi.fn<FfmpegRunner>(async () => {
            return reason === 'extract-failed' ? { code: 1, stderr: 'boom' } : { code: 0, stderr: '' };
        });
        const audio = audioFiles(reason === 'no-audio' ? [] : ['part-000.mp3']);
        const { files, dependencies } = setup(ask, translating(), { ffmpeg, audio });
        expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, vi.fn())).toEqual({ ok: false, reason });
        expect(ask).not.toHaveBeenCalled();
        expect(files.written).toEqual({});
        expect(audio.removed).toEqual([WORK]);
    });

    it('says it was cancelled, not that it failed, when the user cancelled while ffmpeg ran', async () => {
        const controller = new AbortController();
        const ffmpeg = vi.fn<FfmpegRunner>(async () => {
            controller.abort();
            return { code: null, stderr: '' };
        });
        const audio = audioFiles();
        const { dependencies } = setup(speaking(), translating(), { ffmpeg, audio });
        expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, vi.fn(), controller.signal)).toEqual({ ok: false, reason: 'cancelled' });
        expect(audio.removed).toEqual([WORK]);
    });
});

describe('generateEpisodeSubtitle: when the service does not work', () => {
    it('gives the error of the service, saves nothing and removes the folder', async () => {
        const ask = speaking({ ok: false, error: { code: 'INVALID_TOKEN', raw: 'bad key' } });
        const { files, audio, dependencies } = setup(ask);
        const onProgress = vi.fn();
        expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, onProgress)).toEqual({
            ok: false,
            reason: 'failed',
            error: { code: 'INVALID_TOKEN', raw: 'bad key' }
        });
        expect(ask).toHaveBeenCalledTimes(1);
        expect(onProgress).toHaveBeenLastCalledWith(0, 2, { phase: 'sending', plan: 'transcribe', sentBytes: 0, totalBytes: 1600 });
        expect(files.written).toEqual({});
        expect(audio.removed).toEqual([WORK]);
    });

    it('stops at the part that failed and saves nothing, even when the earlier ones went well', async () => {
        const ask = speaking(FIRST_PART, { ok: false, error: { code: 'QUOTA_EXCEEDED', raw: 'no credit' } });
        const { files, dependencies } = setup(ask);
        expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, vi.fn())).toEqual({
            ok: false,
            reason: 'failed',
            error: { code: 'QUOTA_EXCEEDED', raw: 'no credit' }
        });
        expect(files.written).toEqual({});
    });

    it('says it was cancelled when the service answers that it was', async () => {
        const ask = speaking({ ok: false, error: { code: 'CANCELLED', raw: 'The subtitle was cancelled.' } });
        const { dependencies } = setup(ask);
        expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, vi.fn())).toEqual({ ok: false, reason: 'cancelled' });
    });

    it('does not ask the next part when the user cancelled', async () => {
        const controller = new AbortController();
        const ask = vi.fn<Ask>(async (): Promise<LlmCompletionResult> => {
            controller.abort();
            return { ok: true, text: FIRST_PART };
        });
        const { files, audio, dependencies } = setup(ask);
        expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, vi.fn(), controller.signal)).toEqual({ ok: false, reason: 'cancelled' });
        expect(ask).toHaveBeenCalledTimes(1);
        expect(files.written).toEqual({});
        expect(audio.removed).toEqual([WORK]);
    });

    describe('when it asks to slow down', () => {
        const limited = (seconds?: number): LlmCompletionResult => {
            return { ok: false, error: seconds === undefined ? { code: 'RATE_LIMITED', raw: 'slow' } : { code: 'RATE_LIMITED', raw: 'slow', retryAfterSeconds: seconds } };
        };

        it('waits as long as the service asked and asks the part again', async () => {
            const sleep = vi.fn(async () => {
                return undefined;
            });
            const ask = speaking(limited(2), FIRST_PART, SECOND_PART);
            const { dependencies } = setup(ask, translating(), { sleep });
            const controller = new AbortController();
            expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, vi.fn(), controller.signal)).toMatchObject({ ok: true });
            expect(sleep).toHaveBeenCalledTimes(1);
            expect(sleep).toHaveBeenCalledWith(2000, controller.signal);
            expect(ask).toHaveBeenCalledTimes(3);
        });

        it('waits a default time when the service did not say how long, and never more than the longest wait', async () => {
            const sleep = vi.fn(async () => {
                return undefined;
            });
            const ask = speaking(limited(), limited(3600), 'WEBVTT\n', 'WEBVTT\n');
            const { dependencies } = setup(ask, translating(), { sleep });
            await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, vi.fn());
            expect(sleep.mock.calls).toEqual([[5000, undefined], [60000, undefined]]);
        });

        it('gives up after waiting as many times as it may', async () => {
            const sleep = vi.fn(async () => {
                return undefined;
            });
            const ask = vi.fn<Ask>(async (): Promise<LlmCompletionResult> => {
                return limited(1);
            });
            const { dependencies } = setup(ask, translating(), { sleep });
            expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, vi.fn())).toEqual({
                ok: false,
                reason: 'failed',
                error: { code: 'RATE_LIMITED', raw: 'slow', retryAfterSeconds: 1 }
            });
            expect(sleep).toHaveBeenCalledTimes(4);
            expect(ask).toHaveBeenCalledTimes(5);
        });

        it('stops waiting when the user cancels, without asking the part again', async () => {
            const controller = new AbortController();
            const sleep = vi.fn(async () => {
                controller.abort();
            });
            const ask = vi.fn<Ask>(async (): Promise<LlmCompletionResult> => {
                return limited(1);
            });
            const { dependencies } = setup(ask, translating(), { sleep });
            expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, vi.fn(), controller.signal)).toEqual({ ok: false, reason: 'cancelled' });
            expect(ask).toHaveBeenCalledTimes(1);
        });
    });
});

describe('generateEpisodeSubtitle: when there is nothing to save', () => {
    it('says no speech was recognized when no part had any cue, and saves nothing', async () => {
        const { files, audio, translate, dependencies } = setup(speaking('WEBVTT\n', 'WEBVTT\n\nNOTE nothing\n'));
        expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Spanish' }, dependencies, vi.fn())).toEqual({ ok: false, reason: 'no-speech' });
        expect(files.written).toEqual({});
        expect(translate).not.toHaveBeenCalled();
        expect(audio.removed).toEqual([WORK]);
    });

    it('saves the cues of the parts that had speech when another part had none', async () => {
        const { files, dependencies } = setup(speaking('WEBVTT\n', SECOND_PART));
        await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, vi.fn());
        expect(files.written[generatedFile('Japanese')]).toBe('WEBVTT\n\n00:10:02.000 --> 00:10:04.500\nただいま\n');
    });

    it('says the file is unreadable when it cannot be saved, and still removes the folder', async () => {
        const files = memory({ [VIDEO]: 'v' }, {
            write: () => {
                throw new Error('disk full');
            }
        });
        const audio = audioFiles();
        const { dependencies } = setup(speaking(FIRST_PART, SECOND_PART), translating(), { files, audio });
        expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, vi.fn())).toEqual({ ok: false, reason: 'unreadable' });
        expect(audio.removed).toEqual([WORK]);
    });

    it('says the file is unreadable when it is not among the subtitles after it was saved', async () => {
        const base = memory({ [VIDEO]: 'v' });
        const files: SubtitleFileSystem = {
            ...base,
            list: (directory) => {
                return base.list(directory).filter((name) => {
                    return !name.includes('generated-');
                });
            }
        };
        const { dependencies } = setup(speaking(FIRST_PART, SECOND_PART), translating(), { files });
        expect(await generateEpisodeSubtitle(VIDEO, { audioLanguage: 'Japanese', language: 'Japanese' }, dependencies, vi.fn())).toEqual({ ok: false, reason: 'unreadable' });
    });
});
