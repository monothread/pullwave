// @vitest-environment jsdom
import { useFxStore } from '@renderer/fx/fxStore';
import type { AnimeCheckState, AnimeHistoryEntry, AnimeJob, AnimeScheduleEntry, AnimeSearchResult, AnimeUpdateEntry } from '@shared/anime';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { machineTimeZone, zonedDayLimits } from '@shared/timezone';
import { useAppStore } from '@renderer/store/appStore';
import { effectiveAudio, INITIAL_SCHEDULE, INITIAL_SEARCH, MAX_SCHEDULE_SEARCH_NAMES, UNSUPPORTED_STATUS, useAnimeStore, type AnimeScheduleState } from '@renderer/store/animeStore';
import { makeAnime, makeAnimeJob, makeEpisode, makeScheduleEntry, makeStatus } from '../../helpers/animeFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();

const RESULT: AnimeSearchResult = { index: 2, title: 'Naruto' };
const SUPPORTED = makeStatus();

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, notice: null });
    useAnimeStore.setState({ ...initialAnime, status: UNSUPPORTED_STATUS, view: 'search', returnView: 'search', jobs: [], library: [], history: [], migration: null, search: INITIAL_SEARCH, schedule: INITIAL_SCHEDULE, selection: null, playing: null, streaming: null });
});

describe('effectiveAudio', () => {
    it('uses the audio picked on the screen, or the setting when none was picked', () => {
        expect(effectiveAudio({ ...INITIAL_SEARCH, audio: 'dub' }, 'sub')).toBe('dub');
        expect(effectiveAudio(INITIAL_SEARCH, 'dub')).toBe('dub');
        expect(effectiveAudio({ ...INITIAL_SEARCH, audio: 'sub' }, 'dub')).toBe('sub');
    });
});

describe('useAnimeStore initial state', () => {
    it('starts unsupported and empty', () => {
        expect(initialAnime.status).toEqual({ supported: false, available: false, aniCli: null });
        expect(initialAnime.view).toBe('schedule');
        expect(initialAnime.returnView).toBe('schedule');
        expect(initialAnime.schedule).toEqual({ status: 'idle', entries: [], error: null, view: 'day', timeZone: machineTimeZone(), limits: [] });
        expect(initialAnime.jobs).toEqual([]);
        expect(initialAnime.queueHeld).toBe(false);
        expect(initialAnime.library).toEqual([]);
        expect(initialAnime.history).toEqual([]);
        expect(initialAnime.search).toEqual({ query: '', audio: null, status: 'idle', results: [], error: null, searchedQuery: '', searchedAudio: 'sub', hasNextPage: false, limited: false, loadingMore: false });
        expect(initialAnime.selection).toBeNull();
        expect(initialAnime.playing).toBeNull();
        expect(initialAnime.streaming).toBeNull();
        expect(initialAnime.libraryFocus).toBeNull();
        expect(initialAnime.librarySeries).toBeNull();
    });
});

describe('init', () => {
    it('only asks for the status where the section does not exist', async () => {
        const dispose = await useAnimeStore.getState().init();
        expect(useAnimeStore.getState().status).toEqual({ supported: false, available: false, aniCli: null });
        expect(mock.api.listAnimeLibrary).not.toHaveBeenCalled();
        expect(mock.api.listAnimeJobs).not.toHaveBeenCalled();
        expect(mock.api.listAnimeHistory).not.toHaveBeenCalled();
        expect(mock.api.onAnimeJobUpdate).not.toHaveBeenCalled();
        expect(() => {
            dispose();
        }).not.toThrow();
    });

    it('loads the library and the jobs and listens for changes', async () => {
        const anime = makeAnime([makeEpisode()]);
        const job = makeAnimeJob();
        mock.api.getAnimeStatus.mockResolvedValue(SUPPORTED);
        mock.api.listAnimeLibrary.mockResolvedValue([anime]);
        mock.api.listAnimeJobs.mockResolvedValue([job]);

        const dispose = await useAnimeStore.getState().init();

        expect(useAnimeStore.getState().status).toEqual(SUPPORTED);
        expect(useAnimeStore.getState().library).toEqual([anime]);
        expect(useAnimeStore.getState().jobs).toEqual([job]);

        const updated: AnimeJob = { ...job, percent: 80 };
        const other = makeAnimeJob({ episodeId: 2, episode: '2' });
        mock.emitAnimeJob(updated);
        mock.emitAnimeJob(other);
        expect(useAnimeStore.getState().jobs).toEqual([updated, other]);

        mock.api.listAnimeLibrary.mockResolvedValue([]);
        mock.emitAnimeLibraryChanged();
        await vi.waitFor(() => {
            expect(useAnimeStore.getState().library).toEqual([]);
        });

        dispose();
        expect(mock.unsubscribers).toHaveLength(7);
        mock.unsubscribers.forEach((unsubscribe) => {
            expect(unsubscribe).toHaveBeenCalledTimes(1);
        });
    });
});

describe('init and the queue that is held', () => {
    it('reads whether the queue is held and follows PAUSE ALL and RESUME ALL', async () => {
        mock.api.getAnimeStatus.mockResolvedValue(SUPPORTED);
        mock.api.animeQueueHeld.mockResolvedValue(true);

        await useAnimeStore.getState().init();

        expect(mock.api.animeQueueHeld).toHaveBeenCalledTimes(1);
        expect(useAnimeStore.getState().queueHeld).toBe(true);
        mock.emitAnimeQueueHeld(false);
        expect(useAnimeStore.getState().queueHeld).toBe(false);
        mock.emitAnimeQueueHeld(true);
        expect(useAnimeStore.getState().queueHeld).toBe(true);
    });

    it('does not ask where the section does not exist', async () => {
        await useAnimeStore.getState().init();
        expect(mock.api.animeQueueHeld).not.toHaveBeenCalled();
        expect(mock.api.onAnimeQueueHeld).not.toHaveBeenCalled();
    });
});

describe('init and the jobs that are done', () => {
    function toastMessages(): string[] {
        return useAppStore.getState().toasts.map((toast) => {
            return toast.message;
        });
    }

    beforeEach(() => {
        useAppStore.setState({ toasts: [] });
        mock.api.getAnimeStatus.mockResolvedValue(SUPPORTED);
    });

    it('takes a download that is done off the list, and says so with a toast', async () => {
        await useAnimeStore.getState().init();
        mock.emitAnimeJob(makeAnimeJob({ status: 'running' }));
        mock.emitAnimeJob(makeAnimeJob({ episodeId: 2, episode: '2', status: 'running' }));
        expect(toastMessages()).toEqual([]);

        mock.emitAnimeJob(makeAnimeJob({ status: 'done', percent: 100, speed: '', eta: '' }));

        expect(useAnimeStore.getState().jobs).toEqual([makeAnimeJob({ episodeId: 2, episode: '2', status: 'running' })]);
        expect(toastMessages()).toEqual(['Download complete: Naruto · EP 1']);
        expect(useAppStore.getState().notice).toBeNull();
    });

    it('celebrates each episode that is done, and not one that is going on', async () => {
        useFxStore.setState({ celebrations: 0 });
        await useAnimeStore.getState().init();
        mock.emitAnimeJob(makeAnimeJob({ status: 'running' }));
        expect(useFxStore.getState().celebrations).toBe(0);
        mock.emitAnimeJob(makeAnimeJob({ status: 'done' }));
        mock.emitAnimeJob(makeAnimeJob({ episodeId: 2, episode: '2', status: 'done' }));
        expect(useFxStore.getState().celebrations).toBe(2);
    });

    it('stacks the toasts of the downloads that finish together', async () => {
        await useAnimeStore.getState().init();
        mock.emitAnimeJob(makeAnimeJob({ episodeId: 1, episode: '1', status: 'done' }));
        mock.emitAnimeJob(makeAnimeJob({ episodeId: 2, episode: '2', status: 'done' }));
        mock.emitAnimeJob(makeAnimeJob({ episodeId: 3, animeTitle: 'Bleach', episode: '12', status: 'done' }));
        expect(toastMessages()).toEqual(['Download complete: Naruto · EP 1', 'Download complete: Naruto · EP 2', 'Download complete: Bleach · EP 12']);
        expect(useAnimeStore.getState().jobs).toEqual([]);
    });

    it('says it in the language of the settings', async () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'pt' } });
        await useAnimeStore.getState().init();
        mock.emitAnimeJob(makeAnimeJob({ status: 'done' }));
        expect(toastMessages()).toEqual(['Download concluído: Naruto · EP 1']);
    });

    it('does not add a job that arrives done, because there is nothing left to show of it', async () => {
        await useAnimeStore.getState().init();
        mock.emitAnimeJob(makeAnimeJob({ episodeId: 9, status: 'done' }));
        expect(useAnimeStore.getState().jobs).toEqual([]);
        expect(toastMessages()).toHaveLength(1);
    });

    it.each(['queued', 'running', 'paused', 'error', 'cancelled'] as const)('keeps a %s job on the list and says nothing', async (status) => {
        await useAnimeStore.getState().init();
        mock.emitAnimeJob(makeAnimeJob({ status }));
        expect(useAnimeStore.getState().jobs).toEqual([makeAnimeJob({ status })]);
        expect(toastMessages()).toEqual([]);
    });
});

describe('addToLibrary', () => {
    const selection = { result: RESULT, query: 'naruto', audio: 'dub' as const, status: 'ready' as const, episodes: ['1', '2', '3'], error: null };

    beforeEach(() => {
        useAnimeStore.setState({ selection });
        useAppStore.setState({ notice: null });
    });

    function added(count = 3) {
        return makeAnime(
            Array.from({ length: count }, (_unused, index) => {
                return makeEpisode({ id: index + 1, number: String(index + 1), status: 'idle', filePath: null, sizeBytes: null });
            }),
            { id: 7, title: 'Naruto', audio: 'dub' }
        );
    }

    it('sends the id the source gave the anime, so a season with the same title is not taken for another', async () => {
        mock.api.addAnimeToLibrary.mockResolvedValue({ ok: true, anime: added() });
        const selected = useAnimeStore.getState().selection;
        useAnimeStore.setState({ selection: { ...selected!, result: { index: 2, title: 'Naruto (season 2)', sourceId: 'naruto-season-2-605' } } });
        await useAnimeStore.getState().addToLibrary(null);
        expect(mock.api.addAnimeToLibrary).toHaveBeenCalledWith(expect.objectContaining({ title: 'Naruto (season 2)', index: 2, sourceId: 'naruto-season-2-605' }));
    });

    it('sends the opened anime with all its episodes and the series it goes under', async () => {
        mock.api.addAnimeToLibrary.mockResolvedValue({ ok: true, anime: added() });
        expect(await useAnimeStore.getState().addToLibrary({ series: '  Naruto  Series ', season: 2, seasonName: ' The  Second ' })).toBe(true);
        expect(mock.api.addAnimeToLibrary).toHaveBeenCalledTimes(1);
        expect(mock.api.addAnimeToLibrary).toHaveBeenCalledWith({
            title: 'Naruto',
            query: 'naruto',
            index: 2,
            audio: 'dub',
            episodes: ['1', '2', '3'],
            series: 'Naruto Series',
            season: 2,
            seasonName: 'The Second'
        });
    });

    it('sends no series, season or name when it goes on its own, whether it gets none or an empty one', async () => {
        mock.api.addAnimeToLibrary.mockResolvedValue({ ok: true, anime: added() });
        await useAnimeStore.getState().addToLibrary(null);
        await useAnimeStore.getState().addToLibrary({ series: 'Naruto', season: 1, seasonName: '   ' });
        expect(mock.api.addAnimeToLibrary).toHaveBeenNthCalledWith(1, { title: 'Naruto', query: 'naruto', index: 2, audio: 'dub', episodes: ['1', '2', '3'], series: null, season: null, seasonName: null });
        expect(mock.api.addAnimeToLibrary).toHaveBeenNthCalledWith(2, { title: 'Naruto', query: 'naruto', index: 2, audio: 'dub', episodes: ['1', '2', '3'], series: 'Naruto', season: 1, seasonName: null });
    });

    it('reads the library again and says how many episodes the anime has now', async () => {
        const anime = added(3);
        mock.api.addAnimeToLibrary.mockResolvedValue({ ok: true, anime });
        mock.api.listAnimeLibrary.mockResolvedValue([anime]);
        await useAnimeStore.getState().addToLibrary(null);
        expect(useAnimeStore.getState().library).toEqual([anime]);
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'Added to the library: Naruto (3 episodes).' });
    });

    it('says it in the language of the settings', async () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'pt' } });
        mock.api.addAnimeToLibrary.mockResolvedValue({ ok: true, anime: added(3) });
        await useAnimeStore.getState().addToLibrary(null);
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'Adicionado à biblioteca: Naruto (3 episódios).' });
    });

    it('does nothing without an opened anime, while its episodes are loading, after they failed, or without episodes', async () => {
        useAnimeStore.setState({ selection: null });
        expect(await useAnimeStore.getState().addToLibrary(null)).toBe(false);
        useAnimeStore.setState({ selection: { ...selection, status: 'loading' as const, episodes: [] } });
        expect(await useAnimeStore.getState().addToLibrary(null)).toBe(false);
        useAnimeStore.setState({ selection: { ...selection, status: 'error' as const, episodes: [], error: { code: 'NETWORK', raw: 'boom' } } });
        expect(await useAnimeStore.getState().addToLibrary(null)).toBe(false);
        useAnimeStore.setState({ selection: { ...selection, episodes: [] } });
        expect(await useAnimeStore.getState().addToLibrary(null)).toBe(false);
        expect(mock.api.addAnimeToLibrary).not.toHaveBeenCalled();
        expect(useAppStore.getState().notice).toBeNull();
    });

    it.each([
        ['a series name that is empty', { series: '   ', season: 1 }],
        ['a series name that is too long', { series: 'a'.repeat(101), season: 1 }],
        ['a season of zero', { series: 'Naruto', season: 0 }],
        ['a season over 99', { series: 'Naruto', season: 100 }],
        ['a season that is not whole', { series: 'Naruto', season: 1.5 }],
        ['a name that is too long', { series: 'Naruto', season: 1, seasonName: 'a'.repeat(61) }]
    ])('says so and adds nothing with %s', async (_name, joined) => {
        expect(await useAnimeStore.getState().addToLibrary(joined)).toBe(false);
        expect(mock.api.addAnimeToLibrary).not.toHaveBeenCalled();
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'Give a series name (up to 100 characters), an order from 1 to 99 and a name of up to 60 characters.' });
    });

    it('says which order the series could take when the one asked for is taken, and keeps the library as it was', async () => {
        mock.api.addAnimeToLibrary.mockResolvedValue({ ok: false, reason: 'season-taken', suggested: 4 });
        expect(await useAnimeStore.getState().addToLibrary({ series: 'Naruto', season: 2, seasonName: '' })).toBe(false);
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'Order 2 is already used by another anime of the series. Use 4, the next one.' });
        expect(mock.api.listAnimeLibrary).not.toHaveBeenCalled();
    });

    it.each([
        ['busy', 'The anime folder is being migrated. Try again when it is done.'],
        ['invalid', 'The anime could not be added to the library.']
    ] as const)('says why it could not add the anime when the app answers %s', async (reason, message) => {
        mock.api.addAnimeToLibrary.mockResolvedValue({ ok: false, reason });
        expect(await useAnimeStore.getState().addToLibrary(null)).toBe(false);
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message });
        expect(mock.api.listAnimeLibrary).not.toHaveBeenCalled();
    });
});

describe('downloadMissing', () => {
    it('asks the app to queue what is missing of these anime, and reads the library again', async () => {
        const anime = makeAnime([makeEpisode({ id: 1, status: 'queued', filePath: null, sizeBytes: null })], { id: 7 });
        mock.api.listAnimeLibrary.mockResolvedValue([anime]);
        await useAnimeStore.getState().downloadMissing([7, 8]);
        expect(mock.api.downloadMissingAnime).toHaveBeenCalledTimes(1);
        expect(mock.api.downloadMissingAnime).toHaveBeenCalledWith([7, 8]);
        expect(useAnimeStore.getState().library).toEqual([anime]);
    });

    it('does not say anything: the downloads screen shows what was queued', async () => {
        await useAnimeStore.getState().downloadMissing([7]);
        expect(useAppStore.getState().notice).toBeNull();
        expect(useAppStore.getState().toasts).toEqual([]);
    });
});

describe('renameSeries', () => {
    it('renames the series of all these anime and reads the library again', async () => {
        const renamed = [makeAnime([], { id: 1, series: 'Sousou no Frieren', season: 1 }), makeAnime([], { id: 2, title: 'Frieren 2', series: 'Sousou no Frieren', season: 2 })];
        mock.api.listAnimeLibrary.mockResolvedValue(renamed);
        expect(await useAnimeStore.getState().renameSeries([1, 2], 'Sousou no Frieren')).toEqual({ ok: true });
        expect(mock.api.renameAnimeSeries).toHaveBeenCalledTimes(1);
        expect(mock.api.renameAnimeSeries).toHaveBeenCalledWith([1, 2], 'Sousou no Frieren');
        expect(useAnimeStore.getState().library).toEqual(renamed);
    });

    it('gives the answer as it is, and does not read the library, when it is refused', async () => {
        mock.api.renameAnimeSeries.mockResolvedValue({ ok: false, reason: 'season-taken', anime: 'Frieren', season: 1, suggested: 4 });
        expect(await useAnimeStore.getState().renameSeries([1], 'Journeys')).toEqual({ ok: false, reason: 'season-taken', anime: 'Frieren', season: 1, suggested: 4 });
        expect(mock.api.listAnimeLibrary).not.toHaveBeenCalled();
        mock.api.renameAnimeSeries.mockResolvedValue({ ok: false, reason: 'invalid' });
        expect(await useAnimeStore.getState().renameSeries([1], '')).toEqual({ ok: false, reason: 'invalid' });
        expect(mock.api.listAnimeLibrary).not.toHaveBeenCalled();
    });
});

describe('simple setters', () => {
    it('sets the view, the query and the audio', () => {
        useAnimeStore.getState().setView('library');
        useAnimeStore.getState().setQuery('bleach');
        useAnimeStore.getState().setAudio('dub');
        expect(useAnimeStore.getState().view).toBe('library');
        expect(useAnimeStore.getState().search).toMatchObject({ query: 'bleach', audio: 'dub' });
    });

    it('reads the library again when it is shown, so files that are gone are noticed, and not for the search', async () => {
        const anime = makeAnime([makeEpisode({ id: 1, fileMissing: true })]);
        mock.api.listAnimeLibrary.mockResolvedValue([anime]);

        useAnimeStore.getState().setView('search');
        expect(mock.api.listAnimeLibrary).not.toHaveBeenCalled();

        useAnimeStore.getState().setView('library');
        expect(mock.api.listAnimeLibrary).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => {
            expect(useAnimeStore.getState().library).toEqual([anime]);
        });

        useAnimeStore.getState().setView('search');
        useAnimeStore.getState().showInLibrary(1);
        expect(mock.api.listAnimeLibrary).toHaveBeenCalledTimes(2);
    });

    it('goes to the library, to the anime that was being looked at in the search', () => {
        useAnimeStore.setState({ view: 'search', selection: { result: RESULT, query: 'naruto', audio: 'sub', status: 'ready', episodes: ['1'], error: null } });
        useAnimeStore.getState().showInLibrary(7);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'library', returnView: 'library', selection: null, libraryFocus: 7 });
    });

    it('opens the series of the anime that was being looked at: its card, whether it has a series or not', () => {
        useAnimeStore.setState({
            library: [makeAnime([], { id: 7, title: 'Naruto' }), makeAnime([], { id: 8, title: 'Frieren Season 2', series: 'Frieren', season: 2 }), makeAnime([], { id: 9, title: 'Frieren', series: 'Frieren', season: 1 })]
        });
        useAnimeStore.getState().showInLibrary(7);
        expect(useAnimeStore.getState().librarySeries).toBe('anime-7');
        useAnimeStore.getState().showInLibrary(8);
        expect(useAnimeStore.getState().librarySeries).toBe('series-frieren');
        useAnimeStore.getState().showInLibrary(9);
        expect(useAnimeStore.getState().librarySeries).toBe('series-frieren');
    });

    it('opens no series when the anime is not in the library', () => {
        useAnimeStore.setState({ library: [], librarySeries: 'series-frieren' });
        useAnimeStore.getState().showInLibrary(7);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'library', libraryFocus: 7, librarySeries: null });
    });

    it('opens and closes a series of the library, and forgets the anime in view when it closes', () => {
        useAnimeStore.setState({ libraryFocus: 7 });
        useAnimeStore.getState().openSeries('series-frieren');
        expect(useAnimeStore.getState()).toMatchObject({ librarySeries: 'series-frieren', libraryFocus: 7 });
        useAnimeStore.getState().closeSeries();
        expect(useAnimeStore.getState()).toMatchObject({ librarySeries: null, libraryFocus: null });
    });

    it('opens and closes the screen of a season, a page of its own', () => {
        expect(useAnimeStore.getState().librarySeason).toBeNull();
        useAnimeStore.getState().openSeries('series-frieren');
        useAnimeStore.getState().openSeason(12);
        expect(useAnimeStore.getState()).toMatchObject({ librarySeries: 'series-frieren', librarySeason: 12 });
        useAnimeStore.getState().closeSeason();
        expect(useAnimeStore.getState()).toMatchObject({ librarySeries: 'series-frieren', librarySeason: null });
    });

    it('closes the season when another series opens, the series closes, a view is chosen or an anime is shown in the library', () => {
        const reopen = (): void => {
            useAnimeStore.getState().openSeries('series-frieren');
            useAnimeStore.getState().openSeason(12);
        };
        reopen();
        useAnimeStore.getState().openSeries('series-naruto');
        expect(useAnimeStore.getState().librarySeason).toBeNull();
        reopen();
        useAnimeStore.getState().closeSeries();
        expect(useAnimeStore.getState().librarySeason).toBeNull();
        reopen();
        useAnimeStore.getState().setView('library');
        expect(useAnimeStore.getState().librarySeason).toBeNull();
        reopen();
        useAnimeStore.getState().showInLibrary(7);
        expect(useAnimeStore.getState().librarySeason).toBeNull();
    });

    it('closes the series when a view is chosen again', () => {
        useAnimeStore.getState().openSeries('series-frieren');
        useAnimeStore.getState().setView('library');
        expect(useAnimeStore.getState().librarySeries).toBeNull();
        useAnimeStore.getState().openSeries('series-frieren');
        useAnimeStore.getState().setView('search');
        expect(useAnimeStore.getState().librarySeries).toBeNull();
    });

    it('stops pointing at an anime of the library when the view is chosen again', () => {
        useAnimeStore.getState().showInLibrary(7);
        useAnimeStore.getState().setView('search');
        expect(useAnimeStore.getState().libraryFocus).toBeNull();
        useAnimeStore.getState().showInLibrary(7);
        useAnimeStore.getState().setView('library');
        expect(useAnimeStore.getState().libraryFocus).toBeNull();
    });

    it('remembers the view the downloads screen goes back to', () => {
        useAnimeStore.getState().setView('library');
        useAnimeStore.getState().openDownloads();
        expect(useAnimeStore.getState()).toMatchObject({ view: 'downloads', returnView: 'library' });
        useAnimeStore.getState().closeDownloads();
        expect(useAnimeStore.getState().view).toBe('library');

        useAnimeStore.getState().setView('search');
        useAnimeStore.getState().openDownloads();
        useAnimeStore.getState().closeDownloads();
        expect(useAnimeStore.getState().view).toBe('search');
    });

    it('does not forget where to go back when the downloads screen is opened twice', () => {
        useAnimeStore.getState().setView('library');
        useAnimeStore.getState().openDownloads();
        useAnimeStore.getState().openDownloads();
        useAnimeStore.getState().closeDownloads();
        expect(useAnimeStore.getState().view).toBe('library');
    });

    it('opens and closes the player', () => {
        useAnimeStore.getState().play(3, 7);
        expect(useAnimeStore.getState().playing).toEqual({ animeId: 3, episodeId: 7 });
        useAnimeStore.getState().closePlayer();
        expect(useAnimeStore.getState().playing).toBeNull();
    });
});

describe('setQuery with an empty name', () => {
    const ERROR = { code: 'NO_RESULTS' as const, raw: 'No results found!' };

    it('clears the results of the last search', () => {
        useAnimeStore.setState({ search: { ...INITIAL_SEARCH, query: 'naruto', status: 'done', results: [RESULT], searchedQuery: 'naruto', searchedAudio: 'dub' } });
        useAnimeStore.getState().setQuery('');
        expect(useAnimeStore.getState().search).toEqual({ ...INITIAL_SEARCH, query: '', status: 'idle', results: [], error: null, searchedQuery: 'naruto', searchedAudio: 'dub' });
    });

    it('clears the error of the last search', () => {
        useAnimeStore.setState({ search: { ...INITIAL_SEARCH, query: 'zzz', status: 'error', error: ERROR } });
        useAnimeStore.getState().setQuery('');
        expect(useAnimeStore.getState().search).toMatchObject({ query: '', status: 'idle', results: [], error: null });
    });

    it('clears them for a name of spaces only', () => {
        useAnimeStore.setState({ search: { ...INITIAL_SEARCH, query: 'naruto', status: 'done', results: [RESULT] } });
        useAnimeStore.getState().setQuery('   ');
        expect(useAnimeStore.getState().search).toMatchObject({ query: '   ', status: 'idle', results: [] });
    });

    it('keeps the audio that was picked', () => {
        useAnimeStore.setState({ search: { ...INITIAL_SEARCH, query: 'naruto', audio: 'dub', status: 'done', results: [RESULT] } });
        useAnimeStore.getState().setQuery('');
        expect(useAnimeStore.getState().search.audio).toBe('dub');
    });

    it('keeps the results while the name is not empty', () => {
        useAnimeStore.setState({ search: { ...INITIAL_SEARCH, query: 'naruto', status: 'done', results: [RESULT] } });
        useAnimeStore.getState().setQuery('naru');
        expect(useAnimeStore.getState().search).toMatchObject({ query: 'naru', status: 'done', results: [RESULT] });
    });

    it('does not show the answer of a search that was running when the name was emptied', async () => {
        let answer: (response: { ok: true; results: typeof RESULT[] }) => void = () => {
            return;
        };
        mock.api.searchAnime.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        useAnimeStore.getState().setQuery('naruto');
        const running = useAnimeStore.getState().runSearch();
        useAnimeStore.getState().setQuery('');
        answer({ ok: true, results: [RESULT] });
        await running;
        expect(useAnimeStore.getState().search).toMatchObject({ query: '', status: 'idle', results: [] });
    });
});

describe('runSearch', () => {
    it('does nothing for an empty query', async () => {
        useAnimeStore.getState().setQuery('   ');
        await useAnimeStore.getState().runSearch();
        expect(mock.api.searchAnime).not.toHaveBeenCalled();
        expect(useAnimeStore.getState().search.status).toBe('idle');
    });

    it('searches with the audio of the settings and keeps the results with what they belong to', async () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, animeAudio: 'dub' } });
        mock.api.searchAnime.mockResolvedValue({ ok: true, results: [RESULT], hasNextPage: true, limited: false });
        useAnimeStore.getState().setQuery('  naruto ');

        const running = useAnimeStore.getState().runSearch();
        expect(useAnimeStore.getState().search.status).toBe('searching');
        await running;

        expect(mock.api.searchAnime).toHaveBeenCalledTimes(1);
        expect(mock.api.searchAnime).toHaveBeenCalledWith('naruto', 'dub');
        expect(useAnimeStore.getState().search).toEqual({ query: '  naruto ', audio: null, status: 'done', results: [RESULT], error: null, searchedQuery: 'naruto', searchedAudio: 'dub', hasNextPage: true, limited: false, loadingMore: false });
    });

    it('keeps whether the source has more results and whether the list reached its limit', async () => {
        mock.api.searchAnime.mockResolvedValue({ ok: true, results: [RESULT], hasNextPage: false, limited: true });
        useAnimeStore.getState().setQuery('a');
        await useAnimeStore.getState().runSearch();
        expect(useAnimeStore.getState().search).toMatchObject({ status: 'done', results: [RESULT], hasNextPage: false, limited: true, loadingMore: false });
    });

    it('forgets that the previous search had more results while it searches again', async () => {
        useAnimeStore.setState({ search: { ...INITIAL_SEARCH, query: 'naruto', results: [RESULT], status: 'done', searchedQuery: 'naruto', hasNextPage: true, limited: true, loadingMore: true } });
        mock.api.searchAnime.mockResolvedValue({ ok: true, results: [], hasNextPage: false, limited: false });
        const running = useAnimeStore.getState().runSearch();
        expect(useAnimeStore.getState().search).toMatchObject({ status: 'searching', results: [], hasNextPage: false, limited: false, loadingMore: false });
        await running;
    });

    it('shows only the answer of the last search when two ran together', async () => {
        const answers: Array<(response: { ok: true; results: typeof RESULT[]; hasNextPage: boolean; limited: boolean }) => void> = [];
        mock.api.searchAnime.mockImplementation(() => {
            return new Promise((resolve) => {
                answers.push(resolve);
            });
        });
        useAnimeStore.getState().setQuery('first');
        const first = useAnimeStore.getState().runSearch();
        useAnimeStore.getState().setQuery('second');
        const second = useAnimeStore.getState().runSearch();
        answers[1]?.({ ok: true, results: [{ index: 1, title: 'Second' }], hasNextPage: false, limited: false });
        await second;
        answers[0]?.({ ok: true, results: [{ index: 1, title: 'First' }], hasNextPage: true, limited: false });
        await first;
        expect(useAnimeStore.getState().search).toMatchObject({ status: 'done', results: [{ index: 1, title: 'Second' }], searchedQuery: 'second', hasNextPage: false });
    });

    it('prefers the audio picked on the screen', async () => {
        mock.api.searchAnime.mockResolvedValue({ ok: true, results: [] });
        useAnimeStore.getState().setQuery('naruto');
        useAnimeStore.getState().setAudio('dub');
        await useAnimeStore.getState().runSearch();
        expect(mock.api.searchAnime).toHaveBeenCalledWith('naruto', 'dub');
    });

    it('clears the opened anime and the previous results while it searches', async () => {
        useAnimeStore.setState({
            selection: { result: RESULT, query: 'x', audio: 'sub', status: 'ready', episodes: ['1'], error: null },
            search: { ...INITIAL_SEARCH, query: 'naruto', results: [RESULT], status: 'done' }
        });
        mock.api.searchAnime.mockResolvedValue({ ok: true, results: [] });
        const running = useAnimeStore.getState().runSearch();
        expect(useAnimeStore.getState().selection).toBeNull();
        expect(useAnimeStore.getState().search.results).toEqual([]);
        await running;
    });

    it('keeps the error of a failed search', async () => {
        const error = { code: 'NO_RESULTS' as const, raw: 'No results found!' };
        mock.api.searchAnime.mockResolvedValue({ ok: false, error });
        useAnimeStore.getState().setQuery('zzz');
        await useAnimeStore.getState().runSearch();
        expect(useAnimeStore.getState().search).toMatchObject({ status: 'error', error, results: [], searchedQuery: 'zzz', searchedAudio: 'sub' });
    });
});

describe('loadMoreSearch', () => {
    const FIRST: AnimeSearchResult[] = [{ index: 1, title: 'One' }, { index: 2, title: 'Two' }];

    function listed(overrides: Partial<ReturnType<typeof useAnimeStore.getState>['search']> = {}): void {
        useAnimeStore.setState({
            search: { ...INITIAL_SEARCH, query: 'typed later', audio: 'dub', status: 'done', results: FIRST, searchedQuery: 'naruto', searchedAudio: 'dub', hasNextPage: true, ...overrides }
        });
    }

    it('asks for the results after the ones listed, for what was searched and not for what is typed now, and adds the new ones', async () => {
        listed();
        mock.api.searchAnime.mockResolvedValue({ ok: true, results: [...FIRST, { index: 3, title: 'Three' }, { index: 4, title: 'Four' }], hasNextPage: true, limited: false });

        const loading = useAnimeStore.getState().loadMoreSearch();
        expect(useAnimeStore.getState().search.loadingMore).toBe(true);
        await loading;

        expect(mock.api.searchAnime).toHaveBeenCalledTimes(1);
        expect(mock.api.searchAnime).toHaveBeenCalledWith('naruto', 'dub', 2);
        expect(useAnimeStore.getState().search).toEqual({
            query: 'typed later',
            audio: 'dub',
            status: 'done',
            results: [...FIRST, { index: 3, title: 'Three' }, { index: 4, title: 'Four' }],
            error: null,
            searchedQuery: 'naruto',
            searchedAudio: 'dub',
            hasNextPage: true,
            limited: false,
            loadingMore: false
        });
    });

    it('does not repeat a result it already has, and goes on from the last position', async () => {
        listed();
        mock.api.searchAnime.mockResolvedValue({ ok: true, results: [{ index: 2, title: 'Two' }, { index: 3, title: 'Three' }], hasNextPage: false, limited: false });

        await useAnimeStore.getState().loadMoreSearch();

        expect(useAnimeStore.getState().search.results).toEqual([...FIRST, { index: 3, title: 'Three' }]);
        expect(useAnimeStore.getState().search.hasNextPage).toBe(false);
    });

    it('says the list reached its limit and asks for no more', async () => {
        listed();
        mock.api.searchAnime.mockResolvedValue({ ok: true, results: [...FIRST, { index: 3, title: 'Three' }], hasNextPage: false, limited: true });

        await useAnimeStore.getState().loadMoreSearch();

        expect(useAnimeStore.getState().search).toMatchObject({ results: [...FIRST, { index: 3, title: 'Three' }], hasNextPage: false, limited: true, loadingMore: false });
    });

    it('stops asking when an answer has nothing new, which would be asked for again forever', async () => {
        listed();
        mock.api.searchAnime.mockResolvedValue({ ok: true, results: FIRST, hasNextPage: true, limited: false });

        await useAnimeStore.getState().loadMoreSearch();

        expect(useAnimeStore.getState().search).toMatchObject({ results: FIRST, hasNextPage: false, loadingMore: false });
    });

    it.each([
        ['the search is not done', { status: 'searching' as const }],
        ['the source has no more', { hasNextPage: false }],
        ['more are already being asked for', { loadingMore: true }]
    ])('asks for nothing when %s', async (_name, overrides) => {
        listed(overrides);
        await useAnimeStore.getState().loadMoreSearch();
        expect(mock.api.searchAnime).not.toHaveBeenCalled();
    });

    it('keeps the results and shows the error when it fails, and asks for no more so it is not asked again at once', async () => {
        const error = { code: 'BLOCKED' as const, raw: 'Blocked by cloudflare.' };
        listed();
        mock.api.searchAnime.mockResolvedValue({ ok: false, error });

        await useAnimeStore.getState().loadMoreSearch();

        expect(useAnimeStore.getState().search).toMatchObject({ status: 'done', results: FIRST, error, hasNextPage: false, loadingMore: false });
    });

    it('does not use the answer when another search was made while it ran', async () => {
        let answer: (response: { ok: true; results: AnimeSearchResult[]; hasNextPage: boolean; limited: boolean }) => void = () => {
            return;
        };
        listed();
        mock.api.searchAnime.mockReturnValueOnce(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const loading = useAnimeStore.getState().loadMoreSearch();
        mock.api.searchAnime.mockResolvedValueOnce({ ok: true, results: [{ index: 1, title: 'Fresh' }], hasNextPage: false, limited: false });
        await useAnimeStore.getState().runSearch();
        answer({ ok: true, results: [...FIRST, { index: 3, title: 'Stale' }], hasNextPage: true, limited: false });
        await loading;

        expect(useAnimeStore.getState().search).toMatchObject({ results: [{ index: 1, title: 'Fresh' }], hasNextPage: false, loadingMore: false });
    });

    it('does not use the answer when the list was replaced by the anime of the library while it ran', async () => {
        let answer: (response: { ok: true; results: AnimeSearchResult[]; hasNextPage: boolean; limited: boolean }) => void = () => {
            return;
        };
        listed();
        mock.api.searchAnime.mockReturnValueOnce(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const loading = useAnimeStore.getState().loadMoreSearch();
        useAnimeStore.setState({ search: { ...useAnimeStore.getState().search, results: [{ index: 9, title: 'Opened' }], hasNextPage: false, loadingMore: false } });
        answer({ ok: true, results: [...FIRST, { index: 3, title: 'Stale' }], hasNextPage: true, limited: false });
        await loading;

        expect(useAnimeStore.getState().search).toMatchObject({ results: [{ index: 9, title: 'Opened' }], hasNextPage: false });
    });

    it('does not use the answer when the name was emptied while it ran', async () => {
        let answer: (response: { ok: true; results: AnimeSearchResult[]; hasNextPage: boolean; limited: boolean }) => void = () => {
            return;
        };
        listed();
        mock.api.searchAnime.mockReturnValueOnce(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const loading = useAnimeStore.getState().loadMoreSearch();
        useAnimeStore.getState().setQuery('');
        answer({ ok: true, results: [...FIRST, { index: 3, title: 'Stale' }], hasNextPage: true, limited: false });
        await loading;

        expect(useAnimeStore.getState().search).toMatchObject({ status: 'idle', results: [], hasNextPage: false, loadingMore: false });
    });
});

describe('openResult and closeResult', () => {
    beforeEach(() => {
        useAnimeStore.setState({ search: { ...INITIAL_SEARCH, results: [RESULT], status: 'done', searchedQuery: 'naruto', searchedAudio: 'dub' } });
    });

    it('loads the episodes of the result for the search it came from', async () => {
        mock.api.listAnimeEpisodes.mockResolvedValue({ ok: true, episodes: ['1', '2'] });
        const opening = useAnimeStore.getState().openResult(RESULT);
        expect(useAnimeStore.getState().selection).toEqual({ result: RESULT, query: 'naruto', audio: 'dub', status: 'loading', episodes: [], error: null });
        await opening;

        expect(mock.api.listAnimeEpisodes).toHaveBeenCalledWith('naruto', 2, 'dub');
        expect(useAnimeStore.getState().selection).toEqual({ result: RESULT, query: 'naruto', audio: 'dub', status: 'ready', episodes: ['1', '2'], error: null });
    });

    it('keeps the error when the episodes cannot be loaded', async () => {
        const error = { code: 'BLOCKED' as const, raw: 'Blocked by cloudflare.' };
        mock.api.listAnimeEpisodes.mockResolvedValue({ ok: false, error });
        await useAnimeStore.getState().openResult(RESULT);
        expect(useAnimeStore.getState().selection).toMatchObject({ status: 'error', error, episodes: [] });
    });

    it('ignores the answer when the user went back or opened another result meanwhile', async () => {
        let answer: (value: { ok: true; episodes: string[] }) => void = () => {
            return undefined;
        };
        mock.api.listAnimeEpisodes.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const opening = useAnimeStore.getState().openResult(RESULT);
        useAnimeStore.getState().closeResult();
        answer({ ok: true, episodes: ['1'] });
        await opening;
        expect(useAnimeStore.getState().selection).toBeNull();
    });

    it('closes the opened anime', () => {
        useAnimeStore.setState({ selection: { result: RESULT, query: 'naruto', audio: 'sub', status: 'ready', episodes: [], error: null } });
        useAnimeStore.getState().closeResult();
        expect(useAnimeStore.getState().selection).toBeNull();
    });
});

describe('openLibraryAnime', () => {
    const ANIME = makeAnime([], { id: 7, title: 'Naruto Shippuden', query: 'naruto shippuden', searchIndex: 3, audio: 'dub' });
    const OPENED: AnimeSearchResult = { index: 3, title: 'Naruto Shippuden' };

    it('goes to the search and opens the anime as if it had been found there', async () => {
        mock.api.listAnimeEpisodes.mockResolvedValue({ ok: true, episodes: ['1', '2', '3'] });
        useAnimeStore.setState({ view: 'library', returnView: 'library', search: { ...INITIAL_SEARCH, query: 'bleach', audio: 'sub', status: 'error', error: { code: 'BLOCKED', raw: 'x' } } });

        const opening = useAnimeStore.getState().openLibraryAnime(ANIME);
        expect(useAnimeStore.getState().view).toBe('search');
        expect(useAnimeStore.getState().returnView).toBe('search');
        expect(useAnimeStore.getState().search).toEqual({
            query: 'naruto shippuden',
            audio: 'dub',
            status: 'done',
            results: [OPENED],
            error: null,
            searchedQuery: 'naruto shippuden',
            searchedAudio: 'dub',
            hasNextPage: false,
            limited: false,
            loadingMore: false
        });
        expect(useAnimeStore.getState().selection).toEqual({ result: OPENED, query: 'naruto shippuden', audio: 'dub', status: 'loading', episodes: [], error: null });
        await opening;

        expect(mock.api.listAnimeEpisodes).toHaveBeenCalledTimes(1);
        expect(mock.api.listAnimeEpisodes).toHaveBeenCalledWith('naruto shippuden', 3, 'dub');
        expect(mock.api.searchAnime).not.toHaveBeenCalled();
        expect(useAnimeStore.getState().selection).toEqual({ result: OPENED, query: 'naruto shippuden', audio: 'dub', status: 'ready', episodes: ['1', '2', '3'], error: null });
    });

    it('keeps the anime as the only result, so going back from it lists it', async () => {
        mock.api.listAnimeEpisodes.mockResolvedValue({ ok: true, episodes: ['1'] });
        await useAnimeStore.getState().openLibraryAnime(ANIME);
        useAnimeStore.getState().closeResult();
        expect(useAnimeStore.getState().selection).toBeNull();
        expect(useAnimeStore.getState().search.results).toEqual([OPENED]);
    });

    it('keeps the error when the episodes cannot be loaded', async () => {
        const error = { code: 'BLOCKED' as const, raw: 'Blocked by cloudflare.' };
        mock.api.listAnimeEpisodes.mockResolvedValue({ ok: false, error });
        await useAnimeStore.getState().openLibraryAnime(ANIME);
        expect(useAnimeStore.getState().view).toBe('search');
        expect(useAnimeStore.getState().selection).toMatchObject({ status: 'error', error, episodes: [] });
    });
});

describe('openLibraryAnime for an anime that has the id of the source', () => {
    it('opens it as the result with its id, so it is told from the anime that has the same title', async () => {
        mock.api.listAnimeEpisodes.mockResolvedValue({ ok: true, episodes: ['1'] });
        const anime = makeAnime([], { id: 8, title: 'Nisekoi: False Love (season 2)', query: 'nisekoi', searchIndex: 2, audio: 'sub', sourceId: 'nisekoi-false-love-season-2-605' });
        await useAnimeStore.getState().openLibraryAnime(anime);
        const result = { index: 2, title: 'Nisekoi: False Love (season 2)', sourceId: 'nisekoi-false-love-season-2-605' };
        expect(useAnimeStore.getState().search.results).toEqual([result]);
        expect(useAnimeStore.getState().selection).toMatchObject({ result, query: 'nisekoi', audio: 'sub' });
    });

    it('opens an anime with no id as before, without one in the result', async () => {
        mock.api.listAnimeEpisodes.mockResolvedValue({ ok: true, episodes: ['1'] });
        await useAnimeStore.getState().openLibraryAnime(makeAnime([], { id: 9, title: 'Naruto', query: 'naruto', searchIndex: 1, sourceId: null }));
        expect(useAnimeStore.getState().search.results).toEqual([{ index: 1, title: 'Naruto' }]);
    });
});

describe('openLibraryAnime for an anime whose place in the search is not known', () => {
    const FOUND = makeAnime([], { id: 8, title: 'Re_Zero', query: 'Re_Zero', searchIndex: 0, audio: 'dub' });

    it('searches it by its title instead of opening an episode list with a position that means nothing', async () => {
        mock.api.searchAnime.mockResolvedValue({ ok: true, results: [{ index: 1, title: 'Re:Zero' }] });
        useAnimeStore.setState({ view: 'library', returnView: 'library', selection: { result: RESULT, query: 'x', audio: 'sub', status: 'ready', episodes: [], error: null } });

        await useAnimeStore.getState().openLibraryAnime(FOUND);

        expect(mock.api.searchAnime).toHaveBeenCalledTimes(1);
        expect(mock.api.searchAnime).toHaveBeenCalledWith('Re_Zero', 'dub');
        expect(mock.api.listAnimeEpisodes).not.toHaveBeenCalled();
        expect(useAnimeStore.getState()).toMatchObject({ view: 'search', returnView: 'search', selection: null });
        expect(useAnimeStore.getState().search).toMatchObject({
            query: 'Re_Zero',
            audio: 'dub',
            status: 'done',
            results: [{ index: 1, title: 'Re:Zero' }],
            searchedQuery: 'Re_Zero',
            searchedAudio: 'dub'
        });
    });

    it('shows the error of the search when it fails', async () => {
        const error = { code: 'BLOCKED' as const, raw: 'Blocked by cloudflare.' };
        mock.api.searchAnime.mockResolvedValue({ ok: false, error });
        await useAnimeStore.getState().openLibraryAnime(FOUND);
        expect(useAnimeStore.getState().search).toMatchObject({ status: 'error', error });
    });
});

describe('importLibrary', () => {
    it('asks the app to import a folder, refreshes the library and says what happened', async () => {
        const anime = makeAnime([makeEpisode({ id: 1 })]);
        mock.api.importAnimeLibrary.mockResolvedValue({ ok: true, added: 3, relinked: 1, skipped: 2, ignored: 4 });
        mock.api.listAnimeLibrary.mockResolvedValue([anime]);

        await useAnimeStore.getState().importLibrary();

        expect(mock.api.importAnimeLibrary).toHaveBeenCalledTimes(1);
        expect(useAnimeStore.getState().library).toEqual([anime]);
        expect(useAppStore.getState().notice).toEqual({
            kind: 'info',
            message: 'IMPORT DONE: 3 ADDED · 1 POINTED TO A NEW PLACE · 2 ALREADY IN THE LIBRARY · 4 NOT RECOGNIZED'
        });
    });

    it('says nothing and changes nothing when the user gives up', async () => {
        useAppStore.setState({ notice: null });
        mock.api.importAnimeLibrary.mockResolvedValue({ ok: false, reason: 'cancelled' });
        await useAnimeStore.getState().importLibrary();
        expect(mock.api.listAnimeLibrary).not.toHaveBeenCalled();
        expect(useAppStore.getState().notice).toBeNull();
    });

    it('says the folder has to be inside the anime folder, and changes nothing, when it is outside', async () => {
        mock.api.importAnimeLibrary.mockResolvedValue({ ok: false, reason: 'outside', folder: '/media/anime' });
        await useAnimeStore.getState().importLibrary();
        expect(mock.api.listAnimeLibrary).not.toHaveBeenCalled();
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'Only folders inside the anime folder can be imported: /media/anime' });
    });
});

describe('checkAudio', () => {
    const SUMMARY = { checked: 5, withoutAudio: 2, unreadable: 1, unreadableIds: [4], missing: 3 };

    it('asks the app to look at the audio, reads the library again and opens the report with every episode that has a problem', async () => {
        const library = [
            makeAnime([makeEpisode({ id: 1 }), makeEpisode({ id: 2, number: '2', noAudio: true }), makeEpisode({ id: 3, number: '3', fileMissing: true }), makeEpisode({ id: 4, number: '4' })], {
                id: 10,
                title: 'Naruto'
            })
        ];
        mock.api.checkAnimeAudio.mockResolvedValue({ ok: true, ...SUMMARY });
        mock.api.listAnimeLibrary.mockResolvedValue(library);

        await useAnimeStore.getState().checkAudio();

        expect(mock.api.checkAnimeAudio).toHaveBeenCalledTimes(1);
        expect(mock.api.listAnimeLibrary).toHaveBeenCalledTimes(1);
        expect(useAnimeStore.getState().library).toEqual(library);
        expect(useAnimeStore.getState().audioReport).toEqual({
            summary: SUMMARY,
            downloaded: 4,
            problems: [
                { animeId: 10, animeTitle: 'Naruto', episodeId: 2, episode: '2', kind: 'no-audio' },
                { animeId: 10, animeTitle: 'Naruto', episodeId: 3, episode: '3', kind: 'file-missing' },
                { animeId: 10, animeTitle: 'Naruto', episodeId: 4, episode: '4', kind: 'unreadable' }
            ]
        });
        expect(useAnimeStore.getState().checkingAudio).toBe(false);
    });

    it('opens a report with no problems when the library is fine', async () => {
        mock.api.checkAnimeAudio.mockResolvedValue({ ok: true, checked: 1, withoutAudio: 0, unreadable: 0, unreadableIds: [], missing: 0 });
        mock.api.listAnimeLibrary.mockResolvedValue([makeAnime([makeEpisode({ id: 1 })])]);

        await useAnimeStore.getState().checkAudio();

        expect(useAnimeStore.getState().audioReport).toEqual({ summary: { checked: 1, withoutAudio: 0, unreadable: 0, unreadableIds: [], missing: 0 }, downloaded: 1, problems: [] });
    });

    it('counts only the downloaded episodes of the library, so an empty library can be told from one with no problem', async () => {
        const library = [
            makeAnime([makeEpisode({ id: 1 }), makeEpisode({ id: 2, number: '2', status: 'error', filePath: null }), makeEpisode({ id: 3, number: '3', status: 'idle', filePath: null })], { id: 10 }),
            makeAnime([makeEpisode({ id: 4, animeId: 20, number: '1' })], { id: 20, title: 'Bleach' })
        ];
        mock.api.checkAnimeAudio.mockResolvedValue({ ok: true, checked: 2, withoutAudio: 0, unreadable: 0, unreadableIds: [], missing: 0 });
        mock.api.listAnimeLibrary.mockResolvedValue(library);

        await useAnimeStore.getState().checkAudio();

        expect(useAnimeStore.getState().audioReport?.downloaded).toBe(2);
    });

    it('reports no downloaded episode for an empty library', async () => {
        mock.api.checkAnimeAudio.mockResolvedValue({ ok: true, checked: 0, withoutAudio: 0, unreadable: 0, unreadableIds: [], missing: 0 });
        mock.api.listAnimeLibrary.mockResolvedValue([]);

        await useAnimeStore.getState().checkAudio();

        expect(useAnimeStore.getState().audioReport).toEqual({ summary: { checked: 0, withoutAudio: 0, unreadable: 0, unreadableIds: [], missing: 0 }, downloaded: 0, problems: [] });
    });

    it('says it is checking while the app looks', async () => {
        let answer: (response: { ok: true; checked: number; withoutAudio: number; unreadable: number; unreadableIds: number[]; missing: number }) => void = () => {
            return undefined;
        };
        mock.api.checkAnimeAudio.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );

        const running = useAnimeStore.getState().checkAudio();
        expect(useAnimeStore.getState().checkingAudio).toBe(true);
        expect(useAnimeStore.getState().audioReport).toBeNull();
        answer({ ok: true, checked: 0, withoutAudio: 0, unreadable: 0, unreadableIds: [], missing: 0 });
        await running;

        expect(useAnimeStore.getState().checkingAudio).toBe(false);
    });

    it('says a check is going on already, and opens no report, when the app answers busy', async () => {
        mock.api.checkAnimeAudio.mockResolvedValue({ ok: false, reason: 'busy' });

        await useAnimeStore.getState().checkAudio();

        expect(mock.api.listAnimeLibrary).not.toHaveBeenCalled();
        expect(useAnimeStore.getState().audioReport).toBeNull();
        expect(useAnimeStore.getState().checkingAudio).toBe(false);
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'The downloaded episodes are being checked already.' });
    });

    it('says nothing and opens no report where the section does not exist', async () => {
        useAppStore.setState({ notice: null });
        mock.api.checkAnimeAudio.mockResolvedValue({ ok: false, reason: 'unsupported' });

        await useAnimeStore.getState().checkAudio();

        expect(useAnimeStore.getState().audioReport).toBeNull();
        expect(useAppStore.getState().notice).toBeNull();
    });

    it('stops saying it is checking when the call fails', async () => {
        mock.api.checkAnimeAudio.mockRejectedValue(new Error('boom'));

        await expect(useAnimeStore.getState().checkAudio()).rejects.toThrow('boom');

        expect(useAnimeStore.getState().checkingAudio).toBe(false);
        expect(useAnimeStore.getState().audioReport).toBeNull();
    });
});

describe('the report of the audio check', () => {
    const PROBLEMS = [
        { animeId: 10, animeTitle: 'Naruto', episodeId: 2, episode: '2', kind: 'no-audio' as const },
        { animeId: 10, animeTitle: 'Naruto', episodeId: 3, episode: '3', kind: 'file-missing' as const }
    ];
    const SUMMARY = { checked: 5, withoutAudio: 1, unreadable: 0, unreadableIds: [], missing: 1 };

    it('closes', () => {
        useAnimeStore.setState({ audioReport: { summary: SUMMARY, downloaded: 5, problems: PROBLEMS } });

        useAnimeStore.getState().closeAudioReport();

        expect(useAnimeStore.getState().audioReport).toBeNull();
    });

    it('queues again every episode of the report in one call, closes it and says how many', async () => {
        useAnimeStore.setState({ audioReport: { summary: SUMMARY, downloaded: 5, problems: PROBLEMS } });

        await useAnimeStore.getState().redownloadProblems();

        expect(mock.api.redownloadAnimeEpisodes).toHaveBeenCalledTimes(1);
        expect(mock.api.redownloadAnimeEpisodes).toHaveBeenCalledWith([2, 3]);
        expect(useAnimeStore.getState().audioReport).toBeNull();
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'Queued 2 episode(s) to be downloaded again.' });
    });

    it('only closes a report with no problems', async () => {
        useAppStore.setState({ notice: null });
        useAnimeStore.setState({ audioReport: { summary: SUMMARY, downloaded: 5, problems: [] } });

        await useAnimeStore.getState().redownloadProblems();

        expect(mock.api.redownloadAnimeEpisodes).not.toHaveBeenCalled();
        expect(useAnimeStore.getState().audioReport).toBeNull();
        expect(useAppStore.getState().notice).toBeNull();
    });

    it('does nothing when there is no report', async () => {
        useAppStore.setState({ notice: null });

        await useAnimeStore.getState().redownloadProblems();

        expect(mock.api.redownloadAnimeEpisodes).not.toHaveBeenCalled();
        expect(useAppStore.getState().notice).toBeNull();
    });

    const MIXED = [...PROBLEMS, { animeId: 10, animeTitle: 'Naruto', episodeId: 4, episode: '4', kind: 'unreadable' as const }, { animeId: 11, animeTitle: 'Kaiju', episodeId: 5, episode: '1', kind: 'unreadable' as const }];

    it('does not queue again the episodes that could not be read: they are repaired, and a new download gives the same video', async () => {
        useAnimeStore.setState({ audioReport: { summary: SUMMARY, downloaded: 5, problems: MIXED } });

        await useAnimeStore.getState().redownloadProblems();

        expect(mock.api.redownloadAnimeEpisodes).toHaveBeenCalledWith([2, 3]);
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'Queued 2 episode(s) to be downloaded again.' });
    });

    it('only closes the report when everything in it could not be read, with nothing to queue again', async () => {
        useAppStore.setState({ notice: null });
        useAnimeStore.setState({ audioReport: { summary: SUMMARY, downloaded: 5, problems: MIXED.slice(2) } });

        await useAnimeStore.getState().redownloadProblems();

        expect(mock.api.redownloadAnimeEpisodes).not.toHaveBeenCalled();
        expect(useAnimeStore.getState().audioReport).toBeNull();
        expect(useAppStore.getState().notice).toBeNull();
    });

    it('repairs the episodes that could not be read in one call, closes the report, reads the library again and says how it went', async () => {
        const library = [makeAnime([makeEpisode({ id: 4 })], { id: 10, title: 'Naruto' })];
        mock.api.repairAnimeEpisodes.mockResolvedValue({ ok: true, repaired: 1, failed: 1, skipped: 0 });
        mock.api.listAnimeLibrary.mockResolvedValue(library);
        useAnimeStore.setState({ audioReport: { summary: SUMMARY, downloaded: 5, problems: MIXED } });

        await useAnimeStore.getState().repairProblems();

        expect(mock.api.repairAnimeEpisodes).toHaveBeenCalledTimes(1);
        expect(mock.api.repairAnimeEpisodes).toHaveBeenCalledWith([4, 5]);
        expect(mock.api.redownloadAnimeEpisodes).not.toHaveBeenCalled();
        expect(useAnimeStore.getState().audioReport).toBeNull();
        expect(mock.api.listAnimeLibrary).toHaveBeenCalledTimes(1);
        expect(useAnimeStore.getState().library).toEqual(library);
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: '1 episode(s) repaired · 1 could not be repaired.' });
    });

    it('says a repair is going on already, and leaves the library alone', async () => {
        mock.api.repairAnimeEpisodes.mockResolvedValue({ ok: false, reason: 'busy' });
        useAnimeStore.setState({ audioReport: { summary: SUMMARY, downloaded: 5, problems: MIXED } });

        await useAnimeStore.getState().repairProblems();

        expect(useAnimeStore.getState().audioReport).toBeNull();
        expect(mock.api.listAnimeLibrary).not.toHaveBeenCalled();
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'The episodes are being repaired already.' });
    });

    it('says nothing when this system cannot repair', async () => {
        useAppStore.setState({ notice: null });
        mock.api.repairAnimeEpisodes.mockResolvedValue({ ok: false, reason: 'unsupported' });
        useAnimeStore.setState({ audioReport: { summary: SUMMARY, downloaded: 5, problems: MIXED } });

        await useAnimeStore.getState().repairProblems();

        expect(mock.api.listAnimeLibrary).not.toHaveBeenCalled();
        expect(useAppStore.getState().notice).toBeNull();
    });

    it('does not repair, and keeps the report, when nothing in it could not be read', async () => {
        useAnimeStore.setState({ audioReport: { summary: SUMMARY, downloaded: 5, problems: PROBLEMS } });

        await useAnimeStore.getState().repairProblems();

        expect(mock.api.repairAnimeEpisodes).not.toHaveBeenCalled();
        expect(useAnimeStore.getState().audioReport).toEqual({ summary: SUMMARY, downloaded: 5, problems: PROBLEMS });
    });

    it('does nothing to repair when there is no report', async () => {
        await useAnimeStore.getState().repairProblems();

        expect(mock.api.repairAnimeEpisodes).not.toHaveBeenCalled();
    });

    it('downloads one episode again through the api, and not as a retry', async () => {
        await useAnimeStore.getState().redownloadEpisode(7);

        expect(mock.api.redownloadAnimeEpisode).toHaveBeenCalledWith(7);
        expect(mock.api.retryAnimeJob).not.toHaveBeenCalled();
    });
});

describe('migrateFolder', () => {
    it('asks the app to migrate, reads the library again and says how many episodes were moved', async () => {
        const anime = makeAnime([makeEpisode({ id: 1 })]);
        const moved = { ok: true as const, episodes: 5, files: 12, destination: '/new/anime' };
        mock.api.migrateAnimeFolder.mockResolvedValue(moved);
        mock.api.listAnimeLibrary.mockResolvedValue([anime]);

        expect(await useAnimeStore.getState().migrateFolder()).toEqual(moved);

        expect(mock.api.migrateAnimeFolder).toHaveBeenCalledTimes(1);
        expect(useAnimeStore.getState().library).toEqual([anime]);
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'MIGRATION DONE: 5 EPISODES MOVED TO /new/anime' });
        expect(useAnimeStore.getState().migration).toBeNull();
    });

    it('shows the migration as running (from zero) while it waits for the answer, and not after', async () => {
        let finish: (response: { ok: false; reason: 'cancelled' }) => void = () => {
            return;
        };
        mock.api.migrateAnimeFolder.mockReturnValue(
            new Promise((resolve) => {
                finish = resolve;
            })
        );
        const running = useAnimeStore.getState().migrateFolder();
        expect(useAnimeStore.getState().migration).toEqual({ done: 0, total: 0 });
        finish({ ok: false, reason: 'cancelled' });
        await running;
        expect(useAnimeStore.getState().migration).toBeNull();
    });

    it('follows the progress the app reports, once the store is listening', async () => {
        mock.api.getAnimeStatus.mockResolvedValue(SUPPORTED);
        await useAnimeStore.getState().init();
        mock.emitAnimeMigrationProgress({ done: 2, total: 9 });
        expect(useAnimeStore.getState().migration).toEqual({ done: 2, total: 9 });
        mock.emitAnimeMigrationProgress({ done: 9, total: 9 });
        expect(useAnimeStore.getState().migration).toEqual({ done: 9, total: 9 });
    });

    it('says nothing and does not read the library when the user gives up', async () => {
        useAppStore.setState({ notice: null });
        mock.api.migrateAnimeFolder.mockResolvedValue({ ok: false, reason: 'cancelled' });
        expect(await useAnimeStore.getState().migrateFolder()).toEqual({ ok: false, reason: 'cancelled' });
        expect(mock.api.listAnimeLibrary).not.toHaveBeenCalled();
        expect(useAppStore.getState().notice).toBeNull();
    });

    it.each([
        ['busy', 'A download or a migration is running. Wait for it to finish.'],
        ['same', 'That is already the anime folder.'],
        ['inside', 'Choose a folder that is not inside the current anime folder.'],
        ['conflict', 'The new folder already has files where the anime would be copied. Choose another folder.'],
        ['failed', 'The migration failed. What was copied was removed and nothing changed.']
    ] as const)('says why it did not happen when the app answers %s', async (reason, message) => {
        mock.api.migrateAnimeFolder.mockResolvedValue({ ok: false, reason });
        expect(await useAnimeStore.getState().migrateFolder()).toEqual({ ok: false, reason });
        expect(mock.api.listAnimeLibrary).not.toHaveBeenCalled();
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message });
        expect(useAnimeStore.getState().migration).toBeNull();
    });

    it('stops showing the migration as running when the app fails', async () => {
        mock.api.migrateAnimeFolder.mockRejectedValue(new Error('boom'));
        await expect(useAnimeStore.getState().migrateFolder()).rejects.toThrow('boom');
        expect(useAnimeStore.getState().migration).toBeNull();
    });
});

describe('setSeries', () => {
    it('joins an anime to a series and reads the library again', async () => {
        const anime = makeAnime([makeEpisode({ id: 1 })], { series: 'Frieren', season: 2 });
        mock.api.listAnimeLibrary.mockResolvedValue([anime]);
        expect(await useAnimeStore.getState().setSeries(1, 'Frieren', 2, 'Beyond the End')).toEqual({ ok: true });
        expect(mock.api.setAnimeSeries).toHaveBeenCalledTimes(1);
        expect(mock.api.setAnimeSeries).toHaveBeenCalledWith(1, 'Frieren', 2, 'Beyond the End');
        expect(useAnimeStore.getState().library).toEqual([anime]);
    });

    it('passes the season and the name to the app with the series the anime has', async () => {
        await useAnimeStore.getState().setSeries(1, 'Frieren', 3, null);
        expect(mock.api.setAnimeSeries).toHaveBeenCalledWith(1, 'Frieren', 3, null);
    });

    it('gives the answer as it is, with the season it suggests, and does not read the library, when it is refused', async () => {
        mock.api.setAnimeSeries.mockResolvedValue({ ok: false, reason: 'season-taken', suggested: 3 });
        expect(await useAnimeStore.getState().setSeries(1, 'Frieren', 2, null)).toEqual({ ok: false, reason: 'season-taken', suggested: 3 });
        expect(mock.api.listAnimeLibrary).not.toHaveBeenCalled();
    });

});

describe('downloadEpisodes with a series', () => {
    const selection = { result: RESULT, query: 'naruto', audio: 'dub' as const, status: 'ready' as const, episodes: ['1'], error: null };

    beforeEach(() => {
        useAnimeStore.setState({ selection });
        useAppStore.setState({ notice: null });
    });

    it('sends the series and the season the anime is saved under', async () => {
        mock.api.downloadAnime.mockResolvedValue({ ok: true, anime: makeAnime([]) });
        await useAnimeStore.getState().downloadEpisodes(['1'], { series: '  Naruto  Series ', season: 2, seasonName: ' The  Second ' });
        expect(mock.api.downloadAnime).toHaveBeenCalledWith({
            title: 'Naruto',
            query: 'naruto',
            index: 2,
            audio: 'dub',
            episodes: ['1'],
            series: 'Naruto Series',
            season: 2,
            seasonName: 'The Second'
        });
    });

    it('sends no name when it was left empty', async () => {
        mock.api.downloadAnime.mockResolvedValue({ ok: true, anime: makeAnime([]) });
        await useAnimeStore.getState().downloadEpisodes(['1'], { series: 'Naruto', season: 2, seasonName: '   ' });
        await useAnimeStore.getState().downloadEpisodes(['1'], { series: 'Naruto', season: 2 });
        expect(mock.api.downloadAnime).toHaveBeenNthCalledWith(1, expect.objectContaining({ series: 'Naruto', season: 2, seasonName: null }));
        expect(mock.api.downloadAnime).toHaveBeenNthCalledWith(2, expect.objectContaining({ series: 'Naruto', season: 2, seasonName: null }));
    });

    it('sends nothing about a series when there is none', async () => {
        mock.api.downloadAnime.mockResolvedValue({ ok: true, anime: makeAnime([]) });
        await useAnimeStore.getState().downloadEpisodes(['1'], null);
        await useAnimeStore.getState().downloadEpisodes(['1']);
        expect(mock.api.downloadAnime).toHaveBeenNthCalledWith(1, { title: 'Naruto', query: 'naruto', index: 2, audio: 'dub', episodes: ['1'] });
        expect(mock.api.downloadAnime).toHaveBeenNthCalledWith(2, { title: 'Naruto', query: 'naruto', index: 2, audio: 'dub', episodes: ['1'] });
    });

    it.each([
        ['a series name that is empty', { series: '   ', season: 1 }],
        ['a series name that is too long', { series: 'a'.repeat(101), season: 1 }],
        ['a season of zero', { series: 'Naruto', season: 0 }],
        ['a season over 99', { series: 'Naruto', season: 100 }],
        ['a season that is not whole', { series: 'Naruto', season: 1.5 }],
        ['a name that is too long', { series: 'Naruto', season: 1, seasonName: 'a'.repeat(61) }]
    ])('says so and downloads nothing with %s', async (_name, joined) => {
        await useAnimeStore.getState().downloadEpisodes(['1'], joined);
        expect(mock.api.downloadAnime).not.toHaveBeenCalled();
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'Give a series name (up to 100 characters), an order from 1 to 99 and a name of up to 60 characters.' });
    });
});

describe('downloadEpisodes', () => {
    const selection = { result: RESULT, query: 'naruto', audio: 'dub' as const, status: 'ready' as const, episodes: ['1', '2'], error: null };

    it('does nothing without an opened anime or without episodes', async () => {
        await useAnimeStore.getState().downloadEpisodes(['1']);
        useAnimeStore.setState({ selection });
        await useAnimeStore.getState().downloadEpisodes([]);
        expect(mock.api.downloadAnime).not.toHaveBeenCalled();
    });

    it('queues the episodes with the id of the source when the result has one', async () => {
        mock.api.downloadAnime.mockResolvedValue({ ok: true, anime: makeAnime([], { title: 'Naruto' }) });
        useAnimeStore.setState({ selection: { ...selection, result: { index: 2, title: 'Naruto', sourceId: 'naruto-12' } } });
        await useAnimeStore.getState().downloadEpisodes(['1']);
        expect(mock.api.downloadAnime).toHaveBeenCalledWith({ title: 'Naruto', query: 'naruto', index: 2, sourceId: 'naruto-12', audio: 'dub', episodes: ['1'] });
    });

    it('queues the episodes and says so', async () => {
        mock.api.downloadAnime.mockResolvedValue({ ok: true, anime: makeAnime([], { title: 'Naruto' }) });
        useAnimeStore.setState({ selection });

        await useAnimeStore.getState().downloadEpisodes(['1', '2']);

        expect(mock.api.downloadAnime).toHaveBeenCalledWith({ title: 'Naruto', query: 'naruto', index: 2, audio: 'dub', episodes: ['1', '2'] });
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'Queued 2 episode(s) of Naruto.' });
    });

    it('says why the download could not be queued', async () => {
        mock.api.downloadAnime.mockResolvedValue({ ok: false, message: 'The episodes are invalid.' });
        useAnimeStore.setState({ selection });
        await useAnimeStore.getState().downloadEpisodes(['1']);
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'Could not queue the download: The episodes are invalid.' });
    });

    it('writes the notice in the language of the settings', async () => {
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language: 'pt' } });
        mock.api.downloadAnime.mockResolvedValue({ ok: true, anime: makeAnime([], { title: 'Naruto' }) });
        useAnimeStore.setState({ selection });
        await useAnimeStore.getState().downloadEpisodes(['1']);
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: '1 episódio(s) de Naruto na fila.' });
    });
});

describe('watching without downloading', () => {
    const selection = { result: RESULT, query: 'naruto', audio: 'dub' as const, status: 'ready' as const, episodes: ['1', '2'], error: null };
    const STREAM = { sessionId: 's1', url: 'pullwave-stream://p/s1/abc', subtitleUrl: null, subtitles: [] };

    it('does nothing without an opened anime', async () => {
        await useAnimeStore.getState().watchEpisode('1');
        expect(mock.api.openAnimeStream).not.toHaveBeenCalled();
        expect(useAnimeStore.getState().streaming).toBeNull();
    });

    it('shows that the video is being found and then plays it', async () => {
        mock.api.openAnimeStream.mockResolvedValue({ ok: true, stream: STREAM });
        useAnimeStore.setState({ selection });

        const watching = useAnimeStore.getState().watchEpisode('2');
        expect(useAnimeStore.getState().streaming).toEqual({ title: 'Naruto', episode: '2', status: 'loading', stream: null, error: null, nextEpisode: null });
        await watching;

        expect(mock.api.openAnimeStream).toHaveBeenCalledWith({ query: 'naruto', index: 2, audio: 'dub', episode: '2' });
        expect(useAnimeStore.getState().streaming).toEqual({ title: 'Naruto', episode: '2', status: 'ready', stream: STREAM, error: null, nextEpisode: null });
    });

    it('keeps the error when the video cannot be found', async () => {
        const error = { code: 'NO_SOURCES' as const, raw: 'No sources found for dub!' };
        mock.api.openAnimeStream.mockResolvedValue({ ok: false, error });
        useAnimeStore.setState({ selection });
        await useAnimeStore.getState().watchEpisode('1');
        expect(useAnimeStore.getState().streaming).toEqual({ title: 'Naruto', episode: '1', status: 'error', stream: null, error, nextEpisode: '2' });
    });

    it('drops a stream that arrives after the user closed the player', async () => {
        let answer: (value: { ok: true; stream: typeof STREAM }) => void = () => {
            return undefined;
        };
        mock.api.openAnimeStream.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        useAnimeStore.setState({ selection });
        const watching = useAnimeStore.getState().watchEpisode('1');
        useAnimeStore.getState().closeStream();
        answer({ ok: true, stream: STREAM });
        await watching;

        expect(useAnimeStore.getState().streaming).toBeNull();
        expect(mock.api.closeAnimeStream).toHaveBeenCalledWith('s1');
    });

    it('ignores a failure that arrives after the user closed the player', async () => {
        let answer: (value: { ok: false; error: { code: 'NETWORK'; raw: string } }) => void = () => {
            return undefined;
        };
        mock.api.openAnimeStream.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        useAnimeStore.setState({ selection });
        const watching = useAnimeStore.getState().watchEpisode('1');
        useAnimeStore.getState().closeStream();
        answer({ ok: false, error: { code: 'NETWORK', raw: 'x' } });
        await watching;
        expect(useAnimeStore.getState().streaming).toBeNull();
        expect(mock.api.closeAnimeStream).not.toHaveBeenCalled();
    });

    it('knows the episode the source lists after the one being watched, and none after the last one', async () => {
        mock.api.openAnimeStream.mockResolvedValue({ ok: true, stream: STREAM });
        useAnimeStore.setState({ selection: { ...selection, episodes: ['1', '2', '3'] } });

        await useAnimeStore.getState().watchEpisode('1');
        expect(useAnimeStore.getState().streaming?.nextEpisode).toBe('2');
        await useAnimeStore.getState().watchEpisode('2');
        expect(useAnimeStore.getState().streaming?.nextEpisode).toBe('3');
        await useAnimeStore.getState().watchEpisode('3');
        expect(useAnimeStore.getState().streaming?.nextEpisode).toBeNull();
    });

    it('has no next episode for one the list does not have', async () => {
        mock.api.openAnimeStream.mockResolvedValue({ ok: true, stream: STREAM });
        useAnimeStore.setState({ selection });
        await useAnimeStore.getState().watchEpisode('9');
        expect(useAnimeStore.getState().streaming?.nextEpisode).toBeNull();
    });

    it('closes the stream of the episode that was playing when another one starts, and not before there was one', async () => {
        const SECOND_STREAM = { ...STREAM, sessionId: 's2' };
        mock.api.openAnimeStream.mockResolvedValueOnce({ ok: true, stream: STREAM }).mockResolvedValueOnce({ ok: true, stream: SECOND_STREAM });
        useAnimeStore.setState({ selection });

        await useAnimeStore.getState().watchEpisode('1');
        expect(mock.api.closeAnimeStream).not.toHaveBeenCalled();

        await useAnimeStore.getState().watchEpisode('2');
        expect(mock.api.closeAnimeStream).toHaveBeenCalledTimes(1);
        expect(mock.api.closeAnimeStream).toHaveBeenCalledWith('s1');
        expect(useAnimeStore.getState().streaming).toEqual({ title: 'Naruto', episode: '2', status: 'ready', stream: SECOND_STREAM, error: null, nextEpisode: null });
    });

    it('closes nothing when the episode before had no stream (it was loading or failed)', async () => {
        mock.api.openAnimeStream.mockResolvedValue({ ok: true, stream: STREAM });
        useAnimeStore.setState({ selection, streaming: { title: 'Naruto', episode: '1', status: 'error', stream: null, error: { code: 'NETWORK', raw: 'x' }, nextEpisode: '2' } });
        await useAnimeStore.getState().watchEpisode('2');
        expect(mock.api.closeAnimeStream).not.toHaveBeenCalled();
    });

    it('closes the stream the main process opened', () => {
        useAnimeStore.setState({ streaming: { title: 'Naruto', episode: '1', status: 'ready', stream: STREAM, error: null, nextEpisode: null } });
        useAnimeStore.getState().closeStream();
        expect(mock.api.closeAnimeStream).toHaveBeenCalledWith('s1');
        expect(useAnimeStore.getState().streaming).toBeNull();
    });

    it('has nothing to tell the main process when no stream was opened yet', () => {
        useAnimeStore.setState({ streaming: { title: 'Naruto', episode: '1', status: 'loading', stream: null, error: null, nextEpisode: null } });
        useAnimeStore.getState().closeStream();
        useAnimeStore.getState().closeStream();
        expect(mock.api.closeAnimeStream).not.toHaveBeenCalled();
        expect(useAnimeStore.getState().streaming).toBeNull();
    });
});

describe('jobs and library actions', () => {
    it('pauses and resumes through the api, by the episode', async () => {
        await useAnimeStore.getState().pauseJob(6);
        await useAnimeStore.getState().resumeJob(7);
        expect(mock.api.pauseAnimeJob).toHaveBeenCalledTimes(1);
        expect(mock.api.pauseAnimeJob).toHaveBeenCalledWith(6);
        expect(mock.api.resumeAnimeJob).toHaveBeenCalledTimes(1);
        expect(mock.api.resumeAnimeJob).toHaveBeenCalledWith(7);
        expect(mock.api.cancelAnimeJob).not.toHaveBeenCalled();
    });

    it('pauses and resumes every download at once', async () => {
        await useAnimeStore.getState().pauseAllJobs();
        expect(mock.api.pauseAllAnimeJobs).toHaveBeenCalledTimes(1);
        expect(mock.api.resumeAllAnimeJobs).not.toHaveBeenCalled();
        await useAnimeStore.getState().resumeAllJobs();
        expect(mock.api.resumeAllAnimeJobs).toHaveBeenCalledTimes(1);
        expect(mock.api.pauseAllAnimeJobs).toHaveBeenCalledTimes(1);
    });

    it('pauses, resumes and cancels the downloads of the anime given, and only of them', async () => {
        await useAnimeStore.getState().pauseAnimeJobs([3, 4]);
        expect(mock.api.pauseAnimes.mock.calls).toEqual([[[3, 4]]]);
        expect(mock.api.resumeAnimes).not.toHaveBeenCalled();
        expect(mock.api.cancelAnimes).not.toHaveBeenCalled();
        await useAnimeStore.getState().resumeAnimeJobs([5]);
        expect(mock.api.resumeAnimes.mock.calls).toEqual([[[5]]]);
        await useAnimeStore.getState().cancelAnimeJobs([6, 7]);
        expect(mock.api.cancelAnimes.mock.calls).toEqual([[[6, 7]]]);
        expect(mock.api.pauseAnimes).toHaveBeenCalledTimes(1);
        expect(mock.api.pauseAllAnimeJobs).not.toHaveBeenCalled();
        expect(mock.api.resumeAllAnimeJobs).not.toHaveBeenCalled();
    });

    it('tries again every download that failed or was cancelled, and none of the others', async () => {
        useAnimeStore.setState({
            jobs: (['running', 'queued', 'paused', 'error', 'cancelled'] as const).map((status, index) => {
                return makeAnimeJob({ episodeId: index + 1, status });
            })
        });

        await useAnimeStore.getState().retryFailedJobs();

        expect(mock.api.retryAnimeJob.mock.calls).toEqual([[4], [5]]);
    });

    it('tries nothing again when no download failed', async () => {
        useAnimeStore.setState({ jobs: [makeAnimeJob({ status: 'running' })] });
        await useAnimeStore.getState().retryFailedJobs();
        expect(mock.api.retryAnimeJob).not.toHaveBeenCalled();
    });

    it('cancels and retries through the api', async () => {
        await useAnimeStore.getState().cancelJob(4);
        await useAnimeStore.getState().retryJob(5);
        expect(mock.api.cancelAnimeJob).toHaveBeenCalledWith(4);
        expect(mock.api.retryAnimeJob).toHaveBeenCalledWith(5);
    });

    it('downloads an episode whose file is gone again through the api, and not as a retry', async () => {
        await useAnimeStore.getState().redownloadEpisode(7);
        expect(mock.api.redownloadAnimeEpisode).toHaveBeenCalledTimes(1);
        expect(mock.api.redownloadAnimeEpisode).toHaveBeenCalledWith(7);
        expect(mock.api.retryAnimeJob).not.toHaveBeenCalled();
    });

    it('clears the finished jobs and takes the list the main process kept', async () => {
        useAnimeStore.setState({ jobs: [makeAnimeJob({ status: 'done' }), makeAnimeJob({ episodeId: 2, status: 'running' })] });
        mock.api.listAnimeJobs.mockResolvedValue([makeAnimeJob({ episodeId: 2, status: 'running' })]);
        await useAnimeStore.getState().clearFinishedJobs();
        expect(mock.api.clearFinishedAnimeJobs).toHaveBeenCalledTimes(1);
        expect(useAnimeStore.getState().jobs).toEqual([makeAnimeJob({ episodeId: 2, status: 'running' })]);
    });

    it('removes an episode and drops its job', async () => {
        useAnimeStore.setState({ jobs: [makeAnimeJob({ episodeId: 1 }), makeAnimeJob({ episodeId: 2 })] });
        await useAnimeStore.getState().removeEpisode(1);
        expect(mock.api.removeAnimeEpisode).toHaveBeenCalledWith(1);
        expect(useAnimeStore.getState().jobs).toEqual([makeAnimeJob({ episodeId: 2 })]);
    });

    it('removes an anime and drops the jobs of its episodes', async () => {
        useAnimeStore.setState({ jobs: [makeAnimeJob({ episodeId: 1, animeId: 1 }), makeAnimeJob({ episodeId: 2, animeId: 2 })] });
        await useAnimeStore.getState().removeAnime(1);
        expect(mock.api.removeAnime).toHaveBeenCalledWith(1);
        expect(useAnimeStore.getState().jobs).toEqual([makeAnimeJob({ episodeId: 2, animeId: 2 })]);
    });

    describe('setWatched', () => {
        const EPISODE = makeEpisode({ id: 3, number: '3', positionSeconds: 12, durationSeconds: 1400 });

        beforeEach(() => {
            useAnimeStore.setState({ library: [makeAnime([makeEpisode({ id: 1 }), EPISODE], { id: 9 })] });
        });

        it('marks an episode as watched, keeps the position and takes the library the main process kept', async () => {
            const updated = makeAnime([makeEpisode({ id: 1 }), { ...EPISODE, watched: true }], { id: 9 });
            mock.api.listAnimeLibrary.mockResolvedValue([updated]);
            await useAnimeStore.getState().setWatched(3, true);
            expect(mock.api.saveAnimeProgress).toHaveBeenCalledTimes(1);
            expect(mock.api.saveAnimeProgress).toHaveBeenCalledWith({ episodeId: 3, positionSeconds: 12, durationSeconds: 1400, watched: true });
            expect(useAnimeStore.getState().library).toEqual([updated]);
        });

        it('marks an episode as not watched', async () => {
            await useAnimeStore.getState().setWatched(3, false);
            expect(mock.api.saveAnimeProgress).toHaveBeenCalledWith({ episodeId: 3, positionSeconds: 12, durationSeconds: 1400, watched: false });
        });

        it('does nothing for an episode that is not in the library', async () => {
            await useAnimeStore.getState().setWatched(99, true);
            expect(mock.api.saveAnimeProgress).not.toHaveBeenCalled();
            expect(mock.api.listAnimeLibrary).not.toHaveBeenCalled();
        });
    });

    it('saves the progress and refreshes the library', async () => {
        const update = { episodeId: 3, positionSeconds: 12, durationSeconds: 1400, watched: false };
        await useAnimeStore.getState().saveProgress(update);
        expect(mock.api.saveAnimeProgress).toHaveBeenCalledWith(update);

        const anime = makeAnime([makeEpisode({ positionSeconds: 12 })]);
        mock.api.listAnimeLibrary.mockResolvedValue([anime]);
        await useAnimeStore.getState().refreshLibrary();
        expect(useAnimeStore.getState().library).toEqual([anime]);
    });
});

describe('the history', () => {
    const ENTRY: AnimeHistoryEntry = { id: 1, title: 'Naruto', query: 'naruto', searchIndex: 2, audio: 'dub', episode: null, openedAt: 10, watchedAt: null };
    const WATCHED: AnimeHistoryEntry = { id: 2, title: 'Bleach', query: 'bleach', searchIndex: 4, audio: 'sub', episode: '12', openedAt: 20, watchedAt: 20 };

    it('is loaded with the section', async () => {
        mock.api.getAnimeStatus.mockResolvedValue(SUPPORTED);
        mock.api.listAnimeHistory.mockResolvedValue([WATCHED, ENTRY]);
        await useAnimeStore.getState().init();
        expect(mock.api.listAnimeHistory).toHaveBeenCalledTimes(1);
        expect(useAnimeStore.getState().history).toEqual([WATCHED, ENTRY]);
    });

    it('is read again on demand', async () => {
        mock.api.listAnimeHistory.mockResolvedValue([ENTRY]);
        await useAnimeStore.getState().refreshHistory();
        expect(useAnimeStore.getState().history).toEqual([ENTRY]);
    });

    describe('recording', () => {
        beforeEach(() => {
            mock.api.listAnimeHistory.mockResolvedValue([ENTRY]);
            mock.api.listAnimeEpisodes.mockResolvedValue({ ok: true, episodes: ['1'] });
        });

        it('records an anime that is opened from the search, with the search it came from and no episode, then reads the history', async () => {
            useAnimeStore.setState({ search: { ...INITIAL_SEARCH, results: [RESULT], status: 'done', searchedQuery: 'naruto', searchedAudio: 'dub' } });
            await useAnimeStore.getState().openResult(RESULT);
            await vi.waitFor(() => {
                expect(useAnimeStore.getState().history).toEqual([ENTRY]);
            });
            expect(mock.api.recordAnimeHistory).toHaveBeenCalledTimes(1);
            expect(mock.api.recordAnimeHistory).toHaveBeenCalledWith({ title: 'Naruto', query: 'naruto', index: 2, audio: 'dub', episode: null });
        });

        it('records the episode of the library that is played', async () => {
            useAnimeStore.setState({ library: [makeAnime([makeEpisode({ id: 7, animeId: 3, number: '5' })], { id: 3, title: 'Bleach', query: 'bleach', searchIndex: 4, audio: 'sub' })] });
            useAnimeStore.getState().play(3, 7);
            await vi.waitFor(() => {
                expect(useAnimeStore.getState().history).toEqual([ENTRY]);
            });
            expect(mock.api.recordAnimeHistory).toHaveBeenCalledWith({ title: 'Bleach', query: 'bleach', index: 4, audio: 'sub', episode: '5' });
        });

        it('opens the player without recording when the episode is not in the library', () => {
            useAnimeStore.getState().play(3, 7);
            expect(useAnimeStore.getState().playing).toEqual({ animeId: 3, episodeId: 7 });
            expect(mock.api.recordAnimeHistory).not.toHaveBeenCalled();
        });

        it('does not record an episode that belongs to another anime of the library', () => {
            useAnimeStore.setState({ library: [makeAnime([makeEpisode({ id: 7, animeId: 3, number: '5' })], { id: 3 })] });
            useAnimeStore.getState().play(3, 99);
            expect(mock.api.recordAnimeHistory).not.toHaveBeenCalled();
        });

        it('records the episode that is watched without downloading it', async () => {
            mock.api.openAnimeStream.mockResolvedValue({ ok: true, stream: { sessionId: 's1', url: 'pullwave-stream://p/s1/abc', subtitleUrl: null } });
            useAnimeStore.setState({ selection: { result: RESULT, query: 'naruto', audio: 'dub', status: 'ready', episodes: ['1', '2'], error: null } });
            await useAnimeStore.getState().watchEpisode('2');
            await vi.waitFor(() => {
                expect(useAnimeStore.getState().history).toEqual([ENTRY]);
            });
            expect(mock.api.recordAnimeHistory).toHaveBeenCalledWith({ title: 'Naruto', query: 'naruto', index: 2, audio: 'dub', episode: '2' });
        });

        it('does not record when there is no opened anime to watch', async () => {
            await useAnimeStore.getState().watchEpisode('2');
            expect(mock.api.recordAnimeHistory).not.toHaveBeenCalled();
        });

        it('goes on when the history cannot be kept', async () => {
            mock.api.recordAnimeHistory.mockRejectedValue(new Error('disk full'));
            useAnimeStore.setState({ library: [makeAnime([makeEpisode({ id: 7, animeId: 3, number: '5' })], { id: 3 })] });
            useAnimeStore.getState().play(3, 7);
            await vi.waitFor(() => {
                expect(mock.api.recordAnimeHistory).toHaveBeenCalledTimes(1);
            });
            expect(useAnimeStore.getState().playing).toEqual({ animeId: 3, episodeId: 7 });
            expect(mock.api.listAnimeHistory).not.toHaveBeenCalled();
        });
    });

    it('removes one entry and reads the history', async () => {
        useAnimeStore.setState({ history: [WATCHED, ENTRY] });
        mock.api.listAnimeHistory.mockResolvedValue([ENTRY]);
        await useAnimeStore.getState().removeHistoryEntry(2);
        expect(mock.api.removeAnimeHistory).toHaveBeenCalledWith(2);
        expect(useAnimeStore.getState().history).toEqual([ENTRY]);
    });

    it('clears every entry', async () => {
        useAnimeStore.setState({ history: [WATCHED, ENTRY] });
        await useAnimeStore.getState().clearHistory();
        expect(mock.api.clearAnimeHistory).toHaveBeenCalledTimes(1);
        expect(useAnimeStore.getState().history).toEqual([]);
    });

    it('opens an entry as an anime of the search, with the search it was found in', async () => {
        mock.api.listAnimeEpisodes.mockResolvedValue({ ok: true, episodes: ['1', '2'] });
        useAnimeStore.setState({ view: 'history' });
        await useAnimeStore.getState().openLibraryAnime(ENTRY);

        expect(mock.api.listAnimeEpisodes).toHaveBeenCalledWith('naruto', 2, 'dub');
        expect(useAnimeStore.getState()).toMatchObject({
            view: 'search',
            returnView: 'search',
            selection: { result: { index: 2, title: 'Naruto' }, query: 'naruto', audio: 'dub', status: 'ready', episodes: ['1', '2'] }
        });
    });

    it('opens an entry whose place in the search is not known by searching its title', async () => {
        mock.api.searchAnime.mockResolvedValue({ ok: true, results: [RESULT] });
        await useAnimeStore.getState().openLibraryAnime({ ...ENTRY, searchIndex: 0 });
        expect(mock.api.searchAnime).toHaveBeenCalledWith('naruto', 'dub');
        expect(useAnimeStore.getState()).toMatchObject({ view: 'search', selection: null });
    });
});

describe('openHistoryEntry', () => {
    const ENTRY: AnimeHistoryEntry = { id: 1, title: 'Naruto', query: 'naruto', searchIndex: 2, audio: 'dub', episode: null, openedAt: 10, watchedAt: null };

    beforeEach(() => {
        mock.api.listAnimeLibrary.mockResolvedValue([]);
    });

    it('opens the series in the library when the anime of the entry is there (same title and audio), without searching', async () => {
        useAnimeStore.setState({ view: 'history', library: [makeAnime([], { id: 7, title: 'Naruto', audio: 'dub' })] });
        await useAnimeStore.getState().openHistoryEntry(ENTRY);

        expect(mock.api.listAnimeEpisodes).not.toHaveBeenCalled();
        expect(mock.api.searchAnime).not.toHaveBeenCalled();
        expect(useAnimeStore.getState()).toMatchObject({ view: 'library', returnView: 'library', selection: null, libraryFocus: 7, librarySeries: 'anime-7' });
    });

    it('opens the series of an anime that belongs to one, by the key of the series', async () => {
        useAnimeStore.setState({ library: [makeAnime([], { id: 8, title: 'Naruto', audio: 'dub', series: 'Naruto Saga', season: 1 })] });
        await useAnimeStore.getState().openHistoryEntry(ENTRY);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'library', libraryFocus: 8, librarySeries: 'series-naruto saga' });
    });

    it('opens the entry in the search, with its episodes, when the anime is not in the library', async () => {
        mock.api.listAnimeEpisodes.mockResolvedValue({ ok: true, episodes: ['1', '2'] });
        useAnimeStore.setState({ view: 'history', library: [] });
        await useAnimeStore.getState().openHistoryEntry(ENTRY);

        expect(mock.api.listAnimeEpisodes).toHaveBeenCalledWith('naruto', 2, 'dub');
        expect(useAnimeStore.getState()).toMatchObject({
            view: 'search',
            returnView: 'search',
            selection: { result: { index: 2, title: 'Naruto' }, query: 'naruto', audio: 'dub', status: 'ready', episodes: ['1', '2'] }
        });
    });

    it('opens it in the search when the library has the title with another audio only', async () => {
        mock.api.listAnimeEpisodes.mockResolvedValue({ ok: true, episodes: ['1'] });
        useAnimeStore.setState({ library: [makeAnime([], { id: 7, title: 'Naruto', audio: 'sub' })] });
        await useAnimeStore.getState().openHistoryEntry(ENTRY);
        expect(useAnimeStore.getState()).toMatchObject({ view: 'search', librarySeries: null });
        expect(mock.api.listAnimeEpisodes).toHaveBeenCalledWith('naruto', 2, 'dub');
    });
});

describe('the schedule', () => {
    const NOW = new Date('2026-10-03T15:30:00Z');
    const TOKYO = 'Asia/Tokyo';
    const FRIEREN = makeScheduleEntry();
    const DANDADAN = makeScheduleEntry({ anilistId: 2, title: 'Dandadan', names: ['Dandadan', 'Dan Da Dan'], episode: 3, airingAt: 1_700_043_600 });

    function setSchedule(overrides: Partial<AnimeScheduleState> = {}): void {
        useAnimeStore.setState({ schedule: { ...INITIAL_SCHEDULE, timeZone: TOKYO, ...overrides } });
    }

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('loadSchedule', () => {
        it('asks for the day of today in the time zone that is set and shows what came', async () => {
            setSchedule();
            mock.api.listAnimeSchedule.mockResolvedValue({ ok: true, entries: [FRIEREN, DANDADAN] });
            const limits = zonedDayLimits(NOW.getTime(), TOKYO, 1);

            const loading = useAnimeStore.getState().loadSchedule();
            expect(useAnimeStore.getState().schedule).toEqual({ status: 'loading', entries: [], error: null, view: 'day', timeZone: TOKYO, limits });
            await loading;

            expect(limits).toEqual([1_791_039_600, 1_791_126_000]);
            expect(mock.api.listAnimeSchedule).toHaveBeenCalledTimes(1);
            expect(mock.api.listAnimeSchedule).toHaveBeenCalledWith({ from: 1_791_039_600, to: 1_791_126_000, refresh: false });
            expect(useAnimeStore.getState().schedule).toEqual({ status: 'ready', entries: [FRIEREN, DANDADAN], error: null, view: 'day', timeZone: TOKYO, limits });
        });

        it('asks for the seven days that start with today in the week view', async () => {
            setSchedule({ view: 'week' });

            await useAnimeStore.getState().loadSchedule();

            const limits = zonedDayLimits(NOW.getTime(), TOKYO, 7);
            expect(limits).toHaveLength(8);
            expect(mock.api.listAnimeSchedule).toHaveBeenCalledWith({ from: 1_791_039_600, to: 1_791_039_600 + 7 * 86_400, refresh: false });
            expect(useAnimeStore.getState().schedule.limits).toEqual(limits);
        });

        it('counts the days in the time zone that is set, not in the one of the machine', async () => {
            setSchedule({ timeZone: 'America/Sao_Paulo' });

            await useAnimeStore.getState().loadSchedule();

            // 15:30 UTC is still October 3 in Brazil, which starts at 03:00 UTC.
            expect(mock.api.listAnimeSchedule).toHaveBeenCalledWith({ from: 1_790_996_400, to: 1_791_082_800, refresh: false });
        });

        it('keeps what is on the screen while it is listed again', async () => {
            setSchedule({ status: 'ready', entries: [FRIEREN] });
            mock.api.listAnimeSchedule.mockResolvedValue({ ok: true, entries: [DANDADAN] });

            const loading = useAnimeStore.getState().loadSchedule();
            expect(useAnimeStore.getState().schedule.entries).toEqual([FRIEREN]);
            expect(useAnimeStore.getState().schedule.status).toBe('loading');
            await loading;

            expect(useAnimeStore.getState().schedule.entries).toEqual([DANDADAN]);
        });

        it('shows the error and no entries when the schedule could not be had', async () => {
            const error = { code: 'NETWORK' as const, raw: 'AniList answered with status 429.' };
            setSchedule({ status: 'ready', entries: [FRIEREN] });
            mock.api.listAnimeSchedule.mockResolvedValue({ ok: false, error });

            await useAnimeStore.getState().loadSchedule();

            expect(useAnimeStore.getState().schedule).toMatchObject({ status: 'error', entries: [], error });
        });

        it('drops the answer of a listing that is not the last one asked for', async () => {
            setSchedule();
            let answerFirst: (value: { ok: true; entries: AnimeScheduleEntry[] }) => void = () => {
                return undefined;
            };
            mock.api.listAnimeSchedule.mockImplementationOnce(() => {
                return new Promise((resolve) => {
                    answerFirst = resolve;
                });
            });
            const first = useAnimeStore.getState().loadSchedule();
            mock.api.listAnimeSchedule.mockResolvedValueOnce({ ok: true, entries: [DANDADAN] });
            await useAnimeStore.getState().loadSchedule();

            answerFirst({ ok: true, entries: [FRIEREN] });
            await first;

            expect(useAnimeStore.getState().schedule.entries).toEqual([DANDADAN]);
        });
    });

    describe('setScheduleView and setScheduleTimeZone', () => {
        beforeEach(() => {
            window.localStorage.clear();
        });

        it('keep the choice of the time zone for the next time, but not the one of the view', () => {
            useAnimeStore.getState().setScheduleView('week');
            useAnimeStore.getState().setScheduleTimeZone('Europe/Lisbon');

            expect(window.localStorage.getItem('pullwave-schedule-view')).toBeNull();
            expect(window.localStorage.getItem('pullwave-schedule-time-zone')).toBe('Europe/Lisbon');
        });

        it('start the store on the day, with the time zone that was chosen the last time', async () => {
            window.localStorage.setItem('pullwave-schedule-time-zone', 'Europe/Lisbon');
            vi.resetModules();

            const fresh = await import('@renderer/store/animeStore');

            expect(fresh.useAnimeStore.getState().schedule).toEqual({ ...fresh.INITIAL_SCHEDULE, view: 'day', timeZone: 'Europe/Lisbon' });
        });

        it('start the store on the day even when an older version saved the week', async () => {
            window.localStorage.setItem('pullwave-schedule-view', 'week');
            vi.resetModules();

            const fresh = await import('@renderer/store/animeStore');

            expect(fresh.useAnimeStore.getState().schedule).toEqual({ ...fresh.INITIAL_SCHEDULE, view: 'day', timeZone: machineTimeZone() });
        });

        it('start the store with the day and the time zone of the machine when nothing was chosen', async () => {
            vi.resetModules();

            const fresh = await import('@renderer/store/animeStore');

            expect(fresh.useAnimeStore.getState().schedule).toEqual({ ...fresh.INITIAL_SCHEDULE, view: 'day', timeZone: machineTimeZone() });
        });

        it('start the store with the machine time zone when the one that was chosen does not exist', async () => {
            window.localStorage.setItem('pullwave-schedule-view', 'week');
            window.localStorage.setItem('pullwave-schedule-time-zone', 'Mars/Olympus');
            vi.resetModules();

            const fresh = await import('@renderer/store/animeStore');

            expect(fresh.useAnimeStore.getState().schedule).toMatchObject({ view: 'day', timeZone: machineTimeZone() });
        });

        it('change the view and clear what was listed for the other one', () => {
            setSchedule({ status: 'ready', entries: [FRIEREN] });

            useAnimeStore.getState().setScheduleView('week');

            expect(useAnimeStore.getState().schedule).toMatchObject({ view: 'week', timeZone: TOKYO, entries: [], status: 'ready' });
        });

        it('change the time zone and clear what was listed for the other one', () => {
            setSchedule({ status: 'ready', entries: [FRIEREN], view: 'week' });

            useAnimeStore.getState().setScheduleTimeZone('Europe/Lisbon');

            expect(useAnimeStore.getState().schedule).toMatchObject({ view: 'week', timeZone: 'Europe/Lisbon', entries: [], status: 'ready' });
        });
    });

    describe('openScheduleEntry', () => {
        beforeEach(() => {
            useAnimeStore.setState({ view: 'schedule', returnView: 'schedule', selection: { result: RESULT, query: 'old', audio: 'sub', status: 'ready', episodes: ['1'], error: null } });
        });

        it('goes to the search and looks the anime up by its title', async () => {
            mock.api.searchAnime.mockResolvedValue({ ok: true, results: [{ index: 1, title: 'Frieren: Beyond Journey\'s End' }] });

            await useAnimeStore.getState().openScheduleEntry(FRIEREN);

            expect(mock.api.searchAnime).toHaveBeenCalledTimes(1);
            expect(mock.api.searchAnime).toHaveBeenCalledWith('Sousou no Frieren', 'sub');
            expect(useAnimeStore.getState()).toMatchObject({ view: 'search', returnView: 'search', selection: null });
            expect(useAnimeStore.getState().search).toMatchObject({
                query: 'Sousou no Frieren',
                status: 'done',
                results: [{ index: 1, title: 'Frieren: Beyond Journey\'s End' }],
                searchedQuery: 'Sousou no Frieren',
                searchedAudio: 'sub'
            });
        });

        it('searches with the audio of the settings, or the one picked on the screen', async () => {
            useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, animeAudio: 'dub' } });
            mock.api.searchAnime.mockResolvedValue({ ok: true, results: [{ index: 1, title: 'Dandadan' }] });

            await useAnimeStore.getState().openScheduleEntry(DANDADAN);

            expect(mock.api.searchAnime).toHaveBeenCalledWith('Dandadan', 'dub');
        });

        it('tries the next name when the search for the first finds nothing, and stops at the first that finds the anime', async () => {
            mock.api.searchAnime
                .mockResolvedValueOnce({ ok: false, error: { code: 'NO_RESULTS', raw: 'No results found!' } })
                .mockResolvedValueOnce({ ok: true, results: [{ index: 2, title: 'Dan Da Dan' }] });

            await useAnimeStore.getState().openScheduleEntry(makeScheduleEntry({ title: 'Dandadan', names: ['Dandadan', 'Dan Da Dan', 'Third name'] }));

            expect(mock.api.searchAnime.mock.calls).toEqual([
                ['Dandadan', 'sub'],
                ['Dan Da Dan', 'sub']
            ]);
            expect(useAnimeStore.getState().search).toMatchObject({ query: 'Dan Da Dan', status: 'done', results: [{ index: 2, title: 'Dan Da Dan' }] });
        });

        it('tries the next name when the search finds an empty list', async () => {
            mock.api.searchAnime.mockResolvedValueOnce({ ok: true, results: [] }).mockResolvedValueOnce({ ok: true, results: [{ index: 1, title: 'Dan Da Dan' }] });

            await useAnimeStore.getState().openScheduleEntry(DANDADAN);

            expect(mock.api.searchAnime).toHaveBeenCalledTimes(2);
        });

        it('tries no more than a few names and leaves the last search on the screen when none finds the anime', async () => {
            const error = { code: 'NO_RESULTS' as const, raw: 'No results found!' };
            mock.api.searchAnime.mockResolvedValue({ ok: false, error });

            await useAnimeStore.getState().openScheduleEntry(makeScheduleEntry({ title: 'One', names: ['One', 'Two', 'Three', 'Four', 'Five'] }));

            expect(MAX_SCHEDULE_SEARCH_NAMES).toBe(3);
            expect(mock.api.searchAnime.mock.calls).toEqual([
                ['One', 'sub'],
                ['Two', 'sub'],
                ['Three', 'sub']
            ]);
            expect(useAnimeStore.getState().search).toMatchObject({ query: 'Three', status: 'error', error });
        });

        it('searches by the title when the entry has no names', async () => {
            mock.api.searchAnime.mockResolvedValue({ ok: true, results: [{ index: 1, title: 'Dandadan' }] });

            await useAnimeStore.getState().openScheduleEntry(makeScheduleEntry({ title: 'Dandadan', names: [] }));

            expect(mock.api.searchAnime.mock.calls).toEqual([['Dandadan', 'sub']]);
        });
    });

    describe('the releases of an anime', () => {
        it('says it to the main process and reads the library again', async () => {
            const anime = makeAnime([makeEpisode()], { id: 4, airing: { status: 'finished', override: 'ongoing', complete: false } });
            mock.api.listAnimeLibrary.mockResolvedValue([anime]);

            await useAnimeStore.getState().setAiring(4, 'ongoing');

            expect(mock.api.setAnimeAiring).toHaveBeenCalledTimes(1);
            expect(mock.api.setAnimeAiring).toHaveBeenCalledWith(4, 'ongoing');
            expect(useAnimeStore.getState().library).toEqual([anime]);
        });

        it('goes back to following AniList when null is given', async () => {
            await useAnimeStore.getState().setAiring(4, null);

            expect(mock.api.setAnimeAiring).toHaveBeenCalledWith(4, null);
        });
    });

    describe('updates', () => {
        const ENTRY: AnimeUpdateEntry = {
            id: 1,
            animeId: 1,
            animeTitle: 'Naruto',
            audio: 'sub',
            episodeId: 7,
            episodeNumber: '3',
            foundAt: 1_700_000_000_000,
            origin: 'auto',
            status: 'idle'
        };

        beforeEach(() => {
            useAnimeStore.setState({ updates: [], checkingNew: null, library: [], view: 'updates', returnView: 'updates' });
            useAppStore.setState({ toasts: [] });
            mock.api.getAnimeStatus.mockResolvedValue(SUPPORTED);
        });

        function toasts(): string[] {
            return useAppStore.getState().toasts.map((toast) => {
                return toast.message;
            });
        }

        it('starts with no updates and nothing being checked', () => {
            expect(initialAnime.updates).toEqual([]);
            expect(initialAnime.checkingNew).toBeNull();
        });

        it('keeps the list the main process gives', async () => {
            mock.api.listAnimeUpdates.mockResolvedValue([ENTRY]);

            await useAnimeStore.getState().loadUpdates();

            expect(mock.api.listAnimeUpdates).toHaveBeenCalledTimes(1);
            expect(useAnimeStore.getState().updates).toEqual([ENTRY]);
        });

        it('empties the list after asking the main process to clear it', async () => {
            useAnimeStore.setState({ updates: [ENTRY] });

            await useAnimeStore.getState().clearUpdates();

            expect(mock.api.clearAnimeUpdates).toHaveBeenCalledTimes(1);
            expect(useAnimeStore.getState().updates).toEqual([]);
        });

        it('goes to the anime of an update in the library, opened on its card', () => {
            const naruto = makeAnime([makeEpisode({ id: 7, animeId: 1, number: '3' })], { id: 1, title: 'Naruto' });
            useAnimeStore.setState({ library: [naruto] });

            useAnimeStore.getState().openFromUpdate(ENTRY);

            expect(useAnimeStore.getState()).toMatchObject({ view: 'library', returnView: 'library', selection: null, libraryFocus: 1, librarySeries: 'anime-1' });
        });

        describe('checkNewEpisodes', () => {
            it('asks for every anime when none is given, shows it is looking meanwhile, and reloads the library and the list', async () => {
                let seenWhileAsking: unknown = null;
                mock.api.checkNewAnimeEpisodes.mockImplementation(async () => {
                    seenWhileAsking = useAnimeStore.getState().checkingNew;
                    return { ok: true, count: 1, titles: ['Naruto'], notDownloaded: [], failed: 0, skipped: 0 };
                });
                mock.api.listAnimeUpdates.mockResolvedValue([ENTRY]);
                mock.api.listAnimeLibrary.mockResolvedValue([makeAnime([makeEpisode()])]);

                await useAnimeStore.getState().checkNewEpisodes(null);

                expect(mock.api.checkNewAnimeEpisodes).toHaveBeenCalledTimes(1);
                expect(mock.api.checkNewAnimeEpisodes).toHaveBeenCalledWith(null);
                expect(seenWhileAsking).toBe('all');
                expect(useAnimeStore.getState().checkingNew).toBeNull();
                expect(useAnimeStore.getState().library).toHaveLength(1);
                expect(useAnimeStore.getState().updates).toEqual([ENTRY]);
                expect(toasts()).toEqual([]);
            });

            it('asks for one anime when its id is given', async () => {
                let seenWhileAsking: unknown = null;
                mock.api.checkNewAnimeEpisodes.mockImplementation(async () => {
                    seenWhileAsking = useAnimeStore.getState().checkingNew;
                    return { ok: true, count: 1, titles: ['Naruto'], notDownloaded: [], failed: 0, skipped: 0 };
                });

                await useAnimeStore.getState().checkNewEpisodes(4);

                expect(mock.api.checkNewAnimeEpisodes).toHaveBeenCalledWith(4);
                expect(seenWhileAsking).toBe(4);
                expect(useAnimeStore.getState().checkingNew).toBeNull();
            });

            it('does not reload the list when the updates are not on the screen', async () => {
                useAnimeStore.setState({ view: 'library' });
                mock.api.checkNewAnimeEpisodes.mockResolvedValue({ ok: true, count: 1, titles: ['Naruto'], notDownloaded: [], failed: 0, skipped: 0 });

                await useAnimeStore.getState().checkNewEpisodes(null);

                expect(mock.api.listAnimeUpdates).not.toHaveBeenCalled();
                expect(mock.api.listAnimeLibrary).toHaveBeenCalledTimes(1);
            });

            it('says there is nothing new when nothing was found and nothing failed', async () => {
                mock.api.checkNewAnimeEpisodes.mockResolvedValue({ ok: true, count: 0, titles: [], notDownloaded: [], failed: 0, skipped: 0 });

                await useAnimeStore.getState().checkNewEpisodes(null);

                expect(toasts()).toEqual(['No new episodes.']);
            });

            it('says how many anime could not be reached when nothing was found and some failed', async () => {
                mock.api.checkNewAnimeEpisodes.mockResolvedValue({ ok: true, count: 0, titles: [], notDownloaded: [], failed: 2, skipped: 0 });

                await useAnimeStore.getState().checkNewEpisodes(null);

                expect(toasts()).toEqual(['No new episodes; the source could not be reached for 2 anime.']);
            });

            it('says how many anime were left for the next check, whether or not something was found', async () => {
                mock.api.checkNewAnimeEpisodes.mockResolvedValue({ ok: true, count: 1, titles: ['Naruto'], notDownloaded: [], failed: 0, skipped: 3 });

                await useAnimeStore.getState().checkNewEpisodes(null);

                expect(toasts()).toEqual(['3 anime were left for the next check.']);
            });

            it('says what went wrong when the check could not be made, and goes on to reload', async () => {
                mock.api.checkNewAnimeEpisodes.mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND', message: 'The anime is not in the library.' } });

                await useAnimeStore.getState().checkNewEpisodes(9);

                expect(toasts()).toEqual(['Could not look for new episodes: The anime is not in the library.']);
                expect(mock.api.listAnimeLibrary).toHaveBeenCalledTimes(1);
                expect(useAnimeStore.getState().checkingNew).toBeNull();
            });

            it('stops showing it is looking even when the call to the main process fails', async () => {
                mock.api.checkNewAnimeEpisodes.mockRejectedValue(new Error('ipc failed'));

                await expect(useAnimeStore.getState().checkNewEpisodes(null)).rejects.toThrow('ipc failed');

                expect(useAnimeStore.getState().checkingNew).toBeNull();
            });
        });

        describe('the check that is going on in the main process', () => {
            const GOING: AnimeCheckState = { running: true, origin: 'auto', done: 12, total: 200, current: 'Naruto' };
            const IDLE: AnimeCheckState = { running: false, origin: null, done: 0, total: 0, current: null };

            beforeEach(() => {
                useAnimeStore.setState({ checkState: IDLE });
            });

            it('starts with none going on', () => {
                expect(initialAnime.checkState).toEqual(IDLE);
            });

            it('reads the one that is going on when the section opens, which began before the screen did', async () => {
                mock.api.getAnimeCheckState.mockResolvedValue(GOING);

                const dispose = await useAnimeStore.getState().init();

                expect(mock.api.getAnimeCheckState).toHaveBeenCalledTimes(1);
                expect(useAnimeStore.getState().checkState).toEqual(GOING);
                dispose();
            });

            it('follows it: how far it is and which anime it asks about, until it ends', async () => {
                const dispose = await useAnimeStore.getState().init();

                mock.emitAnimeCheckState(GOING);
                expect(useAnimeStore.getState().checkState).toEqual(GOING);
                mock.emitAnimeCheckState({ ...GOING, done: 13, current: 'Bleach' });
                expect(useAnimeStore.getState().checkState).toEqual({ running: true, origin: 'auto', done: 13, total: 200, current: 'Bleach' });
                mock.emitAnimeCheckState(IDLE);

                expect(useAnimeStore.getState().checkState).toEqual(IDLE);
                dispose();
            });

            it('does not start another check while one is going on in the main process', async () => {
                useAnimeStore.setState({ checkState: GOING });

                await useAnimeStore.getState().checkNewEpisodes(null);
                await useAnimeStore.getState().checkNewEpisodes(4);

                expect(mock.api.checkNewAnimeEpisodes).not.toHaveBeenCalled();
                expect(mock.api.listAnimeLibrary).not.toHaveBeenCalled();
                expect(useAnimeStore.getState().checkingNew).toBeNull();
                expect(toasts()).toEqual([]);
            });

            it('does not start another check while one asked for here is going on', async () => {
                useAnimeStore.setState({ checkingNew: 'all' });

                await useAnimeStore.getState().checkNewEpisodes(null);

                expect(mock.api.checkNewAnimeEpisodes).not.toHaveBeenCalled();
                expect(useAnimeStore.getState().checkingNew).toBe('all');
            });

            it('starts one again once the one that was going on ends', async () => {
                useAnimeStore.setState({ checkState: GOING });
                await useAnimeStore.getState().checkNewEpisodes(null);
                expect(mock.api.checkNewAnimeEpisodes).not.toHaveBeenCalled();

                useAnimeStore.setState({ checkState: IDLE });
                await useAnimeStore.getState().checkNewEpisodes(null);

                expect(mock.api.checkNewAnimeEpisodes).toHaveBeenCalledTimes(1);
                expect(mock.api.checkNewAnimeEpisodes).toHaveBeenCalledWith(null);
            });
        });

        describe('events of the main process', () => {
            it('says how many episodes were added and to which anime', async () => {
                const dispose = await useAnimeStore.getState().init();

                mock.emitAnimeNewEpisodes({ count: 3, titles: ['Naruto', 'Bleach'], notDownloaded: [] });

                expect(toasts()).toEqual(['3 new episode(s) added to the library: Naruto, Bleach']);
                dispose();
            });

            it('also says which anime had too many new episodes to download them by themselves', async () => {
                const dispose = await useAnimeStore.getState().init();

                mock.emitAnimeNewEpisodes({ count: 30, titles: ['One Piece'], notDownloaded: ['One Piece'] });

                expect(toasts()).toEqual([
                    '30 new episode(s) added to the library: One Piece',
                    'Too many new episodes at once to download them by themselves: One Piece. They are in the library.'
                ]);
                dispose();
            });

            it('reloads the list of updates when the library changes while the updates are on the screen', async () => {
                mock.api.listAnimeUpdates.mockResolvedValue([ENTRY]);
                const dispose = await useAnimeStore.getState().init();
                mock.api.listAnimeUpdates.mockClear();

                mock.emitAnimeLibraryChanged();

                await vi.waitFor(() => {
                    expect(useAnimeStore.getState().updates).toEqual([ENTRY]);
                });
                expect(mock.api.listAnimeUpdates).toHaveBeenCalledTimes(1);
                dispose();
            });

            it('does not reload the list of updates when the library changes on another screen', async () => {
                useAnimeStore.setState({ view: 'library' });
                const dispose = await useAnimeStore.getState().init();
                mock.api.listAnimeUpdates.mockClear();

                mock.emitAnimeLibraryChanged();
                await vi.waitFor(() => {
                    expect(mock.api.listAnimeLibrary).toHaveBeenCalled();
                });

                expect(mock.api.listAnimeUpdates).not.toHaveBeenCalled();
                dispose();
            });
        });
    });
});

describe('covers', () => {
    const COVER = 'https://s4.anilist.co/cover/naruto.jpg';

    it('starts with none', () => {
        expect(initialAnime.covers).toEqual({});
    });

    it('looks the cover up by the title and keeps what was found, under the title without the case', async () => {
        mock.api.findAnimeCover.mockResolvedValue(COVER);

        await useAnimeStore.getState().loadCover('  Naruto ');

        expect(mock.api.findAnimeCover).toHaveBeenCalledTimes(1);
        expect(mock.api.findAnimeCover).toHaveBeenCalledWith('  Naruto ');
        expect(useAnimeStore.getState().covers).toEqual({ naruto: { status: 'found', url: COVER } });
    });

    it('keeps that there is no cover when the main process says so', async () => {
        mock.api.findAnimeCover.mockResolvedValue(null);

        await useAnimeStore.getState().loadCover('Unknown anime');

        expect(useAnimeStore.getState().covers).toEqual({ 'unknown anime': { status: 'none' } });
    });

    it('keeps that the cover could not be asked for when the request fails', async () => {
        mock.api.findAnimeCover.mockRejectedValue(new Error('AniList answered with status 500.'));

        await useAnimeStore.getState().loadCover('Naruto');

        expect(useAnimeStore.getState().covers).toEqual({ naruto: { status: 'failed' } });
    });

    it('does not ask again for a title it already knows, whatever the case', async () => {
        mock.api.findAnimeCover.mockResolvedValue(COVER);

        await useAnimeStore.getState().loadCover('Naruto');
        await useAnimeStore.getState().loadCover('NARUTO');
        await useAnimeStore.getState().loadCover(' naruto ');

        expect(mock.api.findAnimeCover).toHaveBeenCalledTimes(1);
    });

    it('asks again for a title that has no cover each time a card is shown, and keeps it as it is while there is none', async () => {
        mock.api.findAnimeCover.mockResolvedValue(null);

        await useAnimeStore.getState().loadCover('Unknown');
        const covers = useAnimeStore.getState().covers;
        await useAnimeStore.getState().loadCover('Unknown');
        await useAnimeStore.getState().loadCover('unknown ');

        expect(mock.api.findAnimeCover).toHaveBeenCalledTimes(3);
        expect(mock.api.findAnimeCover).toHaveBeenNthCalledWith(1, 'Unknown');
        expect(mock.api.findAnimeCover).toHaveBeenNthCalledWith(2, 'Unknown');
        expect(mock.api.findAnimeCover).toHaveBeenNthCalledWith(3, 'unknown ');
        expect(useAnimeStore.getState().covers).toBe(covers);
        expect(covers).toEqual({ unknown: { status: 'none' } });
    });

    it('takes the cover of a title that had none when it is found by the next ask', async () => {
        mock.api.findAnimeCover.mockResolvedValueOnce(null).mockResolvedValueOnce(COVER);

        await useAnimeStore.getState().loadCover('Naruto');
        expect(useAnimeStore.getState().covers).toEqual({ naruto: { status: 'none' } });
        await useAnimeStore.getState().loadCover('Naruto');

        expect(useAnimeStore.getState().covers).toEqual({ naruto: { status: 'found', url: COVER } });
    });

    it('does not ask again for a title whose cover was found', async () => {
        mock.api.findAnimeCover.mockResolvedValue(COVER);
        await useAnimeStore.getState().loadCover('Naruto');
        await useAnimeStore.getState().loadCover('Naruto');

        expect(mock.api.findAnimeCover).toHaveBeenCalledTimes(1);
        expect(useAnimeStore.getState().covers).toEqual({ naruto: { status: 'found', url: COVER } });
    });

    it('asks again for a title whose cover could not be asked for, the next time its card is shown', async () => {
        mock.api.findAnimeCover.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(COVER);

        await useAnimeStore.getState().loadCover('Naruto');
        await useAnimeStore.getState().loadCover('Naruto');

        expect(mock.api.findAnimeCover).toHaveBeenCalledTimes(2);
        expect(useAnimeStore.getState().covers).toEqual({ naruto: { status: 'found', url: COVER } });
    });

    it('asks once when the same title is asked for while it is being looked up', async () => {
        let answer: (url: string | null) => void = () => {
            return undefined;
        };
        mock.api.findAnimeCover.mockImplementation(() => {
            return new Promise((resolve) => {
                answer = resolve;
            });
        });

        const first = useAnimeStore.getState().loadCover('Naruto');
        const second = useAnimeStore.getState().loadCover('naruto');
        answer(COVER);
        await Promise.all([first, second]);

        expect(mock.api.findAnimeCover).toHaveBeenCalledTimes(1);
        expect(useAnimeStore.getState().covers).toEqual({ naruto: { status: 'found', url: COVER } });
    });

    it('keeps the titles apart', async () => {
        mock.api.findAnimeCover.mockImplementation(async (title: string) => {
            return title === 'Naruto' ? COVER : null;
        });

        await useAnimeStore.getState().loadCover('Naruto');
        await useAnimeStore.getState().loadCover('Bleach');

        expect(useAnimeStore.getState().covers).toEqual({ naruto: { status: 'found', url: COVER }, bleach: { status: 'none' } });
    });

    it('does not ask for a title that is empty', async () => {
        await useAnimeStore.getState().loadCover('   ');

        expect(mock.api.findAnimeCover).not.toHaveBeenCalled();
        expect(useAnimeStore.getState().covers).toEqual({});
    });

    it('takes the new address of a cover that the main process checked again and found different', async () => {
        mock.api.getAnimeStatus.mockResolvedValue(SUPPORTED);
        mock.api.findAnimeCover.mockResolvedValue(COVER);
        await useAnimeStore.getState().init();
        await useAnimeStore.getState().loadCover('Naruto');

        mock.emitAnimeCover({ title: 'Naruto', url: 'https://s4.anilist.co/cover/naruto-new.jpg' });

        expect(useAnimeStore.getState().covers).toEqual({ naruto: { status: 'found', url: 'https://s4.anilist.co/cover/naruto-new.jpg' } });
    });

    it('takes a cover for a title that had none', async () => {
        mock.api.getAnimeStatus.mockResolvedValue(SUPPORTED);
        mock.api.findAnimeCover.mockResolvedValue(null);
        await useAnimeStore.getState().init();
        await useAnimeStore.getState().loadCover('Naruto');

        mock.emitAnimeCover({ title: 'Naruto', url: COVER });

        expect(useAnimeStore.getState().covers).toEqual({ naruto: { status: 'found', url: COVER } });
    });

    it('keeps the other covers when one changes', async () => {
        mock.api.getAnimeStatus.mockResolvedValue(SUPPORTED);
        useAnimeStore.setState({ covers: { bleach: { status: 'found', url: 'https://s4.anilist.co/bleach.jpg' } } });
        await useAnimeStore.getState().init();

        mock.emitAnimeCover({ title: 'Naruto', url: COVER });

        expect(useAnimeStore.getState().covers).toEqual({ bleach: { status: 'found', url: 'https://s4.anilist.co/bleach.jpg' }, naruto: { status: 'found', url: COVER } });
    });
});

describe('the schedule refresh', () => {
    const NOW = new Date('2026-10-03T15:30:00Z');

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not ask AniList again unless it is asked to: the listing says so', async () => {
        await useAnimeStore.getState().loadSchedule();
        await useAnimeStore.getState().loadSchedule(false);
        await useAnimeStore.getState().loadSchedule(true);

        expect(mock.api.listAnimeSchedule.mock.calls.map((call) => {
            return (call[0] as { refresh: boolean }).refresh;
        })).toEqual([false, false, true]);
    });
});
