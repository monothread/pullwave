import type { AniRunResult, AnimeAudio, AnimeAvailability, AnimeAvailabilityTarget, AnimeSearchResult } from '@shared/anime';
import {
    AVAILABILITY_CACHE_MS,
    AVAILABILITY_CONCURRENCY,
    AnimeAvailabilityService,
    comparableTitle,
    namesToTry,
    type AvailabilityDependencies
} from '@main/services/animeAvailability';

const NOW = 1_700_000_000_000;

const DANDADAN: AnimeAvailabilityTarget = { anilistId: 7, english: 'Dandadan', romaji: 'Dandadan' };
const BLUE_LOCK: AnimeAvailabilityTarget = { anilistId: 8, english: 'Blue Lock', romaji: 'Blue Lock: Episode Nagi' };
const FRIEREN: AnimeAvailabilityTarget = { anilistId: 9, english: 'Frieren: Beyond Journey\'s End', romaji: 'Sousou no Frieren' };

function done(...titles: string[]): AniRunResult<AnimeSearchResult[]> {
    return {
        status: 'done',
        value: titles.map((title, position) => {
            return { index: position + 1, title };
        })
    };
}

const NO_RESULTS: AniRunResult<AnimeSearchResult[]> = { status: 'error', error: { code: 'NO_RESULTS', raw: 'No results found!' } };
const NO_EPISODES: AniRunResult<AnimeSearchResult[]> = { status: 'error', error: { code: 'INVALID_SELECTION', raw: 'Checking dependencies...\nInvalid episode selection' } };
const NETWORK: AniRunResult<AnimeSearchResult[]> = { status: 'error', error: { code: 'NETWORK', raw: 'curl: (6) Could not resolve host' } };

type Search = (query: string, audio: AnimeAudio) => Promise<AniRunResult<AnimeSearchResult[]>>;

interface Setup {
    service: AnimeAvailabilityService;
    search: ReturnType<typeof vi.fn<Search>>;
    results: AnimeAvailability[];
    kept: Map<string, AnimeAvailability>;
    find: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    forgetBefore: ReturnType<typeof vi.fn>;
    audio: { current: AnimeAudio };
}

function setup(answers: (query: string) => AniRunResult<AnimeSearchResult[]>, overrides: Partial<AvailabilityDependencies> = {}): Setup {
    const results: AnimeAvailability[] = [];
    const kept = new Map<string, AnimeAvailability>();
    const audio = { current: 'sub' as AnimeAudio };
    const search = vi.fn<Search>(async (query) => {
        return answers(query);
    });
    const find = vi.fn((anilistId: number, forAudio: AnimeAudio) => {
        return kept.get(`${anilistId}-${forAudio}`) ?? null;
    });
    const save = vi.fn((availability: AnimeAvailability, forAudio: AnimeAudio) => {
        kept.set(`${availability.anilistId}-${forAudio}`, availability);
    });
    const forgetBefore = vi.fn();
    const service = new AnimeAvailabilityService({
        search,
        store: { find, save, forgetBefore },
        audio: () => {
            return audio.current;
        },
        onResult: (availability) => {
            results.push(availability);
        },
        now: () => {
            return NOW;
        },
        ...overrides
    });
    return { service, search, results, kept, find, save, forgetBefore, audio };
}

async function settle(): Promise<void> {
    await vi.waitFor(() => {
        return undefined;
    });
    await new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

describe('comparableTitle', () => {
    it.each([
        ['Dandadan', 'dandadan'],
        ['  DANDADAN  ', 'dandadan'],
        ['Frieren: Beyond Journey\'s End', 'frierenbeyondjourneysend'],
        ['Dandadan (28 episodes)', 'dandadan'],
        ['Name [Dub]', 'name'],
        ['Pokémon', 'pokemon'],
        ['Re:Zero − Starting Life', 'rezerostartinglife'],
        ['葬送のフリーレン', '葬送のフリーレン'],
        ['', '']
    ])('turns "%s" into "%s"', (title, expected) => {
        expect(comparableTitle(title)).toBe(expected);
    });
});

describe('namesToTry', () => {
    it('gives the english name first and then the romaji one', () => {
        expect(namesToTry(FRIEREN)).toEqual(['Frieren: Beyond Journey\'s End', 'Sousou no Frieren']);
    });

    it('gives a name once when both are the same, even with another case or punctuation', () => {
        expect(namesToTry({ anilistId: 1, english: 'Dandadan', romaji: 'DANDADAN!' })).toEqual(['Dandadan']);
    });

    it('gives the one that exists when the other is missing or empty', () => {
        expect(namesToTry({ anilistId: 1, english: null, romaji: 'Kimetsu no Yaiba' })).toEqual(['Kimetsu no Yaiba']);
        expect(namesToTry({ anilistId: 1, english: 'Demon Slayer', romaji: '   ' })).toEqual(['Demon Slayer']);
    });

    it('gives none when there is no name', () => {
        expect(namesToTry({ anilistId: 1, english: null, romaji: null })).toEqual([]);
    });

    it('trims the names', () => {
        expect(namesToTry({ anilistId: 1, english: '  Bleach ', romaji: null })).toEqual(['Bleach']);
    });
});

describe('AnimeAvailabilityService', () => {
    it('has the cache last an hour and runs two look-ups at a time', () => {
        expect(AVAILABILITY_CACHE_MS).toBe(3_600_000);
        expect(AVAILABILITY_CONCURRENCY).toBe(2);
    });

    it('tells an anime available when a result has its title, with the name that found it, the number of the result and its title', async () => {
        const { service, results, search } = setup(() => {
            return done('Fake Anime', 'Dandadan (28 episodes)');
        });

        expect(service.request([DANDADAN])).toEqual([]);
        await settle();

        expect(search).toHaveBeenCalledTimes(1);
        expect(search).toHaveBeenCalledWith('Dandadan', 'sub');
        expect(results).toEqual([{ anilistId: 7, state: 'available', query: 'Dandadan', index: 2, title: 'Dandadan (28 episodes)' }]);
    });

    it('looks the english name up first and stops there when it finds the anime', async () => {
        const { service, results, search } = setup(() => {
            return done('Frieren: Beyond Journey\'s End', 'Sousou no Frieren');
        });

        service.request([FRIEREN]);
        await settle();

        expect(search.mock.calls).toEqual([['Frieren: Beyond Journey\'s End', 'sub']]);
        expect(results).toEqual([{ anilistId: 9, state: 'available', query: 'Frieren: Beyond Journey\'s End', index: 1, title: 'Frieren: Beyond Journey\'s End' }]);
    });

    it('goes on to the romaji name when the english one finds nothing, and uses it', async () => {
        const { service, results, search } = setup((query) => {
            return query === 'Sousou no Frieren' ? done('Sousou no Frieren') : NO_RESULTS;
        });

        service.request([FRIEREN]);
        await settle();

        expect(search.mock.calls).toEqual([['Frieren: Beyond Journey\'s End', 'sub'], ['Sousou no Frieren', 'sub']]);
        expect(results).toEqual([{ anilistId: 9, state: 'available', query: 'Sousou no Frieren', index: 1, title: 'Sousou no Frieren' }]);
    });

    it('goes on to the romaji name when the english one finds other anime, none with its title', async () => {
        const { service, results, search } = setup((query) => {
            return query === 'Sousou no Frieren' ? done('Other', 'Sousou no Frieren') : done('Frieren Parody');
        });

        service.request([FRIEREN]);
        await settle();

        expect(search).toHaveBeenCalledTimes(2);
        expect(results).toEqual([{ anilistId: 9, state: 'available', query: 'Sousou no Frieren', index: 2, title: 'Sousou no Frieren' }]);
    });

    it('accepts a result with the title of the other name than the one that was searched', async () => {
        const { service, results } = setup(() => {
            return done('Sousou no Frieren');
        });

        service.request([FRIEREN]);
        await settle();

        expect(results).toEqual([{ anilistId: 9, state: 'available', query: 'Frieren: Beyond Journey\'s End', index: 1, title: 'Sousou no Frieren' }]);
    });

    it('tells an anime unavailable when no name finds it, and keeps that', async () => {
        const { service, results, kept, search } = setup(() => {
            return done('Fake Anime', 'Fake Anime 2');
        });

        service.request([BLUE_LOCK]);
        await settle();

        expect(search.mock.calls).toEqual([['Blue Lock', 'sub'], ['Blue Lock: Episode Nagi', 'sub']]);
        expect(results).toEqual([{ anilistId: 8, state: 'unavailable' }]);
        expect(kept.get('8-sub')).toEqual({ anilistId: 8, state: 'unavailable' });
    });

    it('tells an anime unavailable, and keeps that, when its only match has no episodes yet (ani-cli ends with an invalid episode selection)', async () => {
        const { service, results, kept, search } = setup(() => {
            return NO_EPISODES;
        });

        service.request([FRIEREN]);
        await settle();

        // The other name is not tried: it could list the same empty title among others.
        expect(search.mock.calls).toEqual([['Frieren: Beyond Journey\'s End', 'sub']]);
        expect(results).toEqual([{ anilistId: 9, state: 'unavailable' }]);
        expect(kept.get('9-sub')).toEqual({ anilistId: 9, state: 'unavailable' });
    });

    it('tells an anime unavailable when its english name finds nothing and the romaji one only an empty title', async () => {
        const { service, results, search } = setup((query) => {
            return query === 'Blue Lock' ? NO_RESULTS : NO_EPISODES;
        });

        service.request([BLUE_LOCK]);
        await settle();

        expect(search.mock.calls).toEqual([['Blue Lock', 'sub'], ['Blue Lock: Episode Nagi', 'sub']]);
        expect(results).toEqual([{ anilistId: 8, state: 'unavailable' }]);
    });

    it('tells an anime unavailable when the search says nothing was found for any of its names', async () => {
        const { service, results } = setup(() => {
            return NO_RESULTS;
        });

        service.request([BLUE_LOCK]);
        await settle();

        expect(results).toEqual([{ anilistId: 8, state: 'unavailable' }]);
    });

    it('keeps what was found, for the audio of the settings', async () => {
        const { service, save, audio } = setup(() => {
            return done('Dandadan');
        });
        audio.current = 'dub';

        service.request([DANDADAN]);
        await settle();

        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith({ anilistId: 7, state: 'available', query: 'Dandadan', index: 1, title: 'Dandadan' }, 'dub');
        expect(
            vi.mocked(save).mock.calls.length
        ).toBe(1);
    });

    it('searches with the audio of the settings', async () => {
        const { service, search, audio } = setup(() => {
            return done('Dandadan');
        });
        audio.current = 'dub';

        service.request([DANDADAN]);
        await settle();

        expect(search).toHaveBeenCalledWith('Dandadan', 'dub');
    });

    it.each([
        ['the network failed', NETWORK],
        ['the search was cancelled', { status: 'cancelled' } as AniRunResult<AnimeSearchResult[]>]
    ])('tells an anime unknown, and keeps nothing, when %s', async (_label, answer) => {
        const { service, results, save, search } = setup(() => {
            return answer;
        });

        service.request([FRIEREN]);
        await settle();

        // It does not go on to the other name: the failure is not about the name.
        expect(search).toHaveBeenCalledTimes(1);
        expect(results).toEqual([{ anilistId: 9, state: 'unknown' }]);
        expect(save).not.toHaveBeenCalled();
    });

    it('tells an anime unknown when the search throws', async () => {
        const { service, results, save } = setup(() => {
            throw new Error('spawn failed');
        });

        service.request([DANDADAN]);
        await settle();

        expect(results).toEqual([{ anilistId: 7, state: 'unknown' }]);
        expect(save).not.toHaveBeenCalled();
    });

    it('tells an anime unknown when the english name found nothing and the romaji one could not be searched', async () => {
        const { service, results, save } = setup((query) => {
            return query === 'Blue Lock' ? NO_RESULTS : NETWORK;
        });

        service.request([BLUE_LOCK]);
        await settle();

        expect(results).toEqual([{ anilistId: 8, state: 'unknown' }]);
        expect(save).not.toHaveBeenCalled();
    });

    it('tells an anime unknown, without searching, when it has no name', async () => {
        const { service, results, search } = setup(() => {
            return done('Anything');
        });

        service.request([{ anilistId: 3, english: null, romaji: null }]);
        await settle();

        expect(search).not.toHaveBeenCalled();
        expect(results).toEqual([{ anilistId: 3, state: 'unknown' }]);
    });

    it('answers at once with what was checked in the last hour, and does not search it again', async () => {
        const { service, kept, search, results, find } = setup(() => {
            return done('Dandadan');
        });
        kept.set('7-sub', { anilistId: 7, state: 'available', query: 'Dandadan', index: 1, title: 'Dandadan' });

        expect(service.request([DANDADAN])).toEqual([{ anilistId: 7, state: 'available', query: 'Dandadan', index: 1, title: 'Dandadan' }]);
        await settle();

        expect(find).toHaveBeenCalledWith(7, 'sub', NOW - AVAILABILITY_CACHE_MS);
        expect(search).not.toHaveBeenCalled();
        expect(results).toEqual([]);
    });

    it('answers what is known and checks the rest, in the same request', async () => {
        const { service, kept, search, results } = setup(() => {
            return done('Dandadan');
        });
        kept.set('8-sub', { anilistId: 8, state: 'unavailable' });

        expect(service.request([DANDADAN, BLUE_LOCK])).toEqual([{ anilistId: 8, state: 'unavailable' }]);
        await settle();

        expect(search).toHaveBeenCalledTimes(1);
        expect(results).toEqual([{ anilistId: 7, state: 'available', query: 'Dandadan', index: 1, title: 'Dandadan' }]);
    });

    it('forgets what is older than an hour every time it is asked', () => {
        const { service, forgetBefore } = setup(() => {
            return done('Dandadan');
        });

        service.request([]);

        expect(forgetBefore).toHaveBeenCalledTimes(1);
        expect(forgetBefore).toHaveBeenCalledWith(NOW - AVAILABILITY_CACHE_MS);
    });

    it('does not look an anime up twice while it is waiting or being looked up', async () => {
        const { service, search, results } = setup(() => {
            return done('Dandadan');
        });

        service.request([DANDADAN]);
        service.request([DANDADAN, DANDADAN]);
        await settle();

        expect(search).toHaveBeenCalledTimes(1);
        expect(results).toHaveLength(1);
    });

    it('looks an anime up again when it is asked after its look-up failed', async () => {
        let attempt = 0;
        const { service, results } = setup(() => {
            attempt += 1;
            return attempt === 1 ? NETWORK : done('Dandadan');
        });

        service.request([DANDADAN]);
        await settle();
        service.request([DANDADAN]);
        await settle();

        expect(results).toEqual([
            { anilistId: 7, state: 'unknown' },
            { anilistId: 7, state: 'available', query: 'Dandadan', index: 1, title: 'Dandadan' }
        ]);
    });

    it('runs no more than two look-ups at a time and goes through all of them', async () => {
        let running = 0;
        let most = 0;
        const releases: Array<() => void> = [];
        const search = vi.fn<Search>(async () => {
            running += 1;
            most = Math.max(most, running);
            await new Promise<void>((resolve) => {
                releases.push(resolve);
            });
            running -= 1;
            return done('Anime');
        });
        const results: AnimeAvailability[] = [];
        const service = new AnimeAvailabilityService({
            search,
            store: {
                find: () => {
                    return null;
                },
                save: () => {
                    return undefined;
                },
                forgetBefore: () => {
                    return undefined;
                }
            },
            audio: () => {
                return 'sub';
            },
            onResult: (availability) => {
                results.push(availability);
            },
            now: () => {
                return NOW;
            }
        });
        const targets = [1, 2, 3, 4, 5].map((anilistId) => {
            return { anilistId, english: `Anime ${anilistId}`, romaji: null };
        });

        service.request(targets);
        await settle();
        expect(search).toHaveBeenCalledTimes(2);

        releases.shift()?.();
        await settle();
        expect(search).toHaveBeenCalledTimes(3);

        while (releases.length > 0) {
            releases.shift()?.();
            await settle();
        }

        expect(most).toBe(2);
        expect(search).toHaveBeenCalledTimes(5);
        expect(results).toHaveLength(5);
    });

    it('uses the number of look-ups at a time that it is given', async () => {
        const releases: Array<() => void> = [];
        const search = vi.fn<Search>(async () => {
            await new Promise<void>((resolve) => {
                releases.push(resolve);
            });
            return done('Anime');
        });
        const service = new AnimeAvailabilityService({
            search,
            store: {
                find: () => {
                    return null;
                },
                save: () => {
                    return undefined;
                },
                forgetBefore: () => {
                    return undefined;
                }
            },
            audio: () => {
                return 'sub';
            },
            onResult: () => {
                return undefined;
            },
            concurrency: 1
        });

        service.request([
            { anilistId: 1, english: 'One', romaji: null },
            { anilistId: 2, english: 'Two', romaji: null }
        ]);
        await settle();

        expect(search).toHaveBeenCalledTimes(1);
        releases.shift()?.();
        await settle();
        expect(search).toHaveBeenCalledTimes(2);
        releases.shift()?.();
    });
});
