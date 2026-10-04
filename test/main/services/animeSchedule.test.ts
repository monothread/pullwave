import {
    ANILIST_URL,
    MAX_SYNONYMS,
    SCHEDULE_MAX_PAGES,
    SCHEDULE_PAGE_SIZE,
    SCHEDULE_QUERY,
    ScheduleFetchError,
    fetchAiringSchedule,
    loadSchedule,
    parseScheduleEntry,
    SCHEDULE_CACHE_MS,
    type ScheduleCache
} from '@main/services/animeSchedule';
import type { AnimeScheduleEntry } from '@shared/anime';

interface RawEpisodeOptions {
    id?: number;
    episode?: number;
    airingAt?: number;
    format?: string | null;
    country?: string | null;
    isAdult?: boolean;
    romaji?: string | null;
    english?: string | null;
    synonyms?: unknown;
    cover?: string | null;
}

function rawEpisode(options: RawEpisodeOptions = {}): unknown {
    return {
        episode: options.episode ?? 12,
        airingAt: options.airingAt ?? 1_700_040_000,
        media: {
            id: options.id ?? 154587,
            format: options.format === undefined ? 'TV' : options.format,
            countryOfOrigin: options.country === undefined ? 'JP' : options.country,
            isAdult: options.isAdult ?? false,
            title: {
                romaji: options.romaji === undefined ? 'Sousou no Frieren' : options.romaji,
                english: options.english === undefined ? 'Frieren: Beyond Journey\'s End' : options.english
            },
            synonyms: options.synonyms ?? [],
            coverImage: { large: options.cover === undefined ? 'https://img.example/frieren.jpg' : options.cover }
        }
    };
}

function pageBody(items: unknown[], hasNextPage = false): unknown {
    return { data: { Page: { pageInfo: { hasNextPage }, airingSchedules: items } } };
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const FRIEREN: AnimeScheduleEntry = {
    anilistId: 154587,
    title: 'Frieren: Beyond Journey\'s End',
    english: 'Frieren: Beyond Journey\'s End',
    romaji: 'Sousou no Frieren',
    names: ['Frieren: Beyond Journey\'s End', 'Sousou no Frieren'],
    episode: 12,
    airingAt: 1_700_040_000,
    coverUrl: 'https://img.example/frieren.jpg'
};

describe('parseScheduleEntry', () => {
    it('reads the episode, when it airs, the anime and every name it has', () => {
        expect(parseScheduleEntry(rawEpisode())).toEqual(FRIEREN);
    });

    it('keeps the english and the romaji names apart, each one missing when the anime has none', () => {
        expect(parseScheduleEntry(rawEpisode({ romaji: 'Kimetsu no Yaiba', english: 'Demon Slayer' }))).toMatchObject({ english: 'Demon Slayer', romaji: 'Kimetsu no Yaiba' });
        expect(parseScheduleEntry(rawEpisode({ romaji: null, english: 'Demon Slayer' }))).toMatchObject({ english: 'Demon Slayer', romaji: null });
        expect(parseScheduleEntry(rawEpisode({ romaji: 'Kimetsu no Yaiba', english: null }))).toMatchObject({ english: null, romaji: 'Kimetsu no Yaiba' });
        expect(parseScheduleEntry(rawEpisode({ romaji: '  Bleach  ', english: '  ' }))).toMatchObject({ english: null, romaji: 'Bleach' });
    });

    it('shows the english title and puts it first among the names, before the romaji one', () => {
        const parsed = parseScheduleEntry(rawEpisode({ romaji: 'Kimetsu no Yaiba', english: 'Demon Slayer' }));
        expect(parsed?.title).toBe('Demon Slayer');
        expect(parsed?.names).toEqual(['Demon Slayer', 'Kimetsu no Yaiba']);
    });

    it('shows the english title when there is no romaji one', () => {
        const parsed = parseScheduleEntry(rawEpisode({ romaji: null, english: 'Demon Slayer' }));
        expect(parsed?.title).toBe('Demon Slayer');
        expect(parsed?.names).toEqual(['Demon Slayer']);
    });

    it('shows the romaji title when there is no english one', () => {
        const parsed = parseScheduleEntry(rawEpisode({ romaji: 'Kimetsu no Yaiba', english: null }));
        expect(parsed?.title).toBe('Kimetsu no Yaiba');
        expect(parsed?.names).toEqual(['Kimetsu no Yaiba']);
    });

    it('gives none when the anime has no title at all', () => {
        expect(parseScheduleEntry(rawEpisode({ romaji: null, english: null }))).toBeNull();
    });

    it('trims the names and does not repeat one that only differs in case', () => {
        const parsed = parseScheduleEntry(rawEpisode({ romaji: '  Bleach  ', english: 'BLEACH', synonyms: ['bleach', 'Burīchi'] }));
        expect(parsed?.names).toEqual(['BLEACH', 'Burīchi']);
    });

    it('keeps the synonyms that are text, up to the limit', () => {
        const synonyms = ['One', 2, '', '   ', 'Two', 'Three', 'Four', 'Five', 'Six'];
        const parsed = parseScheduleEntry(rawEpisode({ synonyms }));
        expect(parsed?.names).toEqual(['Frieren: Beyond Journey\'s End', 'Sousou no Frieren', 'One', 'Two', 'Three', 'Four']);
        expect(MAX_SYNONYMS).toBe(4);
    });

    it('has no synonyms when the list is not a list', () => {
        expect(parseScheduleEntry(rawEpisode({ synonyms: 'Frieren' }))?.names).toEqual(FRIEREN.names);
    });

    it('has no cover when there is none', () => {
        expect(parseScheduleEntry(rawEpisode({ cover: null }))?.coverUrl).toBeNull();
    });

    it.each(['TV', 'TV_SHORT', 'ONA', 'OVA'])('takes an anime in the %s format', (format) => {
        expect(parseScheduleEntry(rawEpisode({ format }))).not.toBeNull();
    });

    it.each(['MOVIE', 'SPECIAL', 'MUSIC', null])('leaves out the %s format', (format) => {
        expect(parseScheduleEntry(rawEpisode({ format }))).toBeNull();
    });

    it.each(['KR', 'CN', null])('leaves out an anime made in %s', (country) => {
        expect(parseScheduleEntry(rawEpisode({ country }))).toBeNull();
    });

    it('leaves out an anime for adults', () => {
        expect(parseScheduleEntry(rawEpisode({ isAdult: true }))).toBeNull();
    });

    it('leaves out an episode that is not numbered from 1', () => {
        expect(parseScheduleEntry(rawEpisode({ episode: 0 }))).toBeNull();
        expect(parseScheduleEntry(rawEpisode({ episode: 1.5 }))).toBeNull();
    });

    it.each([
        ['null', null],
        ['text', 'Frieren'],
        ['a list', []],
        ['an item without media', { episode: 1, airingAt: 1 }],
        ['an item with media that is not an object', { episode: 1, airingAt: 1, media: 'Frieren' }],
        ['an item without the time it airs', { episode: 1, media: { id: 1 } }],
        ['an item without the episode', { airingAt: 1, media: { id: 1 } }],
        ['an anime without an id', { episode: 1, airingAt: 1, media: { format: 'TV', countryOfOrigin: 'JP', title: { romaji: 'A' } } }]
    ])('gives none for %s', (_name, input) => {
        expect(parseScheduleEntry(input)).toBeNull();
    });
});

describe('fetchAiringSchedule', () => {
    it('asks AniList for the stretch with the query and the first page', async () => {
        const fetchFn = vi.fn(async () => {
            return jsonResponse(pageBody([rawEpisode()]));
        });

        const episodes = await fetchAiringSchedule(1_700_000_000, 1_700_086_400, { fetchFn });

        expect(episodes).toEqual([FRIEREN]);
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(fetchFn).toHaveBeenCalledWith(ANILIST_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query: SCHEDULE_QUERY, variables: { start: 1_700_000_000, end: 1_700_086_400, page: 1, perPage: SCHEDULE_PAGE_SIZE } }),
            signal: expect.any(AbortSignal)
        });
    });

    it('asks at the address it was given', async () => {
        const addresses: Array<string | URL | Request> = [];
        const fetchFn = vi.fn(async (url: string | URL | Request): Promise<Response> => {
            addresses.push(url);
            return jsonResponse(pageBody([]));
        });

        await fetchAiringSchedule(1, 2, { fetchFn, url: 'http://127.0.0.1:9000/graphql' });

        expect(addresses).toEqual(['http://127.0.0.1:9000/graphql']);
    });

    it('gives nothing when no episode airs', async () => {
        const fetchFn = vi.fn(async () => {
            return jsonResponse(pageBody([]));
        });

        expect(await fetchAiringSchedule(1, 2, { fetchFn })).toEqual([]);
    });

    it('asks for the next page while there is one and joins them in order', async () => {
        const answers = [
            jsonResponse(pageBody([rawEpisode({ id: 1, episode: 1, romaji: 'First', english: 'First' })], true)),
            jsonResponse(pageBody([rawEpisode({ id: 2, episode: 2, romaji: 'Second', english: 'Second' })], true)),
            jsonResponse(pageBody([rawEpisode({ id: 3, episode: 3, romaji: 'Third', english: 'Third' })], false))
        ];
        const pagesAsked: number[] = [];
        const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
            pagesAsked.push(JSON.parse(init?.body as string).variables.page);
            return answers.shift() as Response;
        });

        const episodes = await fetchAiringSchedule(1, 2, { fetchFn });

        expect(
            episodes.map((episode) => {
                return [episode.anilistId, episode.episode, episode.title];
            })
        ).toEqual([
            [1, 1, 'First'],
            [2, 2, 'Second'],
            [3, 3, 'Third']
        ]);
        expect(pagesAsked).toEqual([1, 2, 3]);
    });

    it('stops at the last page it is willing to ask for when AniList always says there is another', async () => {
        const fetchFn = vi.fn(async () => {
            return jsonResponse(pageBody([rawEpisode()], true));
        });

        const episodes = await fetchAiringSchedule(1, 2, { fetchFn });

        expect(fetchFn).toHaveBeenCalledTimes(SCHEDULE_MAX_PAGES);
        expect(episodes).toHaveLength(SCHEDULE_MAX_PAGES);
    });

    it('leaves out what is not an episode of a series made in Japan', async () => {
        const fetchFn = vi.fn(async () => {
            return jsonResponse(pageBody([rawEpisode({ id: 1 }), rawEpisode({ id: 2, format: 'MOVIE' }), rawEpisode({ id: 3, country: 'CN' }), rawEpisode({ id: 4, isAdult: true }), 'broken']));
        });

        const episodes = await fetchAiringSchedule(1, 2, { fetchFn });

        expect(
            episodes.map((episode) => {
                return episode.anilistId;
            })
        ).toEqual([1]);
    });

    it('fails when AniList cannot be reached', async () => {
        const fetchFn = vi.fn(async () => {
            throw new Error('getaddrinfo ENOTFOUND graphql.anilist.co');
        });

        const result = fetchAiringSchedule(1, 2, { fetchFn });

        await expect(result).rejects.toBeInstanceOf(ScheduleFetchError);
        await expect(result).rejects.toThrow('AniList could not be reached: getaddrinfo ENOTFOUND graphql.anilist.co');
    });

    it('fails with the text of what was thrown when it is not an error', async () => {
        const fetchFn = vi.fn(async () => {
            throw 'offline';
        });

        await expect(fetchAiringSchedule(1, 2, { fetchFn })).rejects.toThrow('AniList could not be reached: offline');
    });

    it('fails when AniList refuses', async () => {
        const fetchFn = vi.fn(async () => {
            return jsonResponse({ errors: [] }, 429);
        });

        const result = fetchAiringSchedule(1, 2, { fetchFn });

        await expect(result).rejects.toBeInstanceOf(ScheduleFetchError);
        await expect(result).rejects.toThrow('AniList answered with status 429.');
    });

    it('fails when the answer is not JSON', async () => {
        const fetchFn = vi.fn(async () => {
            return new Response('<html>Bad gateway</html>', { status: 200 });
        });

        await expect(fetchAiringSchedule(1, 2, { fetchFn })).rejects.toThrow('AniList answered with something that is not JSON.');
    });

    it.each([
        ['null', null],
        ['no data', {}],
        ['no page', { data: {} }],
        ['a page without the schedule', { data: { Page: { pageInfo: { hasNextPage: false } } } }],
        ['a schedule that is not a list', { data: { Page: { airingSchedules: 'none' } } }],
        ['errors in place of data', { errors: [{ message: 'Too many requests' }] }]
    ])('fails when the answer has %s', async (_name, body) => {
        const fetchFn = vi.fn(async () => {
            return jsonResponse(body);
        });

        const result = fetchAiringSchedule(1, 2, { fetchFn });

        await expect(result).rejects.toBeInstanceOf(ScheduleFetchError);
        await expect(result).rejects.toThrow('AniList answered with something that is not a schedule.');
    });

    it('stops asking when a page fails, and gives nothing of the pages before', async () => {
        const fetchFn = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse(pageBody([rawEpisode()], true)))
            .mockResolvedValueOnce(jsonResponse({}, 500));

        await expect(fetchAiringSchedule(1, 2, { fetchFn })).rejects.toThrow('AniList answered with status 500.');
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('gives up on an answer that takes longer than the time it was given', async () => {
        const fetchFn = vi.fn((_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
            return new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                    reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
                });
            });
        });

        await expect(fetchAiringSchedule(1, 2, { fetchFn: fetchFn as unknown as typeof fetch, timeoutMs: 20 })).rejects.toThrow(
            'AniList could not be reached: The operation was aborted due to timeout'
        );
    });
});

describe('loadSchedule', () => {
    it('lists the episodes of the stretch, asking from one second before it starts because the limits are exclusive', async () => {
        const bodies: Array<{ variables: { start: number; end: number; page: number; perPage: number } }> = [];
        const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
            bodies.push(JSON.parse(init?.body as string));
            return jsonResponse(pageBody([rawEpisode()]));
        });

        const response = await loadSchedule({ from: 1_700_000_000, to: 1_700_086_400, refresh: false }, { fetchFn });

        expect(response).toEqual({ ok: true, entries: [FRIEREN] });
        expect(bodies).toHaveLength(1);
        expect(bodies[0]?.variables).toEqual({ start: 1_699_999_999, end: 1_700_086_400, page: 1, perPage: SCHEDULE_PAGE_SIZE });
    });

    it('asks at the address it was given', async () => {
        const addresses: Array<string | URL | Request> = [];
        const fetchFn = vi.fn(async (url: string | URL | Request): Promise<Response> => {
            addresses.push(url);
            return jsonResponse(pageBody([]));
        });

        const response = await loadSchedule({ from: 1, to: 2, refresh: false }, { fetchFn, url: 'http://127.0.0.1:9000/graphql' });

        expect(response).toEqual({ ok: true, entries: [] });
        expect(addresses).toEqual(['http://127.0.0.1:9000/graphql']);
    });

    it('gives a network error with what AniList said when it refuses', async () => {
        const fetchFn = vi.fn(async () => {
            return jsonResponse({}, 429);
        });

        expect(await loadSchedule({ from: 1, to: 2, refresh: false }, { fetchFn })).toEqual({ ok: false, error: { code: 'NETWORK', raw: 'AniList answered with status 429.' } });
    });

    it('gives a network error when AniList cannot be reached', async () => {
        const fetchFn = vi.fn(async () => {
            throw new Error('getaddrinfo ENOTFOUND graphql.anilist.co');
        });

        expect(await loadSchedule({ from: 1, to: 2, refresh: false }, { fetchFn })).toEqual({
            ok: false,
            error: { code: 'NETWORK', raw: 'AniList could not be reached: getaddrinfo ENOTFOUND graphql.anilist.co' }
        });
    });

    it('gives a network error when the answer is not JSON', async () => {
        const fetchFn = vi.fn(async (): Promise<Response> => {
            return new Response('<html>Bad gateway</html>', { status: 200 });
        });

        const response = await loadSchedule({ from: 1, to: 2, refresh: false }, { fetchFn });

        expect(response).toEqual({ ok: false, error: { code: 'NETWORK', raw: 'AniList answered with something that is not JSON.' } });
    });
});

describe('loadSchedule cache', () => {
    const REQUEST = { from: 1_700_000_000, to: 1_700_086_400 };
    const CACHED: AnimeScheduleEntry = { anilistId: 1, title: 'Cached', english: 'Cached', romaji: null, names: ['Cached'], episode: 4, airingAt: 1_700_000_100, coverUrl: null };

    function makeCache(found: AnimeScheduleEntry[] | null = null) {
        const find = vi.fn<ScheduleCache['find']>(() => {
            return found;
        });
        const save = vi.fn<ScheduleCache['save']>(() => {
            return undefined;
        });
        const cache: ScheduleCache = { find, save };
        return { cache, find, save };
    }

    function answering(...items: unknown[]) {
        return vi.fn(async () => {
            return jsonResponse(pageBody(items));
        });
    }

    it('trusts what was listed for a day', () => {
        expect(SCHEDULE_CACHE_MS).toBe(24 * 60 * 60 * 1000);
    });

    it('answers from the cache, without asking AniList, when it has the stretch', async () => {
        const { cache, find, save } = makeCache([CACHED]);
        const fetchFn = answering(rawEpisode());

        const response = await loadSchedule({ ...REQUEST, refresh: false }, { fetchFn, cache });

        expect(response).toEqual({ ok: true, entries: [CACHED] });
        expect(find).toHaveBeenCalledTimes(1);
        expect(find).toHaveBeenCalledWith(REQUEST.from, REQUEST.to);
        expect(fetchFn).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
    });

    it('answers an empty day from the cache too: nothing airing is an answer', async () => {
        const { cache } = makeCache([]);
        const fetchFn = answering(rawEpisode());

        expect(await loadSchedule({ ...REQUEST, refresh: false }, { fetchFn, cache })).toEqual({ ok: true, entries: [] });
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('asks AniList when the cache has nothing, and keeps the answer with the exact stretch', async () => {
        const { cache, save } = makeCache(null);
        const fetchFn = answering(rawEpisode());

        const response = await loadSchedule({ ...REQUEST, refresh: false }, { fetchFn, cache });

        expect(response).toEqual({ ok: true, entries: [FRIEREN] });
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith(REQUEST.from, REQUEST.to, [FRIEREN]);
    });

    it('keeps an empty answer too, so the next time does not ask again', async () => {
        const { cache, save } = makeCache(null);

        await loadSchedule({ ...REQUEST, refresh: false }, { fetchFn: answering(), cache });

        expect(save).toHaveBeenCalledWith(REQUEST.from, REQUEST.to, []);
    });

    it('asks AniList again, without looking at the cache, when it is asked to refresh, and keeps the new answer', async () => {
        const { cache, find, save } = makeCache([CACHED]);
        const fetchFn = answering(rawEpisode());

        const response = await loadSchedule({ ...REQUEST, refresh: true }, { fetchFn, cache });

        expect(response).toEqual({ ok: true, entries: [FRIEREN] });
        expect(find).not.toHaveBeenCalled();
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith(REQUEST.from, REQUEST.to, [FRIEREN]);
    });

    it('keeps nothing, and gives the error, when AniList cannot be asked', async () => {
        const { cache, save } = makeCache(null);
        const fetchFn = vi.fn(async () => {
            return jsonResponse({}, 500);
        });

        const response = await loadSchedule({ ...REQUEST, refresh: false }, { fetchFn, cache });

        expect(response).toEqual({ ok: false, error: { code: 'NETWORK', raw: 'AniList answered with status 500.' } });
        expect(save).not.toHaveBeenCalled();
    });

    it('does not fall back to the old cache when a refresh fails: the failure is told', async () => {
        const { cache } = makeCache([CACHED]);
        const fetchFn = vi.fn(async () => {
            return jsonResponse({}, 429);
        });

        const response = await loadSchedule({ ...REQUEST, refresh: true }, { fetchFn, cache });

        expect(response).toEqual({ ok: false, error: { code: 'NETWORK', raw: 'AniList answered with status 429.' } });
    });

    it('works without a cache', async () => {
        const response = await loadSchedule({ ...REQUEST, refresh: false }, { fetchFn: answering(rawEpisode()) });

        expect(response).toEqual({ ok: true, entries: [FRIEREN] });
    });
});
