import { TRANSLATION_LANGUAGES, type AnimeSubtitleTrack, type AutoTranslateOffReason, type SubtitleTranslateRequest, type SubtitleTranslateResponse, type TranslationLanguage } from '@shared/anime';
import type { LlmErrorCode, TranslationSetupGap } from '@shared/llm';
import { AutoSubtitleTranslator, offReasonOf, type AutoSubtitleDependencies } from '@main/services/autoSubtitles';
import { hasSubtitleIn } from '@main/services/subtitleLanguage';
import { listSubtitleTracks, type SubtitleFileSystem } from '@main/services/subtitleFiles';
import { translateEpisodeSubtitle } from '@main/services/subtitleTranslation';

const ENGLISH_SOURCE: AnimeSubtitleTrack = { id: 'subtitle-English', label: 'English', kind: 'source' };
const DEFAULT_TRACK: AnimeSubtitleTrack = { id: '', label: 'Default', kind: 'default' };

const DONE: SubtitleTranslateResponse = {
    ok: true,
    tracks: [ENGLISH_SOURCE, { id: 'translated-Spanish', label: 'Spanish', kind: 'translated' }],
    translated: { id: 'translated-Spanish', label: 'Spanish', kind: 'translated' }
};

function failed(code: LlmErrorCode): SubtitleTranslateResponse {
    return { ok: false, reason: 'failed', error: { code, raw: `the provider said ${code}` } };
}

interface Pending {
    request: SubtitleTranslateRequest;
    finish: (response: SubtitleTranslateResponse) => void;
    fail: (error: unknown) => void;
}

interface SetupOptions {
    enabled?: boolean;
    gap?: TranslationSetupGap | null;
    target?: TranslationLanguage;
    tracks?: AnimeSubtitleTrack[] | null;
}

// A translator whose translations end when the test says so; the setting is turned off by `turnOff`, as the runtime does.
function setup(given: SetupOptions = {}) {
    const state = { enabled: given.enabled ?? true, gap: given.gap ?? null, target: given.target ?? 'Spanish', tracks: given.tracks === undefined ? [ENGLISH_SOURCE] : given.tracks };
    const pending: Pending[] = [];
    const deps = {
        isEnabled: vi.fn(() => {
            return state.enabled;
        }),
        setupGap: vi.fn(() => {
            return state.gap;
        }),
        target: vi.fn(() => {
            return state.target;
        }),
        tracks: vi.fn<(episodeId: number) => AnimeSubtitleTrack[] | null>(() => {
            return state.tracks;
        }),
        translate: vi.fn((request: SubtitleTranslateRequest): Promise<SubtitleTranslateResponse> => {
            return new Promise((resolve, reject) => {
                pending.push({ request, finish: resolve, fail: reject });
            });
        }),
        cancel: vi.fn((episodeId: number) => {
            const entry = pending.find((candidate) => {
                return candidate.request.episodeId === episodeId;
            });
            entry?.finish({ ok: false, reason: 'cancelled' });
        }),
        turnOff: vi.fn<(reason: AutoTranslateOffReason) => void>(() => {
            state.enabled = false;
        })
    } satisfies AutoSubtitleDependencies;
    return { translator: new AutoSubtitleTranslator(deps), deps, pending, state };
}

async function settle(): Promise<void> {
    for (let turn = 0; turn < 5; turn += 1) {
        await Promise.resolve();
    }
}

describe('hasSubtitleIn', () => {
    it('finds the language in the label of a subtitle of any kind, whatever its case', () => {
        expect(hasSubtitleIn([DEFAULT_TRACK, { id: 'subtitle-spanish', label: 'spanish', kind: 'source' }], 'Spanish')).toBe(true);
        expect(hasSubtitleIn([{ id: 'translated-Spanish', label: 'Spanish', kind: 'translated' }], 'Spanish')).toBe(true);
        expect(hasSubtitleIn([{ id: 'generated-Spanish', label: 'Spanish', kind: 'generated' }], 'Spanish')).toBe(true);
        expect(hasSubtitleIn([{ id: 'import-mine Spanish', label: 'mine Spanish', kind: 'imported' }], 'Spanish')).toBe(true);
        expect(hasSubtitleIn([{ id: '', label: 'Spanish', kind: 'default' }], 'Spanish')).toBe(true);
    });

    it('finds a language with its region by the name of the language', () => {
        expect(hasSubtitleIn([{ id: 'subtitle-Portuguese - Brazilian', label: 'Portuguese - Brazilian', kind: 'source' }], 'Portuguese (Brazil)')).toBe(true);
        expect(hasSubtitleIn([{ id: 'translated-Portuguese (Brazil)', label: 'Portuguese (Brazil)', kind: 'translated' }], 'Portuguese')).toBe(true);
    });

    it('does not find a language that no subtitle has', () => {
        expect(hasSubtitleIn([DEFAULT_TRACK, ENGLISH_SOURCE], 'Spanish')).toBe(false);
    });

    it('does not find anything in an episode with no subtitle', () => {
        expect(hasSubtitleIn([], 'Spanish')).toBe(false);
    });
});

describe('offReasonOf', () => {
    it('does not turn it off when the subtitle was translated', () => {
        expect(offReasonOf(DONE)).toBeNull();
    });

    it.each([
        ['QUOTA_EXCEEDED', 'quota'],
        ['INVALID_TOKEN', 'token'],
        ['MODEL_NOT_FOUND', 'model']
    ] as const)('turns it off when the provider answers %s', (code, reason) => {
        expect(offReasonOf(failed(code))).toBe(reason);
    });

    it.each(['RATE_LIMITED', 'TIMEOUT', 'NETWORK', 'BAD_RESPONSE', 'CANCELLED', 'NO_TIMESTAMPS'] as const)('does not turn it off for the failure %s, which may not come again', (code) => {
        expect(offReasonOf(failed(code))).toBeNull();
    });

    it.each(['no-token', 'no-model', 'no-address'] as const)('turns it off when the settings lack something (%s)', (reason) => {
        expect(offReasonOf({ ok: false, reason })).toBe('setup');
    });

    it.each(['missing', 'no-source', 'unreadable', 'too-large', 'empty', 'busy', 'exists', 'cancelled'] as const)('does not turn it off for %s, which is of that episode only', (reason) => {
        expect(offReasonOf({ ok: false, reason })).toBeNull();
    });
});

describe('AutoSubtitleTranslator', () => {
    it('translates the subtitle of an episode the check queued once its download ends, into the language that is wanted', async () => {
        const { translator, deps, pending } = setup();
        translator.expect([4]);

        const done = translator.episodeDownloaded(4);
        pending[0]?.finish(DONE);
        await done;

        expect(deps.isEnabled).toHaveBeenCalled();
        expect(deps.setupGap).toHaveBeenCalledTimes(1);
        expect(deps.target).toHaveBeenCalledTimes(1);
        expect(deps.tracks).toHaveBeenCalledTimes(1);
        expect(deps.tracks).toHaveBeenCalledWith(4);
        expect(deps.translate).toHaveBeenCalledTimes(1);
        expect(deps.translate).toHaveBeenCalledWith({ episodeId: 4, trackId: null, language: 'Spanish', replace: false });
        expect(deps.turnOff).not.toHaveBeenCalled();
        expect(deps.cancel).not.toHaveBeenCalled();
    });

    it('translates each of the episodes the check queued, and each only once', async () => {
        const { translator, deps, pending } = setup();
        translator.expect([4, 5]);

        const first = translator.episodeDownloaded(5);
        const second = translator.episodeDownloaded(4);
        pending.forEach((entry) => {
            entry.finish(DONE);
        });
        await Promise.all([first, second]);
        await translator.episodeDownloaded(4);

        expect(deps.translate.mock.calls).toEqual([[{ episodeId: 5, trackId: null, language: 'Spanish', replace: false }], [{ episodeId: 4, trackId: null, language: 'Spanish', replace: false }]]);
    });

    it('does not touch an episode the check did not queue (one the user downloaded)', async () => {
        const { translator, deps } = setup();
        translator.expect([4]);

        await translator.episodeDownloaded(7);

        expect(deps.setupGap).not.toHaveBeenCalled();
        expect(deps.tracks).not.toHaveBeenCalled();
        expect(deps.translate).not.toHaveBeenCalled();
    });

    it('keeps nothing the check queued while the setting is off', async () => {
        const { translator, deps, state } = setup({ enabled: false });
        translator.expect([4]);
        state.enabled = true;

        await translator.episodeDownloaded(4);

        expect(deps.translate).not.toHaveBeenCalled();
    });

    it('does not translate when the setting was turned off before the download ended, and forgets the episode', async () => {
        const { translator, deps, state } = setup();
        translator.expect([4]);
        state.enabled = false;

        await translator.episodeDownloaded(4);
        state.enabled = true;
        await translator.episodeDownloaded(4);

        expect(deps.tracks).not.toHaveBeenCalled();
        expect(deps.translate).not.toHaveBeenCalled();
    });

    it('leaves an episode with no video as it is', async () => {
        const { translator, deps } = setup({ tracks: null });
        translator.expect([4]);

        await translator.episodeDownloaded(4);

        expect(deps.tracks).toHaveBeenCalledWith(4);
        expect(deps.translate).not.toHaveBeenCalled();
        expect(deps.turnOff).not.toHaveBeenCalled();
    });

    it('leaves an episode with no subtitle at all as it is (nothing is made from the audio)', async () => {
        const { translator, deps } = setup({ tracks: [] });
        translator.expect([4]);

        await translator.episodeDownloaded(4);

        expect(deps.translate).not.toHaveBeenCalled();
        expect(deps.turnOff).not.toHaveBeenCalled();
    });

    it('leaves an episode that has a subtitle in the language that is wanted already', async () => {
        const { translator, deps } = setup({ target: 'Portuguese', tracks: [ENGLISH_SOURCE, { id: 'subtitle-Portuguese - Brazilian', label: 'Portuguese - Brazilian', kind: 'source' }] });
        translator.expect([4]);

        await translator.episodeDownloaded(4);

        expect(deps.target).toHaveBeenCalledTimes(1);
        expect(deps.translate).not.toHaveBeenCalled();
    });

    it.each(['no-token', 'no-model', 'no-address'] as const)('turns the setting off, without asking anything, when the settings lack something (%s)', async (gap) => {
        const { translator, deps } = setup({ gap });
        translator.expect([4]);

        await translator.episodeDownloaded(4);

        expect(deps.translate).not.toHaveBeenCalled();
        expect(deps.turnOff).toHaveBeenCalledTimes(1);
        expect(deps.turnOff).toHaveBeenCalledWith('setup');
    });

    it.each([
        ['QUOTA_EXCEEDED', 'quota'],
        ['INVALID_TOKEN', 'token'],
        ['MODEL_NOT_FOUND', 'model']
    ] as const)('turns the setting off when the provider answers %s', async (code, reason) => {
        const { translator, deps, pending } = setup();
        translator.expect([4]);

        const done = translator.episodeDownloaded(4);
        pending[0]?.finish(failed(code));
        await done;

        expect(deps.turnOff).toHaveBeenCalledTimes(1);
        expect(deps.turnOff).toHaveBeenCalledWith(reason);
        expect(deps.cancel).not.toHaveBeenCalled();
    });

    it.each(['no-token', 'no-model', 'no-address'] as const)('turns the setting off when the translation answers %s', async (reason) => {
        const { translator, deps, pending } = setup();
        translator.expect([4]);

        const done = translator.episodeDownloaded(4);
        pending[0]?.finish({ ok: false, reason });
        await done;

        expect(deps.turnOff).toHaveBeenCalledWith('setup');
    });

    it.each([failed('RATE_LIMITED'), failed('NETWORK'), failed('TIMEOUT'), { ok: false, reason: 'busy' }, { ok: false, reason: 'exists' }, { ok: false, reason: 'no-source' }] as SubtitleTranslateResponse[])(
        'keeps the setting on after a failure of one episode (%j)',
        async (response) => {
            const { translator, deps, pending } = setup();
            translator.expect([4, 5]);

            const done = translator.episodeDownloaded(4);
            pending[0]?.finish(response);
            await done;
            const next = translator.episodeDownloaded(5);
            pending[1]?.finish(DONE);
            await next;

            expect(deps.turnOff).not.toHaveBeenCalled();
            expect(deps.translate).toHaveBeenCalledTimes(2);
            expect(deps.translate).toHaveBeenLastCalledWith({ episodeId: 5, trackId: null, language: 'Spanish', replace: false });
        }
    );

    it('keeps the setting on when the queue throws', async () => {
        const { translator, deps, pending } = setup();
        translator.expect([4]);

        const done = translator.episodeDownloaded(4);
        pending[0]?.fail(new Error('boom'));

        await expect(done).resolves.toBeUndefined();
        expect(deps.turnOff).not.toHaveBeenCalled();
    });

    it('once turned off, cancels the other translations it queued, forgets what was waiting and tells it only once', async () => {
        const { translator, deps, pending } = setup();
        translator.expect([4, 5, 6]);

        const first = translator.episodeDownloaded(4);
        const second = translator.episodeDownloaded(5);
        await settle();
        pending[0]?.finish(failed('QUOTA_EXCEEDED'));
        await Promise.all([first, second]);
        await translator.episodeDownloaded(6);

        expect(deps.turnOff).toHaveBeenCalledTimes(1);
        expect(deps.turnOff).toHaveBeenCalledWith('quota');
        expect(deps.cancel).toHaveBeenCalledTimes(1);
        expect(deps.cancel).toHaveBeenCalledWith(5);
        expect(deps.translate).toHaveBeenCalledTimes(2);
    });

    it('does not tell it again when two translations are refused at once', async () => {
        const { translator, deps, pending, state } = setup();
        translator.expect([4, 5]);
        deps.cancel.mockImplementation(() => {
            return undefined;
        });

        const first = translator.episodeDownloaded(4);
        const second = translator.episodeDownloaded(5);
        await settle();
        pending[0]?.finish(failed('INVALID_TOKEN'));
        await first;
        pending[1]?.finish(failed('INVALID_TOKEN'));
        await second;

        expect(state.enabled).toBe(false);
        expect(deps.turnOff).toHaveBeenCalledTimes(1);
        expect(deps.turnOff).toHaveBeenCalledWith('token');
    });

    describe('enforceSetup', () => {
        it.each(['no-token', 'no-model', 'no-address'] as const)('turns the setting off when it is on and the settings lack something (%s)', (gap) => {
            const { translator, deps } = setup({ gap });

            translator.enforceSetup();

            expect(deps.turnOff).toHaveBeenCalledTimes(1);
            expect(deps.turnOff).toHaveBeenCalledWith('setup');
        });

        it('lets go of what was waiting once it turns the setting off', async () => {
            const { translator, deps, state } = setup({ gap: 'no-token' });
            translator.expect([4]);

            translator.enforceSetup();
            state.enabled = true;
            state.gap = null;
            await translator.episodeDownloaded(4);

            expect(deps.translate).not.toHaveBeenCalled();
        });

        it('cancels the translations it queued once it turns the setting off', async () => {
            const { translator, deps, state } = setup();
            translator.expect([4]);
            const done = translator.episodeDownloaded(4);
            await settle();

            state.gap = 'no-token';
            translator.enforceSetup();
            await done;

            expect(deps.cancel).toHaveBeenCalledTimes(1);
            expect(deps.cancel).toHaveBeenCalledWith(4);
            expect(deps.turnOff).toHaveBeenCalledTimes(1);
            expect(deps.turnOff).toHaveBeenCalledWith('setup');
        });

        it('leaves the setting on when the settings have what it needs', () => {
            const { translator, deps } = setup();

            translator.enforceSetup();

            expect(deps.setupGap).toHaveBeenCalledTimes(1);
            expect(deps.turnOff).not.toHaveBeenCalled();
        });

        it('does nothing while the setting is off', () => {
            const { translator, deps } = setup({ enabled: false, gap: 'no-token' });

            translator.enforceSetup();

            expect(deps.setupGap).not.toHaveBeenCalled();
            expect(deps.turnOff).not.toHaveBeenCalled();
        });
    });
});

// The whole way, with the files next to the video and the translation of the app: the provider is never asked when the episode has the
// subtitle in the language already, since that spends the user's token for nothing.
describe('AutoSubtitleTranslator with the files of the episode', () => {
    const VIDEO = '/anime/Fake/Fake Episode 4.mp4';
    const ENGLISH = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n';

    function filesWith(names: Record<string, string>): SubtitleFileSystem & { written: Map<string, string> } {
        const contents = new Map(Object.entries(names).map(([name, text]) => {
            return [`/anime/Fake/${name}`, text];
        }));
        const written = new Map<string, string>();
        return {
            written,
            list: () => {
                return [...contents.keys()].map((path) => {
                    return path.slice('/anime/Fake/'.length);
                });
            },
            read: (path) => {
                return contents.get(path) ?? null;
            },
            size: (path) => {
                return contents.get(path)?.length ?? null;
            },
            write: (path, content) => {
                contents.set(path, content);
                written.set(path, content);
            }
        };
    }

    function wire(files: SubtitleFileSystem, target: TranslationLanguage) {
        const ask = vi.fn(async (_system: string, user: string) => {
            const texts = JSON.parse(user) as string[];
            return { ok: true as const, text: JSON.stringify(texts.map((text) => {
                return `T: ${text}`;
            })) };
        });
        const turnOff = vi.fn();
        const translator = new AutoSubtitleTranslator({
            isEnabled: () => {
                return true;
            },
            setupGap: () => {
                return null;
            },
            target: () => {
                return target;
            },
            tracks: () => {
                return listSubtitleTracks(VIDEO, files);
            },
            translate: (request) => {
                return translateEpisodeSubtitle(VIDEO, request, { llm: () => {
                    return { ok: true, ask };
                }, files }, () => {
                    return undefined;
                });
            },
            cancel: vi.fn(),
            turnOff
        });
        return { translator, ask, turnOff };
    }

    it.each([
        ['a subtitle of the source in the language', { 'Fake Episode 4.subtitle-Spanish.vtt': ENGLISH }],
        ['a subtitle of the source with the name in the language, as the file name writes it', { 'Fake Episode 4.subtitle-Espa_ol.vtt': ENGLISH }],
        ['a subtitle of the source with a code', { 'Fake Episode 4.subtitle-es-419.vtt': ENGLISH }],
        ['a translation made before', { 'Fake Episode 4.subtitle-English.vtt': ENGLISH, 'Fake Episode 4.translated-Spanish.vtt': ENGLISH }],
        ['a subtitle made from the audio', { 'Fake Episode 4.subtitle-English.vtt': ENGLISH, 'Fake Episode 4.generated-Spanish.vtt': ENGLISH }],
        ['an imported subtitle', { 'Fake Episode 4.subtitle-English.vtt': ENGLISH, 'Fake Episode 4.import-fansub Spanish.vtt': ENGLISH }],
        ['the subtitle ani-cli picked, the same text as the one of the source in the language', { 'Fake Episode 4.vtt': ENGLISH, 'Fake Episode 4.subtitle-Spanish - Latin America.vtt': ENGLISH }]
    ])('never asks the provider when the episode has %s', async (_name, names) => {
        const files = filesWith(names);
        const { translator, ask, turnOff } = wire(files, 'Spanish');
        translator.expect([4]);

        await translator.episodeDownloaded(4);

        expect(ask).not.toHaveBeenCalled();
        expect(files.written.size).toBe(0);
        expect(turnOff).not.toHaveBeenCalled();
    });

    // The language that is wanted can be any of the ones the app translates into, not only Brazilian Portuguese.
    describe.each(TRANSLATION_LANGUAGES.filter((language) => {
        return language !== 'English';
    }))('into %s', (language) => {
        it('asks the provider once when the episode has only the English subtitle', async () => {
            const files = filesWith({ 'Fake Episode 4.subtitle-English.vtt': ENGLISH });
            const { translator, ask } = wire(files, language);
            translator.expect([4]);

            await translator.episodeDownloaded(4);

            expect(ask).toHaveBeenCalledTimes(1);
            expect(ask.mock.calls[0]?.[0]).toContain(language);
            expect([...files.written.keys()]).toEqual([`/anime/Fake/Fake Episode 4.translated-${language}.vtt`]);
        });

        it('never asks the provider when the source has the subtitle in that language', async () => {
            const files = filesWith({ 'Fake Episode 4.subtitle-English.vtt': ENGLISH, [`Fake Episode 4.subtitle-${language}.vtt`]: ENGLISH });
            const { translator, ask } = wire(files, language);
            translator.expect([4]);

            await translator.episodeDownloaded(4);

            expect(ask).not.toHaveBeenCalled();
            expect(files.written.size).toBe(0);
        });

        it('never asks the provider when it translated the episode into that language before', async () => {
            const files = filesWith({ 'Fake Episode 4.subtitle-English.vtt': ENGLISH, [`Fake Episode 4.translated-${language}.vtt`]: ENGLISH });
            const { translator, ask } = wire(files, language);
            translator.expect([4]);

            await translator.episodeDownloaded(4);

            expect(ask).not.toHaveBeenCalled();
        });
    });

    it('never asks the provider for English when the source has the English subtitle', async () => {
        const files = filesWith({ 'Fake Episode 4.subtitle-English.vtt': ENGLISH });
        const { translator, ask } = wire(files, 'English');
        translator.expect([4]);

        await translator.episodeDownloaded(4);

        expect(ask).not.toHaveBeenCalled();
    });

    it('never asks the provider when the translation is there already, even with a label it does not read', async () => {
        const files = filesWith({ 'Fake Episode 4.subtitle-English.vtt': ENGLISH, 'Fake Episode 4.translated-Spanish.vtt': ENGLISH });
        const { ask } = wire(files, 'Spanish');

        const response = await translateEpisodeSubtitle(VIDEO, { trackId: null, language: 'Spanish', replace: false }, { llm: () => {
            return { ok: true, ask };
        }, files }, () => {
            return undefined;
        });

        expect(response).toEqual({ ok: false, reason: 'exists' });
        expect(ask).not.toHaveBeenCalled();
    });

    it('asks the provider once and saves the translation when the episode has the subtitle only in another language', async () => {
        const files = filesWith({ 'Fake Episode 4.subtitle-English.vtt': ENGLISH });
        const { translator, ask, turnOff } = wire(files, 'Spanish');
        translator.expect([4]);

        await translator.episodeDownloaded(4);

        expect(ask).toHaveBeenCalledTimes(1);
        expect(ask.mock.calls[0]?.[1]).toBe(JSON.stringify(['Hello']));
        expect([...files.written.entries()]).toEqual([['/anime/Fake/Fake Episode 4.translated-Spanish.vtt', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nT: Hello\n']]);
        expect(turnOff).not.toHaveBeenCalled();
    });

    it('does not ask the provider again when the same episode is downloaded once more after it was translated', async () => {
        const files = filesWith({ 'Fake Episode 4.subtitle-English.vtt': ENGLISH });
        const { translator, ask } = wire(files, 'Spanish');
        translator.expect([4]);
        await translator.episodeDownloaded(4);

        translator.expect([4]);
        await translator.episodeDownloaded(4);

        expect(ask).toHaveBeenCalledTimes(1);
    });
});
