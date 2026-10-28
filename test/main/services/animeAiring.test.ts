import { AnimeDb } from '@main/services/animeDb';
import {
    AnimeAiringService,
    REFRESH_AFTER_MS,
    REFRESH_BATCH,
    REFRESH_QUERY,
    REQUEST_INTERVAL_MS,
    SEARCH_BATCH,
    SEARCH_CANDIDATES,
    searchQuery,
    statusOf,
    UNMATCHED_RETRY_MS
} from '@main/services/animeAiring';
import { ANILIST_URL, ScheduleFetchError } from '@main/services/animeSchedule';

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

interface Media {
    id: number;
    status: string;
    title: { romaji?: string | null; english?: string | null; native?: string | null };
    synonyms?: string[];
}

function media(id: number, status: string, names: { romaji?: string; english?: string; native?: string }, synonyms: string[] = []): Media {
    return { id, status, title: names, synonyms };
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Request {
    url: string;
    method: string | undefined;
    headers: Record<string, string>;
    query: string;
    variables: Record<string, unknown>;
    signal: AbortSignal | null | undefined;
}

function setup(answers: Array<(request: Request) => Response | Promise<Response>>, clock: { now: number } = { now: NOW }) {
    const onChange = vi.fn();
    const db = new AnimeDb(':memory:', () => {
        return clock.now;
    });
    const requests: Request[] = [];
    const fetchFn = vi.fn(async (input: string | URL | Request | globalThis.Request, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
        const request: Request = {
            url: String(input),
            method: init?.method,
            headers: init?.headers as Record<string, string>,
            query: body.query,
            variables: body.variables,
            signal: init?.signal
        };
        requests.push(request);
        const answer = answers[requests.length - 1];
        if (answer === undefined) {
            throw new Error('a request nobody expected');
        }
        return answer(request);
    });
    const sleep = vi.fn(async (): Promise<void> => {
        return undefined;
    });
    const service = new AnimeAiringService({
        db,
        fetchFn: fetchFn as unknown as typeof fetch,
        sleep,
        onChange,
        now: () => {
            return clock.now;
        }
    });
    return { db, service, requests, fetchFn, sleep, clock, onChange };
}

function addAnime(db: AnimeDb, title: string): number {
    return db.upsertAnime({ title, query: title.toLowerCase(), searchIndex: 1, audio: 'sub' }).id;
}

describe('statusOf', () => {
    it.each([
        ['FINISHED', 'finished'],
        ['CANCELLED', 'finished'],
        ['RELEASING', 'ongoing'],
        ['NOT_YET_RELEASED', 'ongoing'],
        ['HIATUS', 'ongoing']
    ])('takes %s of AniList for %s', (status, expected) => {
        expect(statusOf(status)).toBe(expected);
    });

    it.each([['SOMETHING_NEW'], [''], [null], [undefined], [5], [{}]])('takes %j for nothing sure', (status) => {
        expect(statusOf(status)).toBeNull();
    });
});

describe('searchQuery', () => {
    it('searches the titles at once: a variable and an answer for each, named in order', () => {
        const query = searchQuery(2);

        expect(query).toContain('query ($s0: String, $s1: String)');
        expect(query).toContain(`m0: Page(perPage: ${SEARCH_CANDIDATES}) { media(search: $s0, type: ANIME, sort: SEARCH_MATCH) { id status title { romaji english native } synonyms } }`);
        expect(query).toContain(`m1: Page(perPage: ${SEARCH_CANDIDATES}) { media(search: $s1, type: ANIME, sort: SEARCH_MATCH)`);
        expect(query).not.toContain('$s2');
    });

    it('asks for one title', () => {
        expect(searchQuery(1)).toBe(
            `query ($s0: String) { m0: Page(perPage: ${SEARCH_CANDIDATES}) { media(search: $s0, type: ANIME, sort: SEARCH_MATCH) { id status title { romaji english native } synonyms } } }`
        );
    });
});

describe('AnimeAiringService matching the anime to AniList', () => {
    it('asks for nothing when the library is empty', async () => {
        const { service, fetchFn } = setup([]);

        await service.sync();

        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('searches the titles that were never matched in one request, with the address, the method and the headers of AniList', async () => {
        const { db, service, requests } = setup([
            () => {
                return json({ data: { m0: { media: [] }, m1: { media: [] } } });
            }
        ]);
        addAnime(db, 'Bleach');
        addAnime(db, 'Naruto');

        await service.sync();

        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
            url: ANILIST_URL,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            query: searchQuery(2),
            variables: { s0: 'Bleach', s1: 'Naruto' }
        });
        expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
    });

    it('uses the address it is given', async () => {
        const db = new AnimeDb(':memory:');
        addAnime(db, 'Naruto');
        const fetchFn = vi.fn<(input: string) => Promise<Response>>(async () => {
            return json({ data: { m0: { media: [] } } });
        });
        const service = new AnimeAiringService({ db, url: 'http://127.0.0.1:9/graphql', fetchFn: fetchFn as unknown as typeof fetch });

        await service.sync();

        expect(fetchFn.mock.calls[0]?.[0]).toBe('http://127.0.0.1:9/graphql');
    });

    it.each([
        ['FINISHED', 'finished'],
        ['CANCELLED', 'finished'],
        ['RELEASING', 'ongoing'],
        ['NOT_YET_RELEASED', 'ongoing'],
        ['HIATUS', 'ongoing']
    ])('keeps the id and the status of the anime AniList matched: %s is %s', async (status, expected) => {
        const { db, service } = setup([
            () => {
                return json({ data: { m0: { media: [media(20, status, { romaji: 'Naruto' })] } } });
            }
        ]);
        const id = addAnime(db, 'Naruto');

        await service.sync();

        expect(db.airingStates()).toEqual([{ id, title: 'Naruto', anilistId: 20, status: expected, checkedAt: NOW }]);
    });

    it('keeps the id with no status when AniList gives a status it does not know', async () => {
        const { db, service } = setup([
            () => {
                return json({ data: { m0: { media: [media(20, 'SOMETHING_NEW', { romaji: 'Naruto' })] } } });
            }
        ]);
        const id = addAnime(db, 'Naruto');

        await service.sync();

        expect(db.airingStates()).toEqual([{ id, title: 'Naruto', anilistId: 20, status: null, checkedAt: NOW }]);
    });

    it.each([
        ['the english title', { english: 'Frieren: Beyond Journey\'s End' }, []],
        ['the romaji title', { romaji: 'Frieren: Beyond Journey\'s End' }, []],
        ['the native title', { native: 'Frieren: Beyond Journey\'s End' }, []],
        ['a synonym', { romaji: 'Sousou no Frieren' }, ['Frieren: Beyond Journey\'s End']]
    ])('matches by %s', async (_label, names, synonyms) => {
        const { db, service } = setup([
            () => {
                return json({ data: { m0: { media: [media(30, 'RELEASING', names, synonyms)] } } });
            }
        ]);
        addAnime(db, 'Frieren: Beyond Journey\'s End');

        await service.sync();

        expect(db.airingStates()[0]).toMatchObject({ anilistId: 30, status: 'ongoing' });
    });

    it('matches without regard to case, accents, punctuation or the number of episodes the source puts in brackets', async () => {
        const { db, service } = setup([
            () => {
                return json({ data: { m0: { media: [media(40, 'FINISHED', { english: 'Pokémon: Indigo League' })] } } });
            }
        ]);
        addAnime(db, 'POKEMON Indigo League (82 episodes)');

        await service.sync();

        expect(db.airingStates()[0]).toMatchObject({ anilistId: 40, status: 'finished' });
    });

    it('searches by the title without what the source puts in brackets', async () => {
        const { db, service, requests } = setup([
            () => {
                return json({ data: { m0: { media: [] } } });
            }
        ]);
        addAnime(db, 'Dandadan (Mini Anime)');

        await service.sync();

        expect(requests[0]?.variables).toEqual({ s0: 'Dandadan' });
    });

    it('takes the one of the answers that has the title, not the first one', async () => {
        const { db, service } = setup([
            () => {
                return json({
                    data: {
                        m0: {
                            media: [
                                media(1, 'FINISHED', { english: 'Naruto: Shippuden' }),
                                media(2, 'FINISHED', { english: 'Naruto the Movie' }),
                                media(3, 'FINISHED', { english: 'Naruto' })
                            ]
                        }
                    }
                });
            }
        ]);
        addAnime(db, 'Naruto');

        await service.sync();

        expect(db.airingStates()[0]).toMatchObject({ anilistId: 3 });
    });

    it('does not take a season for another: the title has to be one of the names AniList gives', async () => {
        const { db, service } = setup([
            () => {
                return json({
                    data: {
                        m0: { media: [media(10, 'FINISHED', { english: 'Frieren' }), media(11, 'RELEASING', { english: 'Frieren Season 2' })] },
                        m1: { media: [media(10, 'FINISHED', { english: 'Frieren' }), media(11, 'RELEASING', { english: 'Frieren Season 2' })] }
                    }
                });
            }
        ]);
        const second = addAnime(db, 'Frieren Season 2');
        const third = addAnime(db, 'Frieren Season 3');

        await service.sync();

        // The second season is the one called so; the third is not listed, and the first season is not taken for it.
        expect(db.airingStates()).toEqual([
            { id: second, title: 'Frieren Season 2', anilistId: 11, status: 'ongoing', checkedAt: NOW },
            { id: third, title: 'Frieren Season 3', anilistId: null, status: null, checkedAt: NOW }
        ]);
    });

    it('keeps nothing sure when AniList has no answer for a title, but remembers it asked', async () => {
        const { db, service } = setup([
            () => {
                return json({ data: { m0: { media: [] }, m1: null } });
            }
        ]);
        const first = addAnime(db, 'Bleach');
        const second = addAnime(db, 'Naruto');

        await service.sync();

        expect(db.airingStates()).toEqual([
            { id: first, title: 'Bleach', anilistId: null, status: null, checkedAt: NOW },
            { id: second, title: 'Naruto', anilistId: null, status: null, checkedAt: NOW }
        ]);
        expect(db.getAnime(first)?.airing.complete).toBe(false);
    });

    it('keeps nothing sure for a title with no letter or number to compare', async () => {
        const { db, service } = setup([
            () => {
                return json({ data: { m0: { media: [media(5, 'FINISHED', { english: '!!!' })] } } });
            }
        ]);
        const id = addAnime(db, '!!!');

        await service.sync();

        expect(db.airingStates()).toEqual([{ id, title: '!!!', anilistId: null, status: null, checkedAt: NOW }]);
    });

    it('ignores answers that are not shaped as an anime', async () => {
        const { db, service } = setup([
            () => {
                return json({ data: { m0: { media: [null, 'x', { id: 'a' }, { id: 1.5 }, media(7, 'FINISHED', { english: 'Naruto' })] } } });
            }
        ]);
        addAnime(db, 'Naruto');

        await service.sync();

        expect(db.airingStates()[0]).toMatchObject({ anilistId: 7, status: 'finished' });
    });

    it(`searches no more than ${SEARCH_BATCH} titles in a request and waits between the requests`, async () => {
        const answerFor = (request: Request): Response => {
            const data: Record<string, unknown> = {};
            Object.keys(request.variables).forEach((key) => {
                data[`m${key.slice(1)}`] = { media: [] };
            });
            return json({ data });
        };
        const { db, service, requests, sleep } = setup([answerFor, answerFor]);
        for (let position = 1; position <= SEARCH_BATCH + 1; position += 1) {
            addAnime(db, `Anime ${String(position).padStart(2, '0')}`);
        }

        await service.sync();

        expect(requests.map((request) => {
            return Object.keys(request.variables).length;
        })).toEqual([SEARCH_BATCH, 1]);
        expect(sleep).toHaveBeenCalledTimes(1);
        expect(sleep).toHaveBeenCalledWith(REQUEST_INTERVAL_MS);
    });

    it('does not search the titles that were already matched, nor the ones searched in the last week', async () => {
        const clock = { now: NOW };
        const { db, service, fetchFn } = setup([], clock);
        const matched = addAnime(db, 'Bleach');
        const missed = addAnime(db, 'Naruto');
        db.saveAiring(matched, 20, 'finished');
        db.saveAiring(missed, null, null);
        clock.now = NOW + UNMATCHED_RETRY_MS - 1;

        await service.sync();

        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('searches again, after a week, the title AniList had nothing sure about', async () => {
        const clock = { now: NOW };
        const { db, service, requests } = setup(
            [
                () => {
                    return json({ data: { m0: { media: [media(50, 'RELEASING', { english: 'Naruto' })] } } });
                }
            ],
            clock
        );
        const id = addAnime(db, 'Naruto');
        db.saveAiring(id, null, null);
        clock.now = NOW + UNMATCHED_RETRY_MS;

        await service.sync();

        expect(requests).toHaveLength(1);
        expect(db.airingStates()[0]).toEqual({ id, title: 'Naruto', anilistId: 50, status: 'ongoing', checkedAt: NOW + UNMATCHED_RETRY_MS });
    });
});

describe('AnimeAiringService asking about the anime that were matched', () => {
    function matched(db: AnimeDb, title: string, anilistId: number, status: 'finished' | 'ongoing' | null, clock: { now: number }, askedAt = NOW): number {
        const before = clock.now;
        clock.now = askedAt;
        const id = addAnime(db, title);
        db.saveAiring(id, anilistId, status);
        clock.now = before;
        return id;
    }

    it('asks by id, for the ones that have not ended and were asked about more than 3 hours ago', async () => {
        const clock = { now: NOW };
        const { db, service, requests } = setup(
            [
                () => {
                    return json({ data: { Page: { media: [{ id: 20, status: 'RELEASING' }, { id: 21, status: 'RELEASING' }] } } });
                }
            ],
            clock
        );
        matched(db, 'Bleach', 20, 'ongoing', clock);
        matched(db, 'Naruto', 21, null, clock);
        clock.now = NOW + REFRESH_AFTER_MS;

        await service.sync();

        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ url: ANILIST_URL, query: REFRESH_QUERY, variables: { ids: [20, 21], perPage: 2 } });
    });

    it('keeps the new status: an anime that was going on and ended is complete from then on', async () => {
        const clock = { now: NOW };
        const { db, service } = setup(
            [
                () => {
                    return json({ data: { Page: { media: [{ id: 20, status: 'FINISHED' }] } } });
                }
            ],
            clock
        );
        const id = matched(db, 'Bleach', 20, 'ongoing', clock);
        clock.now = NOW + REFRESH_AFTER_MS;

        await service.sync();

        expect(db.getAnime(id)?.airing).toEqual({ status: 'finished', override: null, complete: true });
        expect(db.airingStates()[0]).toEqual({ id, title: 'Bleach', anilistId: 20, status: 'finished', checkedAt: NOW + REFRESH_AFTER_MS });
    });

    it('does not ask again, before 3 hours, about the ones asked a short time ago', async () => {
        const clock = { now: NOW };
        const { db, service, fetchFn } = setup([], clock);
        matched(db, 'Bleach', 20, 'ongoing', clock);
        clock.now = NOW + REFRESH_AFTER_MS - 1;

        await service.sync();

        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('never asks again about an anime that ended', async () => {
        const clock = { now: NOW };
        const { db, service, fetchFn } = setup([], clock);
        matched(db, 'Bleach', 20, 'finished', clock);
        clock.now = NOW + 365 * 24 * HOUR;

        await service.sync();

        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('keeps what it had for an anime AniList does not give back, and for one it gives with a status it does not know', async () => {
        const clock = { now: NOW };
        const { db, service } = setup(
            [
                () => {
                    return json({ data: { Page: { media: [{ id: 21, status: 'SOMETHING_NEW' }] } } });
                }
            ],
            clock
        );
        matched(db, 'Bleach', 20, 'ongoing', clock);
        matched(db, 'Naruto', 21, 'ongoing', clock);
        clock.now = NOW + REFRESH_AFTER_MS;

        await service.sync();

        expect(db.airingStates().map((state) => {
            return [state.title, state.status, state.checkedAt];
        })).toEqual([
            ['Bleach', 'ongoing', NOW],
            ['Naruto', 'ongoing', NOW + REFRESH_AFTER_MS]
        ]);
    });

    it(`asks about no more than ${REFRESH_BATCH} ids in a request and waits between the requests`, async () => {
        const clock = { now: NOW };
        const answerFor = (request: Request): Response => {
            return json({ data: { Page: { media: (request.variables.ids as number[]).map((id) => {
                return { id, status: 'RELEASING' };
            }) } } });
        };
        const { db, service, requests, sleep } = setup([answerFor, answerFor], clock);
        for (let position = 1; position <= REFRESH_BATCH + 1; position += 1) {
            matched(db, `Anime ${String(position).padStart(2, '0')}`, 100 + position, 'ongoing', clock);
        }
        clock.now = NOW + REFRESH_AFTER_MS;

        await service.sync();

        expect(requests.map((request) => {
            return (request.variables.ids as number[]).length;
        })).toEqual([REFRESH_BATCH, 1]);
        expect(sleep).toHaveBeenCalledTimes(1);
        expect(sleep).toHaveBeenCalledWith(REQUEST_INTERVAL_MS);
    });

    it('matches the new anime first and then asks about the others, waiting between the two requests', async () => {
        const clock = { now: NOW };
        const { db, service, requests, sleep } = setup(
            [
                () => {
                    return json({ data: { m0: { media: [media(60, 'RELEASING', { english: 'Naruto' })] } } });
                },
                () => {
                    return json({ data: { Page: { media: [{ id: 20, status: 'FINISHED' }] } } });
                }
            ],
            clock
        );
        const old = matched(db, 'Bleach', 20, 'ongoing', clock);
        clock.now = NOW + REFRESH_AFTER_MS;
        addAnime(db, 'Naruto');

        await service.sync();

        expect(requests.map((request) => {
            return request.query === REFRESH_QUERY ? 'refresh' : 'search';
        })).toEqual(['search', 'refresh']);
        expect(sleep).toHaveBeenCalledTimes(1);
        expect(db.getAnime(old)?.airing.status).toBe('finished');
    });
});

describe('AnimeAiringService when AniList does not answer', () => {
    it('rejects, and keeps nothing, when it cannot be reached', async () => {
        const { db, service } = setup([
            () => {
                throw new Error('connect ECONNREFUSED');
            }
        ]);
        addAnime(db, 'Naruto');

        await expect(service.sync()).rejects.toThrow('AniList could not be reached: connect ECONNREFUSED');
        await expect(service.sync()).rejects.toBeInstanceOf(ScheduleFetchError);
        expect(db.airingStates()[0]?.checkedAt).toBeNull();
    });

    it('rejects when the failure is not an error', async () => {
        const db = new AnimeDb(':memory:');
        addAnime(db, 'Naruto');
        const service = new AnimeAiringService({
            db,
            fetchFn: (async () => {
                return Promise.reject('offline');
            }) as unknown as typeof fetch
        });

        await expect(service.sync()).rejects.toThrow('AniList could not be reached: offline');
    });

    it('rejects when AniList refuses, as it does when it is asked too much', async () => {
        const { db, service } = setup([
            () => {
                return json({ errors: [{ status: 429 }] }, 429);
            }
        ]);
        addAnime(db, 'Naruto');

        await expect(service.sync()).rejects.toThrow('AniList answered 429.');
        expect(db.airingStates()[0]?.checkedAt).toBeNull();
    });

    it('rejects when the answer is not JSON', async () => {
        const { db, service } = setup([
            () => {
                return new Response('<html>', { status: 200 });
            }
        ]);
        addAnime(db, 'Naruto');

        await expect(service.sync()).rejects.toThrow('AniList did not answer with JSON.');
    });

    it.each([
        ['no data', { errors: [{ message: 'bad' }] }],
        ['data that is null', { data: null }],
        ['something that is not an object', 'x']
    ])('rejects when the answer has %s', async (_label, body) => {
        const { db, service } = setup([
            () => {
                return json(body);
            }
        ]);
        addAnime(db, 'Naruto');

        await expect(service.sync()).rejects.toThrow('AniList answered with no data.');
    });

    it('keeps what the requests before the failure got', async () => {
        const answerFor = (request: Request): Response => {
            const data: Record<string, unknown> = {};
            Object.keys(request.variables).forEach((key) => {
                data[`m${key.slice(1)}`] = { media: [media(70, 'FINISHED', { english: 'Anime 01' })] };
            });
            return json({ data });
        };
        const { db, service } = setup([
            answerFor,
            () => {
                return json({}, 503);
            }
        ]);
        for (let position = 1; position <= SEARCH_BATCH + 1; position += 1) {
            addAnime(db, `Anime ${String(position).padStart(2, '0')}`);
        }

        await expect(service.sync()).rejects.toThrow('AniList answered 503.');

        const states = db.airingStates();
        expect(states[0]).toMatchObject({ title: 'Anime 01', anilistId: 70, status: 'finished', checkedAt: NOW });
        expect(states.at(-1)).toMatchObject({ anilistId: null, status: null, checkedAt: null });
    });

    it('does not wait for the pause when it fails at the first request', async () => {
        const { db, service, sleep } = setup([
            () => {
                return json({}, 500);
            }
        ]);
        addAnime(db, 'Naruto');

        await expect(service.sync()).rejects.toThrow('AniList answered 500.');
        expect(sleep).not.toHaveBeenCalled();
    });
});

describe('AnimeAiringService telling that what is known changed', () => {
    it('tells once for each request of the search that kept something', async () => {
        const answerFor = (request: Request): Response => {
            const data: Record<string, unknown> = {};
            Object.keys(request.variables).forEach((key) => {
                data[`m${key.slice(1)}`] = { media: [] };
            });
            return json({ data });
        };
        const { db, service, onChange } = setup([answerFor, answerFor]);
        for (let position = 1; position <= SEARCH_BATCH + 1; position += 1) {
            addAnime(db, `Anime ${String(position).padStart(2, '0')}`);
        }

        await service.sync();

        expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('tells when an anime that was going on is asked about and kept a status', async () => {
        const clock = { now: NOW };
        const { db, service, onChange } = setup(
            [
                () => {
                    return json({ data: { Page: { media: [{ id: 20, status: 'FINISHED' }] } } });
                }
            ],
            clock
        );
        const id = addAnime(db, 'Bleach');
        db.saveAiring(id, 20, 'ongoing');
        clock.now = NOW + REFRESH_AFTER_MS;

        await service.sync();

        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('tells nothing when AniList gives back none of the anime asked about, when there is nothing to ask or when it fails', async () => {
        const clock = { now: NOW };
        const { db, service, onChange } = setup(
            [
                () => {
                    return json({ data: { Page: { media: [] } } });
                },
                () => {
                    return json({}, 500);
                }
            ],
            clock
        );
        await service.sync();
        const id = addAnime(db, 'Bleach');
        db.saveAiring(id, 20, 'ongoing');
        clock.now = NOW + REFRESH_AFTER_MS;
        await service.sync();
        clock.now = NOW + 2 * REFRESH_AFTER_MS;
        await expect(service.sync()).rejects.toThrow('AniList answered 500.');

        expect(onChange).not.toHaveBeenCalled();
    });
});

