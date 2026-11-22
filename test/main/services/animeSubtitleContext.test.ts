import {
    AnimeSubtitleContextService,
    cleanSynopsis,
    CONTEXT_BY_ID_QUERY,
    CONTEXT_BY_SEARCH_QUERY,
    formatSeriesContext,
    MAX_CHARACTERS,
    MAX_SYNOPSIS_LENGTH,
    parseMediaContext,
    type AnimeSubtitleContext
} from '@main/services/animeSubtitleContext';

const DEATH_PARADE_MEDIA = {
    title: { romaji: 'Death Parade', english: 'Death Parade', native: 'デス・パレード' },
    synonyms: ['Death Billiards'],
    description: 'After death, there is no heaven or hell, only a bar called <i>Quindecim</i>~!hidden spoiler!~ where bartender Decim judges souls. (Source: MAL Rewrite)',
    characters: {
        nodes: [
            { name: { full: 'Decim', native: 'デキム' } },
            { name: { full: 'Chiyuki', native: '知幸' } },
            { name: { full: 'Nona', native: 'ノーナ' } },
            { name: { full: 'Decim', native: 'デキム' } },
            { name: { full: '  ', native: '空白' } }
        ]
    }
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
}

describe('cleanSynopsis', () => {
    it('strips spoiler tags, HTML tags, Markdown formatting, entities, and trailing Source notes', () => {
        expect(
            cleanSynopsis('A <b>bar</b> called &quot;[Quindecim](https://example.com)&quot;~!secret twist!~&mdash;run by **Decim**&#39;s __calm__ _staff_ and Decim&#039;s rules. (Source: AniList)')
        ).toBe('A bar called "Quindecim" —run by Decim\'s calm staff and Decim\'s rules.');
    });

    it('truncates long descriptions at a sentence boundary when possible, and otherwise at a word boundary or hard cut with ellipsis', () => {
        const sentenceText = `${'A'.repeat(160)}. ${'B'.repeat(260)}.`;
        expect(cleanSynopsis(sentenceText)).toBe(`${'A'.repeat(160)}.`);

        const boundarySentence = `${'A'.repeat(MAX_SYNOPSIS_LENGTH - 1)}. Next sentence.`;
        expect(cleanSynopsis(boundarySentence)).toBe(`${'A'.repeat(MAX_SYNOPSIS_LENGTH - 1)}.`);

        const noSentence = Array.from({ length: 80 }, () => {
            return 'word';
        }).join(' ');
        const cut = cleanSynopsis(noSentence);
        expect(cut).not.toBeNull();
        expect((cut as string).length).toBeLessThanOrEqual(MAX_SYNOPSIS_LENGTH + 3);
        expect((cut as string).endsWith('...')).toBe(true);

        const noSpaces = 'x'.repeat(MAX_SYNOPSIS_LENGTH + 40);
        expect(cleanSynopsis(noSpaces)).toBe(`${'x'.repeat(MAX_SYNOPSIS_LENGTH)}...`);
    });

    it.each([null, undefined, 42, '', '   ', '~!only spoiler!~'])('returns null for %p', (raw) => {
        expect(cleanSynopsis(raw)).toBeNull();
    });
});

describe('parseMediaContext', () => {
    it('extracts title, native title, cleaned synopsis, and deduplicated characters', () => {
        expect(parseMediaContext(DEATH_PARADE_MEDIA)).toEqual({
            title: 'Death Parade',
            nativeTitle: 'デス・パレード',
            synopsis: 'After death, there is no heaven or hell, only a bar called Quindecim where bartender Decim judges souls.',
            characters: [
                { full: 'Decim', native: 'デキム' },
                { full: 'Chiyuki', native: '知幸' },
                { full: 'Nona', native: 'ノーナ' }
            ]
        });
    });

    it('caps characters at MAX_CHARACTERS and falls back from english to romaji to native title', () => {
        const nodes = Array.from({ length: MAX_CHARACTERS + 5 }, (_unused, index) => {
            return { name: { full: `Char ${index}`, native: null } };
        });
        const parsed = parseMediaContext({ title: { romaji: 'Sousou no Frieren' }, description: null, characters: { nodes } });
        expect(parsed?.title).toBe('Sousou no Frieren');
        expect(parsed?.nativeTitle).toBeNull();
        expect(parsed?.characters).toHaveLength(MAX_CHARACTERS);
        expect(parseMediaContext({ title: { native: '葬送のフリーレン' } })).toEqual({
            title: '葬送のフリーレン',
            nativeTitle: null,
            synopsis: null,
            characters: []
        });
    });

    it('returns null for non-records or media without any title', () => {
        expect(parseMediaContext(null)).toBeNull();
        expect(parseMediaContext([])).toBeNull();
        expect(parseMediaContext({ title: {} })).toBeNull();
    });
});

describe('formatSeriesContext', () => {
    it('formats series title with native title, premise, and characters with native readings', () => {
        const context: AnimeSubtitleContext = {
            title: 'Death Parade',
            nativeTitle: 'デス・パレード',
            synopsis: 'Souls are judged at Quindecim.',
            characters: [
                { full: 'Decim', native: 'デキム' },
                { full: 'Chiyuki', native: null },
                { full: 'Ginti', native: 'Ginti' }
            ]
        };
        expect(formatSeriesContext(context)).toBe('Series: Death Parade (デス・パレード)\nPremise: Souls are judged at Quindecim.\nCharacters: Decim (デキム), Chiyuki, Ginti');
    });

    it('omits premise and characters when absent', () => {
        expect(formatSeriesContext({ title: 'Naruto', nativeTitle: null, synopsis: null, characters: [] })).toBe('Series: Naruto');
    });
});

describe('AnimeSubtitleContextService', () => {
    it('fetches by anilistId when available and caches the result for subsequent calls', async () => {
        const fetchFn = vi.fn<typeof fetch>(async () => {
            return jsonResponse({ data: { Media: DEATH_PARADE_MEDIA } });
        });
        const service = new AnimeSubtitleContextService({ url: 'http://anilist.test/graphql', fetchFn });
        const first = await service.resolve({ title: 'Death Parade', anilistId: 20931 });
        const second = await service.resolve({ title: 'Death Parade', anilistId: 20931 });
        expect(first).toEqual(parseMediaContext(DEATH_PARADE_MEDIA));
        expect(second).toEqual(first);
        expect(fetchFn).toHaveBeenCalledTimes(1);
        const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://anilist.test/graphql');
        expect(JSON.parse(init.body as string)).toEqual({ query: CONTEXT_BY_ID_QUERY, variables: { id: 20931 } });
    });

    it('searches by title when anilistId is null and requires an exact normalized title match', async () => {
        const fetchFn = vi.fn<typeof fetch>(async () => {
            return jsonResponse({
                data: {
                    Page: {
                        media: [
                            { title: { romaji: 'Death Note', english: 'Death Note' }, synonyms: [] },
                            DEATH_PARADE_MEDIA
                        ]
                    }
                }
            });
        });
        const service = new AnimeSubtitleContextService({ url: 'http://anilist.test/graphql', fetchFn });
        const unmatched = await service.resolve({ title: 'Death Parade Season 2', anilistId: null });
        expect(unmatched).toBeNull();
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(JSON.parse((fetchFn.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
            query: CONTEXT_BY_SEARCH_QUERY,
            variables: { search: 'Death Parade Season 2' }
        });

        const matched = await service.resolve({ title: 'Death Parade (TV)', anilistId: null });
        expect(matched).toEqual(parseMediaContext(DEATH_PARADE_MEDIA));
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(JSON.parse((fetchFn.mock.calls[1]?.[1] as RequestInit).body as string)).toEqual({
            query: CONTEXT_BY_SEARCH_QUERY,
            variables: { search: 'Death Parade' }
        });
    });

    it('caches clean null matches without refetching, but retries after network or HTTP failures', async () => {
        let calls = 0;
        const fetchFn = vi.fn<typeof fetch>(async () => {
            calls += 1;
            if (calls === 1) {
                throw new Error('offline');
            }
            if (calls === 2) {
                return new Response('rate limit', { status: 429 });
            }
            return jsonResponse({ data: { Media: null } });
        });
        const service = new AnimeSubtitleContextService({ url: 'http://anilist.test/graphql', fetchFn });
        expect(await service.resolve({ title: 'Unknown', anilistId: 99 })).toBeNull();
        expect(await service.resolve({ title: 'Unknown', anilistId: 99 })).toBeNull();
        expect(await service.resolve({ title: 'Unknown', anilistId: 99 })).toBeNull();
        expect(await service.resolve({ title: 'Unknown', anilistId: 99 })).toBeNull();
        expect(fetchFn).toHaveBeenCalledTimes(3);
    });

    it('returns null without fetching when title is empty/null without id or when signal is already aborted', async () => {
        const fetchFn = vi.fn<typeof fetch>();
        const service = new AnimeSubtitleContextService({ fetchFn });
        expect(await service.resolve({ title: null, anilistId: null })).toBeNull();
        expect(await service.resolve({ title: '   ', anilistId: null })).toBeNull();
        const controller = new AbortController();
        controller.abort();
        expect(await service.resolve({ title: 'Death Parade', anilistId: 20931 }, controller.signal)).toBeNull();
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('deduplicates concurrent lookups for the same anime', async () => {
        const fetchFn = vi.fn<typeof fetch>(async () => {
            return jsonResponse({ data: { Media: DEATH_PARADE_MEDIA } });
        });
        const service = new AnimeSubtitleContextService({ url: 'http://anilist.test/graphql', fetchFn });
        const [first, second] = await Promise.all([
            service.resolve({ title: 'Death Parade', anilistId: 20931 }),
            service.resolve({ title: 'Death Parade', anilistId: 20931 })
        ]);
        expect(first).toEqual(second);
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('retries after GraphQL errors returned on HTTP 200 without caching null', async () => {
        let calls = 0;
        const fetchFn = vi.fn<typeof fetch>(async () => {
            calls += 1;
            if (calls === 1) {
                return jsonResponse({ data: { Media: null }, errors: [{ message: 'Too Many Requests.' }] }, 200);
            }
            return jsonResponse({ data: { Media: DEATH_PARADE_MEDIA } }, 200);
        });
        const service = new AnimeSubtitleContextService({ url: 'http://anilist.test/graphql', fetchFn });
        expect(await service.resolve({ title: 'Death Parade', anilistId: 20931 })).toBeNull();
        expect(await service.resolve({ title: 'Death Parade', anilistId: 20931 })).toEqual(parseMediaContext(DEATH_PARADE_MEDIA));
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('aborts the underlying fetch when the sole caller aborts mid-flight and does not cache the cancellation', async () => {
        let observedSignal: AbortSignal | undefined;
        let calls = 0;
        const fetchFn = vi.fn<typeof fetch>((_url, init) => {
            calls += 1;
            if (calls === 1) {
                observedSignal = init?.signal ?? undefined;
                return new Promise<Response>((_resolve, reject) => {
                    observedSignal?.addEventListener('abort', () => {
                        reject(new DOMException('Aborted', 'AbortError'));
                    });
                });
            }
            return Promise.resolve(jsonResponse({ data: { Media: DEATH_PARADE_MEDIA } }));
        });
        const service = new AnimeSubtitleContextService({ url: 'http://anilist.test/graphql', fetchFn });
        const controller = new AbortController();
        const pending = service.resolve({ title: 'Death Parade', anilistId: 20931 }, controller.signal);
        controller.abort();
        expect(await pending).toBeNull();
        expect(observedSignal?.aborted).toBe(true);
        expect(await service.resolve({ title: 'Death Parade', anilistId: 20931 })).toEqual(parseMediaContext(DEATH_PARADE_MEDIA));
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('keeps a shared lookup alive when only one concurrent caller aborts, and aborts it once every waiter aborts', async () => {
        let releaseFirst: (response: Response) => void = () => {
            return undefined;
        };
        let firstSignal: AbortSignal | undefined;
        let secondSignal: AbortSignal | undefined;
        let calls = 0;
        const fetchFn = vi.fn<typeof fetch>((_url, init) => {
            calls += 1;
            if (calls === 1) {
                firstSignal = init?.signal ?? undefined;
                return new Promise<Response>((resolve) => {
                    releaseFirst = resolve;
                });
            }
            secondSignal = init?.signal ?? undefined;
            return new Promise<Response>((_resolve, reject) => {
                secondSignal?.addEventListener('abort', () => {
                    reject(new DOMException('Aborted', 'AbortError'));
                });
            });
        });
        const service = new AnimeSubtitleContextService({ url: 'http://anilist.test/graphql', fetchFn });

        const callerA = new AbortController();
        const callerB = new AbortController();
        const promiseA = service.resolve({ title: 'Death Parade', anilistId: 20931 }, callerA.signal);
        const promiseB = service.resolve({ title: 'Death Parade', anilistId: 20931 }, callerB.signal);
        callerA.abort();
        expect(await promiseA).toBeNull();
        expect(firstSignal?.aborted).toBe(false);
        releaseFirst(jsonResponse({ data: { Media: DEATH_PARADE_MEDIA } }));
        expect(await promiseB).toEqual(parseMediaContext(DEATH_PARADE_MEDIA));
        expect(fetchFn).toHaveBeenCalledTimes(1);

        const callerC = new AbortController();
        const callerD = new AbortController();
        const promiseC = service.resolve({ title: 'Bleach', anilistId: 269 }, callerC.signal);
        const promiseD = service.resolve({ title: 'Bleach', anilistId: 269 }, callerD.signal);
        callerD.abort();
        expect(await promiseD).toBeNull();
        expect(secondSignal?.aborted).toBe(false);
        callerC.abort();
        expect(await promiseC).toBeNull();
        expect(secondSignal?.aborted).toBe(true);
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('returns null without caching when the request exceeds timeoutMs', async () => {
        let calls = 0;
        const fetchFn = vi.fn<typeof fetch>((_url, init) => {
            calls += 1;
            if (calls === 1) {
                return new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        reject(new DOMException('Timed out', 'TimeoutError'));
                    });
                });
            }
            return Promise.resolve(jsonResponse({ data: { Media: DEATH_PARADE_MEDIA } }));
        });
        const service = new AnimeSubtitleContextService({ url: 'http://anilist.test/graphql', fetchFn, timeoutMs: 25 });
        expect(await service.resolve({ title: 'Death Parade', anilistId: 20931 })).toBeNull();
        expect(await service.resolve({ title: 'Death Parade', anilistId: 20931 })).toEqual(parseMediaContext(DEATH_PARADE_MEDIA));
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it.each([0, -1, 1.5])('falls back to title search when anilistId is invalid (%p)', async (invalidId) => {
        const fetchFn = vi.fn<typeof fetch>(async () => {
            return jsonResponse({ data: { Page: { media: [DEATH_PARADE_MEDIA] } } });
        });
        const service = new AnimeSubtitleContextService({ url: 'http://anilist.test/graphql', fetchFn });
        expect(await service.resolve({ title: 'Death Parade', anilistId: invalidId })).toEqual(parseMediaContext(DEATH_PARADE_MEDIA));
        expect(JSON.parse((fetchFn.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
            query: CONTEXT_BY_SEARCH_QUERY,
            variables: { search: 'Death Parade' }
        });
    });

    it.each([
        ['synonym', 'Death Billiards'],
        ['romaji', 'Sousou no Frieren'],
        ['native', '葬送のフリーレン']
    ])('matches search candidates by %s title', async (_kind, queryTitle) => {
        const frieren = {
            title: { romaji: 'Sousou no Frieren', english: 'Frieren: Beyond Journey\'s End', native: '葬送のフリーレン' },
            synonyms: [],
            description: 'An elf mage reflects on mortality.',
            characters: { nodes: [] }
        };
        const fetchFn = vi.fn<typeof fetch>(async () => {
            return jsonResponse({ data: { Page: { media: [DEATH_PARADE_MEDIA, frieren] } } });
        });
        const service = new AnimeSubtitleContextService({ url: 'http://anilist.test/graphql', fetchFn });
        const expected = queryTitle === 'Death Billiards' ? parseMediaContext(DEATH_PARADE_MEDIA) : parseMediaContext(frieren);
        expect(await service.resolve({ title: queryTitle, anilistId: null })).toEqual(expected);
    });
});
