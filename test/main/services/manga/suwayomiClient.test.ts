import type { MangaFilter, MangaPreferenceValue } from '@shared/manga';
import { filterChanges, QUERIES, REQUEST_TIMEOUT_MS, SOURCE_TIMEOUT_MS, SuwayomiApiError, SuwayomiClient } from '@main/services/manga/suwayomiClient';

const BASE = 'http://127.0.0.1:4321';

interface Call {
    url: string;
    init: RequestInit;
    body: { query: string; variables: Record<string, unknown> };
}

function setup(answers: Array<Response | Error>, baseUrl: () => Promise<string> = () => {
    return Promise.resolve(BASE);
}) {
    const calls: Call[] = [];
    const queue = [...answers];
    const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {}, body: JSON.parse(String(init?.body)) as Call['body'] });
        const next = queue.length > 1 ? queue.shift()! : queue[0]!;
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next.clone());
    }) as unknown as typeof fetch;
    return { client: new SuwayomiClient({ baseUrl, fetchImpl }), calls };
}

function data(payload: unknown): Response {
    return new Response(JSON.stringify({ data: payload }), { status: 200 });
}

const MANGA = { id: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: '/api/v1/manga/7/thumbnail' };

describe('SuwayomiClient requests', () => {
    it('posts the query and the variables to the GraphQL address of the server', async () => {
        const { client, calls } = setup([data({ extensionStores: { nodes: [] } })]);
        await client.stores();
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe(`${BASE}/api/graphql`);
        expect(calls[0]?.init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
        expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
        expect(calls[0]?.body).toEqual({ query: QUERIES.stores, variables: {} });
    });

    it('reports a server that cannot be reached for a request', async () => {
        const { client } = setup([new Error('ECONNREFUSED')]);
        await expect(client.stores()).rejects.toMatchObject({ code: 'REQUEST_FAILED', message: 'ECONNREFUSED' });
        await expect(client.stores()).rejects.toBeInstanceOf(SuwayomiApiError);
    });

    it('reports a server that cannot be started', async () => {
        const { client, calls } = setup([data({})], () => {
            return Promise.reject(new Error('The server did not become ready in time'));
        });
        await expect(client.stores()).rejects.toMatchObject({ code: 'SERVER_UNAVAILABLE', message: 'The server did not become ready in time' });
        expect(calls).toHaveLength(0);
    });

    it('reports an answer that is not a success', async () => {
        const { client } = setup([new Response('nope', { status: 500 })]);
        await expect(client.stores()).rejects.toMatchObject({ code: 'REQUEST_FAILED', message: 'The server answered 500' });
    });

    it('reports an answer that is not JSON', async () => {
        const { client } = setup([new Response('<html>', { status: 200 })]);
        await expect(client.stores()).rejects.toMatchObject({ code: 'INVALID_RESPONSE', message: 'The server did not answer with JSON' });
    });

    it('reports the error the server gives', async () => {
        const { client } = setup([new Response(JSON.stringify({ errors: [{ message: 'Source not found' }] }), { status: 200 })]);
        await expect(client.stores()).rejects.toMatchObject({ code: 'API_ERROR', message: 'Source not found' });
    });

    it('reports an error without a message and an answer without data', async () => {
        await expect(setup([new Response(JSON.stringify({ errors: [{}] }), { status: 200 })]).client.stores()).rejects.toMatchObject({
            code: 'API_ERROR',
            message: 'The server reported an error'
        });
        await expect(setup([new Response('{}', { status: 200 })]).client.stores()).rejects.toMatchObject({ code: 'INVALID_RESPONSE', message: 'The server answered without data' });
    });

    it('reports an answer in a shape it does not know', async () => {
        const { client } = setup([data({ extensionStores: { nodes: 'x' } })]);
        await expect(client.stores()).rejects.toMatchObject({ code: 'INVALID_RESPONSE', message: 'The stores must be a list' });
    });

    it('waits longer for the calls that go to a site', async () => {
        const timeouts: number[] = [];
        const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
            timeouts.push(milliseconds);
            return new AbortController().signal;
        });
        try {
            const { client } = setup([data({ extensionStores: { nodes: [] } }), data({ fetchSourceManga: { mangas: [], hasNextPage: false } })]);
            await client.stores();
            await client.list({ sourceId: '1', kind: 'popular', page: 1, query: '' });
        } finally {
            spy.mockRestore();
        }
        expect(timeouts).toEqual([REQUEST_TIMEOUT_MS, SOURCE_TIMEOUT_MS]);
    });
});

describe('SuwayomiClient settings of the server', () => {
    it('points the server at a FlareSolverr and turns the bypass on', async () => {
        const { client, calls } = setup([data({ setSettings: { settings: { flareSolverrEnabled: true, flareSolverrUrl: 'http://127.0.0.1:8191' } } })]);
        await expect(client.setFlareSolverr('http://127.0.0.1:8191')).resolves.toBeUndefined();
        expect(calls[0]?.body).toEqual({ query: QUERIES.setFlareSolverr, variables: { settings: { flareSolverrEnabled: true, flareSolverrUrl: 'http://127.0.0.1:8191', flareSolverrAsResponseFallback: true } } });
    });

    it('turns the bypass off when there is no FlareSolverr, without touching the address', async () => {
        const { client, calls } = setup([data({ setSettings: { settings: { flareSolverrEnabled: false } } })]);
        await client.setFlareSolverr(null);
        expect(calls[0]?.body.variables).toEqual({ settings: { flareSolverrEnabled: false } });
    });

    it('reports the error the server gives', async () => {
        const { client } = setup([new Response(JSON.stringify({ errors: [{ message: 'not allowed' }] }), { status: 200 })]);
        await expect(client.setFlareSolverr('http://127.0.0.1:8191')).rejects.toMatchObject({ code: 'API_ERROR', message: 'not allowed' });
    });
});

describe('SuwayomiClient version of the server', () => {
    it('asks who the server is and gives its version', async () => {
        const { client, calls } = setup([data({ aboutServer: { version: 'v2.4.2366' } })]);
        await expect(client.serverVersion()).resolves.toBe('v2.4.2366');
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe(`${BASE}/api/graphql`);
        expect(calls[0]?.body).toEqual({ query: QUERIES.about, variables: {} });
        expect(QUERIES.about).toBe('{ aboutServer { version } }');
    });

    it('gives nothing for a version that is empty or is not text', async () => {
        await expect(setup([data({ aboutServer: { version: '' } })]).client.serverVersion()).resolves.toBeNull();
        await expect(setup([data({ aboutServer: { version: 7 } })]).client.serverVersion()).resolves.toBeNull();
    });

    it('cuts a version that is far too long', async () => {
        await expect(setup([data({ aboutServer: { version: 'v'.repeat(100) } })]).client.serverVersion()).resolves.toBe('v'.repeat(40));
    });

    it('fails when the answer does not have the server in it, or the server gives an error', async () => {
        await expect(setup([data({})]).client.serverVersion()).rejects.toBeInstanceOf(SuwayomiApiError);
        await expect(setup([new Response(JSON.stringify({ errors: [{ message: 'nope' }] }), { status: 200 })]).client.serverVersion()).rejects.toMatchObject({ code: 'API_ERROR', message: 'nope' });
    });
});

describe('SuwayomiClient stores', () => {
    it('lists the stores', async () => {
        const { client } = setup([data({ extensionStores: { nodes: [{ name: 'Keiyoushi', indexUrl: 'https://a.example/i.json' }] } })]);
        await expect(client.stores()).resolves.toEqual([{ name: 'Keiyoushi', indexUrl: 'https://a.example/i.json' }]);
    });

    it('adds a store', async () => {
        const { client, calls } = setup([data({ addExtensionStore: { extensionStore: { name: 'K', indexUrl: 'https://a.example/i.json' } } })]);
        await expect(client.addStore('https://a.example/i.json')).resolves.toEqual({ name: 'K', indexUrl: 'https://a.example/i.json' });
        expect(calls[0]?.body).toEqual({ query: QUERIES.addStore, variables: { indexUrl: 'https://a.example/i.json' } });
    });

    it('removes a store', async () => {
        const { client, calls } = setup([data({ removeExtensionStore: { extensionStore: null } })]);
        await expect(client.removeStore('https://a.example/i.json')).resolves.toBeUndefined();
        expect(calls[0]?.body).toEqual({ query: QUERIES.removeStore, variables: { indexUrl: 'https://a.example/i.json' } });
    });
});

describe('SuwayomiClient extensions', () => {
    const raw = { pkgName: 'eu.kanade.x', name: 'X', lang: 'en', versionName: '1', isInstalled: false, hasUpdate: false, isObsolete: false, iconUrl: '/icon', contentWarning: 'SAFE', storeIndexUrl: null, extensionLib: '1.4' };
    const parsed = { pkgName: 'eu.kanade.x', name: 'X', lang: 'en', versionName: '1', isInstalled: false, hasUpdate: false, isObsolete: false, iconUrl: `${BASE}/icon`, contentWarning: 'SAFE', storeIndexUrl: null, extensionLib: '1.4', isCompatible: true };

    it('refreshes the lists of the stores and gives what they offer', async () => {
        const { client, calls } = setup([data({ fetchExtensions: { extensions: [raw] } })]);
        await expect(client.refreshExtensions()).resolves.toEqual([parsed]);
        expect(calls[0]?.body.query).toBe(QUERIES.refreshExtensions);
    });

    it('lists the extensions without a limit', async () => {
        const { client, calls } = setup([data({ extensions: { nodes: [raw] } })]);
        await expect(client.extensions()).resolves.toEqual([parsed]);
        expect(calls[0]?.body.query).toBe(QUERIES.extensions);
        expect(QUERIES.extensions).not.toContain('first');
    });

    it.each(['install', 'uninstall', 'update'] as const)('asks the server to %s an extension', async (action) => {
        const { client, calls } = setup([data({ updateExtension: { extension: raw } })]);
        await expect(client.changeExtension('eu.kanade.x', action)).resolves.toBeUndefined();
        expect(calls[0]?.body).toEqual({ query: QUERIES.updateExtension, variables: { id: 'eu.kanade.x', patch: { [action]: true } } });
    });

    it('asks for the version of the library of each extension', () => {
        expect(QUERIES.extensions).toContain('extensionLib');
        expect(QUERIES.refreshExtensions).toContain('extensionLib');
    });

    it('updates the extensions given in one request', async () => {
        const { client, calls } = setup([data({ updateExtensions: { extensions: [raw] } })]);
        await expect(client.updateExtensions(['eu.kanade.x', 'eu.kanade.y'])).resolves.toBeUndefined();
        expect(calls[0]?.body).toEqual({ query: QUERIES.updateExtensions, variables: { ids: ['eu.kanade.x', 'eu.kanade.y'] } });
        expect(QUERIES.updateExtensions).toContain('patch: { update: true }');
    });

    it('lists the sources', async () => {
        const { client } = setup([
            data({ sources: { nodes: [{ id: '1', name: 'S', displayName: 'S (EN)', lang: 'en', iconUrl: '/i', supportsLatest: true, isConfigurable: true, contentWarning: 'SAFE', extension: { pkgName: 'eu.kanade.x', storeIndexUrl: 'https://a.example/i.json' } }] } })
        ]);
        await expect(client.sources()).resolves.toEqual([
            { id: '1', name: 'S (EN)', lang: 'en', iconUrl: `${BASE}/i`, supportsLatest: true, isConfigurable: true, contentWarning: 'SAFE', extensionPkg: 'eu.kanade.x', storeIndexUrl: 'https://a.example/i.json' }
        ]);
        expect(QUERIES.sources).toContain('isConfigurable');
        expect(QUERIES.sources).toContain('extension { pkgName storeIndexUrl }');
    });

    describe('settings of a source', () => {
        const raw = [
            { __typename: 'EditTextPreference', key: 'Server URL Address', title: 'Server URL Address', summary: '', visible: true, enabled: true, editValue: '' },
            { __typename: 'SwitchPreference', key: 'hq', title: 'High quality', summary: '', visible: true, enabled: true, switchValue: false }
        ];
        const parsed = [
            { position: 0, type: 'text', key: 'Server URL Address', title: 'Server URL Address', summary: '', enabled: true, value: '' },
            { position: 1, type: 'switch', key: 'hq', title: 'High quality', summary: '', enabled: true, value: false }
        ];

        it('reads them', async () => {
            const { client, calls } = setup([data({ source: { preferences: raw } })]);
            await expect(client.sourcePreferences('123')).resolves.toEqual(parsed);
            expect(calls[0]?.body).toEqual({ query: QUERIES.sourcePreferences, variables: { id: '123' } });
        });

        it('asks for each kind of setting under a name of its own, so the kinds do not clash', () => {
            ['editValue: currentValue', 'listValue: currentValue', 'switchValue: currentValue', 'checkValue: currentValue', 'multiValue: currentValue'].forEach((field) => {
                expect(QUERIES.sourcePreferences).toContain(field);
            });
        });

        it.each([
            ['text', 'http://x:4567', 'editTextState'],
            ['list', 'BASIC', 'listState'],
            ['switch', true, 'switchState'],
            ['checkbox', false, 'checkBoxState'],
            ['multiselect', ['en', 'pt'], 'multiSelectState']
        ] as const)('changes a %s setting in the field of its kind and gives the settings as they are now', async (type, value, field) => {
            const { client, calls } = setup([data({ updateSourcePreference: { preferences: raw } })]);
            await expect(client.setSourcePreference({ sourceId: '123', position: 3, type, value: value as MangaPreferenceValue })).resolves.toEqual(parsed);
            expect(calls[0]?.body).toEqual({ query: QUERIES.setSourcePreference, variables: { source: '123', change: { position: 3, [field]: value } } });
        });

        it('reports an answer in a shape it does not know', async () => {
            const { client } = setup([data({ source: { preferences: 'x' } })]);
            await expect(client.sourcePreferences('123')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', message: 'The settings must be a list' });
        });

        it('reports the error the server gives', async () => {
            const { client } = setup([new Response(JSON.stringify({ errors: [{ message: 'Source not found' }] }), { status: 200 })]);
            await expect(client.setSourcePreference({ sourceId: '9', position: 0, type: 'text', value: 'x' })).rejects.toMatchObject({ code: 'API_ERROR', message: 'Source not found' });
        });
    });
});

describe('SuwayomiClient mangas', () => {
    it.each([
        ['popular', 'POPULAR', null],
        ['latest', 'LATEST', null],
        ['search', 'SEARCH', 'naruto']
    ] as const)('lists the %s mangas of a source', async (kind, type, query) => {
        const { client, calls } = setup([data({ fetchSourceManga: { hasNextPage: true, mangas: [MANGA] } })]);
        await expect(client.list({ sourceId: '123', kind, page: 2, query: 'naruto' })).resolves.toEqual({
            items: [{ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: `${BASE}/api/v1/manga/7/thumbnail` }],
            hasNextPage: true
        });
        expect(calls[0]?.body).toEqual({ query: QUERIES.list, variables: { source: '123', type, page: 2, query, filters: null } });
    });

    const FILTERS: MangaFilter[] = [
        { type: 'header', name: 'Note' },
        { type: 'text', name: 'Author', value: 'Oda' },
        { type: 'checkbox', name: 'Chapters', value: true },
        { type: 'tristate', name: 'Action', value: 'exclude' },
        { type: 'select', name: 'Within', options: ['a', 'b'], value: 1 },
        { type: 'sort', name: 'Sort', options: ['Name', 'Date'], value: { index: 1, ascending: true } },
        { type: 'separator', name: '' },
        { type: 'group', name: 'Genre', filters: [{ type: 'tristate', name: 'Drama', value: 'include' }, { type: 'checkbox', name: 'Ecchi', value: false }] }
    ];

    it('turns the filters into the changes the server takes, each named by its place, a group carrying its own', () => {
        expect(filterChanges(FILTERS)).toEqual([
            { position: 1, textState: 'Oda' },
            { position: 2, checkBoxState: true },
            { position: 3, triState: 'EXCLUDE' },
            { position: 4, selectState: 1 },
            { position: 5, sortState: { index: 1, ascending: true } },
            { position: 7, groupChange: { position: 0, triState: 'INCLUDE' } },
            { position: 7, groupChange: { position: 1, checkBoxState: false } }
        ]);
    });

    it('sends the filters of a search with it, and only of a search', async () => {
        const { client, calls } = setup([data({ fetchSourceManga: { hasNextPage: false, mangas: [] } })]);
        await client.list({ sourceId: '123', kind: 'search', page: 1, query: '', filters: FILTERS });
        expect(calls[0]?.body.variables).toEqual({ source: '123', type: 'SEARCH', page: 1, query: '', filters: filterChanges(FILTERS) });
        await client.list({ sourceId: '123', kind: 'popular', page: 1, query: '', filters: FILTERS });
        expect(calls[1]?.body.variables).toEqual({ source: '123', type: 'POPULAR', page: 1, query: null, filters: null });
        await client.list({ sourceId: '123', kind: 'search', page: 1, query: 'x', filters: [] });
        expect(calls[2]?.body.variables).toEqual({ source: '123', type: 'SEARCH', page: 1, query: 'x', filters: null });
    });

    it('reads the filters of a source', async () => {
        const { client, calls } = setup([data({ source: { filters: [{ __typename: 'CheckBoxFilter', name: 'Has chapters', checkValue: true }] } })]);
        await expect(client.sourceFilters('123')).resolves.toEqual([{ type: 'checkbox', name: 'Has chapters', value: true }]);
        expect(calls[0]?.body).toEqual({ query: QUERIES.sourceFilters, variables: { id: '123' } });
        ['textValue: default', 'checkValue: default', 'triValue: default', 'selectValue: default', 'sortOptions: values', 'sortValue: default', 'GroupFilter'].forEach((field) => {
            expect(QUERIES.sourceFilters).toContain(field);
        });
    });

    it('reports filters in a shape it does not know', async () => {
        const { client } = setup([data({ source: { filters: 'x' } })]);
        await expect(client.sourceFilters('123')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', message: 'The filters must be a list' });
    });

    it('gives the details and the chapters of a manga', async () => {
        const { client, calls } = setup([
            data({
                fetchMangaAndChapters: {
                    manga: { ...MANGA, realUrl: 'https://dex.example/one-piece', author: 'Oda', artist: null, description: 'Pirates', genre: ['Action'], status: 'ONGOING' },
                    chapters: [{ id: 11, name: 'Romance Dawn', chapterNumber: 1, uploadDate: '1700000000000', scanlator: null, sourceOrder: 1100 }]
                }
            })
        ]);
        expect(QUERIES.mangaWithChapters).toContain('realUrl');
        await expect(client.mangaWithChapters(7)).resolves.toEqual({
            details: {
                remoteId: 7,
                sourceId: '123',
                title: 'One Piece',
                thumbnailUrl: `${BASE}/api/v1/manga/7/thumbnail`,
                url: 'https://dex.example/one-piece',
                author: 'Oda',
                artist: null,
                description: 'Pirates',
                genres: ['Action'],
                status: 'ongoing'
            },
            chapters: [{ remoteId: 11, name: 'Romance Dawn', number: 1, dateUploaded: 1700000000000, scanlator: null, sourceOrder: 1100 }]
        });
        expect(calls[0]?.body).toEqual({ query: QUERIES.mangaWithChapters, variables: { id: 7 } });
    });

    it('gives the addresses of the pages of a chapter', async () => {
        const { client, calls } = setup([data({ fetchChapterPages: { pages: ['/api/v1/manga/7/chapter/1/page/0', '/api/v1/manga/7/chapter/1/page/1'] } })]);
        await expect(client.chapterPages(11)).resolves.toEqual([`${BASE}/api/v1/manga/7/chapter/1/page/0`, `${BASE}/api/v1/manga/7/chapter/1/page/1`]);
        expect(calls[0]?.body).toEqual({ query: QUERIES.chapterPages, variables: { chapterId: 11 } });
    });
});
