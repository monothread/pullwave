import { CoverChain, FALLBACK_INTERVAL_MS, FALLBACK_TIMEOUT_MS, fallbackProviders, searchVariants } from '@main/services/covers/coverChain';
import { AniListCoverProvider, KitsuCoverProvider, MangaDexCoverProvider, type CoverKind, type CoverProvider } from '@main/services/covers/coverProviders';
import { CoverFetchError } from '@main/services/covers/politeClient';

// A service that answers each name with what it is given for it (null for the names it does not know), or fails.
function provider(name: string, answers: Record<string, string | Error>) {
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

describe('the constants', () => {
    it('asks the fallbacks a second apart, and gives each request six seconds', () => {
        expect(FALLBACK_INTERVAL_MS).toBe(1000);
        expect(FALLBACK_TIMEOUT_MS).toBe(6000);
    });
});

describe('searchVariants', () => {
    it('tries the name as it is, then without the qualifier of the source, then with the D of a number taken out', () => {
        expect(searchVariants('2.5D Seduction (Mini Anime)')).toEqual(['2.5D Seduction (Mini Anime)', '2.5D Seduction', '2.5 Seduction']);
    });

    it('does not repeat a name, and trims it', () => {
        expect(searchVariants('  Naruto  ')).toEqual(['Naruto']);
        expect(searchVariants('Naruto [Remastered]')).toEqual(['Naruto [Remastered]', 'Naruto']);
    });

    it('does not turn a D that is part of a word into a number', () => {
        expect(searchVariants('3Dancers')).toEqual(['3Dancers']);
    });

    it('is empty for an empty name', () => {
        expect(searchVariants('   ')).toEqual([]);
    });
});

describe('CoverChain', () => {
    it('gives the cover of the first service, without asking the others', async () => {
        const first = provider('A', { Naruto: 'https://a/naruto.jpg' });
        const second = provider('B', { Naruto: 'https://b/naruto.jpg' });
        await expect(new CoverChain('anime', [first.service, second.service]).find('Naruto')).resolves.toBe('https://a/naruto.jpg');
        expect(first.asked).toEqual([['Naruto', 'anime']]);
        expect(second.asked).toEqual([]);
    });

    it('tries the simpler names with a service before going to the next one', async () => {
        const first = provider('A', { 'Naruto': 'https://a/naruto.jpg' });
        const second = provider('B', {});
        await expect(new CoverChain('manga', [second.service, first.service]).find('Naruto (Colored)')).resolves.toBe('https://a/naruto.jpg');
        expect(second.asked).toEqual([['Naruto (Colored)', 'manga'], ['Naruto', 'manga']]);
        expect(first.asked).toEqual([['Naruto (Colored)', 'manga'], ['Naruto', 'manga']]);
    });

    it('gives null when no service has a cover', async () => {
        const first = provider('A', {});
        const second = provider('B', {});
        await expect(new CoverChain('anime', [first.service, second.service]).find('Unknown')).resolves.toBeNull();
        expect(first.asked).toEqual([['Unknown', 'anime']]);
        expect(second.asked).toEqual([['Unknown', 'anime']]);
    });

    it('gives null with no service', async () => {
        await expect(new CoverChain('anime', []).find('Naruto')).resolves.toBeNull();
    });

    it('passes over a service that cannot be asked, without trying its other names, and gives the cover of the next one', async () => {
        const failing = provider('A', { 'Naruto (TV)': new CoverFetchError('A could not be reached: offline') });
        const next = provider('B', { 'Naruto (TV)': 'https://b/naruto.jpg' });
        await expect(new CoverChain('anime', [failing.service, next.service]).find('Naruto (TV)')).resolves.toBe('https://b/naruto.jpg');
        expect(failing.asked).toEqual([['Naruto (TV)', 'anime']]);
    });

    it('fails with the first failure when no service had a cover and any could not be asked', async () => {
        const first = provider('A', {});
        const second = provider('B', { Naruto: new CoverFetchError('B answered with status 500.') });
        const third = provider('C', { Naruto: new CoverFetchError('C answered with status 503.') });
        await expect(new CoverChain('anime', [first.service, second.service, third.service]).find('Naruto')).rejects.toEqual(new CoverFetchError('B answered with status 500.'));
        expect(third.asked).toEqual([['Naruto', 'anime']]);
    });

    it('turns what else a service throws into a failure to ask it, with its text', async () => {
        const broken = provider('A', { Naruto: new Error('unexpected') });
        const failure = await new CoverChain('anime', [broken.service]).find('Naruto').catch((error: unknown) => {
            return error;
        });
        expect(failure).toBeInstanceOf(CoverFetchError);
        expect(failure).toEqual(new CoverFetchError('unexpected'));
        const thrown: CoverProvider = {
            name: 'B',
            find: async () => {
                throw 'refused';
            }
        };
        await expect(new CoverChain('anime', [thrown]).find('Naruto')).rejects.toEqual(new CoverFetchError('refused'));
    });
});

describe('fallbackProviders', () => {
    function json(body: unknown): Response {
        return new Response(JSON.stringify(body), { status: 200 });
    }

    it('asks Kitsu for an anime', () => {
        const providers = fallbackProviders('anime');
        expect(providers.map((item) => {
            return item.name;
        })).toEqual(['Kitsu']);
        expect(providers[0]).toBeInstanceOf(KitsuCoverProvider);
    });

    it('asks AniList, MangaDex and then Kitsu for a manga', () => {
        const providers = fallbackProviders('manga');
        expect(providers.map((item) => {
            return item.name;
        })).toEqual(['AniList', 'MangaDex', 'Kitsu']);
        expect(providers[0]).toBeInstanceOf(AniListCoverProvider);
        expect(providers[1]).toBeInstanceOf(MangaDexCoverProvider);
        expect(providers[2]).toBeInstanceOf(KitsuCoverProvider);
    });

    it('gives each request six seconds by default, and the time it is given otherwise', async () => {
        const timeout = vi.spyOn(AbortSignal, 'timeout');
        const fetchFn = vi.fn(async (): Promise<Response> => {
            return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }) as unknown as typeof fetch;
        await fallbackProviders('anime', { fetchFn, sleep: async () => {} })[0]!.find('Naruto', 'anime');
        expect(timeout).toHaveBeenLastCalledWith(FALLBACK_TIMEOUT_MS);
        await fallbackProviders('anime', { fetchFn, sleep: async () => {}, timeoutMs: 1500 })[0]!.find('Naruto', 'anime');
        expect(timeout).toHaveBeenLastCalledWith(1500);
        timeout.mockRestore();
    });

    it('asks the real services when no address stands in for them', async () => {
        const fetchFn = vi.fn(async (): Promise<Response> => {
            return json({ data: [] });
        }) as unknown as typeof fetch;
        const providers = fallbackProviders('manga', { fetchFn, sleep: async () => {} });
        for (const item of providers) {
            await item.find('One Piece', 'manga');
        }
        expect(vi.mocked(fetchFn).mock.calls.map((call) => {
            return String(call[0]).split('?')[0];
        })).toEqual(['https://graphql.anilist.co', 'https://api.mangadex.org/manga', 'https://kitsu.io/api/edge/manga']);
    });

    it('asks every service under the address that stands in for them, with no slash too many', async () => {
        const fetchFn = vi.fn(async (): Promise<Response> => {
            return json({ data: [] });
        }) as unknown as typeof fetch;
        const providers = fallbackProviders('manga', { baseUrl: 'http://127.0.0.1:9/', fetchFn, sleep: async () => {} });
        for (const item of providers) {
            await item.find('One Piece', 'manga');
        }
        expect(vi.mocked(fetchFn).mock.calls.map((call) => {
            return String(call[0]).split('?')[0];
        })).toEqual(['http://127.0.0.1:9/anilist', 'http://127.0.0.1:9/mangadex/manga', 'http://127.0.0.1:9/kitsu/manga']);
    });

    it('gives the covers of MangaDex under the address that stands in for its pictures', async () => {
        const fetchFn = vi.fn(async (): Promise<Response> => {
            return json({ data: [{ id: 'op', attributes: { title: { en: 'One Piece' } }, relationships: [{ type: 'cover_art', attributes: { fileName: 'c.jpg' } }] }] });
        }) as unknown as typeof fetch;
        const mangaDex = fallbackProviders('manga', { baseUrl: 'http://127.0.0.1:9', fetchFn, sleep: async () => {} })[1]!;
        await expect(mangaDex.find('One Piece', 'manga')).resolves.toBe('http://127.0.0.1:9/mangadex-uploads/covers/op/c.jpg.512.jpg');
    });

    it('waits a second between the requests to each service by default, and the interval it is given otherwise', async () => {
        const fetchFn = vi.fn(async (): Promise<Response> => {
            return json({ data: [] });
        }) as unknown as typeof fetch;
        const waits: number[] = [];
        const sleep = async (milliseconds: number): Promise<void> => {
            waits.push(milliseconds);
        };
        const [kitsu] = fallbackProviders('anime', { fetchFn, sleep });
        await kitsu!.find('Naruto', 'anime');
        const [quickKitsu] = fallbackProviders('anime', { fetchFn, sleep, intervalMs: 250 });
        await quickKitsu!.find('Naruto', 'anime');
        expect(waits).toEqual([FALLBACK_INTERVAL_MS, 250]);
    });
});
