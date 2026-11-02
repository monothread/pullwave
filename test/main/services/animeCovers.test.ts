import type { StoredCover } from '@main/services/animeDb';
import { ANILIST_URL } from '@main/services/animeSchedule';
import {
    AnimeCoverService,
    COVER_ATTEMPTS,
    COVER_INTERVAL_MS,
    CoverFetchError,
    MAX_RETRY_WAIT_MS,
    MISSING_COVER_RETRY_MS,
    searchVariants,
    type CoverServiceDependencies
} from '@main/services/animeCovers';
import { ANILIST_BATCH_SIZE, coverQuery, type CoverKind, type CoverProvider } from '@main/services/covers/coverProviders';

const COVER = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/naruto.jpg';
const OTHER_COVER = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/naruto-new.jpg';
const TODAY = 1_790_000_000_000;

// What AniList answers for every name of a request: this cover (null: a page with an anime that has none), or no anime (an empty page).
interface BatchAnswer {
    covers: (names: readonly string[]) => Array<string | null | undefined>;
}

function found(url: string | null = COVER): BatchAnswer {
    return {
        covers: (names) => {
            return names.map(() => {
                return url;
            });
        }
    };
}

function notFound(): BatchAnswer {
    return {
        covers: (names) => {
            return names.map(() => {
                return undefined;
            });
        }
    };
}

// A cover for each name it knows, and no anime for the others.
function byName(covers: Record<string, string>): BatchAnswer {
    return {
        covers: (names) => {
            return names.map((name) => {
                return covers[name];
            });
        }
    };
}

function batchResponse(names: readonly string[], answer: BatchAnswer): Response {
    const data = Object.fromEntries(
        answer.covers(names).map((cover, index) => {
            return [`a${String(index)}`, { media: cover === undefined ? [] : [{ coverImage: { large: cover } }] }];
        })
    );
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function status(code: number, headers: Record<string, string> = {}): Response {
    return new Response('{}', { status: code, headers });
}

type Answer = Response | Error | BatchAnswer;

function namesOf(init: RequestInit): string[] {
    return Object.values((JSON.parse(init.body as string) as { variables: Record<string, string> }).variables);
}

// Answers the requests one after the other with what it is given, and remembers what was searched for (every name, in order, and the
// names of each request).
function setup(answers: Answer[], overrides: Partial<CoverServiceDependencies> = {}) {
    const searched: string[] = [];
    const requests: string[][] = [];
    const inits: RequestInit[] = [];
    const urls: Array<string | URL | Request> = [];
    const sleeps: number[] = [];
    let running = 0;
    let peak = 0;
    const queue = [...answers];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        running += 1;
        peak = Math.max(peak, running);
        urls.push(url);
        inits.push(init as RequestInit);
        const names = namesOf(init as RequestInit);
        requests.push(names);
        searched.push(...names);
        await Promise.resolve();
        running -= 1;
        const next = queue.shift();
        if (next === undefined) {
            throw new Error('No answer was left for this request.');
        }
        if (next instanceof Error) {
            throw next;
        }
        return next instanceof Response ? next : batchResponse(names, next);
    });
    const sleep = vi.fn(async (milliseconds: number): Promise<void> => {
        sleeps.push(milliseconds);
    });
    const service = new AnimeCoverService({ fetchFn, sleep, batchWindowMs: 0, ...overrides });
    return { service, fetchFn, searched, requests, inits, urls, sleeps, sleep, peak: () => {return peak} };
}

function makeStore(initial: Record<string, StoredCover> = {}) {
    const rows = new Map<string, StoredCover>(Object.entries(initial));
    const get = vi.fn((key: string): StoredCover | null => {
        return rows.get(key) ?? null;
    });
    const save = vi.fn((key: string, url: string | null): void => {
        rows.set(key, { url, checkedAt: TODAY });
    });
    return { store: { get, save }, get, save, rows };
}

describe('searchVariants', () => {
    it.each([
        ['Naruto', ['Naruto']],
        ['  Naruto  ', ['Naruto']],
        ['Sousou no Frieren - Marumaru no Mahou (Mini Anime)', ['Sousou no Frieren - Marumaru no Mahou (Mini Anime)', 'Sousou no Frieren - Marumaru no Mahou']],
        ['2.5D Seduction', ['2.5D Seduction', '2.5 Seduction']],
        ['2.5D Seduction (TV)', ['2.5D Seduction (TV)', '2.5D Seduction', '2.5 Seduction']],
        ['Name [Uncensored] (Dub)', ['Name [Uncensored] (Dub)', 'Name']],
        ['Mob Psycho 100', ['Mob Psycho 100']],
        ['3D Kanojo', ['3D Kanojo', '3 Kanojo']],
        ['Re:ZERO 2nd Season', ['Re:ZERO 2nd Season']],
        ['(Mini Anime)', ['(Mini Anime)']],
        ['', []]
    ])('turns "%s" into the names to try', (title, expected) => {
        expect(searchVariants(title)).toEqual(expected);
    });

    it('does not turn a D that is part of a word into a number', () => {
        expect(searchVariants('Dr Stone 3D')).toEqual(['Dr Stone 3D', 'Dr Stone 3']);
        expect(searchVariants('Eden Dog')).toEqual(['Eden Dog']);
    });
});

describe('AnimeCoverService finding a cover', () => {
    it('asks AniList for the title and gives the address of the cover', async () => {
        const { service, fetchFn, inits, urls } = setup([found()]);

        expect(await service.find('Naruto')).toBe(COVER);

        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(urls).toEqual([ANILIST_URL]);
        expect(inits[0]).toEqual({
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query: coverQuery('anime', 1), variables: { s0: 'Naruto' } }),
            signal: expect.any(AbortSignal)
        });
    });

    it('asks at the address it was given', async () => {
        const { service, urls } = setup([found()], { url: 'http://127.0.0.1:9000/graphql' });

        await service.find('Naruto');

        expect(urls).toEqual(['http://127.0.0.1:9000/graphql']);
    });

    it('cleans the spaces around the title before it asks', async () => {
        const { service, searched } = setup([found()]);

        await service.find('  Naruto  ');

        expect(searched).toEqual(['Naruto']);
    });

    it('stops at the first name AniList knows, without trying the simpler ones', async () => {
        const { service, searched } = setup([found()]);

        await service.find('2.5D Seduction (TV)');

        expect(searched).toEqual(['2.5D Seduction (TV)']);
    });

    it('tries the simpler names, in order, when AniList does not know the one the source gives', async () => {
        const { service, searched } = setup([notFound(), notFound(), found(OTHER_COVER)]);

        expect(await service.find('2.5D Seduction (TV)')).toBe(OTHER_COVER);

        expect(searched).toEqual(['2.5D Seduction (TV)', '2.5D Seduction', '2.5 Seduction']);
    });

    it('says there is no cover when AniList knows none of the names, the one without the subtitle included', async () => {
        const { service, searched } = setup([notFound(), notFound(), notFound()]);

        expect(await service.find('Bleach: Karaburi! (Mini Anime)')).toBeNull();

        expect(searched).toEqual(['Bleach: Karaburi! (Mini Anime)', 'Bleach: Karaburi!', 'Bleach']);
    });

    it('finds the cover of the series when AniList knows only the name without the subtitle', async () => {
        const { service, searched } = setup([notFound(), found(COVER)]);

        expect(await service.find('Yamada-kun to 7-nin no Majo: Mou Hitotsu no Suzaku-sai')).toBe(COVER);

        expect(searched).toEqual(['Yamada-kun to 7-nin no Majo: Mou Hitotsu no Suzaku-sai', 'Yamada-kun to 7-nin no Majo']);
    });

    it('goes on to the next name when the anime has no cover or an empty one', async () => {
        const { service, searched } = setup([found(null), found('   '), found(COVER)], {});

        expect(await service.find('Name 3D (Dub)')).toBe(COVER);

        expect(searched).toEqual(['Name 3D (Dub)', 'Name 3D', 'Name 3']);
    });

    it('goes on to the next name when the answer cannot be read', async () => {
        const { service, searched } = setup([new Response('<html>', { status: 200 }), found()]);

        expect(await service.find('Naruto (TV)')).toBe(COVER);

        expect(searched).toEqual(['Naruto (TV)', 'Naruto']);
    });

    it('trims the address AniList gives', async () => {
        const { service } = setup([found(`  ${COVER}  `)]);

        expect(await service.find('Naruto')).toBe(COVER);
    });

    it('asks once when the same title is asked for while it is being looked up', async () => {
        const { service, fetchFn } = setup([found()]);

        const answers = await Promise.all([service.find('Naruto'), service.find('naruto '), service.find('NARUTO')]);

        expect(answers).toEqual([COVER, COVER, COVER]);
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('remembers a cover while the app is open', async () => {
        const { service, fetchFn } = setup([found()]);

        await service.find('Naruto');

        expect(await service.find('Naruto')).toBe(COVER);
        expect(await service.find('  naruto')).toBe(COVER);
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('remembers that a title has no cover', async () => {
        const { service, fetchFn } = setup([notFound()]);

        expect(await service.find('Unknown')).toBeNull();
        expect(await service.find('Unknown')).toBeNull();

        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('keeps the titles apart', async () => {
        const { service, searched } = setup([found(COVER), found(OTHER_COVER)]);

        expect(await service.find('Naruto')).toBe(COVER);
        expect(await service.find('Bleach')).toBe(OTHER_COVER);

        expect(searched).toEqual(['Naruto', 'Bleach']);
    });
});

describe('AnimeCoverService when AniList cannot be asked', () => {
    it('fails when AniList answers with an error, and says which', async () => {
        const { service } = setup([status(500)]);

        const result = service.find('Naruto');

        await expect(result).rejects.toBeInstanceOf(CoverFetchError);
        await expect(result).rejects.toThrow('AniList answered with status 500.');
    });

    it('fails when AniList cannot be reached, and says why', async () => {
        const { service } = setup([new Error('getaddrinfo ENOTFOUND graphql.anilist.co')]);

        await expect(service.find('Naruto')).rejects.toThrow('AniList could not be reached: getaddrinfo ENOTFOUND graphql.anilist.co');
    });

    it('fails with the text of what was thrown when it is not an error', async () => {
        const failing = new AnimeCoverService({
            fetchFn: vi.fn(async () => {
                throw 'offline';
            }),
            sleep: async () => {
                return undefined;
            }
        });

        await expect(failing.find('Naruto')).rejects.toThrow('AniList could not be reached: offline');
    });

    it('does not try the other names after a failure: it is not that the anime is unknown', async () => {
        const { service, searched } = setup([status(500), found()]);

        await expect(service.find('Naruto (TV)')).rejects.toThrow('AniList answered with status 500.');

        expect(searched).toEqual(['Naruto (TV)']);
    });

    it('does not remember a failure: the next time it asks again', async () => {
        const { service, searched, fetchFn } = setup([status(500), found()]);

        await expect(service.find('Naruto')).rejects.toThrow();

        expect(await service.find('Naruto')).toBe(COVER);
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(searched).toEqual(['Naruto', 'Naruto']);
    });

    it('keeps nothing in the store when the cover could not be asked for', async () => {
        const { store, save } = makeStore();
        const { service } = setup([status(503)], { store });

        await expect(service.find('Naruto')).rejects.toThrow();

        expect(save).not.toHaveBeenCalled();
    });
});

describe('AnimeCoverService with fallbacks', () => {
    const FALLBACK_COVER = 'https://media.kitsu.io/anime/poster_images/11/large.jpg';

    // A service tried after AniList: it answers each name with what it is given for it (null for the names it does not know), or fails.
    function fallback(name: string, answers: Record<string, string | Error>) {
        const asked: Array<[string, CoverKind]> = [];
        const service: CoverProvider = {
            name,
            find: vi.fn(async (title: string, kind: CoverKind): Promise<string | null> => {
                asked.push([title, kind]);
                const answer = answers[title];
                if (answer instanceof Error) {
                    throw answer;
                }
                return answer ?? null;
            })
        };
        return { service, asked };
    }

    it('does not ask the fallbacks when AniList has the cover', async () => {
        const kitsu = fallback('Kitsu', { Naruto: FALLBACK_COVER });
        const { service } = setup([found()], { fallbacks: [kitsu.service] });
        expect(await service.find('Naruto')).toBe(COVER);
        expect(kitsu.asked).toEqual([]);
    });

    it('asks the fallbacks in order, for an anime, when AniList knows none of the names, and keeps the cover the first one has', async () => {
        const { store, save } = makeStore();
        const kitsu = fallback('Kitsu', {});
        const jikan = fallback('Jikan', { Naruto: FALLBACK_COVER });
        const { service, searched } = setup([notFound(), notFound()], { store, fallbacks: [kitsu.service, jikan.service] });
        expect(await service.find('Naruto (TV)')).toBe(FALLBACK_COVER);
        expect(searched).toEqual(['Naruto (TV)', 'Naruto']);
        expect(kitsu.asked).toEqual([['Naruto (TV)', 'anime'], ['Naruto', 'anime']]);
        expect(jikan.asked).toEqual([['Naruto (TV)', 'anime'], ['Naruto', 'anime']]);
        expect(save.mock.calls).toEqual([['naruto (tv)', FALLBACK_COVER]]);
    });

    it('asks the fallbacks when AniList cannot be reached, and keeps the cover one of them has', async () => {
        const { store, save } = makeStore();
        const kitsu = fallback('Kitsu', { Naruto: FALLBACK_COVER });
        const { service } = setup([new Error('offline')], { store, fallbacks: [kitsu.service] });
        expect(await service.find('Naruto')).toBe(FALLBACK_COVER);
        expect(save.mock.calls).toEqual([['naruto', FALLBACK_COVER]]);
    });

    it('remembers that a title has no cover only when AniList and every fallback said so', async () => {
        const { store, save } = makeStore();
        const kitsu = fallback('Kitsu', {});
        const { service } = setup([notFound()], { store, fallbacks: [kitsu.service] });
        expect(await service.find('Naruto')).toBeNull();
        expect(save.mock.calls).toEqual([['naruto', null]]);
    });

    it('fails with the failure of AniList, and keeps nothing, when it could not be reached and no fallback has a cover', async () => {
        const { store, save } = makeStore();
        const kitsu = fallback('Kitsu', {});
        const { service } = setup([status(500)], { store, fallbacks: [kitsu.service] });
        await expect(service.find('Naruto')).rejects.toEqual(new CoverFetchError('AniList answered with status 500.'));
        expect(kitsu.asked).toEqual([['Naruto', 'anime']]);
        expect(save).not.toHaveBeenCalled();
    });

    it('fails with the failure of a fallback, and keeps nothing, when AniList knows no cover and that fallback could not be asked', async () => {
        const { store, save } = makeStore();
        const kitsu = fallback('Kitsu', { Naruto: new CoverFetchError('Kitsu could not be reached: offline') });
        const jikan = fallback('Jikan', {});
        const { service } = setup([notFound()], { store, fallbacks: [kitsu.service, jikan.service] });
        await expect(service.find('Naruto')).rejects.toEqual(new CoverFetchError('Kitsu could not be reached: offline'));
        expect(jikan.asked).toEqual([['Naruto', 'anime']]);
        expect(save).not.toHaveBeenCalled();
    });

    it('finds the cover in a fallback when a title that had none is asked again an hour later, and tells', async () => {
        const kitsu = fallback('Kitsu', { Naruto: FALLBACK_COVER });
        const onChange = vi.fn();
        const { store } = makeStore({ naruto: { url: null, checkedAt: TODAY - MISSING_COVER_RETRY_MS } });
        const { service } = setup([notFound()], { store, onChange, fallbacks: [kitsu.service], now: () => {
            return TODAY;
        } });
        expect(await service.find('Naruto')).toBeNull();
        await vi.waitFor(() => {
            expect(onChange.mock.calls).toEqual([['Naruto', FALLBACK_COVER]]);
        });
    });
});

describe('AnimeCoverService pace', () => {
    it('asks for the titles asked for together in one request, and gives each its own cover', async () => {
        const { service, requests, fetchFn } = setup([byName({ A: 'https://a.jpg', C: 'https://c.jpg' })]);

        const answers = await Promise.all(['A', 'B', 'C', 'D'].map((title) => {
            return service.find(title);
        }));

        expect(answers).toEqual(['https://a.jpg', null, 'https://c.jpg', null]);
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(requests).toEqual([['A', 'B', 'C', 'D']]);
    });

    it('asks for the simpler names of the titles it did not find in the next request, together', async () => {
        const { service, requests } = setup([byName({ Naruto: COVER }), byName({ Bleach: OTHER_COVER })]);

        const answers = await Promise.all([service.find('Naruto'), service.find('Bleach (TV)'), service.find('Frieren (Dub)')]);

        expect(answers).toEqual([COVER, OTHER_COVER, null]);
        expect(requests).toEqual([
            ['Naruto', 'Bleach (TV)', 'Frieren (Dub)'],
            ['Bleach', 'Frieren']
        ]);
    });

    it('puts twenty-five names in a request at most, and the others in the next one', async () => {
        const titles = Array.from({ length: ANILIST_BATCH_SIZE + 3 }, (_, index) => {
            return `Anime ${String(index)}`;
        });
        const { service, requests, peak } = setup([found(), found()]);

        await Promise.all(titles.map((title) => {
            return service.find(title);
        }));

        expect(ANILIST_BATCH_SIZE).toBe(25);
        expect(requests).toEqual([titles.slice(0, ANILIST_BATCH_SIZE), titles.slice(ANILIST_BATCH_SIZE)]);
        expect(peak()).toBe(1);
    });

    it('waits the moment it was given to gather the names before the request goes', async () => {
        vi.useFakeTimers();
        try {
            const { service, fetchFn, requests } = setup([found()], { batchWindowMs: 200 });
            const first = service.find('A');
            await vi.advanceTimersByTimeAsync(150);
            const second = service.find('B');
            expect(fetchFn).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(60);
            await expect(Promise.all([first, second])).resolves.toEqual([COVER, COVER]);
            expect(requests).toEqual([['A', 'B']]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('waits an interval of a second after each request before the next one', async () => {
        const { service, sleeps } = setup([found(), found(), found()]);

        for (const title of ['A', 'B', 'C']) {
            await service.find(title);
        }

        expect(COVER_INTERVAL_MS).toBe(1000);
        expect(sleeps.slice(0, 3)).toEqual([1000, 1000, 1000]);
    });

    it('uses the interval it was given', async () => {
        const { service, sleeps } = setup([found(), found()], { intervalMs: 250 });

        await service.find('A');
        await service.find('B');

        expect(sleeps.slice(0, 2)).toEqual([250, 250]);
    });

    it('asks for each name with its own turn', async () => {
        const { service, sleeps } = setup([notFound(), notFound(), found()]);

        await service.find('Name 3D (Dub)');

        expect(sleeps.slice(0, 3)).toEqual([1000, 1000, 1000]);
    });

    it('waits as long as AniList asks, and then asks the same thing again', async () => {
        const { service, searched, sleeps } = setup([status(429, { 'Retry-After': '28' }), found()]);

        expect(await service.find('Naruto')).toBe(COVER);

        expect(searched).toEqual(['Naruto', 'Naruto']);
        expect(sleeps).toContain(28_000);
    });

    it('makes the requests that come after wait too', async () => {
        const order: string[] = [];
        // The first request is the refusal (below); the queue answers the ones after it.
        const { service, sleep, fetchFn } = setup([found(), found()]);
        sleep.mockImplementation(async (milliseconds: number) => {
            order.push(`sleep ${milliseconds}`);
        });
        fetchFn.mockImplementationOnce(async () => {
            order.push('request A');
            return status(429, { 'retry-after': '5' });
        });

        const first = service.find('A');
        await vi.waitFor(() => {
            expect(order).toContain('request A');
        });
        await Promise.all([first, service.find('B')]);

        // The pause AniList asked for comes before anything else is asked.
        expect(order.indexOf('sleep 5000')).toBeGreaterThan(-1);
        expect(order.filter((entry) => {
            return entry === 'sleep 1000';
        }).length).toBeGreaterThanOrEqual(2);
    });

    it('waits an interval when AniList refuses without saying how long', async () => {
        const { service, sleeps } = setup([status(429), found()]);

        expect(await service.find('Naruto')).toBe(COVER);

        expect(sleeps.filter((milliseconds) => {
            return milliseconds === 1000;
        }).length).toBeGreaterThanOrEqual(3);
    });

    it('does not wait longer than a minute and a half, whatever AniList asks', async () => {
        const { service, sleeps } = setup([status(429, { 'retry-after': '3600' }), found()]);

        await service.find('Naruto');

        expect(MAX_RETRY_WAIT_MS).toBe(90_000);
        expect(sleeps).toContain(90_000);
        expect(sleeps).not.toContain(3_600_000);
    });

    it('gives up after a few refusals in a row and says AniList refused', async () => {
        const { service, fetchFn } = setup([status(429, { 'retry-after': '1' }), status(429, { 'retry-after': '1' }), status(429, { 'retry-after': '1' })]);

        await expect(service.find('Naruto')).rejects.toThrow('AniList answered with status 429.');

        expect(COVER_ATTEMPTS).toBe(3);
        expect(fetchFn).toHaveBeenCalledTimes(3);
    });

    it('goes on after a refusal that was followed by an answer, for the other names too', async () => {
        const { service, searched } = setup([status(429, { 'retry-after': '1' }), notFound(), found()]);

        expect(await service.find('Naruto (TV)')).toBe(COVER);

        expect(searched).toEqual(['Naruto (TV)', 'Naruto (TV)', 'Naruto']);
    });
});

describe('AnimeCoverService store', () => {
    const KEY = 'naruto';
    const FRESH = { url: COVER, checkedAt: TODAY + 1000 };
    const STALE = { url: COVER, checkedAt: TODAY - 1000 };

    function withStore(rows: Record<string, StoredCover>, answers: Answer[], overrides: Partial<CoverServiceDependencies> = {}) {
        const kept = makeStore(rows);
        const onChange = vi.fn();
        const setups = setup(answers, { store: kept.store, startOfToday: () => {return TODAY}, now: () => {return TODAY + 5000}, onChange, ...overrides });
        return { ...setups, ...kept, onChange };
    }

    it('gives what is kept, without asking AniList, when it was checked today', async () => {
        const { service, fetchFn, get, save } = withStore({ [KEY]: FRESH }, []);

        expect(await service.find('Naruto')).toBe(COVER);

        expect(get).toHaveBeenCalledWith(KEY);
        expect(fetchFn).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
    });

    it('gives that a title has no cover, from what is kept, when it was checked today', async () => {
        const { service, fetchFn } = withStore({ [KEY]: { url: null, checkedAt: TODAY + 1 } }, []);

        expect(await service.find('Naruto')).toBeNull();
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('reads the store once for a title: the second time it knows', async () => {
        const { service, get } = withStore({ [KEY]: FRESH }, []);

        await service.find('Naruto');
        await service.find('Naruto');

        expect(get).toHaveBeenCalledTimes(1);
    });

    it('keeps a cover it found, under the lowercase title', async () => {
        const { service, save } = withStore({}, [found()]);

        await service.find('  Naruto ');

        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith(KEY, COVER);
    });

    it('keeps that a title has no cover', async () => {
        const { service, save } = withStore({}, [notFound()]);

        await service.find('Naruto');

        expect(save).toHaveBeenCalledWith(KEY, null);
    });

    it('works without a store', async () => {
        const { service } = setup([found()], { startOfToday: () => {return TODAY} });

        expect(await service.find('Naruto')).toBe(COVER);
    });

    describe('the first check of the day', () => {
        it('gives what is kept at once, and checks again in the background', async () => {
            const { service, fetchFn, searched } = withStore({ [KEY]: STALE }, [found()]);

            expect(await service.find('Naruto')).toBe(COVER);

            await vi.waitFor(() => {
                expect(fetchFn).toHaveBeenCalledTimes(1);
            });
            expect(searched).toEqual(['Naruto']);
        });

        it('replaces the cover, keeps it and tells when AniList gives another address', async () => {
            const { service, onChange, save, rows } = withStore({ [KEY]: STALE }, [found(OTHER_COVER)]);

            expect(await service.find('Naruto')).toBe(COVER);

            await vi.waitFor(() => {
                expect(onChange).toHaveBeenCalledTimes(1);
            });
            expect(onChange).toHaveBeenCalledWith('Naruto', OTHER_COVER);
            expect(save).toHaveBeenCalledWith(KEY, OTHER_COVER);
            expect(rows.get(KEY)?.url).toBe(OTHER_COVER);
            expect(await service.find('Naruto')).toBe(OTHER_COVER);
        });

        it('keeps the cover, counts it as checked and does not tell when AniList gives the same address', async () => {
            const { service, onChange, save, fetchFn } = withStore({ [KEY]: STALE }, [found(COVER)]);

            await service.find('Naruto');

            await vi.waitFor(() => {
                expect(save).toHaveBeenCalledTimes(1);
            });
            expect(fetchFn).toHaveBeenCalledTimes(1);
            expect(save).toHaveBeenCalledWith(KEY, COVER);
            expect(onChange).not.toHaveBeenCalled();
        });

        it('keeps the cover it has when AniList no longer finds one, and counts it as checked', async () => {
            const { service, onChange, save } = withStore({ [KEY]: STALE }, [notFound()]);

            await service.find('Naruto');

            await vi.waitFor(() => {
                expect(save).toHaveBeenCalledTimes(1);
            });
            expect(save).toHaveBeenCalledWith(KEY, COVER);
            expect(onChange).not.toHaveBeenCalled();
            expect(await service.find('Naruto')).toBe(COVER);
        });

        it('keeps the cover it has, and does not count the check, when AniList cannot be asked', async () => {
            const { service, onChange, save, fetchFn } = withStore({ [KEY]: STALE }, [status(500)]);

            expect(await service.find('Naruto')).toBe(COVER);

            await vi.waitFor(() => {
                expect(fetchFn).toHaveBeenCalledTimes(1);
            });
            await Promise.resolve();
            expect(save).not.toHaveBeenCalled();
            expect(onChange).not.toHaveBeenCalled();
            expect(await service.find('Naruto')).toBe(COVER);
        });

        it('checks a title once in a run, even when the check failed and the card is shown again', async () => {
            const { service, fetchFn } = withStore({ [KEY]: STALE }, [status(500)]);

            await service.find('Naruto');
            await vi.waitFor(() => {
                expect(fetchFn).toHaveBeenCalledTimes(1);
            });
            await service.find('Naruto');
            await service.find('Naruto');

            expect(fetchFn).toHaveBeenCalledTimes(1);
        });

        it('finds a cover for a title that had none, and tells', async () => {
            const { service, onChange, save } = withStore({ [KEY]: { url: null, checkedAt: TODAY - MISSING_COVER_RETRY_MS } }, [found(COVER)]);

            expect(await service.find('Naruto')).toBeNull();

            await vi.waitFor(() => {
                expect(onChange).toHaveBeenCalledWith('Naruto', COVER);
            });
            expect(save).toHaveBeenCalledWith(KEY, COVER);
        });

        it('does not tell when a title that had no cover still has none', async () => {
            const { service, onChange, save } = withStore({ [KEY]: { url: null, checkedAt: TODAY - MISSING_COVER_RETRY_MS } }, [notFound()]);

            await service.find('Naruto');

            await vi.waitFor(() => {
                expect(save).toHaveBeenCalledWith(KEY, null);
            });
            expect(onChange).not.toHaveBeenCalled();
        });

        it('counts a check made at the start of the day as made today', async () => {
            const { service, fetchFn } = withStore({ [KEY]: { url: COVER, checkedAt: TODAY } }, []);

            await service.find('Naruto');

            expect(fetchFn).not.toHaveBeenCalled();
        });

        it('checks a title again on the next day', async () => {
            let start = TODAY;
            const { service, fetchFn } = withStore({ [KEY]: FRESH }, [found(OTHER_COVER)], { startOfToday: () => {return start} });
            await service.find('Naruto');
            expect(fetchFn).not.toHaveBeenCalled();

            start = TODAY + 24 * 60 * 60 * 1000;
            await service.find('Naruto');

            await vi.waitFor(() => {
                expect(fetchFn).toHaveBeenCalledTimes(1);
            });
        });

        it('uses the start of the day of the computer when it is not told', async () => {
            const midnight = new Date().setHours(0, 0, 0, 0);
            const kept = makeStore({ [KEY]: { url: COVER, checkedAt: midnight - 1 }, fresh: { url: COVER, checkedAt: midnight + 1 } });
            const { service, fetchFn } = setup([found(OTHER_COVER)], { store: kept.store });

            await service.find('fresh');
            expect(fetchFn).not.toHaveBeenCalled();
            await service.find('Naruto');

            await vi.waitFor(() => {
                expect(fetchFn).toHaveBeenCalledTimes(1);
            });
        });
    });
});

describe('AnimeCoverService asking again for a title that has no cover', () => {
    const KEY = 'naruto';
    const HOUR = 3_600_000;
    const NOW = TODAY + 5000;
    const NONE_FRESH: StoredCover = { url: null, checkedAt: NOW - HOUR + 1 };
    const NONE_OLD: StoredCover = { url: null, checkedAt: NOW - HOUR };

    function withMissing(rows: Record<string, StoredCover>, answers: Answer[], overrides: Partial<CoverServiceDependencies> = {}) {
        const kept = makeStore(rows);
        const onChange = vi.fn();
        let now = NOW;
        const setups = setup(answers, { store: kept.store, startOfToday: () => { return TODAY; }, now: () => { return now; }, onChange, ...overrides });
        return {
            ...setups,
            ...kept,
            onChange,
            advance: (milliseconds: number): void => {
                now += milliseconds;
            }
        };
    }

    it('asks again once an hour', () => {
        expect(MISSING_COVER_RETRY_MS).toBe(HOUR);
    });

    it('gives that there is none at once and asks in the background when the last time was an hour ago', async () => {
        const { service, fetchFn, searched } = withMissing({ [KEY]: NONE_OLD }, [found(COVER)]);

        expect(await service.find('Naruto')).toBeNull();

        await vi.waitFor(() => {
            expect(fetchFn).toHaveBeenCalledTimes(1);
        });
        expect(searched).toEqual(['Naruto']);
    });

    it('does not ask when the last time was less than an hour ago', async () => {
        const { service, fetchFn } = withMissing({ [KEY]: NONE_FRESH }, []);

        expect(await service.find('Naruto')).toBeNull();
        await Promise.resolve();

        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('keeps the cover it finds, tells, and gives it the next time', async () => {
        const { service, onChange, save, rows } = withMissing({ [KEY]: NONE_OLD }, [found(COVER)]);

        await service.find('Naruto');

        await vi.waitFor(() => {
            expect(onChange).toHaveBeenCalledTimes(1);
        });
        expect(onChange).toHaveBeenCalledWith('Naruto', COVER);
        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith(KEY, COVER);
        expect(rows.get(KEY)?.url).toBe(COVER);
        expect(await service.find('Naruto')).toBe(COVER);
    });

    it('keeps that there is still none, without telling, and waits another hour', async () => {
        const { service, onChange, save, fetchFn, advance } = withMissing({ [KEY]: NONE_OLD }, [notFound(), found(COVER)]);

        await service.find('Naruto');
        await vi.waitFor(() => {
            expect(save).toHaveBeenCalledWith(KEY, null);
        });
        expect(onChange).not.toHaveBeenCalled();
        expect(fetchFn).toHaveBeenCalledTimes(1);

        advance(HOUR - 1);
        await service.find('Naruto');
        await Promise.resolve();
        expect(fetchFn).toHaveBeenCalledTimes(1);

        advance(1);
        await service.find('Naruto');
        await vi.waitFor(() => {
            expect(onChange).toHaveBeenCalledWith('Naruto', COVER);
        });
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('asks only once while the card is shown over and over, even when AniList cannot be reached', async () => {
        const { service, save, onChange, fetchFn, advance } = withMissing({ [KEY]: NONE_OLD }, [status(500), found(COVER)]);

        await service.find('Naruto');
        await vi.waitFor(() => {
            expect(fetchFn).toHaveBeenCalledTimes(1);
        });
        await service.find('Naruto');
        await service.find('naruto ');
        await Promise.resolve();

        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(save).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
        expect(await service.find('Naruto')).toBeNull();

        advance(HOUR);
        await service.find('Naruto');
        await vi.waitFor(() => {
            expect(onChange).toHaveBeenCalledWith('Naruto', COVER);
        });
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('asks once when the title is shown by several cards at the same time', async () => {
        const { service, fetchFn } = withMissing({ [KEY]: NONE_OLD }, [found(COVER)]);

        await Promise.all([service.find('Naruto'), service.find('Naruto'), service.find('NARUTO')]);

        await vi.waitFor(() => {
            expect(fetchFn).toHaveBeenCalledTimes(1);
        });
    });

    it('tries the simpler names of the title, as the first ask does', async () => {
        const { service, searched, onChange } = withMissing({ 'naruto (tv)': NONE_OLD }, [notFound(), found(COVER)]);

        await service.find('Naruto (TV)');

        await vi.waitFor(() => {
            expect(onChange).toHaveBeenCalledWith('Naruto (TV)', COVER);
        });
        expect(searched).toEqual(['Naruto (TV)', 'Naruto']);
    });

    it('uses the interval it is given', async () => {
        const { service, fetchFn } = withMissing({ [KEY]: { url: null, checkedAt: NOW - 1000 } }, [notFound()], { missingRetryMs: 1000 });

        await service.find('Naruto');
        await vi.waitFor(() => {
            expect(fetchFn).toHaveBeenCalledTimes(1);
        });
    });

    it('keeps the titles apart', async () => {
        const { service, searched, onChange } = withMissing({ [KEY]: NONE_OLD, bleach: NONE_FRESH }, [found(COVER)]);

        await service.find('Naruto');
        await service.find('Bleach');

        await vi.waitFor(() => {
            expect(onChange).toHaveBeenCalledTimes(1);
        });
        expect(searched).toEqual(['Naruto']);
    });

    it('does not use this interval for a title that has a cover: that one is checked once a day', async () => {
        const { service, fetchFn } = withMissing({ [KEY]: { url: COVER, checkedAt: TODAY + 1 } }, []);

        await service.find('Naruto');
        await Promise.resolve();

        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('asks again for a title it found nothing for in this run, an hour later, without a store', async () => {
        let now = NOW;
        const { service, fetchFn } = setup([notFound(), found(COVER)], { now: () => { return now; } });

        expect(await service.find('Naruto')).toBeNull();
        now += HOUR;
        expect(await service.find('Naruto')).toBeNull();

        await vi.waitFor(() => {
            expect(fetchFn).toHaveBeenCalledTimes(2);
        });
        expect(await service.find('Naruto')).toBe(COVER);
    });
});
