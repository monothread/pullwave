import {
    ANILIST_BATCH_SIZE,
    ANILIST_BATCH_WINDOW_MS,
    ANILIST_COVER_URL,
    AniListCoverProvider,
    KITSU_URL,
    KitsuCoverProvider,
    MANGADEX_UPLOADS_URL,
    MANGADEX_URL,
    MangaDexCoverProvider,
    SEARCH_RESULTS,
    comparableTitle,
    coverQuery,
    pickByTitle
} from '@main/services/covers/coverProviders';
import { CoverFetchError, PoliteClient } from '@main/services/covers/politeClient';

type Answer = Response | Error;

function json(body: unknown, code = 200): Response {
    return new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } });
}

function client(answers: Answer[]) {
    const queue = [...answers];
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        calls.push({ url: String(url), init: init as RequestInit });
        const next = queue.shift() ?? json({});
        if (next instanceof Error) {
            throw next;
        }
        return next;
    }) as unknown as typeof fetch;
    return { client: new PoliteClient({ service: 'Test', intervalMs: 0, fetchFn, sleep: async () => {} }), calls };
}

describe('the constants', () => {
    it('has the addresses of the services, looks at five results of a search and asks AniList for 25 names at a time, gathered for 50 ms', () => {
        expect(ANILIST_COVER_URL).toBe('https://graphql.anilist.co');
        expect(KITSU_URL).toBe('https://kitsu.io/api/edge');
        expect(ANILIST_BATCH_SIZE).toBe(25);
        expect(ANILIST_BATCH_WINDOW_MS).toBe(50);
        expect(MANGADEX_URL).toBe('https://api.mangadex.org');
        expect(MANGADEX_UPLOADS_URL).toBe('https://uploads.mangadex.org');
        expect(SEARCH_RESULTS).toBe(5);
    });
});

describe('coverQuery', () => {
    it('asks AniList for the large cover of each name, a page of one each, for an anime', () => {
        expect(coverQuery('anime', 2)).toBe(
            'query ($s0: String, $s1: String) {\n' +
                '  a0: Page(perPage: 1) { media(search: $s0, type: ANIME) { coverImage { large } } }\n' +
                '  a1: Page(perPage: 1) { media(search: $s1, type: ANIME) { coverImage { large } } }\n' +
                '}'
        );
    });

    it('asks for a manga, with one name', () => {
        expect(coverQuery('manga', 1)).toBe('query ($s0: String) {\n  a0: Page(perPage: 1) { media(search: $s0, type: MANGA) { coverImage { large } } }\n}');
    });
});

describe('comparableTitle', () => {
    it.each([
        ['Kaguya-sama: Love Is War', 'kaguyasamaloveiswar'],
        ['  POKÉMON  ', 'pokemon'],
        ['Re:Zero − Starting Life', 'rezerostartinglife'],
        ['進撃の巨人', '進撃の巨人'],
        ['2.5 Dimensional Seduction', '25dimensionalseduction'],
        ['!!!', '']
    ])('makes "%s" into "%s"', (title, comparable) => {
        expect(comparableTitle(title)).toBe(comparable);
    });
});

describe('pickByTitle', () => {
    const results = [
        { names: ['Naruto Shippuden'], url: 'https://img/shippuden.jpg' },
        { names: ['NARUTO', 'ナルト'], url: null },
        { names: ['Naruto!'], url: 'https://img/naruto.jpg' }
    ];
    const namesOf = (result: (typeof results)[number]): string[] => {
        return result.names;
    };
    const pick = (result: (typeof results)[number]): string | null => {
        return result.url;
    };

    it('takes the first result named the title that has something to take', () => {
        expect(pickByTitle(results, 'naruto', namesOf, pick)).toBe('https://img/naruto.jpg');
    });

    it('takes none when no result is named the title, nor for a title with nothing to compare', () => {
        expect(pickByTitle(results, 'Bleach', namesOf, pick)).toBeNull();
        expect(pickByTitle(results, '???', namesOf, pick)).toBeNull();
        expect(pickByTitle([], 'Naruto', namesOf, pick)).toBeNull();
    });
});

describe('AniListCoverProvider', () => {
    function page(cover: string | null | undefined): unknown {
        return { media: cover === undefined ? [] : [{ coverImage: { large: cover } }] };
    }

    it('asks AniList for the cover of the title, of the kind asked, and gives it trimmed', async () => {
        const { client: polite, calls } = client([json({ data: { a0: page(' https://s4.anilist.co/manga/op.jpg ') } })]);
        const provider = new AniListCoverProvider(polite, ANILIST_COVER_URL, 0);
        expect(provider.name).toBe('AniList');
        await expect(provider.find('One Piece', 'manga')).resolves.toBe('https://s4.anilist.co/manga/op.jpg');
        expect(calls).toEqual([
            {
                url: ANILIST_COVER_URL,
                init: {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({ query: coverQuery('manga', 1), variables: { s0: 'One Piece' } }),
                    signal: expect.any(AbortSignal)
                }
            }
        ]);
    });

    it('asks at the address it was given', async () => {
        const { client: polite, calls } = client([json({ data: { a0: page('https://x/y.jpg') } })]);
        await new AniListCoverProvider(polite, 'http://127.0.0.1:9/anilist', 0).find('Naruto', 'anime');
        expect(calls[0]?.url).toBe('http://127.0.0.1:9/anilist');
        expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ query: coverQuery('anime', 1), variables: { s0: 'Naruto' } });
    });

    it('asks for the names asked for together in one request, once each, and gives each name its own cover', async () => {
        const { client: polite, calls } = client([json({ data: { a0: page('https://a.jpg'), a1: page(undefined), a2: page('https://c.jpg') } })]);
        const provider = new AniListCoverProvider(polite, ANILIST_COVER_URL, 0);
        await expect(Promise.all([provider.find('A', 'anime'), provider.find('B', 'anime'), provider.find('C', 'anime'), provider.find('A', 'anime')])).resolves.toEqual(['https://a.jpg', null, 'https://c.jpg', 'https://a.jpg']);
        expect(calls).toHaveLength(1);
        expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ query: coverQuery('anime', 3), variables: { s0: 'A', s1: 'B', s2: 'C' } });
    });

    it('keeps the anime and the mangas in requests of their own', async () => {
        const { client: polite, calls } = client([json({ data: { a0: page('https://anime.jpg') } }), json({ data: { a0: page('https://manga.jpg') } })]);
        const provider = new AniListCoverProvider(polite, ANILIST_COVER_URL, 0);
        await expect(Promise.all([provider.find('Berserk', 'anime'), provider.find('Berserk', 'manga')])).resolves.toEqual(['https://anime.jpg', 'https://manga.jpg']);
        expect(calls.map((call) => {
            return JSON.parse(call.init.body as string) as unknown;
        })).toEqual([
            { query: coverQuery('anime', 1), variables: { s0: 'Berserk' } },
            { query: coverQuery('manga', 1), variables: { s0: 'Berserk' } }
        ]);
    });

    it('sends a full request at once, without waiting for the moment to pass, and the names left in the next', async () => {
        const names = Array.from({ length: ANILIST_BATCH_SIZE + 2 }, (_, index) => {
            return `Anime ${String(index)}`;
        });
        const { client: polite, calls } = client([json({ data: {} }), json({ data: {} })]);
        const provider = new AniListCoverProvider(polite, ANILIST_COVER_URL, 60_000);
        vi.useFakeTimers();
        try {
            const answers = Promise.all(names.slice(0, ANILIST_BATCH_SIZE).map((name) => {
                return provider.find(name, 'anime');
            }));
            await vi.advanceTimersByTimeAsync(0);
            expect(calls).toHaveLength(1);
            await expect(answers).resolves.toEqual(Array.from({ length: ANILIST_BATCH_SIZE }, () => {
                return null;
            }));
            const rest = Promise.all(names.slice(ANILIST_BATCH_SIZE).map((name) => {
                return provider.find(name, 'anime');
            }));
            await vi.advanceTimersByTimeAsync(60_000);
            await expect(rest).resolves.toEqual([null, null]);
            expect(JSON.parse(calls[1]?.init.body as string)).toEqual({ query: coverQuery('anime', 2), variables: { s0: names[25], s1: names[26] } });
        } finally {
            vi.useRealTimers();
        }
    });

    it('gathers the names for the moment it was given, 50 ms by default', async () => {
        vi.useFakeTimers();
        try {
            const { client: polite, calls } = client([json({ data: { a0: page('https://a.jpg'), a1: page('https://b.jpg') } })]);
            const provider = new AniListCoverProvider(polite);
            const first = provider.find('A', 'anime');
            await vi.advanceTimersByTimeAsync(40);
            const second = provider.find('B', 'anime');
            expect(calls).toHaveLength(0);
            await vi.advanceTimersByTimeAsync(10);
            await expect(Promise.all([first, second])).resolves.toEqual(['https://a.jpg', 'https://b.jpg']);
            expect(calls).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it.each([
        ['a name it does not know (an empty page)', json({ data: { a0: page(undefined) } })],
        ['no cover', json({ data: { a0: page(null) } })],
        ['an empty cover', json({ data: { a0: page('  ') } })],
        ['no page for the name', json({ data: {} })],
        ['an unknown address (404)', json({}, 404)],
        ['an answer that cannot be read', new Response('<html>', { status: 200 })]
    ])('gives none for %s', async (_case, answer) => {
        const { client: polite } = client([answer]);
        await expect(new AniListCoverProvider(polite, ANILIST_COVER_URL, 0).find('Naruto', 'anime')).resolves.toBeNull();
    });

    it('fails, for every name of the request, when AniList cannot be asked', async () => {
        const { client: polite } = client([json({}, 500)]);
        const provider = new AniListCoverProvider(polite, ANILIST_COVER_URL, 0);
        const answers = await Promise.allSettled([provider.find('Naruto', 'anime'), provider.find('Bleach', 'anime')]);
        expect(answers).toEqual([
            { status: 'rejected', reason: new CoverFetchError('Test answered with status 500.') },
            { status: 'rejected', reason: new CoverFetchError('Test answered with status 500.') }
        ]);
    });
});

describe('KitsuCoverProvider', () => {
    function kitsuResult(names: { canonicalTitle?: string; titles?: Record<string, string | null>; abbreviatedTitles?: string[] }, posterImage: Record<string, string | null> | null) {
        return { id: '1', type: 'anime', attributes: { ...names, posterImage } };
    }

    it('searches Kitsu by the text of the title, for the kind asked, with the fields it needs', async () => {
        const { client: polite, calls } = client([json({ data: [kitsuResult({ canonicalTitle: 'One Piece' }, { large: 'https://media.kitsu.io/op/large.jpg' })] })]);
        const provider = new KitsuCoverProvider(polite);
        expect(provider.name).toBe('Kitsu');
        await expect(provider.find('One Piece', 'manga')).resolves.toBe('https://media.kitsu.io/op/large.jpg');
        expect(calls).toEqual([
            {
                url: `${KITSU_URL}/manga?filter%5Btext%5D=One+Piece&page%5Blimit%5D=5&fields%5Bmanga%5D=canonicalTitle%2Ctitles%2CabbreviatedTitles%2CposterImage`,
                init: { headers: { Accept: 'application/vnd.api+json' }, signal: expect.any(AbortSignal) }
            }
        ]);
    });

    it('asks at the address it was given, for an anime', async () => {
        const { client: polite, calls } = client([json({ data: [] })]);
        await new KitsuCoverProvider(polite, 'http://127.0.0.1:9/kitsu').find('Naruto', 'anime');
        expect(calls[0]?.url).toBe('http://127.0.0.1:9/kitsu/anime?filter%5Btext%5D=Naruto&page%5Blimit%5D=5&fields%5Banime%5D=canonicalTitle%2Ctitles%2CabbreviatedTitles%2CposterImage');
    });

    it('takes the first result named the title, by any of its names, and the largest picture it has', async () => {
        const { client: polite } = client([
            json({
                data: [
                    kitsuResult({ canonicalTitle: 'Naruto Shippuden' }, { large: 'https://k/shippuden.jpg' }),
                    kitsuResult({ canonicalTitle: 'Naruto (2002)', titles: { en: null, en_jp: 'Naruto' } }, { large: null, original: 'https://k/naruto-original.jpg', medium: 'https://k/naruto-medium.jpg' })
                ]
            })
        ]);
        await expect(new KitsuCoverProvider(polite).find('Naruto', 'anime')).resolves.toBe('https://k/naruto-original.jpg');
    });

    it('knows a title by its abbreviated names, and takes the medium picture when it is the only one', async () => {
        const { client: polite } = client([json({ data: [kitsuResult({ canonicalTitle: 'Shingeki no Kyojin', abbreviatedTitles: ['AoT', 'SnK'] }, { medium: 'https://k/snk-medium.jpg' })] })]);
        await expect(new KitsuCoverProvider(polite).find('SnK', 'anime')).resolves.toBe('https://k/snk-medium.jpg');
    });

    it.each([
        ['no result named the title', json({ data: [kitsuResult({ canonicalTitle: 'Bleach' }, { large: 'https://k/b.jpg' })] })],
        ['a result with no picture', json({ data: [kitsuResult({ canonicalTitle: 'Naruto' }, null)] })],
        ['no results', json({ data: [] })],
        ['an answer with no list', json({ errors: [] })],
        ['an unknown address (404)', json({}, 404)],
        ['an answer that cannot be read', new Response('<html>', { status: 200 })]
    ])('gives none for %s', async (_case, answer) => {
        const { client: polite } = client([answer]);
        await expect(new KitsuCoverProvider(polite).find('Naruto', 'anime')).resolves.toBeNull();
    });
});

describe('MangaDexCoverProvider', () => {
    function mangaDexResult(id: string, title: Record<string, string>, altTitles: Array<Record<string, string>>, fileName: string | null) {
        return {
            id,
            type: 'manga',
            attributes: { title, altTitles },
            relationships: [{ id: 'author-1', type: 'author' }, ...(fileName === null ? [] : [{ id: 'cover-1', type: 'cover_art', attributes: { fileName } }])]
        };
    }

    it('searches MangaDex by the title with the cover of each result, and gives the address of the cover of the one named the title', async () => {
        const { client: polite, calls } = client([json({ data: [mangaDexResult('a1b2', { en: 'Chainsaw Man' }, [], 'cover.png')] })]);
        const provider = new MangaDexCoverProvider(polite);
        expect(provider.name).toBe('MangaDex');
        await expect(provider.find('Chainsaw Man', 'manga')).resolves.toBe(`${MANGADEX_UPLOADS_URL}/covers/a1b2/cover.png.512.jpg`);
        expect(calls).toEqual([{ url: `${MANGADEX_URL}/manga?title=Chainsaw+Man&limit=5&includes%5B%5D=cover_art`, init: { headers: { Accept: 'application/json' }, signal: expect.any(AbortSignal) } }]);
    });

    it('asks at the addresses it was given, and writes the parts of the address of the cover safely', async () => {
        const { client: polite, calls } = client([json({ data: [mangaDexResult('id 1', { ja: 'Other' }, [{ en: 'Dandadan' }], 'a b.jpg')] })]);
        await expect(new MangaDexCoverProvider(polite, 'http://127.0.0.1:9/mangadex', 'http://127.0.0.1:9/mangadex-uploads').find('Dandadan', 'manga')).resolves.toBe('http://127.0.0.1:9/mangadex-uploads/covers/id%201/a%20b.jpg.512.jpg');
        expect(calls[0]?.url).toBe('http://127.0.0.1:9/mangadex/manga?title=Dandadan&limit=5&includes%5B%5D=cover_art');
    });

    it('asks nothing for an anime: it only has mangas', async () => {
        const { client: polite, calls } = client([]);
        await expect(new MangaDexCoverProvider(polite).find('Naruto', 'anime')).resolves.toBeNull();
        expect(calls).toEqual([]);
    });

    it.each([
        ['no result named the title', json({ data: [mangaDexResult('x', { en: 'Bleach' }, [], 'b.jpg')] })],
        ['a result with no cover', json({ data: [mangaDexResult('x', { en: 'Naruto' }, [], null)] })],
        ['a result with no id', json({ data: [{ ...mangaDexResult('x', { en: 'Naruto' }, [], 'n.jpg'), id: null }] })],
        ['an unknown address (404)', json({}, 404)],
        ['an answer that cannot be read', new Response('<html>', { status: 200 })]
    ])('gives none for %s', async (_case, answer) => {
        const { client: polite } = client([answer]);
        await expect(new MangaDexCoverProvider(polite).find('Naruto', 'manga')).resolves.toBeNull();
    });
});
