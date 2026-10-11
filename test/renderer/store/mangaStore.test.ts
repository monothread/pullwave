// @vitest-environment jsdom
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { MangaError, MangaFilter } from '@shared/manga';
import { useAppStore } from '@renderer/store/appStore';
import { UPDATE_ALL_KEY, upsertMangaJob, useMangaStore } from '@renderer/store/mangaStore';
import type { MangaSourcePreference } from '@shared/manga';
import { makeChapter, makeChapterRecord, makeDetails, makeExtension, makeLibraryManga, makeMangaJob, makeMangaStatus, makeSource, makeSummary, makeTool } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

const FAILURE: MangaError = { code: 'REQUEST_FAILED', message: 'site down' };

beforeEach(() => {
    window.localStorage.clear();
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
    useMangaStore.setState({ ...initialManga });
});

function state() {
    return useMangaStore.getState();
}

function toasts(): string[] {
    return useAppStore.getState().toasts.map((toast) => {
        return toast.message;
    });
}

describe('upsertMangaJob', () => {
    it('adds a job that is new and replaces one that is there, keeping the order', () => {
        const first = makeMangaJob({ chapterId: 1, percent: 10 });
        const second = makeMangaJob({ chapterId: 2 });
        expect(upsertMangaJob([first], second)).toEqual([first, second]);
        expect(upsertMangaJob([first, second], { ...first, percent: 60 })).toEqual([{ ...first, percent: 60 }, second]);
    });
});

describe('mangaStore init', () => {
    it('reads the status and does nothing more where the section does not exist', async () => {
        const unsubscribe = await state().init();
        expect(state().status.supported).toBe(false);
        expect(mock.api.manga.library).not.toHaveBeenCalled();
        expect(mock.api.manga.onToolState).not.toHaveBeenCalled();
        expect(() => {
            unsubscribe();
        }).not.toThrow();
    });

    it('reads the library and the downloads and listens for events where it exists', async () => {
        const library = [makeLibraryManga([makeChapterRecord()])];
        const jobs = [makeMangaJob()];
        mock.api.manga.status.mockResolvedValue(makeMangaStatus());
        mock.api.manga.library.mockResolvedValue(library);
        mock.api.manga.jobs.mockResolvedValue(jobs);
        const unsubscribe = await state().init();
        expect(state().status).toEqual(makeMangaStatus());
        expect(state().library).toEqual(library);
        expect(state().jobs).toEqual(jobs);
        unsubscribe();
        expect(mock.unsubscribers).toHaveLength(5);
        mock.unsubscribers.forEach((fn) => {
            expect(fn).toHaveBeenCalledTimes(1);
        });
    });

    describe('events', () => {
        beforeEach(async () => {
            mock.api.manga.status.mockResolvedValue(makeMangaStatus());
            await state().init();
            mock.api.manga.status.mockClear();
            mock.api.manga.library.mockClear();
        });

        it('keeps the state of the download of the program, and reads the status again when it ends', async () => {
            mock.emitMangaTool(makeTool({ status: 'downloading', percent: 40 }));
            expect(state().status.tool).toMatchObject({ status: 'downloading', percent: 40 });
            expect(mock.api.manga.status).not.toHaveBeenCalled();
            mock.emitMangaTool(makeTool({ status: 'ready' }));
            await vi.waitFor(() => {
                expect(mock.api.manga.status).toHaveBeenCalledTimes(1);
            });
            mock.emitMangaTool(makeTool({ status: 'error', error: { code: 'DOWNLOAD_FAILED', message: 'x' } }));
            await vi.waitFor(() => {
                expect(mock.api.manga.status).toHaveBeenCalledTimes(2);
            });
        });

        it('keeps the state of the download of the helper apart from the one of the program', async () => {
            mock.emitMangaTool(makeTool({ id: 'flaresolverr', status: 'downloading', percent: 70 }));
            expect(state().status.helper).toMatchObject({ id: 'flaresolverr', status: 'downloading', percent: 70 });
            expect(state().status.tool).toMatchObject({ id: 'suwayomi', status: 'ready' });
            mock.emitMangaTool(makeTool({ status: 'downloading', percent: 5 }));
            expect(state().status.tool).toMatchObject({ id: 'suwayomi', status: 'downloading', percent: 5 });
            expect(state().status.helper).toMatchObject({ id: 'flaresolverr', percent: 70 });
        });

        it('reads the status again when the helper is ready or failed', async () => {
            mock.emitMangaTool(makeTool({ id: 'flaresolverr', status: 'ready' }));
            await vi.waitFor(() => {
                expect(mock.api.manga.status).toHaveBeenCalledTimes(1);
            });
        });

        it('keeps the state of the server, reads the library again when it is up and the status when it fails', async () => {
            mock.emitMangaServer('starting');
            expect(state().status.server).toBe('starting');
            expect(mock.api.manga.library).not.toHaveBeenCalled();
            mock.emitMangaServer('running');
            await vi.waitFor(() => {
                expect(mock.api.manga.library).toHaveBeenCalledTimes(1);
            });
            mock.api.manga.status.mockResolvedValue(makeMangaStatus({ server: 'error', serverError: 'could not start' }));
            mock.emitMangaServer('error');
            await vi.waitFor(() => {
                expect(mock.api.manga.status).toHaveBeenCalledTimes(1);
            });
            await vi.waitFor(() => {
                expect(state().status).toMatchObject({ server: 'error', serverError: 'could not start' });
            });
        });

        it('keeps the checks of Cloudflare that are going on', () => {
            mock.emitMangaCloudflare([{ id: 1, host: 'manganato.com', startedAt: 5 }]);
            expect(state().cloudflare).toEqual([{ id: 1, host: 'manganato.com', startedAt: 5 }]);
            mock.emitMangaCloudflare([]);
            expect(state().cloudflare).toEqual([]);
        });

        it('keeps the jobs up to date', () => {
            mock.emitMangaJob(makeMangaJob({ chapterId: 1, percent: 10 }));
            mock.emitMangaJob(makeMangaJob({ chapterId: 1, percent: 50 }));
            mock.emitMangaJob(makeMangaJob({ chapterId: 2, percent: 5 }));
            expect(
                state().jobs.map((job) => {
                    return [job.chapterId, job.percent];
                })
            ).toEqual([[1, 50], [2, 5]]);
        });

        it('takes a finished job off the list and says so', () => {
            mock.emitMangaJob(makeMangaJob({ chapterId: 1 }));
            mock.emitMangaJob(makeMangaJob({ chapterId: 2 }));
            mock.emitMangaJob(makeMangaJob({ chapterId: 1, status: 'done' }));
            expect(
                state().jobs.map((job) => {
                    return job.chapterId;
                })
            ).toEqual([2]);
            expect(toasts()).toEqual(['Download complete: One Piece · Romance Dawn']);
        });

        it('reads the library again when it changes', async () => {
            mock.emitMangaLibraryChanged();
            await vi.waitFor(() => {
                expect(mock.api.manga.library).toHaveBeenCalledTimes(1);
            });
        });
    });
});

describe('mangaStore status and views', () => {
    it('asks for the program again and reads the status', async () => {
        mock.api.manga.status.mockResolvedValue(makeMangaStatus({ tool: makeTool({ status: 'downloading' }) }));
        await state().retryInstall();
        expect(mock.api.manga.install).toHaveBeenCalledTimes(1);
        expect(state().status.tool?.status).toBe('downloading');
    });

    it('changes the view and goes back from the downloads to where it was', () => {
        state().setView('library');
        state().openDownloads();
        expect(state().view).toBe('downloads');
        state().openDownloads();
        state().closeDownloads();
        expect(state().view).toBe('library');
        state().setView('extensions');
        expect(state().view).toBe('extensions');
    });
});

describe('mangaStore browsing', () => {
    it('lists the sources and leaves out the local one; none is open', async () => {
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: [makeSource({ id: '0', name: 'Local source' }), makeSource({ id: '5', name: 'Site A' }), makeSource({ id: '6', name: 'Site B' })] });
        await state().loadSources();
        expect(state().browse.sourcesStatus).toBe('ready');
        expect(
            state().browse.sources.map((source) => {
                return source.id;
            })
        ).toEqual(['5', '6']);
        expect(state().browse.sourceId).toBeNull();
    });

    it('keeps the source that is open while it is still there, and closes it when it is gone', async () => {
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: [makeSource({ id: '5' }), makeSource({ id: '6' })] });
        await state().loadSources();
        state().openSource('6');
        useMangaStore.setState({ browse: { ...state().browse, status: 'done', items: [makeSummary()] } });
        await state().loadSources();
        expect(state().browse).toMatchObject({ sourceId: '6', status: 'done' });
        expect(state().browse.items).toHaveLength(1);
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: [makeSource({ id: '5' })] });
        await state().loadSources();
        expect(state().browse).toMatchObject({ sourceId: null, status: 'idle', items: [] });
    });

    it('has no source when there are none', async () => {
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: [makeSource({ id: '0' })] });
        await state().loadSources();
        expect(state().browse).toMatchObject({ sourcesStatus: 'ready', sources: [], sourceId: null });
    });

    it('reports a failure to list the sources', async () => {
        mock.api.manga.sources.mockResolvedValue({ ok: false, error: FAILURE });
        await state().loadSources();
        expect(state().browse).toMatchObject({ sourcesStatus: 'error', sourcesError: FAILURE });
    });

    it('reads the stores with the sources, so each source can say which store it comes from', async () => {
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: [makeSource({ id: '5' })] });
        mock.api.manga.stores.mockResolvedValue({ ok: true, value: [{ indexUrl: 'https://store.example/index.min.json', name: 'My store' }] });
        await state().loadSources();
        expect(state().extensions.stores).toEqual([{ indexUrl: 'https://store.example/index.min.json', name: 'My store' }]);
    });

    it('lists the sources even when the stores cannot be read, and keeps the stores it had', async () => {
        useMangaStore.setState({ extensions: { ...state().extensions, stores: [{ indexUrl: 'https://a/i.json', name: 'A' }] } });
        mock.api.manga.sources.mockResolvedValue({ ok: true, value: [makeSource({ id: '5' })] });
        mock.api.manga.stores.mockResolvedValue({ ok: false, error: FAILURE });
        await state().loadSources();
        expect(state().browse).toMatchObject({ sourcesStatus: 'ready' });
        expect(state().extensions.stores).toEqual([{ indexUrl: 'https://a/i.json', name: 'A' }]);
    });

    it('limits the list of sources to a language', () => {
        state().setSourceLanguage('pt');
        expect(state().browse.sourceLanguage).toBe('pt');
        state().setSourceLanguage('all-languages');
        expect(state().browse.sourceLanguage).toBe('all-languages');
    });

    it('remembers the language of the sources', () => {
        state().setSourceLanguage('pt');
        expect(JSON.parse(window.localStorage.getItem('pullwave.manga.ui') ?? '{}')).toEqual({ sourceLanguage: 'pt', extensionLanguage: 'all-languages', onlyInstalled: true });
    });

    it('opens a source on its popular mangas, with nothing left of the one before', () => {
        useMangaStore.setState({
            browse: { ...state().browse, sourceId: '5', mode: 'search', query: 'old', status: 'done', items: [makeSummary()], page: 3, hasNextPage: true, error: FAILURE },
            sourceSettings: { open: true, status: 'ready', preferences: [], error: null, saving: false },
            selection: { manga: makeSummary(), status: 'ready', details: null, chapters: [], selected: [], error: null }
        });
        state().openSource('6');
        expect(state().browse).toMatchObject({ sourceId: '6', mode: 'popular', query: '', status: 'idle', items: [], page: 1, hasNextPage: false, loadingMore: false, error: null });
        expect(state().sourceSettings.open).toBe(false);
        expect(state().selection).toBeNull();
    });

    it('opens a source on its latest mangas when asked to', () => {
        state().openSource('6', 'latest');
        expect(state().browse).toMatchObject({ sourceId: '6', mode: 'latest', status: 'idle' });
    });

    it('goes back to the list of sources', () => {
        useMangaStore.setState({
            browse: { ...state().browse, sourceId: '5', mode: 'search', query: 'x', status: 'done', items: [makeSummary()], page: 2, hasNextPage: true, error: FAILURE },
            sourceSettings: { open: true, status: 'ready', preferences: [], error: null, saving: false }
        });
        state().closeSource();
        expect(state().browse).toMatchObject({ sourceId: null, query: '', status: 'idle', items: [], page: 1, hasNextPage: false, error: null });
        expect(state().sourceSettings.open).toBe(false);
    });

    it('clears the list when the mode changes', () => {
        useMangaStore.setState({ browse: { ...state().browse, sourceId: '5', status: 'done', items: [makeSummary()], page: 3, hasNextPage: true, error: FAILURE } });
        state().setMode('latest');
        expect(state().browse).toMatchObject({ mode: 'latest', status: 'idle', items: [], page: 1, hasNextPage: false, error: null });
        state().setQuery('naruto');
        expect(state().browse.query).toBe('naruto');
    });

    describe('runList', () => {
        beforeEach(() => {
            useMangaStore.setState({ browse: { ...state().browse, sourceId: '5', mode: 'popular', query: '' } });
        });

        it('lists the first page', async () => {
            mock.api.manga.list.mockResolvedValue({ ok: true, value: { items: [makeSummary()], hasNextPage: true } });
            await state().runList();
            expect(mock.api.manga.list).toHaveBeenCalledWith({ sourceId: '5', kind: 'popular', page: 1, query: '' });
            expect(state().browse).toMatchObject({ status: 'done', items: [makeSummary()], hasNextPage: true, page: 1, error: null });
        });

        it('searches with the text trimmed', async () => {
            useMangaStore.setState({ browse: { ...state().browse, mode: 'search', query: '  naruto ' } });
            await state().runList();
            expect(mock.api.manga.list).toHaveBeenCalledWith({ sourceId: '5', kind: 'search', page: 1, query: 'naruto', filters: [] });
        });

        it('does nothing without a source, or for a search with nothing to search for', async () => {
            useMangaStore.setState({ browse: { ...state().browse, sourceId: null } });
            await state().runList();
            useMangaStore.setState({ browse: { ...state().browse, sourceId: '5', mode: 'search', query: '   ' } });
            await state().runList();
            expect(mock.api.manga.list).not.toHaveBeenCalled();
        });

        it('shows the error of a list that failed', async () => {
            mock.api.manga.list.mockResolvedValue({ ok: false, error: FAILURE });
            await state().runList();
            expect(state().browse).toMatchObject({ status: 'error', error: FAILURE, items: [] });
        });

        it('does not show the answer of a list that was asked for before another one', async () => {
            let answer: (value: unknown) => void = () => {return undefined};
            mock.api.manga.list.mockReturnValue(
                new Promise((resolve) => {
                    answer = resolve;
                })
            );
            const pending = state().runList();
            state().setMode('latest');
            answer({ ok: true, value: { items: [makeSummary()], hasNextPage: false } });
            await pending;
            expect(state().browse).toMatchObject({ mode: 'latest', status: 'idle', items: [] });
        });
    });

    describe('filters of the search', () => {
        const GENRE: MangaFilter = { type: 'tristate', name: 'Action', value: 'ignore' };
        const FILTERS: MangaFilter[] = [{ type: 'text', name: 'Author', value: '' }, GENRE];

        beforeEach(() => {
            useMangaStore.setState({ browse: { ...state().browse, sourceId: '5', mode: 'search', query: '' } });
        });

        it('asks the source for them once, and keeps what it offers to start over from', async () => {
            mock.api.manga.sourceFilters.mockResolvedValue({ ok: true, value: FILTERS });
            const first = state().loadFilters();
            expect(state().browse.filtersStatus).toBe('loading');
            await first;
            await state().loadFilters();
            expect(mock.api.manga.sourceFilters).toHaveBeenCalledTimes(1);
            expect(mock.api.manga.sourceFilters).toHaveBeenCalledWith('5');
            expect(state().browse).toMatchObject({ filtersStatus: 'ready', filters: FILTERS, initialFilters: FILTERS });
        });

        it('says when they could not be read, and asks again next time', async () => {
            mock.api.manga.sourceFilters.mockResolvedValue({ ok: false, error: FAILURE });
            await state().loadFilters();
            expect(state().browse).toMatchObject({ filtersStatus: 'error', filters: [] });
            mock.api.manga.sourceFilters.mockResolvedValue({ ok: true, value: FILTERS });
            await state().loadFilters();
            expect(state().browse.filtersStatus).toBe('ready');
        });

        it('does nothing without a source, and drops the answer of a source that is no longer open', async () => {
            useMangaStore.setState({ browse: { ...state().browse, sourceId: null } });
            await state().loadFilters();
            expect(mock.api.manga.sourceFilters).not.toHaveBeenCalled();
            useMangaStore.setState({ browse: { ...state().browse, sourceId: '5' } });
            let answer: (value: unknown) => void = () => {return undefined};
            mock.api.manga.sourceFilters.mockReturnValue(
                new Promise((resolve) => {
                    answer = resolve;
                })
            );
            const pending = state().loadFilters();
            state().openSource('6');
            answer({ ok: true, value: FILTERS });
            await pending;
            expect(state().browse).toMatchObject({ sourceId: '6', filtersStatus: 'idle', filters: [] });
        });

        it('sets them, starts over and opens or closes the panel', () => {
            useMangaStore.setState({ browse: { ...state().browse, filters: FILTERS, initialFilters: FILTERS } });
            const changed: MangaFilter[] = [FILTERS[0]!, { ...GENRE, value: 'include' }];
            state().setFilters(changed);
            expect(state().browse.filters).toEqual(changed);
            state().resetFilters();
            expect(state().browse.filters).toEqual(FILTERS);
            expect(state().browse.filtersOpen).toBe(false);
            state().toggleFilters();
            expect(state().browse.filtersOpen).toBe(true);
            state().toggleFilters();
            expect(state().browse.filtersOpen).toBe(false);
        });

        it('searches with them, even with no text, and sends them with the next pages', async () => {
            const changed: MangaFilter[] = [{ ...GENRE, value: 'include' }];
            useMangaStore.setState({ browse: { ...state().browse, filters: changed } });
            mock.api.manga.list.mockResolvedValue({ ok: true, value: { items: [makeSummary()], hasNextPage: true } });
            await state().runList();
            expect(mock.api.manga.list).toHaveBeenCalledWith({ sourceId: '5', kind: 'search', page: 1, query: '', filters: changed });
            await state().loadMore();
            expect(mock.api.manga.list).toHaveBeenLastCalledWith({ sourceId: '5', kind: 'search', page: 2, query: '', filters: changed });
        });

        it('does not send them with the popular or the latest', async () => {
            useMangaStore.setState({ browse: { ...state().browse, mode: 'popular', filters: FILTERS } });
            await state().runList();
            expect(mock.api.manga.list).toHaveBeenCalledWith({ sourceId: '5', kind: 'popular', page: 1, query: '' });
        });

        it('forgets them when another source is opened or the source is closed', () => {
            useMangaStore.setState({ browse: { ...state().browse, filters: FILTERS, initialFilters: FILTERS, filtersStatus: 'ready', filtersOpen: true } });
            state().openSource('6');
            expect(state().browse).toMatchObject({ filters: [], initialFilters: [], filtersStatus: 'idle', filtersOpen: false });
            useMangaStore.setState({ browse: { ...state().browse, filters: FILTERS, filtersStatus: 'ready', filtersOpen: true } });
            state().closeSource();
            expect(state().browse).toMatchObject({ filters: [], filtersStatus: 'idle', filtersOpen: false });
        });
    });

    describe('loadMore', () => {
        beforeEach(() => {
            useMangaStore.setState({
                browse: { ...state().browse, sourceId: '5', mode: 'popular', status: 'done', items: [makeSummary({ remoteId: 1 }), makeSummary({ remoteId: 2 })], page: 1, hasNextPage: true }
            });
        });

        it('adds the next page, without repeating a manga', async () => {
            mock.api.manga.list.mockResolvedValue({ ok: true, value: { items: [makeSummary({ remoteId: 2 }), makeSummary({ remoteId: 3 })], hasNextPage: false } });
            await state().loadMore();
            expect(mock.api.manga.list).toHaveBeenCalledWith({ sourceId: '5', kind: 'popular', page: 2, query: '' });
            expect(
                state().browse.items.map((item) => {
                    return item.remoteId;
                })
            ).toEqual([1, 2, 3]);
            expect(state().browse).toMatchObject({ page: 2, hasNextPage: false, loadingMore: false });
        });

        it('does nothing when there is no next page or one is being loaded', async () => {
            useMangaStore.setState({ browse: { ...state().browse, hasNextPage: false } });
            await state().loadMore();
            useMangaStore.setState({ browse: { ...state().browse, hasNextPage: true, loadingMore: true } });
            await state().loadMore();
            useMangaStore.setState({ browse: { ...state().browse, sourceId: null, loadingMore: false } });
            await state().loadMore();
            expect(mock.api.manga.list).not.toHaveBeenCalled();
        });

        it('keeps what it has and shows the error when the page fails', async () => {
            mock.api.manga.list.mockResolvedValue({ ok: false, error: FAILURE });
            await state().loadMore();
            expect(state().browse).toMatchObject({ loadingMore: false, error: FAILURE, page: 1 });
            expect(state().browse.items).toHaveLength(2);
        });

        it('drops the answer when the list changed meanwhile', async () => {
            let answer: (value: unknown) => void = () => {return undefined};
            mock.api.manga.list.mockReturnValue(
                new Promise((resolve) => {
                    answer = resolve;
                })
            );
            const pending = state().loadMore();
            state().openSource('6');
            answer({ ok: true, value: { items: [makeSummary({ remoteId: 9 })], hasNextPage: false } });
            await pending;
            expect(state().browse).toMatchObject({ sourceId: '6', items: [], loadingMore: false });
        });
    });
});

describe('mangaStore opening a manga', () => {
    const chapters = [makeChapter({ remoteId: 11 }), makeChapter({ remoteId: 12, name: 'Second', number: 2 }), makeChapter({ remoteId: 13, name: 'Third', number: 3 })];

    it('opens a manga, reading its details and chapters', async () => {
        mock.api.manga.details.mockResolvedValue({ ok: true, value: { details: makeDetails(), chapters } });
        const opening = state().openManga(makeSummary());
        expect(state().selection).toMatchObject({ status: 'loading', details: null, chapters: [], selected: [] });
        await opening;
        expect(mock.api.manga.details).toHaveBeenCalledWith(7);
        expect(state().selection).toMatchObject({ status: 'ready', details: makeDetails(), chapters, error: null });
    });

    it('shows the error when the manga cannot be read', async () => {
        mock.api.manga.details.mockResolvedValue({ ok: false, error: FAILURE });
        await state().openManga(makeSummary());
        expect(state().selection).toMatchObject({ status: 'error', error: FAILURE });
    });

    it('drops the answer when another manga was opened, or it was closed, meanwhile', async () => {
        let answer: (value: unknown) => void = () => {return undefined};
        mock.api.manga.details.mockReturnValueOnce(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const pending = state().openManga(makeSummary({ remoteId: 7 }));
        state().closeManga();
        answer({ ok: true, value: { details: makeDetails(), chapters } });
        await pending;
        expect(state().selection).toBeNull();
    });

    describe('picking chapters', () => {
        beforeEach(async () => {
            mock.api.manga.details.mockResolvedValue({ ok: true, value: { details: makeDetails(), chapters } });
            await state().openManga(makeSummary());
        });

        it('picks and unpicks a chapter', () => {
            state().toggleChapter(12);
            state().toggleChapter(13);
            expect(state().selection?.selected).toEqual([12, 13]);
            state().toggleChapter(12);
            expect(state().selection?.selected).toEqual([13]);
        });

        it('picks all of them or none', () => {
            state().selectChapters('all');
            expect(state().selection?.selected).toEqual([11, 12, 13]);
            state().selectChapters('none');
            expect(state().selection?.selected).toEqual([]);
        });

        it('picks the chapters that are not downloaded yet', () => {
            useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ remoteId: 11, status: 'done' }), makeChapterRecord({ id: 2, remoteId: 12, status: 'error' })])] });
            state().selectChapters('missing');
            expect(state().selection?.selected).toEqual([12, 13]);
        });

        it('picks them all when the manga is not in the library', () => {
            state().selectChapters('missing');
            expect(state().selection?.selected).toEqual([11, 12, 13]);
        });

        it('does nothing without an open manga', () => {
            state().closeManga();
            state().toggleChapter(11);
            state().selectChapters('all');
            expect(state().selection).toBeNull();
        });

        it('downloads the chapters picked, tells so, reads the library and clears the choice', async () => {
            mock.api.manga.download.mockResolvedValue(makeLibraryManga([]));
            state().toggleChapter(13);
            state().toggleChapter(11);
            await state().downloadSelected();
            expect(mock.api.manga.download).toHaveBeenCalledWith({
                manga: makeSummary(),
                details: makeDetails(),
                chapters: [chapters[0], chapters[2]]
            });
            expect(toasts()).toEqual(['2 chapter(s) queued.']);
            expect(mock.api.manga.library).toHaveBeenCalled();
            expect(state().selection?.selected).toEqual([]);
        });

        it('does not download with no chapter picked, or while the manga is still loading', async () => {
            await state().downloadSelected();
            useMangaStore.setState({ selection: { ...state().selection!, status: 'loading', selected: [11] } });
            await state().downloadSelected();
            state().closeManga();
            await state().downloadSelected();
            expect(mock.api.manga.download).not.toHaveBeenCalled();
        });

        it('says nothing when the download was refused', async () => {
            mock.api.manga.download.mockResolvedValue(null);
            state().toggleChapter(11);
            await state().downloadSelected();
            expect(toasts()).toEqual([]);
        });

        it('adds the manga to the library with all its chapters', async () => {
            mock.api.manga.addToLibrary.mockResolvedValue(makeLibraryManga([]));
            await expect(state().addToLibrary()).resolves.toBe(true);
            expect(mock.api.manga.addToLibrary).toHaveBeenCalledWith({ manga: makeSummary(), details: makeDetails(), chapters });
            expect(toasts()).toEqual(['Added to the library: One Piece']);
        });

        it('answers false when the library did not take it, or there is nothing to add', async () => {
            mock.api.manga.addToLibrary.mockResolvedValue(null);
            await expect(state().addToLibrary()).resolves.toBe(false);
            expect(toasts()).toEqual([]);
            state().closeManga();
            await expect(state().addToLibrary()).resolves.toBe(false);
        });
    });

    it('sends the summary the manga is known by when its details are not there', async () => {
        useMangaStore.setState({ selection: { manga: makeSummary({ title: 'From the list' }), status: 'ready', details: null, chapters: [makeChapter()], selected: [11], error: null } });
        await state().downloadSelected();
        expect(mock.api.manga.download).toHaveBeenCalledWith(expect.objectContaining({ manga: makeSummary({ title: 'From the list' }), details: null }));
    });

    it('goes to the library and closes the manga', () => {
        useMangaStore.setState({ selection: { manga: makeSummary(), status: 'ready', details: null, chapters: [], selected: [], error: null } });
        state().showInLibrary();
        expect(state().view).toBe('library');
        expect(state().selection).toBeNull();
    });
});

describe('mangaStore library and jobs', () => {
    it('reads the library', async () => {
        const library = [makeLibraryManga([makeChapterRecord()])];
        mock.api.manga.library.mockResolvedValue(library);
        await state().refreshLibrary();
        expect(state().library).toEqual(library);
    });

    it('downloads what is missing, opens the folder and removes a manga or a chapter, reading the library after', async () => {
        await state().downloadMissing(4);
        expect(mock.api.manga.downloadMissing).toHaveBeenCalledWith([4]);
        await state().openFolder(4);
        expect(mock.api.manga.openFolder).toHaveBeenCalledWith(4);
        mock.api.manga.library.mockClear();
        await state().removeManga(4);
        expect(mock.api.manga.removeManga).toHaveBeenCalledWith(4);
        await state().removeChapter(9);
        expect(mock.api.manga.removeChapter).toHaveBeenCalledWith(9);
        expect(mock.api.manga.library).toHaveBeenCalledTimes(2);
    });

    it('cancels, retries, pauses and resumes a download', async () => {
        await state().cancelJob(1);
        await state().retryJob(2);
        await state().pauseJob(3);
        await state().resumeJob(4);
        expect(mock.api.manga.cancel).toHaveBeenCalledWith(1);
        expect(mock.api.manga.retry).toHaveBeenCalledWith(2);
        expect(mock.api.manga.pause).toHaveBeenCalledWith(3);
        expect(mock.api.manga.resume).toHaveBeenCalledWith(4);
    });

    it('clears the downloads that are over and keeps the others', async () => {
        useMangaStore.setState({
            jobs: (['queued', 'running', 'paused', 'error', 'cancelled'] as const).map((status, index) => {
                return makeMangaJob({ chapterId: index + 1, status });
            })
        });
        await state().clearFinishedJobs();
        expect(mock.api.manga.clearFinished).toHaveBeenCalledTimes(1);
        expect(
            state().jobs.map((job) => {
                return job.status;
            })
        ).toEqual(['queued', 'running', 'paused']);
    });
});

describe('mangaStore extensions', () => {
    const STORE = { indexUrl: 'https://store.example/index.min.json', name: 'Store' };

    it('reads the stores and the extensions', async () => {
        mock.api.manga.stores.mockResolvedValue({ ok: true, value: [STORE] });
        mock.api.manga.extensions.mockResolvedValue({ ok: true, value: [makeExtension()] });
        await state().loadExtensions();
        expect(mock.api.manga.extensions).toHaveBeenCalledWith(false);
        expect(state().extensions).toMatchObject({ status: 'ready', stores: [STORE], extensions: [makeExtension()], error: null });
    });

    it('shows the stores while the extensions are still coming', async () => {
        let answer: (value: unknown) => void = () => {return undefined};
        mock.api.manga.stores.mockResolvedValue({ ok: true, value: [STORE] });
        mock.api.manga.extensions.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const loading = state().loadExtensions();
        await vi.waitFor(() => {
            expect(state().extensions).toMatchObject({ status: 'loading', stores: [STORE], extensions: [] });
        });
        answer({ ok: true, value: [makeExtension()] });
        await loading;
        expect(state().extensions.status).toBe('ready');
    });

    it('asks the stores for their lists again when told to', async () => {
        mock.api.manga.stores.mockResolvedValue({ ok: true, value: [STORE] });
        await state().loadExtensions(true);
        expect(mock.api.manga.extensions).toHaveBeenCalledWith(true);
    });

    it('shows the error when the stores cannot be read', async () => {
        mock.api.manga.stores.mockResolvedValue({ ok: false, error: FAILURE });
        await state().loadExtensions();
        expect(state().extensions).toMatchObject({ status: 'error', error: FAILURE });
        expect(mock.api.manga.extensions).not.toHaveBeenCalled();
    });

    it('shows the error, keeping the stores, when the extensions cannot be read', async () => {
        mock.api.manga.stores.mockResolvedValue({ ok: true, value: [STORE] });
        mock.api.manga.extensions.mockResolvedValue({ ok: false, error: FAILURE });
        await state().loadExtensions();
        expect(state().extensions).toMatchObject({ status: 'error', error: FAILURE, stores: [STORE] });
    });

    it('adds a store and reads everything again', async () => {
        mock.api.manga.stores.mockResolvedValue({ ok: true, value: [STORE] });
        await expect(state().addStore(STORE.indexUrl)).resolves.toBe(true);
        expect(mock.api.manga.addStore).toHaveBeenCalledWith(STORE.indexUrl);
        expect(mock.api.manga.extensions).toHaveBeenCalledWith(true);
        expect(state().extensions.busy).toEqual([]);
    });

    it('does not add a store the server refused, and shows why', async () => {
        mock.api.manga.addStore.mockResolvedValue({ ok: false, error: FAILURE });
        await expect(state().addStore(STORE.indexUrl)).resolves.toBe(false);
        expect(state().extensions).toMatchObject({ error: FAILURE, busy: [] });
        expect(mock.api.manga.extensions).not.toHaveBeenCalled();
    });

    it('removes a store and reads the lists again', async () => {
        mock.api.manga.stores.mockResolvedValue({ ok: true, value: [] });
        await state().removeStore(STORE.indexUrl);
        expect(mock.api.manga.removeStore).toHaveBeenCalledWith(STORE.indexUrl);
        expect(mock.api.manga.extensions).toHaveBeenCalledWith(false);
        expect(state().extensions.busy).toEqual([]);
    });

    it('shows why a store could not be removed', async () => {
        mock.api.manga.removeStore.mockResolvedValue({ ok: false, error: FAILURE });
        await state().removeStore(STORE.indexUrl);
        expect(state().extensions.error).toEqual(FAILURE);
        expect(mock.api.manga.extensions).not.toHaveBeenCalled();
    });

    it('marks an extension as busy while it changes, then reads the extensions and the sources', async () => {
        let finish: (value: unknown) => void = () => {return undefined};
        mock.api.manga.changeExtension.mockReturnValue(
            new Promise((resolve) => {
                finish = resolve;
            })
        );
        mock.api.manga.stores.mockResolvedValue({ ok: true, value: [STORE] });
        const changing = state().changeExtension('eu.kanade.x', 'install');
        expect(state().extensions.busy).toEqual(['eu.kanade.x']);
        finish({ ok: true, value: null });
        await changing;
        expect(mock.api.manga.changeExtension).toHaveBeenCalledWith('eu.kanade.x', 'install');
        expect(state().extensions.busy).toEqual([]);
        expect(mock.api.manga.extensions).toHaveBeenCalledWith(false);
        expect(mock.api.manga.sources).toHaveBeenCalledTimes(1);
    });

    it('shows why an extension could not be changed', async () => {
        mock.api.manga.changeExtension.mockResolvedValue({ ok: false, error: FAILURE });
        await state().changeExtension('eu.kanade.x', 'uninstall');
        expect(state().extensions).toMatchObject({ error: FAILURE, busy: [] });
        expect(mock.api.manga.sources).not.toHaveBeenCalled();
    });

    it('updates every extension that has an update, and reads the extensions and the sources again', async () => {
        mock.api.manga.updateAllExtensions.mockResolvedValue({ ok: true, value: 3 });
        const pending = state().updateAllExtensions();
        expect(state().extensions.busy).toEqual([UPDATE_ALL_KEY]);
        await pending;
        expect(mock.api.manga.updateAllExtensions).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.extensions).toHaveBeenCalledWith(false);
        expect(mock.api.manga.sources).toHaveBeenCalledTimes(1);
        expect(state().extensions).toMatchObject({ error: null, busy: [] });
    });

    it('shows why the update of every extension failed, and reads nothing again', async () => {
        mock.api.manga.updateAllExtensions.mockResolvedValue({ ok: false, error: FAILURE });
        await state().updateAllExtensions();
        expect(state().extensions).toMatchObject({ error: FAILURE, busy: [] });
        expect(mock.api.manga.extensions).not.toHaveBeenCalled();
        expect(mock.api.manga.sources).not.toHaveBeenCalled();
    });

    it('installs and removes the helper for Cloudflare, and reads the status after each', async () => {
        const status = makeMangaStatus({ helper: makeTool({ id: 'flaresolverr', status: 'ready' }) });
        mock.api.manga.status.mockResolvedValue(status);
        await state().installHelper();
        expect(mock.api.manga.installHelper).toHaveBeenCalledTimes(1);
        expect(state().status).toEqual(status);
        mock.api.manga.status.mockResolvedValue(makeMangaStatus());
        await state().removeHelper();
        expect(mock.api.manga.removeHelper).toHaveBeenCalledTimes(1);
        expect(state().status).toEqual(makeMangaStatus());
    });

    it('changes the filter a piece at a time', () => {
        state().setExtensionFilter({ query: 'dex' });
        state().setExtensionFilter({ lang: 'pt' });
        state().setExtensionFilter({ onlyInstalled: true });
        expect(state().extensions.filter).toEqual({ query: 'dex', lang: 'pt', onlyInstalled: true });
    });

    it('lists only the installed extensions until the user says otherwise', () => {
        expect(initialManga.extensions.filter).toEqual({ query: '', lang: 'all-languages', onlyInstalled: true });
    });

    it('remembers the language and the installed-only switch, but not the text typed', () => {
        state().setExtensionFilter({ query: 'dex' });
        expect(window.localStorage.getItem('pullwave.manga.ui')).toBeNull();
        state().setExtensionFilter({ lang: 'ja' });
        state().setExtensionFilter({ onlyInstalled: false });
        expect(JSON.parse(window.localStorage.getItem('pullwave.manga.ui') ?? '{}')).toEqual({ sourceLanguage: 'all-languages', extensionLanguage: 'ja', onlyInstalled: false });
    });

    it('starts from what was remembered', async () => {
        window.localStorage.setItem('pullwave.manga.ui', JSON.stringify({ sourceLanguage: 'pt', extensionLanguage: 'en', onlyInstalled: false }));
        vi.resetModules();
        const fresh = (await import('@renderer/store/mangaStore')).useMangaStore.getState();
        expect(fresh.browse.sourceLanguage).toBe('pt');
        expect(fresh.extensions.filter).toEqual({ query: '', lang: 'en', onlyInstalled: false });
    });
});

describe('mangaStore settings of a source', () => {
    const TEXT: MangaSourcePreference = { position: 0, type: 'text', key: 'Server URL Address', title: 'Server URL Address', summary: '', enabled: true, value: '' };
    const SWITCH: MangaSourcePreference = { position: 1, type: 'switch', key: 'hq', title: 'High quality', summary: '', enabled: true, value: false };

    beforeEach(() => {
        useMangaStore.setState({ browse: { ...state().browse, sourceId: '5', sources: [makeSource({ id: '5', isConfigurable: true })] } });
    });

    it('reads the settings of the source being browsed and shows them', async () => {
        mock.api.manga.sourcePreferences.mockResolvedValue({ ok: true, value: [TEXT, SWITCH] });
        const opening = state().openSourceSettings();
        expect(state().sourceSettings).toMatchObject({ open: true, status: 'loading', preferences: [] });
        await opening;
        expect(mock.api.manga.sourcePreferences).toHaveBeenCalledWith('5');
        expect(state().sourceSettings).toEqual({ open: true, status: 'ready', preferences: [TEXT, SWITCH], error: null, saving: false });
    });

    it('shows why the settings could not be read', async () => {
        mock.api.manga.sourcePreferences.mockResolvedValue({ ok: false, error: FAILURE });
        await state().openSourceSettings();
        expect(state().sourceSettings).toMatchObject({ open: true, status: 'error', error: FAILURE, preferences: [] });
    });

    it('does nothing without a source', async () => {
        useMangaStore.setState({ browse: { ...state().browse, sourceId: null } });
        await state().openSourceSettings();
        expect(mock.api.manga.sourcePreferences).not.toHaveBeenCalled();
        expect(state().sourceSettings.open).toBe(false);
    });

    it('drops the answer when the settings were closed or the source changed meanwhile', async () => {
        let answer: (value: unknown) => void = () => {return undefined};
        mock.api.manga.sourcePreferences.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const opening = state().openSourceSettings();
        state().closeSourceSettings();
        answer({ ok: true, value: [TEXT] });
        await opening;
        expect(state().sourceSettings).toMatchObject({ open: false, preferences: [] });
    });

    it('closes the settings', async () => {
        mock.api.manga.sourcePreferences.mockResolvedValue({ ok: true, value: [TEXT] });
        await state().openSourceSettings();
        state().closeSourceSettings();
        expect(state().sourceSettings).toMatchObject({ open: false, status: 'idle', preferences: [] });
    });

    it('closes them when another source is opened, or the list of sources is shown', async () => {
        mock.api.manga.sourcePreferences.mockResolvedValue({ ok: true, value: [TEXT] });
        await state().openSourceSettings();
        state().openSource('6');
        expect(state().sourceSettings.open).toBe(false);
        await state().openSourceSettings();
        state().closeSource();
        expect(state().sourceSettings.open).toBe(false);
    });

    it('changes a setting, keeps what the server gives back and asks for the list again', async () => {
        mock.api.manga.sourcePreferences.mockResolvedValue({ ok: true, value: [TEXT, SWITCH] });
        await state().openSourceSettings();
        useMangaStore.setState({ browse: { ...state().browse, status: 'done', items: [makeSummary()] } });
        mock.api.manga.setSourcePreference.mockResolvedValue({ ok: true, value: [{ ...TEXT, value: 'http://x:4567' }, SWITCH] });
        await state().changePreference(TEXT, 'http://x:4567');
        expect(mock.api.manga.setSourcePreference).toHaveBeenCalledWith({ sourceId: '5', position: 0, type: 'text', value: 'http://x:4567' });
        expect(state().sourceSettings).toMatchObject({ saving: false, error: null, preferences: [{ ...TEXT, value: 'http://x:4567' }, SWITCH] });
        expect(state().browse).toMatchObject({ status: 'idle', items: [], error: null });
    });

    it('marks the settings as being saved while a change goes on', async () => {
        let answer: (value: unknown) => void = () => {return undefined};
        mock.api.manga.setSourcePreference.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const changing = state().changePreference(SWITCH, true);
        expect(state().sourceSettings.saving).toBe(true);
        answer({ ok: true, value: [TEXT, { ...SWITCH, value: true }] });
        await changing;
        expect(state().sourceSettings.saving).toBe(false);
    });

    it('keeps the settings and shows why a change was refused, without asking for the list again', async () => {
        useMangaStore.setState({ sourceSettings: { open: true, status: 'ready', preferences: [TEXT], error: null, saving: false }, browse: { ...state().browse, status: 'done', items: [makeSummary()] } });
        mock.api.manga.setSourcePreference.mockResolvedValue({ ok: false, error: FAILURE });
        await state().changePreference(TEXT, 'x');
        expect(state().sourceSettings).toMatchObject({ saving: false, error: FAILURE, preferences: [TEXT] });
        expect(state().browse).toMatchObject({ status: 'done' });
        expect(state().browse.items).toHaveLength(1);
    });

    it('does not change anything without a source, nor after the source changed', async () => {
        useMangaStore.setState({ browse: { ...state().browse, sourceId: null } });
        await state().changePreference(TEXT, 'x');
        expect(mock.api.manga.setSourcePreference).not.toHaveBeenCalled();
        useMangaStore.setState({ browse: { ...state().browse, sourceId: '5' } });
        let answer: (value: unknown) => void = () => {return undefined};
        mock.api.manga.setSourcePreference.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const changing = state().changePreference(TEXT, 'x');
        state().closeSource();
        answer({ ok: true, value: [TEXT] });
        await changing;
        expect(state().sourceSettings.preferences).toEqual([]);
    });
});

describe('mangaStore where a manga was opened from', () => {
    it('remembers the view, so the browse and the library each show their own', async () => {
        mock.api.manga.details.mockResolvedValue({ ok: false, error: FAILURE });
        useMangaStore.setState({ view: 'library' });
        await state().openManga(makeSummary());
        expect(state().selectionFrom).toBe('library');
        useMangaStore.setState({ view: 'browse' });
        await state().openManga(makeSummary());
        expect(state().selectionFrom).toBe('browse');
        useMangaStore.setState({ view: 'extensions' });
        await state().openManga(makeSummary());
        expect(state().selectionFrom).toBe('browse');
    });
});

describe('mangaStore reader', () => {
    const CHAPTERS = [
        { remoteId: 1, libraryChapterId: null, name: 'Chapter 1', number: 1 },
        { remoteId: 2, libraryChapterId: 8, name: 'Chapter 2', number: 2 },
        { remoteId: 3, libraryChapterId: null, name: 'Chapter 3', number: 3 }
    ];

    it('opens a chapter: it loads, then has the pages the main process gave', async () => {
        mock.api.manga.readPages.mockResolvedValue({ ok: true, value: { pages: ['pullwave-manga://page/8/0'], local: true } });
        const opening = state().openReader('One Piece', CHAPTERS, 1);
        expect(state().reader).toEqual({ status: 'loading', mangaTitle: 'One Piece', chapters: CHAPTERS, index: 1, pages: [], local: false, error: null });
        await opening;
        expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 2, libraryChapterId: 8 });
        expect(state().reader).toEqual({ status: 'ready', mangaTitle: 'One Piece', chapters: CHAPTERS, index: 1, pages: ['pullwave-manga://page/8/0'], local: true, error: null });
    });

    it('says why a chapter could not be read', async () => {
        mock.api.manga.readPages.mockResolvedValue({ ok: false, error: FAILURE });
        await state().openReader('One Piece', CHAPTERS, 0);
        expect(state().reader).toMatchObject({ status: 'error', pages: [], error: FAILURE });
    });

    it('does nothing for a chapter that is not in the list', async () => {
        await state().openReader('One Piece', CHAPTERS, 5);
        expect(state().reader.status).toBe('closed');
        expect(mock.api.manga.readPages).not.toHaveBeenCalled();
    });

    it('goes to the next and to the previous chapter, and says there is none past the ends', async () => {
        mock.api.manga.readPages.mockResolvedValue({ ok: true, value: { pages: ['a'], local: false } });
        await state().openReader('One Piece', CHAPTERS, 1);
        await expect(state().goToChapter(1)).resolves.toBe(true);
        expect(state().reader.index).toBe(2);
        expect(mock.api.manga.readPages).toHaveBeenLastCalledWith({ chapterRemoteId: 3, libraryChapterId: null });
        await expect(state().goToChapter(1)).resolves.toBe(false);
        expect(state().reader.index).toBe(2);
        await state().goToChapter(-1);
        await state().goToChapter(-1);
        expect(state().reader.index).toBe(0);
        await expect(state().goToChapter(-1)).resolves.toBe(false);
    });

    it('does not go anywhere when the reader is closed', async () => {
        await expect(state().goToChapter(1)).resolves.toBe(false);
        expect(mock.api.manga.readPages).not.toHaveBeenCalled();
    });

    it('drops the answer for a chapter that is no longer on the screen, and for a reader that was closed', async () => {
        let answer: (value: unknown) => void = () => {return undefined};
        mock.api.manga.readPages.mockReturnValueOnce(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const first = state().openReader('One Piece', CHAPTERS, 0);
        mock.api.manga.readPages.mockResolvedValueOnce({ ok: true, value: { pages: ['second'], local: false } });
        await state().openReader('One Piece', CHAPTERS, 1);
        answer({ ok: true, value: { pages: ['first'], local: false } });
        await first;
        expect(state().reader).toMatchObject({ index: 1, pages: ['second'] });
        let late: (value: unknown) => void = () => {return undefined};
        mock.api.manga.readPages.mockReturnValueOnce(
            new Promise((resolve) => {
                late = resolve;
            })
        );
        const pending = state().openReader('One Piece', CHAPTERS, 2);
        state().closeReader();
        late({ ok: true, value: { pages: ['late'], local: false } });
        await pending;
        expect(state().reader.status).toBe('closed');
    });

    it('closes', async () => {
        mock.api.manga.readPages.mockResolvedValue({ ok: true, value: { pages: ['a'], local: false } });
        await state().openReader('One Piece', CHAPTERS, 0);
        state().closeReader();
        expect(state().reader).toEqual({ status: 'closed', mangaTitle: '', chapters: [], index: 0, pages: [], local: false, error: null });
    });
});
