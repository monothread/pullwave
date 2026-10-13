// @vitest-environment jsdom
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { MangaError, MangaFilter } from '@shared/manga';
import { useAppStore } from '@renderer/store/appStore';
import { DONE_JOB_LINGER_MS, UPDATE_ALL_KEY, upsertMangaJob, useMangaStore } from '@renderer/store/mangaStore';
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
        expect(mock.unsubscribers).toHaveLength(8);
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

        it('keeps the download of a newer server apart from the status of the section', () => {
            const download = makeTool({ status: 'downloading', percent: 33, version: 'v9.0.0' });
            mock.emitMangaServerUpdate(download);
            expect(state().serverUpdate).toEqual(download);
            expect(state().status.tool).toMatchObject({ status: 'ready' });
            expect(mock.api.manga.status).not.toHaveBeenCalled();
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

        it('says a job is complete, keeps it a moment for its bar to reach the end, and then takes it off the list', () => {
            vi.useFakeTimers();
            try {
                mock.emitMangaJob(makeMangaJob({ chapterId: 1 }));
                mock.emitMangaJob(makeMangaJob({ chapterId: 2 }));
                mock.emitMangaJob(makeMangaJob({ chapterId: 1, status: 'done', percent: 100 }));
                expect(
                    state().jobs.map((job) => {
                        return [job.chapterId, job.status, job.percent];
                    })
                ).toEqual([[1, 'done', 100], [2, 'running', 25]]);
                expect(toasts()).toEqual(['Download complete: One Piece · Romance Dawn']);
                vi.advanceTimersByTime(DONE_JOB_LINGER_MS - 1);
                expect(state().jobs).toHaveLength(2);
                vi.advanceTimersByTime(1);
                expect(
                    state().jobs.map((job) => {
                        return job.chapterId;
                    })
                ).toEqual([2]);
            } finally {
                vi.useRealTimers();
            }
        });

        it('keeps a chapter that is tried again while its finished job was waiting to leave', () => {
            vi.useFakeTimers();
            try {
                mock.emitMangaJob(makeMangaJob({ chapterId: 1, status: 'done', percent: 100 }));
                mock.emitMangaJob(makeMangaJob({ chapterId: 1, status: 'running', percent: 20 }));
                vi.advanceTimersByTime(DONE_JOB_LINGER_MS);
                expect(
                    state().jobs.map((job) => {
                        return [job.chapterId, job.status, job.percent];
                    })
                ).toEqual([[1, 'running', 20]]);
            } finally {
                vi.useRealTimers();
            }
        });

        it('reads the library again when it changes', async () => {
            mock.emitMangaLibraryChanged();
            await vi.waitFor(() => {
                expect(mock.api.manga.library).toHaveBeenCalledTimes(1);
            });
        });

        it('follows the migration of the folder as it goes', () => {
            mock.emitMangaMigration({ done: 2, total: 9 });
            expect(state().migration).toEqual({ done: 2, total: 9 });
        });

        it('says how many chapters the hourly check added, and to which mangas', () => {
            mock.emitMangaNewChapters({ count: 3, titles: ['One Piece', 'Bleach'] });
            expect(toasts()).toEqual(['3 new chapter(s) added to the library: One Piece, Bleach']);
        });
    });
});

describe('mangaStore the site, the folder and the downloads that failed', () => {
    it('opens the page of a manga on its site', async () => {
        await state().openSite('https://dex.example/one-piece');
        expect(mock.api.manga.openSite).toHaveBeenCalledWith('https://dex.example/one-piece');
    });

    it('moves the chapters to a folder, shows the progress while it goes and says how it ended', async () => {
        let finish: (value: unknown) => void = () => {return undefined};
        mock.api.manga.migrateFolder.mockReturnValue(
            new Promise((resolve) => {
                finish = resolve;
            })
        );
        const pending = state().migrateFolder();
        expect(state().migration).toEqual({ done: 0, total: 0 });
        finish({ ok: true, chapters: 4, files: 4, destination: '/mnt/manga' });
        await expect(pending).resolves.toEqual({ ok: true, chapters: 4, files: 4, destination: '/mnt/manga' });
        expect(state().migration).toBeNull();
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: '4 chapter(s) moved to /mnt/manga.' });
    });

    it.each([
        ['busy', 'Chapters are being downloaded or the folder is being moved. Try again when that is done.'],
        ['same', 'That is the folder the mangas are in already.'],
        ['inside', 'The new folder cannot be inside the current one.'],
        ['conflict', 'The new folder already has files with the names of some chapters. Nothing was moved.'],
        ['failed', 'The chapters could not be moved. Nothing changed.']
    ] as const)('says why the migration did not happen (%s)', async (reason, message) => {
        mock.api.manga.migrateFolder.mockResolvedValue({ ok: false, reason });
        await expect(state().migrateFolder()).resolves.toEqual({ ok: false, reason });
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message });
        expect(state().migration).toBeNull();
    });

    it('says nothing when the user gave up choosing a folder', async () => {
        mock.api.manga.migrateFolder.mockResolvedValue({ ok: false, reason: 'cancelled' });
        await state().migrateFolder();
        expect(useAppStore.getState().notice).toBeNull();
        expect(state().migration).toBeNull();
    });

    it('takes the progress away even when the migration throws', async () => {
        mock.api.manga.migrateFolder.mockRejectedValue(new Error('boom'));
        await expect(state().migrateFolder()).rejects.toThrow('boom');
        expect(state().migration).toBeNull();
    });

    it('tries again every download that failed or was cancelled, and none of the others', async () => {
        useMangaStore.setState({
            jobs: [
                makeMangaJob({ chapterId: 1, status: 'error' }),
                makeMangaJob({ chapterId: 2, status: 'cancelled' }),
                makeMangaJob({ chapterId: 3, status: 'running' }),
                makeMangaJob({ chapterId: 4, status: 'queued' }),
                makeMangaJob({ chapterId: 5, status: 'paused' })
            ]
        });
        await state().retryFailedJobs();
        expect(mock.api.manga.retry.mock.calls).toEqual([[1], [2]]);
    });

    it('does nothing when no download failed', async () => {
        useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 3, status: 'running' })] });
        await state().retryFailedJobs();
        expect(mock.api.manga.retry).not.toHaveBeenCalled();
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

        describe('downloading one chapter', () => {
            it('sends only that chapter with the manga it belongs to, tells so and reads the library', async () => {
                mock.api.manga.download.mockResolvedValue(makeLibraryManga([]));
                await state().downloadChapter(12);
                expect(mock.api.manga.download).toHaveBeenCalledTimes(1);
                expect(mock.api.manga.download).toHaveBeenCalledWith({ manga: makeSummary(), details: makeDetails(), chapters: [chapters[1]] });
                expect(toasts()).toEqual(['1 chapter(s) queued.']);
                expect(mock.api.manga.library).toHaveBeenCalled();
            });

            it('does not touch the chapters that were picked', async () => {
                mock.api.manga.download.mockResolvedValue(makeLibraryManga([]));
                state().toggleChapter(11);
                await state().downloadChapter(13);
                expect(state().selection?.selected).toEqual([11]);
                expect(mock.api.manga.download).toHaveBeenCalledWith(expect.objectContaining({ chapters: [chapters[2]] }));
            });

            it('says nothing when the source gave nothing back', async () => {
                mock.api.manga.download.mockResolvedValue(null);
                await state().downloadChapter(11);
                expect(toasts()).toEqual([]);
                expect(mock.api.manga.library).toHaveBeenCalled();
            });

            it.each(['done', 'queued', 'downloading', 'paused'] as const)('does nothing for a chapter that is %s', async (status) => {
                useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ remoteId: 11, status })])] });
                await state().downloadChapter(11);
                expect(mock.api.manga.download).not.toHaveBeenCalled();
            });

            it.each(['idle', 'error', 'cancelled'] as const)('sends a chapter that is %s', async (status) => {
                mock.api.manga.download.mockResolvedValue(makeLibraryManga([]));
                useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ remoteId: 11, status })])] });
                await state().downloadChapter(11);
                expect(mock.api.manga.download).toHaveBeenCalledWith(expect.objectContaining({ chapters: [chapters[0]] }));
            });

            it('does nothing for a chapter the manga does not have', async () => {
                await state().downloadChapter(999);
                expect(mock.api.manga.download).not.toHaveBeenCalled();
            });

            it('does nothing without an open manga, or while it is not ready', async () => {
                useMangaStore.setState({ selection: { manga: makeSummary(), status: 'loading', details: null, chapters: [], selected: [], error: null } });
                await state().downloadChapter(11);
                state().closeManga();
                await state().downloadChapter(11);
                expect(mock.api.manga.download).not.toHaveBeenCalled();
            });
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

        it('sends and counts only the chapters picked that a download does something for', async () => {
            mock.api.manga.download.mockResolvedValue(makeLibraryManga([]));
            useMangaStore.setState({
                library: [
                    makeLibraryManga([
                        makeChapterRecord({ id: 1, remoteId: 11, status: 'done' }),
                        makeChapterRecord({ id: 2, remoteId: 12, status: 'downloading' }),
                        makeChapterRecord({ id: 3, remoteId: 13, status: 'error' })
                    ])
                ]
            });
            state().selectChapters('all');
            await state().downloadSelected();
            expect(mock.api.manga.download).toHaveBeenCalledWith({ manga: makeSummary(), details: makeDetails(), chapters: [chapters[2]] });
            expect(toasts()).toEqual(['1 chapter(s) queued.']);
        });

        it('downloads nothing when every chapter picked is downloaded already', async () => {
            useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 11, status: 'done' })])] });
            state().toggleChapter(11);
            await state().downloadSelected();
            expect(mock.api.manga.download).not.toHaveBeenCalled();
            expect(toasts()).toEqual([]);
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

    it('goes to the library and opens the manga there, as a page of the library', async () => {
        mock.api.manga.details.mockResolvedValue({ ok: true, value: { details: makeDetails(), chapters: [makeChapter()] } });
        useMangaStore.setState({ view: 'browse', selectionFrom: 'browse', selection: { manga: makeSummary(), status: 'ready', details: null, chapters: [], selected: [], error: null } });
        await state().showInLibrary();
        expect(state().view).toBe('library');
        expect(state().selectionFrom).toBe('library');
        expect(state().selection).toMatchObject({ manga: makeSummary(), status: 'ready', chapters: [makeChapter()] });
        expect(mock.api.manga.details).toHaveBeenCalledWith(7);
    });

    it('does nothing to go to the library, or to the source, with no manga open', async () => {
        await state().showInLibrary();
        await state().showInSource();
        await state().searchByTerm('Action');
        expect(state().view).toBe('browse');
        expect(mock.api.manga.details).not.toHaveBeenCalled();
        expect(mock.api.manga.list).not.toHaveBeenCalled();
    });

    it('goes to the source of the manga and opens it there, as a page of the browse', async () => {
        mock.api.manga.details.mockResolvedValue({ ok: true, value: { details: makeDetails(), chapters: [] } });
        useMangaStore.setState({ view: 'library', selectionFrom: 'library', selection: { manga: makeSummary({ sourceId: '55' }), status: 'ready', details: null, chapters: [], selected: [], error: null } });
        await state().showInSource();
        expect(state().view).toBe('browse');
        expect(state().selectionFrom).toBe('browse');
        expect(state().browse).toMatchObject({ sourceId: '55', mode: 'popular' });
        expect(state().selection?.status).toBe('ready');
    });

    it('does not search by a term that is empty', async () => {
        useMangaStore.setState({ selection: { manga: makeSummary(), status: 'ready', details: null, chapters: [], selected: [], error: null } });
        await state().searchByTerm('   ');
        expect(mock.api.manga.sourceFilters).not.toHaveBeenCalled();
        expect(state().selection).not.toBeNull();
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
        await state().removeDownload(9);
        expect(mock.api.manga.removeDownload).toHaveBeenCalledWith(9);
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

    it('pauses and resumes every download at once', async () => {
        await state().pauseAllJobs();
        expect(mock.api.manga.pauseAll).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.resumeAll).not.toHaveBeenCalled();
        await state().resumeAllJobs();
        expect(mock.api.manga.resumeAll).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.pauseAll).toHaveBeenCalledTimes(1);
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
        expect(state().reader).toEqual({ status: 'loading', mangaTitle: 'One Piece', chapters: CHAPTERS, index: 1, pages: [], local: false, error: null, manga: null, resume: false });
        await opening;
        expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 2, libraryChapterId: 8 });
        expect(state().reader).toEqual({ status: 'ready', mangaTitle: 'One Piece', chapters: CHAPTERS, index: 1, pages: ['pullwave-manga://page/8/0'], local: true, error: null, manga: null, resume: false });
    });

    it('says that a chapter was opened to be continued, while it loads and when it is ready, and not for the ones that follow', async () => {
        mock.api.manga.readPages.mockResolvedValue({ ok: true, value: { pages: ['pullwave-manga://page/8/0'], local: true } });
        const opening = state().openReader('One Piece', CHAPTERS, 1, true);
        expect(state().reader).toMatchObject({ status: 'loading', index: 1, resume: true });
        await opening;
        expect(state().reader).toMatchObject({ status: 'ready', index: 1, resume: true });
        await state().goToChapter(1);
        expect(state().reader).toMatchObject({ status: 'ready', index: 2, resume: false });
        await state().goToChapterIndex(0);
        expect(state().reader).toMatchObject({ status: 'ready', index: 0, resume: false });
    });

    describe('chapters reached by scrolling through the zone between chapters', () => {
        beforeEach(async () => {
            mock.api.manga.readPages.mockResolvedValue({ ok: true, value: { pages: ['pullwave-manga://page/8/0'], local: true } });
            await state().openReader('One Piece', CHAPTERS, 1);
        });

        it('opens the next one at its start, while it loads and when it is ready', async () => {
            const going = state().goToChapter(1, true);
            expect(state().reader).toMatchObject({ status: 'loading', index: 2, entry: 'start', resume: false });
            await expect(going).resolves.toBe(true);
            expect(state().reader).toMatchObject({ status: 'ready', index: 2, entry: 'start', resume: false });
        });

        it('opens the previous one at its end', async () => {
            await expect(state().goToChapter(-1, true)).resolves.toBe(true);
            expect(state().reader).toMatchObject({ status: 'ready', index: 0, entry: 'end', resume: false });
        });

        it('says nothing about where a chapter starts when it is not reached by scrolling', async () => {
            await state().goToChapter(1);
            expect(state().reader.entry).toBeUndefined();
            await state().goToChapter(-1, false);
            expect(state().reader.entry).toBeUndefined();
            await state().goToChapterIndex(0);
            expect(state().reader.entry).toBeUndefined();
        });

        it('forgets the way it came in when a chapter is opened from the list', async () => {
            await state().goToChapter(1, true);
            expect(state().reader.entry).toBe('start');
            await state().openReader('One Piece', CHAPTERS, 0);
            expect(state().reader.entry).toBeUndefined();
        });

        it('does not go past the first or the last chapter', async () => {
            await state().goToChapter(1, true);
            await expect(state().goToChapter(1, true)).resolves.toBe(false);
            expect(state().reader).toMatchObject({ index: 2, entry: 'start' });
            await state().openReader('One Piece', CHAPTERS, 0);
            await expect(state().goToChapter(-1, true)).resolves.toBe(false);
            expect(state().reader.index).toBe(0);
        });

        it('asks the source for the chapter it goes to', async () => {
            mock.api.manga.readPages.mockClear();
            await state().goToChapter(1, true);
            expect(mock.api.manga.readPages).toHaveBeenCalledTimes(1);
            expect(mock.api.manga.readPages).toHaveBeenCalledWith({ chapterRemoteId: 3, libraryChapterId: null });
        });
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
        await expect(state().goToChapterIndex(1)).resolves.toBe(false);
        expect(mock.api.manga.readPages).not.toHaveBeenCalled();
    });

    it('jumps to the chapter at a place of the list, forward or back, and says there is none outside of it', async () => {
        mock.api.manga.readPages.mockResolvedValue({ ok: true, value: { pages: ['a'], local: false } });
        await state().openReader('One Piece', CHAPTERS, 1);
        await expect(state().goToChapterIndex(0)).resolves.toBe(true);
        expect(state().reader.index).toBe(0);
        expect(mock.api.manga.readPages).toHaveBeenLastCalledWith({ chapterRemoteId: 1, libraryChapterId: null });
        await expect(state().goToChapterIndex(2)).resolves.toBe(true);
        expect(state().reader).toMatchObject({ index: 2, status: 'ready', pages: ['a'] });
        expect(mock.api.manga.readPages).toHaveBeenLastCalledWith({ chapterRemoteId: 3, libraryChapterId: null });
        await expect(state().goToChapterIndex(3)).resolves.toBe(false);
        await expect(state().goToChapterIndex(-1)).resolves.toBe(false);
        expect(state().reader.index).toBe(2);
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

describe('mangaStore series, groups and the move to another source', () => {
    const GROUPS = [{ id: 1, name: 'Mangas' }, { id: 2, name: 'Manhwas' }];

    it('reads the groups with the library, and drops the group the library was limited to when it is gone', async () => {
        mock.api.manga.library.mockResolvedValue([makeLibraryManga([])]);
        mock.api.manga.groups.mockResolvedValue(GROUPS);
        await state().refreshLibrary();
        expect(state().groups).toEqual(GROUPS);
        useMangaStore.setState({ libraryGroup: 2 });
        await state().refreshLibrary();
        expect(state().libraryGroup).toBe(2);
        mock.api.manga.groups.mockResolvedValue([GROUPS[0]!]);
        await state().refreshLibrary();
        expect(state().libraryGroup).toBeNull();
    });

    it('starts with no group hidden', () => {
        expect(state().hiddenGroupIds).toEqual([]);
    });

    it('hides a group once, in the order they are hidden, and shows it again', () => {
        useMangaStore.setState({ hiddenGroupIds: [] });
        state().hideGroup(2);
        state().hideGroup(1);
        state().hideGroup(2);
        expect(state().hiddenGroupIds).toEqual([2, 1]);
        state().showGroup(2);
        expect(state().hiddenGroupIds).toEqual([1]);
        state().showGroup(2);
        expect(state().hiddenGroupIds).toEqual([1]);
        state().showGroup(1);
        expect(state().hiddenGroupIds).toEqual([]);
    });

    it('goes back to the tab of all when the group the library is limited to is hidden, and keeps the tab otherwise', () => {
        useMangaStore.setState({ hiddenGroupIds: [], libraryGroup: 2 });
        state().hideGroup(1);
        expect(state().libraryGroup).toBe(2);
        state().hideGroup(2);
        expect(state().libraryGroup).toBeNull();
        expect(state().hiddenGroupIds).toEqual([1, 2]);
    });

    it('does not save the hidden groups: nothing is written for them', () => {
        window.localStorage.clear();
        state().hideGroup(1);
        expect(window.localStorage.length).toBe(0);
        expect(mock.api.manga.deleteGroup).not.toHaveBeenCalled();
    });

    it('reads the groups on their own, with the same care', async () => {
        useMangaStore.setState({ libraryGroup: 2 });
        mock.api.manga.groups.mockResolvedValue([GROUPS[0]!]);
        await state().refreshGroups();
        expect(state().groups).toEqual([GROUPS[0]]);
        expect(state().libraryGroup).toBeNull();
        useMangaStore.setState({ libraryGroup: 1 });
        await state().refreshGroups();
        expect(state().libraryGroup).toBe(1);
    });

    it('reads the groups when it starts', async () => {
        mock.api.manga.status.mockResolvedValue(makeMangaStatus());
        mock.api.manga.groups.mockResolvedValue(GROUPS);
        const unsubscribe = await state().init();
        expect(state().groups).toEqual(GROUPS);
        unsubscribe();
    });

    it('opens and closes a series, and limits the library to a group, which closes the series', () => {
        state().openSeries('series-frieren');
        expect(state().librarySeries).toBe('series-frieren');
        state().closeSeries();
        expect(state().librarySeries).toBeNull();
        state().openSeries('series-frieren');
        state().setLibraryGroup(2);
        expect(state()).toMatchObject({ libraryGroup: 2, librarySeries: null });
        state().setLibraryGroup(null);
        expect(state().libraryGroup).toBeNull();
    });

    it('joins a manga to a series and reads the library again, only when it worked', async () => {
        const request = { mangaId: 3, series: 'Frieren', season: 2, seasonName: null };
        await expect(state().setSeries(request)).resolves.toEqual({ ok: true });
        expect(mock.api.manga.setSeries).toHaveBeenCalledWith(request);
        expect(mock.api.manga.library).toHaveBeenCalledTimes(1);
        mock.api.manga.setSeries.mockResolvedValue({ ok: false, reason: 'season-taken', suggested: 3 });
        await expect(state().setSeries(request)).resolves.toEqual({ ok: false, reason: 'season-taken', suggested: 3 });
        expect(mock.api.manga.library).toHaveBeenCalledTimes(1);
    });

    it('renames a series and reads the library again, only when it worked', async () => {
        await expect(state().renameSeries([1, 2], 'Sousou')).resolves.toEqual({ ok: true });
        expect(mock.api.manga.renameSeries).toHaveBeenCalledWith([1, 2], 'Sousou');
        expect(mock.api.manga.library).toHaveBeenCalledTimes(1);
        mock.api.manga.renameSeries.mockResolvedValue({ ok: false, reason: 'invalid' });
        await state().renameSeries([1], 'x');
        expect(mock.api.manga.library).toHaveBeenCalledTimes(1);
    });

    it('makes and renames groups and reads them again, only when it worked', async () => {
        mock.api.manga.groups.mockResolvedValue(GROUPS);
        await expect(state().createGroup('Mangas')).resolves.toEqual({ ok: true, group: { id: 1, name: 'Mangas' } });
        expect(state().groups).toEqual(GROUPS);
        await expect(state().renameGroup(1, 'Shonen')).resolves.toEqual({ ok: true, group: { id: 1, name: 'Shonen' } });
        expect(mock.api.manga.renameGroup).toHaveBeenCalledWith(1, 'Shonen');
        expect(mock.api.manga.groups).toHaveBeenCalledTimes(2);
        mock.api.manga.createGroup.mockResolvedValue({ ok: false, reason: 'taken' });
        mock.api.manga.renameGroup.mockResolvedValue({ ok: false, reason: 'taken' });
        await expect(state().createGroup('Mangas')).resolves.toEqual({ ok: false, reason: 'taken' });
        await expect(state().renameGroup(1, 'x')).resolves.toEqual({ ok: false, reason: 'taken' });
        expect(mock.api.manga.groups).toHaveBeenCalledTimes(2);
    });

    it('deletes a group and puts mangas in one or takes them out, reading the library after each', async () => {
        await state().deleteGroup(2);
        expect(mock.api.manga.deleteGroup).toHaveBeenCalledWith(2);
        await state().setGroupMembers(1, [4, 5], true);
        expect(mock.api.manga.setGroupMembers).toHaveBeenCalledWith(1, [4, 5], true);
        await state().setGroupMembers(1, [4], false);
        expect(mock.api.manga.setGroupMembers).toHaveBeenLastCalledWith(1, [4], false);
        expect(mock.api.manga.library).toHaveBeenCalledTimes(3);
    });

    it('moves a group up or down, and reads the groups again to show the new order', async () => {
        mock.api.manga.groups.mockResolvedValue([GROUPS[1]!, GROUPS[0]!]);
        await state().moveGroup(2, 'up');
        expect(mock.api.manga.moveGroup).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.moveGroup).toHaveBeenCalledWith(2, 'up');
        expect(state().groups).toEqual([GROUPS[1], GROUPS[0]]);
        mock.api.manga.groups.mockResolvedValue([GROUPS[0]!, GROUPS[1]!]);
        await state().moveGroup(2, 'down');
        expect(mock.api.manga.moveGroup).toHaveBeenLastCalledWith(2, 'down');
        expect(state().groups).toEqual([GROUPS[0], GROUPS[1]]);
        expect(mock.api.manga.groups).toHaveBeenCalledTimes(2);
    });

    describe('moving a manga to another source', () => {
        const REQUEST = { mangaId: 3, target: { manga: makeSummary({ remoteId: 70, sourceId: '999' }), details: null, chapters: [makeChapter()] } };

        it('reads the library, opens the manga of the new source and says what happened', async () => {
            const moved = makeLibraryManga([], { id: 3, sourceId: '999', remoteId: 70 });
            mock.api.manga.migrateSource.mockResolvedValue({ ok: true, manga: moved, matched: 4, added: 2, dropped: 1 });
            mock.api.manga.details.mockResolvedValue({ ok: true, value: { details: makeDetails({ remoteId: 70, sourceId: '999' }), chapters: [makeChapter()] } });
            useMangaStore.setState({ selection: { manga: makeSummary(), status: 'ready', details: null, chapters: [], selected: [], error: null } });
            await expect(state().migrateSource(REQUEST)).resolves.toMatchObject({ ok: true, matched: 4, added: 2, dropped: 1 });
            expect(mock.api.manga.migrateSource).toHaveBeenCalledWith(REQUEST);
            expect(mock.api.manga.library).toHaveBeenCalledTimes(1);
            expect(mock.api.manga.details).toHaveBeenCalledWith(70);
            expect(state().selection).toMatchObject({ manga: { remoteId: 70, sourceId: '999' }, status: 'ready' });
            expect(toasts()).toEqual(['Migrated: 4 chapter(s) matched, 2 added, 1 removed.']);
        });

        it('changes nothing on the screen when it did not happen', async () => {
            mock.api.manga.migrateSource.mockResolvedValue({ ok: false, reason: 'exists' });
            useMangaStore.setState({ selection: { manga: makeSummary(), status: 'ready', details: null, chapters: [], selected: [], error: null } });
            await expect(state().migrateSource(REQUEST)).resolves.toEqual({ ok: false, reason: 'exists' });
            expect(mock.api.manga.library).not.toHaveBeenCalled();
            expect(state().selection?.manga.remoteId).toBe(7);
            expect(toasts()).toEqual([]);
        });
    });
});

describe('mangaStore chapters read', () => {
    beforeEach(() => {
        useMangaStore.setState({ readKeys: [] });
    });

    it('marks chapters as read, once each, and keeps them', () => {
        state().markRead(['One Piece|11', 'One Piece|12'], true);
        state().markRead(['One Piece|12', 'Bleach|1'], true);
        expect(state().readKeys).toEqual(['One Piece|11', 'One Piece|12', 'Bleach|1']);
        expect(JSON.parse(window.localStorage.getItem('pullwave.manga.read') ?? '[]')).toEqual(['One Piece|11', 'One Piece|12', 'Bleach|1']);
    });

    it('marks chapters as not read, leaving the others', () => {
        state().markRead(['a|1', 'a|2', 'a|3'], true);
        state().markRead(['a|2', 'a|9'], false);
        expect(state().readKeys).toEqual(['a|1', 'a|3']);
        expect(JSON.parse(window.localStorage.getItem('pullwave.manga.read') ?? '[]')).toEqual(['a|1', 'a|3']);
    });

    it('starts from what was kept', async () => {
        window.localStorage.setItem('pullwave.manga.read', JSON.stringify(['a|1']));
        vi.resetModules();
        const fresh = (await import('@renderer/store/mangaStore')).useMangaStore.getState();
        expect(fresh.readKeys).toEqual(['a|1']);
    });
});


const VERSIONS = {
    suwayomi: { current: 'v1.0.0', latest: 'v2.0.0', error: null, updatable: true, chosen: false, bundled: 'v1.0.0', restartNeeded: false },
    flaresolverr: { current: 'v3.5.2', latest: 'v3.6.0', error: null, updatable: true }
};

describe('mangaStore updates of the programs', () => {
    it('starts with nothing looked for', () => {
        expect(state().toolVersions).toBeNull();
        expect(state().toolsChecking).toBe(false);
        expect(state().serverUpdate).toBeNull();
        expect(state().updateResults).toEqual({ server: null, helper: null });
        expect(state().updating).toEqual({ server: false, helper: false });
    });

    it('looks for the latest versions and keeps them, saying it is looking meanwhile', async () => {
        let answer: (versions: typeof VERSIONS) => void = () => {
            return undefined;
        };
        mock.api.manga.checkToolUpdates.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const pending = state().checkToolUpdates();
        expect(state().toolsChecking).toBe(true);
        answer(VERSIONS);
        await pending;
        expect(state().toolsChecking).toBe(false);
        expect(state().toolVersions).toEqual(VERSIONS);
        expect(mock.api.manga.checkToolUpdates).toHaveBeenCalledTimes(1);
    });

    it('stops saying it is looking when the lookup throws', async () => {
        mock.api.manga.checkToolUpdates.mockRejectedValue(new Error('ipc'));
        await expect(state().checkToolUpdates()).rejects.toThrow('ipc');
        expect(state().toolsChecking).toBe(false);
        expect(state().toolVersions).toBeNull();
    });

    it('updates the server, keeps the answer, forgets the old download and looks at the versions again', async () => {
        useMangaStore.setState({ serverUpdate: makeTool({ status: 'ready' }), updateResults: { server: { ok: false, reason: 'failed', message: 'old' }, helper: null } });
        let answer: (result: { ok: true; version: string }) => void = () => {
            return undefined;
        };
        mock.api.manga.updateServer.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        mock.api.manga.checkToolUpdates.mockResolvedValue({ ...VERSIONS, suwayomi: { ...VERSIONS.suwayomi, updatable: false, restartNeeded: true } });
        const pending = state().updateServer();
        expect(state().updating).toEqual({ server: true, helper: false });
        expect(state().updateResults.server).toBeNull();
        expect(state().serverUpdate).toBeNull();
        answer({ ok: true, version: 'v2.0.0' });
        await pending;
        expect(state().updating).toEqual({ server: false, helper: false });
        expect(state().updateResults.server).toEqual({ ok: true, version: 'v2.0.0' });
        expect(mock.api.manga.checkToolUpdates).toHaveBeenCalledTimes(1);
        expect(state().toolVersions?.suwayomi.restartNeeded).toBe(true);
    });

    it('keeps why an update of the server failed', async () => {
        mock.api.manga.updateServer.mockResolvedValue({ ok: false, reason: 'failed', message: 'hash' });
        await state().updateServer();
        expect(state().updateResults.server).toEqual({ ok: false, reason: 'failed', message: 'hash' });
    });

    it('goes back to the version of the app, forgets the answer and looks at the versions again', async () => {
        useMangaStore.setState({ updateResults: { server: { ok: true, version: 'v2.0.0' }, helper: null } });
        await state().resetServerVersion();
        expect(mock.api.manga.resetServerVersion).toHaveBeenCalledTimes(1);
        expect(state().updateResults.server).toBeNull();
        expect(mock.api.manga.checkToolUpdates).toHaveBeenCalledTimes(1);
    });

    it('updates the helper, keeps the answer, looks at the versions and reads the status again', async () => {
        mock.api.manga.updateHelper.mockResolvedValue({ ok: true, version: 'v3.6.0' });
        mock.api.manga.status.mockResolvedValue(makeMangaStatus());
        const pending = state().updateHelper();
        expect(state().updating).toEqual({ server: false, helper: true });
        await pending;
        expect(state().updating).toEqual({ server: false, helper: false });
        expect(state().updateResults.helper).toEqual({ ok: true, version: 'v3.6.0' });
        expect(mock.api.manga.checkToolUpdates).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.status).toHaveBeenCalledTimes(1);
    });

    it('asks the main process to restart the app', async () => {
        await state().restartApp();
        expect(mock.api.manga.restartApp).toHaveBeenCalledTimes(1);
    });
});

describe('mangaStore health of the programs', () => {
    it('starts with nothing known', () => {
        expect(state().health).toBeNull();
        expect(state().healthChecking).toBe(false);
    });

    it('looks without starting anything, and keeps what it finds', async () => {
        const health = { server: { state: 'stopped' as const, version: null, message: null, external: false }, helper: null };
        mock.api.manga.health.mockResolvedValue(health);
        const pending = state().checkHealth(false);
        expect(state().healthChecking).toBe(true);
        await pending;
        expect(state().healthChecking).toBe(false);
        expect(state().health).toEqual(health);
        expect(mock.api.manga.health).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.health).toHaveBeenCalledWith(false);
    });

    it('asks to start what is stopped when the user checks', async () => {
        await state().checkHealth(true);
        expect(mock.api.manga.health).toHaveBeenCalledWith(true);
        expect(state().health).toEqual({ server: { state: 'healthy', version: 'v1.0.0', message: null, external: false }, helper: null });
    });

    it('stops saying it is checking when the check throws', async () => {
        mock.api.manga.health.mockRejectedValue(new Error('ipc'));
        await expect(state().checkHealth(true)).rejects.toThrow('ipc');
        expect(state().healthChecking).toBe(false);
    });
});

describe('mangaStore opening a manga of the library', () => {
    const saved = makeLibraryManga(
        [makeChapterRecord({ id: 1, remoteId: 11, name: 'Romance Dawn', number: 1, sourceOrder: 1, dateUploaded: 1700000000000, scanlator: 'Group A' }), makeChapterRecord({ id: 2, remoteId: 12, name: 'Second', number: 2, sourceOrder: 2, dateUploaded: null, scanlator: null })],
        { author: 'Oda', artist: 'Oda E.', description: 'Saved description', genres: ['Action'], status: 'ongoing', url: 'https://dex.example/m/1', thumbnailUrl: 'pullwave-manga://cover/1?v=abcdef123456' }
    );
    const fresh = [makeChapter({ remoteId: 11 }), makeChapter({ remoteId: 12, name: 'Second', number: 2 }), makeChapter({ remoteId: 13, name: 'Third', number: 3 })];

    beforeEach(() => {
        useMangaStore.setState({ view: 'library', library: [saved] });
    });

    function pending() {
        let answer: (value: unknown) => void = () => {
            return undefined;
        };
        mock.api.manga.details.mockReturnValueOnce(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        return (value: unknown) => {
            answer(value);
        };
    }

    it('opens at once with what the library has, and looks at the source in the background', async () => {
        const answer = pending();
        const opening = state().openManga(makeSummary());
        expect(state().selection).toEqual({
            manga: makeSummary(),
            status: 'ready',
            details: {
                remoteId: 7,
                sourceId: '123',
                title: 'One Piece',
                thumbnailUrl: 'pullwave-manga://cover/1?v=abcdef123456',
                url: 'https://dex.example/m/1',
                author: 'Oda',
                artist: 'Oda E.',
                description: 'Saved description',
                genres: ['Action'],
                status: 'ongoing'
            },
            chapters: [
                { remoteId: 11, name: 'Romance Dawn', number: 1, dateUploaded: 1700000000000, scanlator: 'Group A', sourceOrder: 1 },
                { remoteId: 12, name: 'Second', number: 2, dateUploaded: null, scanlator: null, sourceOrder: 2 }
            ],
            selected: [],
            error: null
        });
        expect(state().selectionFrom).toBe('library');
        expect(state().selectionRefresh).toEqual({ loading: true, error: null });
        answer({ ok: true, value: { details: makeDetails(), chapters: fresh } });
        await opening;
        expect(mock.api.manga.details).toHaveBeenCalledWith(7);
    });

    it('takes what the source says when it answers, and stops saying it is looking', async () => {
        mock.api.manga.details.mockResolvedValue({ ok: true, value: { details: makeDetails({ description: 'From the source' }), chapters: fresh } });
        await state().openManga(makeSummary());
        expect(state().selection).toMatchObject({ status: 'ready', details: makeDetails({ description: 'From the source' }), chapters: fresh, error: null });
        expect(state().selectionRefresh).toEqual({ loading: false, error: null });
    });

    it('keeps the page as it is when the source cannot be reached, and says why apart from the page', async () => {
        mock.api.manga.details.mockResolvedValue({ ok: false, error: FAILURE });
        await state().openManga(makeSummary());
        expect(state().selection).toMatchObject({ status: 'ready', error: null, chapters: [expect.objectContaining({ remoteId: 11 }), expect.objectContaining({ remoteId: 12 })] });
        expect(state().selection?.details?.description).toBe('Saved description');
        expect(state().selectionRefresh).toEqual({ loading: false, error: FAILURE });
    });

    it('forgets the failure of the last manga when another is opened, and when the page is closed', async () => {
        mock.api.manga.details.mockResolvedValue({ ok: false, error: FAILURE });
        await state().openManga(makeSummary());
        const answer = pending();
        const opening = state().openManga(makeSummary());
        expect(state().selectionRefresh).toEqual({ loading: true, error: null });
        answer({ ok: false, error: FAILURE });
        await opening;
        state().closeManga();
        expect(state().selectionRefresh).toEqual({ loading: false, error: null });
        expect(state().selection).toBeNull();
    });

    it('drops the answer of the source when another manga was opened or the page was closed meanwhile', async () => {
        const answer = pending();
        const opening = state().openManga(makeSummary());
        state().closeManga();
        answer({ ok: true, value: { details: makeDetails(), chapters: fresh } });
        await opening;
        expect(state().selection).toBeNull();
        expect(state().selectionRefresh).toEqual({ loading: false, error: null });
    });

    it('still waits for the source when the manga is not in the library', async () => {
        useMangaStore.setState({ library: [] });
        const answer = pending();
        const opening = state().openManga(makeSummary());
        expect(state().selection).toMatchObject({ status: 'loading', details: null, chapters: [] });
        expect(state().selectionRefresh).toEqual({ loading: false, error: null });
        answer({ ok: false, error: FAILURE });
        await opening;
        expect(state().selection).toMatchObject({ status: 'error', error: FAILURE });
        expect(state().selectionRefresh).toEqual({ loading: false, error: null });
    });

    it('still waits for the source when the manga is opened from the browse, even if it is in the library', async () => {
        useMangaStore.setState({ view: 'browse' });
        const answer = pending();
        const opening = state().openManga(makeSummary());
        expect(state().selection).toMatchObject({ status: 'loading', details: null });
        answer({ ok: false, error: FAILURE });
        await opening;
        expect(state().selection).toMatchObject({ status: 'error', error: FAILURE });
    });
});

describe('mangaStore the list of new chapters', () => {
    const ENTRY = { id: 1, mangaId: 9, mangaTitle: 'One Piece', thumbnailUrl: null, chapterId: 3, chapterRemoteId: 13, chapterName: 'Third', chapterNumber: 3, dateUploaded: null, foundAt: 1700000000000, origin: 'auto' as const, status: 'idle' as const };

    it('starts empty', () => {
        expect(state().updates).toEqual([]);
        expect(state().checkingNew).toBeNull();
    });

    it('reads the chapters that arrived', async () => {
        mock.api.manga.updates.mockResolvedValue([ENTRY]);
        await state().loadUpdates();
        expect(state().updates).toEqual([ENTRY]);
        expect(mock.api.manga.updates).toHaveBeenCalledTimes(1);
    });

    it('clears the list', async () => {
        useMangaStore.setState({ updates: [ENTRY] });
        await state().clearUpdates();
        expect(mock.api.manga.clearUpdates).toHaveBeenCalledTimes(1);
        expect(state().updates).toEqual([]);
    });

    it('opens the manga of an entry on its page in the library', async () => {
        const manga = makeLibraryManga([], { id: 9, title: 'One Piece', thumbnailUrl: 'pullwave-manga://cover/9?v=abc' });
        useMangaStore.setState({ library: [manga], view: 'updates', librarySeries: 'series-x' });
        mock.api.manga.details.mockResolvedValue({ ok: false, error: FAILURE });
        await state().openFromUpdate(ENTRY);
        expect(state().view).toBe('library');
        expect(state().librarySeries).toBeNull();
        expect(state().selectionFrom).toBe('library');
        expect(state().selection).toMatchObject({ manga: { remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: 'pullwave-manga://cover/9?v=abc' }, status: 'ready' });
        expect(mock.api.manga.details).toHaveBeenCalledWith(7);
    });

    it('does nothing for an entry whose manga is no longer in the library', async () => {
        useMangaStore.setState({ library: [], view: 'updates' });
        await state().openFromUpdate(ENTRY);
        expect(state().view).toBe('updates');
        expect(state().selection).toBeNull();
        expect(mock.api.manga.details).not.toHaveBeenCalled();
    });

    it('reads the list again when the library changes and the screen is the list', async () => {
        mock.api.manga.status.mockResolvedValue(makeMangaStatus());
        await state().init();
        mock.api.manga.updates.mockClear();
        mock.emitMangaLibraryChanged();
        await Promise.resolve();
        expect(mock.api.manga.updates).not.toHaveBeenCalled();
        useMangaStore.setState({ view: 'updates' });
        mock.emitMangaLibraryChanged();
        await vi.waitFor(() => {
            expect(mock.api.manga.updates).toHaveBeenCalledTimes(1);
        });
    });
});

describe('mangaStore looking for new chapters', () => {
    it('asks for all the mangas, says it is looking meanwhile, and reads the library after', async () => {
        let answer: (value: unknown) => void = () => {
            return undefined;
        };
        mock.api.manga.checkNewChapters.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const pending = state().checkNewChapters(null);
        expect(state().checkingNew).toBe('all');
        answer({ ok: true, count: 2, titles: ['One Piece'], failed: 0, skipped: 0 });
        await pending;
        expect(state().checkingNew).toBeNull();
        expect(mock.api.manga.checkNewChapters).toHaveBeenCalledWith(null);
        expect(mock.api.manga.library).toHaveBeenCalled();
        expect(toasts()).toEqual([]);
    });

    it('asks for one manga, and says it is that one that is being looked at', async () => {
        let answer: (value: unknown) => void = () => {
            return undefined;
        };
        mock.api.manga.checkNewChapters.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const pending = state().checkNewChapters(9);
        expect(state().checkingNew).toBe(9);
        answer({ ok: true, count: 1, titles: ['One Piece'], failed: 0, skipped: 0 });
        await pending;
        expect(mock.api.manga.checkNewChapters).toHaveBeenCalledWith(9);
    });

    it('says there is nothing new, or that some mangas could not be reached', async () => {
        mock.api.manga.checkNewChapters.mockResolvedValueOnce({ ok: true, count: 0, titles: [], failed: 0, skipped: 0 });
        await state().checkNewChapters(null);
        mock.api.manga.checkNewChapters.mockResolvedValueOnce({ ok: true, count: 0, titles: [], failed: 3, skipped: 0 });
        await state().checkNewChapters(null);
        expect(toasts()).toEqual(['No new chapters.', 'No new chapters. 3 manga(s) could not be reached.']);
    });

    it('says how many mangas were left out because the extension of their source is not installed, whether or not there is something new', async () => {
        mock.api.manga.checkNewChapters.mockResolvedValueOnce({ ok: true, count: 0, titles: [], failed: 0, skipped: 2 });
        await state().checkNewChapters(null);
        mock.api.manga.checkNewChapters.mockResolvedValueOnce({ ok: true, count: 3, titles: ['One Piece'], failed: 0, skipped: 1 });
        await state().checkNewChapters(null);
        mock.api.manga.checkNewChapters.mockResolvedValueOnce({ ok: true, count: 0, titles: [], failed: 1, skipped: 4 });
        await state().checkNewChapters(null);
        expect(toasts()).toEqual([
            'No new chapters.',
            '2 manga(s) were not looked at: the extension of their source is not installed.',
            '1 manga(s) were not looked at: the extension of their source is not installed.',
            'No new chapters. 1 manga(s) could not be reached.',
            '4 manga(s) were not looked at: the extension of their source is not installed.'
        ]);
    });

    it('says the manga was not looked at, when the check of one manga is skipped', async () => {
        mock.api.manga.checkNewChapters.mockResolvedValueOnce({ ok: true, count: 0, titles: [], failed: 0, skipped: 1 });
        await state().checkNewChapters(9);
        expect(toasts()).toEqual(['No new chapters.', '1 manga(s) were not looked at: the extension of their source is not installed.']);
    });

    it('says nothing about left out mangas when none was', async () => {
        mock.api.manga.checkNewChapters.mockResolvedValueOnce({ ok: true, count: 1, titles: ['One Piece'], failed: 0, skipped: 0 });
        await state().checkNewChapters(null);
        expect(toasts()).toEqual([]);
    });

    it('says why a check failed', async () => {
        mock.api.manga.checkNewChapters.mockResolvedValue({ ok: false, error: FAILURE });
        await state().checkNewChapters(9);
        expect(toasts()).toEqual(['Could not look for new chapters: site down']);
        expect(state().checkingNew).toBeNull();
    });

    it('stops saying it is looking when the check throws', async () => {
        mock.api.manga.checkNewChapters.mockRejectedValue(new Error('ipc'));
        await expect(state().checkNewChapters(null)).rejects.toThrow('ipc');
        expect(state().checkingNew).toBeNull();
    });

    it('reads the list again when it is the screen that is shown', async () => {
        useMangaStore.setState({ view: 'updates' });
        mock.api.manga.checkNewChapters.mockResolvedValue({ ok: true, count: 1, titles: ['One Piece'], failed: 0, skipped: 0 });
        await state().checkNewChapters(null);
        expect(mock.api.manga.updates).toHaveBeenCalledTimes(1);
    });
});

describe('mangaStore the history of reading', () => {
    const ENTRY = { id: 4, sourceId: '123', mangaRemoteId: 7, title: 'One Piece', thumbnailUrl: '/t', chapterRemoteId: 11, chapterName: 'Romance Dawn', chapterNumber: 1, page: 3, pageCount: 20, readAt: 1700000000000, libraryMangaId: null };

    it('starts empty, and reads the history', async () => {
        expect(state().history).toEqual([]);
        mock.api.manga.readingHistory.mockResolvedValue([ENTRY]);
        await state().loadHistory();
        expect(state().history).toEqual([ENTRY]);
    });

    it('removes a line, or all of them', async () => {
        useMangaStore.setState({ history: [ENTRY, { ...ENTRY, id: 5, title: 'Bleach' }] });
        await state().removeReading(4);
        expect(mock.api.manga.removeReading).toHaveBeenCalledWith(4);
        expect(state().history.map((entry) => {
            return entry.id;
        })).toEqual([5]);
        await state().clearReading();
        expect(mock.api.manga.clearReading).toHaveBeenCalledTimes(1);
        expect(state().history).toEqual([]);
    });

    it('opens a manga that is in the library on its page there, with the title and the cover of the library', async () => {
        const manga = makeLibraryManga([], { id: 9, title: 'One Piece (library)', thumbnailUrl: 'pullwave-manga://cover/9?v=abc' });
        useMangaStore.setState({ library: [manga], view: 'history' });
        mock.api.manga.details.mockResolvedValue({ ok: false, error: FAILURE });
        await state().openFromHistory({ ...ENTRY, libraryMangaId: 9 });
        expect(state().view).toBe('library');
        expect(state().selectionFrom).toBe('library');
        expect(state().selection?.manga).toEqual({ remoteId: 7, sourceId: '123', title: 'One Piece (library)', thumbnailUrl: 'pullwave-manga://cover/9?v=abc' });
        expect(state().selection?.status).toBe('ready');
    });

    it('opens a manga that is not in the library on its source, like one of the browse', async () => {
        useMangaStore.setState({ library: [], view: 'history' });
        mock.api.manga.details.mockResolvedValue({ ok: false, error: FAILURE });
        await state().openFromHistory(ENTRY);
        expect(state().view).toBe('browse');
        expect(state().selectionFrom).toBe('browse');
        expect(state().selection).toMatchObject({ manga: { remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: '/t' }, status: 'error', error: FAILURE });
    });

    it('opens as a manga of the browse when the line says it is in the library but the library does not have it any more', async () => {
        useMangaStore.setState({ library: [], view: 'history' });
        mock.api.manga.details.mockResolvedValue({ ok: false, error: FAILURE });
        await state().openFromHistory({ ...ENTRY, libraryMangaId: 9 });
        expect(state().view).toBe('browse');
    });

    it('writes where the user is', async () => {
        const record = { sourceId: '123', mangaRemoteId: 7, title: 'One Piece', thumbnailUrl: null, chapterRemoteId: 11, chapterName: 'Romance Dawn', chapterNumber: 1, page: 3, pageCount: 20 };
        await state().recordReading(record);
        expect(mock.api.manga.recordReading).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.recordReading).toHaveBeenCalledWith(record);
    });

    it('remembers the manga that is open when the reader opens, and keeps it when it goes to another chapter', async () => {
        const open = makeSummary();
        useMangaStore.setState({ selection: { manga: open, status: 'ready', details: makeDetails(), chapters: [], selected: [], error: null } });
        mock.api.manga.readPages.mockResolvedValue({ ok: true, value: { pages: ['a'], local: false } });
        const chapters = [
            { remoteId: 11, libraryChapterId: null, name: 'One', number: 1 },
            { remoteId: 12, libraryChapterId: null, name: 'Two', number: 2 }
        ];
        await state().openReader('One Piece', chapters, 0);
        expect(state().reader.manga).toEqual(open);
        useMangaStore.setState({ selection: null });
        await state().goToChapter(1);
        expect(state().reader).toMatchObject({ index: 1, manga: open });
    });

    it('does not know the manga when the reader opens with none open', async () => {
        mock.api.manga.readPages.mockResolvedValue({ ok: true, value: { pages: ['a'], local: false } });
        await state().openReader('One Piece', [{ remoteId: 11, libraryChapterId: null, name: 'One', number: 1 }], 0);
        expect(state().reader.manga).toBeNull();
    });
});

describe('mangaStore the filters that stand for the terms of a manga', () => {
    const FILTERS: MangaFilter[] = [
        { type: 'text', name: 'Author', value: '' },
        { type: 'group', name: 'Genre', filters: [{ type: 'tristate', name: 'Action', value: 'ignore' }] }
    ];

    it('starts with none', () => {
        expect(state().termFilters).toEqual({ sourceId: null, status: 'idle', filters: [] });
    });

    it('reads the filters of the source of the manga, once for each source', async () => {
        mock.api.manga.sourceFilters.mockResolvedValue({ ok: true, value: FILTERS });
        const loading = state().loadTermFilters('123');
        expect(state().termFilters).toEqual({ sourceId: '123', status: 'loading', filters: [] });
        await loading;
        expect(state().termFilters).toEqual({ sourceId: '123', status: 'ready', filters: FILTERS });
        await state().loadTermFilters('123');
        expect(mock.api.manga.sourceFilters).toHaveBeenCalledTimes(1);
        await state().loadTermFilters('456');
        expect(mock.api.manga.sourceFilters).toHaveBeenCalledTimes(2);
        expect(state().termFilters.sourceId).toBe('456');
    });

    it('says it could not read them, and reads again the next time', async () => {
        mock.api.manga.sourceFilters.mockResolvedValueOnce({ ok: false, error: FAILURE });
        await state().loadTermFilters('123');
        expect(state().termFilters).toEqual({ sourceId: '123', status: 'error', filters: [] });
        mock.api.manga.sourceFilters.mockResolvedValueOnce({ ok: true, value: FILTERS });
        await state().loadTermFilters('123');
        expect(state().termFilters.status).toBe('ready');
    });

    it('drops the answer of a source that is no longer the one asked about', async () => {
        let answer: (value: unknown) => void = () => {
            return undefined;
        };
        mock.api.manga.sourceFilters.mockReturnValueOnce(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        mock.api.manga.sourceFilters.mockResolvedValueOnce({ ok: true, value: [] });
        const first = state().loadTermFilters('123');
        await state().loadTermFilters('456');
        answer({ ok: true, value: FILTERS });
        await first;
        expect(state().termFilters).toEqual({ sourceId: '456', status: 'ready', filters: [] });
    });
});

describe('mangaStore searching by a term', () => {
    const FILTERS: MangaFilter[] = [
        { type: 'text', name: 'Author', value: '' },
        { type: 'group', name: 'Genre', filters: [{ type: 'tristate', name: 'Action', value: 'ignore' }, { type: 'tristate', name: 'Drama', value: 'ignore' }] }
    ];

    beforeEach(() => {
        mock.api.manga.sourceFilters.mockResolvedValue({ ok: true, value: FILTERS });
        mock.api.manga.list.mockResolvedValue({ ok: true, value: { items: [], hasNextPage: false } });
        useMangaStore.setState({ selection: { manga: makeSummary(), status: 'ready', details: makeDetails(), chapters: [], selected: [], error: null } });
    });

    it('turns on the filter of a genre, and not the text of the search', async () => {
        await state().searchByTerm('Action');
        expect(state().view).toBe('browse');
        expect(state().browse).toMatchObject({ sourceId: '123', mode: 'search', query: '', filtersOpen: false });
        expect(state().browse.filters).toEqual([FILTERS[0], { type: 'group', name: 'Genre', filters: [{ type: 'tristate', name: 'Action', value: 'include' }, FILTERS[1] && (FILTERS[1] as { filters: MangaFilter[] }).filters[1]] }]);
        expect(mock.api.manga.list).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: '123', kind: 'search', query: '' }));
    });

    it('gives the name of the author to the filter of authors', async () => {
        await state().searchByTerm('Eiichiro Oda', 'author');
        expect(state().browse.filters[0]).toEqual({ type: 'text', name: 'Author', value: 'Eiichiro Oda' });
        expect(state().browse.query).toBe('');
    });

    it('never puts a term that has no filter in the text of the search', async () => {
        await state().searchByTerm('Content rating: Suggestive');
        expect(state().browse.query).toBe('');
        expect(state().browse.filters).toEqual(FILTERS);
        await state().searchByTerm('Someone', 'artist');
        expect(state().browse.query).toBe('');
    });

    it('waits for the filters to be read even when something else already asked for them', async () => {
        let answer: (value: unknown) => void = () => {
            return undefined;
        };
        mock.api.manga.sourceFilters.mockReset();
        mock.api.manga.sourceFilters.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        useMangaStore.getState().openSource('123', 'search');
        // Opening a source closes the manga that was open: the one the term is of is open again.
        useMangaStore.setState({ selection: { manga: makeSummary(), status: 'ready', details: makeDetails(), chapters: [], selected: [], error: null } });
        const early = useMangaStore.getState().loadFilters();
        const searching = state().searchByTerm('Drama');
        answer({ ok: true, value: FILTERS });
        await early;
        await searching;
        expect(mock.api.manga.sourceFilters).toHaveBeenCalledTimes(1);
        const group = state().browse.filters[1] as { filters: Array<{ name: string; value: string }> };
        expect(group.filters.map((filter) => {
            return [filter.name, filter.value];
        })).toEqual([
            ['Action', 'ignore'],
            ['Drama', 'include']
        ]);
    });

    it('does nothing with no manga open, or with an empty term', async () => {
        await state().searchByTerm('   ');
        useMangaStore.setState({ selection: null });
        await state().searchByTerm('Action');
        expect(mock.api.manga.list).not.toHaveBeenCalled();
        expect(state().view).toBe('browse');
    });
});

describe('mangaStore searching a manga in all the sources', () => {
    const SOURCES = [
        makeSource({ id: '5', name: 'Site A', lang: 'en' }),
        makeSource({ id: '6', name: 'Site B', lang: 'en' }),
        makeSource({ id: '7', name: 'Site C', lang: 'pt' }),
        makeSource({ id: '8', name: 'Site D', lang: 'en', contentWarning: 'NSFW' })
    ];

    beforeEach(() => {
        useMangaStore.setState({ browse: { ...state().browse, sources: SOURCES, sourcesStatus: 'ready', sourceLanguage: 'en' } });
        mock.api.manga.list.mockImplementation(async (request) => {
            return { ok: true, value: { items: request.sourceId === '6' ? [] : [makeSummary({ remoteId: 1, sourceId: request.sourceId })], hasNextPage: false } };
        });
    });

    function summary(): Array<[string, string, number]> {
        return state().search.results.map((result) => {
            return [result.source.id, result.status, result.items.length];
        });
    }

    it('starts without a search', () => {
        expect(state().search).toEqual({ query: '', searchedFor: '', status: 'idle', results: [] });
    });

    it('keeps the name typed', () => {
        state().setSearchQuery('one piece');
        expect(state().search.query).toBe('one piece');
    });

    it('searches the sources of the language, with the name trimmed, and says how each one answered', async () => {
        state().setSearchQuery('  one piece ');
        await state().runSearch();
        expect(mock.api.manga.list).toHaveBeenCalledTimes(2);
        expect(mock.api.manga.list).toHaveBeenNthCalledWith(1, { sourceId: '5', kind: 'search', page: 1, query: 'one piece' });
        expect(mock.api.manga.list).toHaveBeenNthCalledWith(2, { sourceId: '6', kind: 'search', page: 1, query: 'one piece' });
        expect(state().search).toMatchObject({ query: '  one piece ', searchedFor: 'one piece', status: 'done' });
        expect(summary()).toEqual([['5', 'found', 1], ['6', 'none', 0]]);
        expect(state().search.results[0]!.items).toEqual([makeSummary({ remoteId: 1, sourceId: '5' })]);
    });

    it('searches the sources for adults only when they are asked for', async () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaShowAdult: true } });
        state().setSearchQuery('x');
        await state().runSearch();
        expect(summary().map((entry) => {
            return entry[0];
        })).toEqual(['5', '6', '8']);
    });

    it('searches every language when none is chosen', async () => {
        useMangaStore.setState({ browse: { ...state().browse, sourceLanguage: 'all-languages' } });
        state().setSearchQuery('x');
        await state().runSearch();
        expect(summary().map((entry) => {
            return entry[0];
        })).toEqual(['5', '6', '7']);
    });

    it('shows only twelve results of a source', async () => {
        mock.api.manga.list.mockResolvedValue({ ok: true, value: { items: Array.from({ length: 20 }, (_unused, index) => {return makeSummary({ remoteId: index + 1 })}), hasNextPage: true } });
        state().setSearchQuery('x');
        await state().runSearch();
        expect(state().search.results[0]!.items).toHaveLength(12);
        expect(state().search.results[0]!.items.at(-1)!.remoteId).toBe(12);
    });

    it('keeps a source that failed as an error, with why, and goes on with the others', async () => {
        mock.api.manga.list.mockImplementation(async (request) => {
            return request.sourceId === '5' ? { ok: false, error: FAILURE } : { ok: true, value: { items: [makeSummary({ remoteId: 2, sourceId: '6' })], hasNextPage: false } };
        });
        state().setSearchQuery('x');
        await state().runSearch();
        expect(summary()).toEqual([['5', 'error', 0], ['6', 'found', 1]]);
        expect(state().search.results[0]!.error).toEqual(FAILURE);
        expect(state().search.results[1]!.error).toBeNull();
        expect(state().search.status).toBe('done');
    });

    it('asks two sources at a time', async () => {
        useMangaStore.setState({ browse: { ...state().browse, sourceLanguage: 'all-languages' } });
        const answers: Array<() => void> = [];
        mock.api.manga.list.mockImplementation(() => {
            return new Promise((resolve) => {
                answers.push(() => {
                    resolve({ ok: true, value: { items: [], hasNextPage: false } });
                });
            });
        });
        state().setSearchQuery('x');
        const searching = state().runSearch();
        expect(state().search.status).toBe('searching');
        expect(summary()).toEqual([['5', 'searching', 0], ['6', 'searching', 0], ['7', 'waiting', 0]]);
        expect(answers).toHaveLength(2);
        answers[0]!();
        await vi.waitFor(() => {
            expect(answers).toHaveLength(3);
        });
        expect(summary()).toEqual([['5', 'none', 0], ['6', 'searching', 0], ['7', 'searching', 0]]);
        answers[1]!();
        answers[2]!();
        await searching;
        expect(state().search.status).toBe('done');
    });

    it('drops the answers of a search that a newer one replaced', async () => {
        const answers = new Map<string, Array<() => void>>();
        mock.api.manga.list.mockImplementation((request) => {
            return new Promise((resolve) => {
                answers.set(`${request.query}:${request.sourceId}`, [
                    () => {
                        resolve({ ok: true, value: { items: [makeSummary({ remoteId: 1, title: request.query, sourceId: request.sourceId })], hasNextPage: false } });
                    }
                ]);
            });
        });
        state().setSearchQuery('old');
        const first = state().runSearch();
        state().setSearchQuery('new');
        const second = state().runSearch();
        answers.get('old:5')![0]!();
        answers.get('old:6')![0]!();
        await first;
        expect(state().search).toMatchObject({ searchedFor: 'new', status: 'searching' });
        expect(summary()).toEqual([['5', 'searching', 0], ['6', 'searching', 0]]);
        expect(mock.api.manga.list).toHaveBeenCalledTimes(4);
        answers.get('new:5')![0]!();
        answers.get('new:6')![0]!();
        await second;
        expect(state().search.status).toBe('done');
        expect(state().search.results[0]!.items[0]!.title).toBe('new');
    });

    it('does not search with an empty name', async () => {
        state().setSearchQuery('   ');
        await state().runSearch();
        expect(mock.api.manga.list).not.toHaveBeenCalled();
        expect(state().search.status).toBe('idle');
    });

    it('finishes at once when there is no source to search', async () => {
        useMangaStore.setState({ browse: { ...state().browse, sources: [] } });
        state().setSearchQuery('x');
        await state().runSearch();
        expect(state().search).toMatchObject({ searchedFor: 'x', status: 'done', results: [] });
    });

    it('opens a manga from the search as one of the search, and a manga from the browse as one of the browse', async () => {
        mock.api.manga.details.mockResolvedValue({ ok: true, value: { details: makeDetails(), chapters: [] } });
        useMangaStore.setState({ view: 'search' });
        await state().openManga(makeSummary());
        expect(state().selectionFrom).toBe('search');
        useMangaStore.setState({ view: 'browse' });
        await state().openManga(makeSummary());
        expect(state().selectionFrom).toBe('browse');
    });
});
