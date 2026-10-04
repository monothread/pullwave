// @vitest-environment jsdom
import type { AnimeHistoryEntry, AnimeJob, AnimeScheduleEntry, AnimeSearchResult } from '@shared/anime';
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
    useAnimeStore.setState({ ...initialAnime, status: UNSUPPORTED_STATUS, updatingCli: false, view: 'search', returnView: 'search', jobs: [], library: [], history: [], migration: null, search: INITIAL_SEARCH, schedule: INITIAL_SCHEDULE, selection: null, playing: null, streaming: null });
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
        expect(initialAnime.updatingCli).toBe(false);
        expect(initialAnime.view).toBe('schedule');
        expect(initialAnime.returnView).toBe('schedule');
        expect(initialAnime.schedule).toEqual({ status: 'idle', entries: [], error: null, view: 'day', timeZone: machineTimeZone(), limits: [] });
        expect(initialAnime.jobs).toEqual([]);
        expect(initialAnime.library).toEqual([]);
        expect(initialAnime.history).toEqual([]);
        expect(initialAnime.search).toEqual({ query: '', audio: null, status: 'idle', results: [], error: null, searchedQuery: '', searchedAudio: 'sub' });
        expect(initialAnime.selection).toBeNull();
        expect(initialAnime.playing).toBeNull();
        expect(initialAnime.streaming).toBeNull();
        expect(initialAnime.libraryFocus).toBeNull();
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
        expect(mock.unsubscribers).toHaveLength(5);
        mock.unsubscribers.forEach((unsubscribe) => {
            expect(unsubscribe).toHaveBeenCalledTimes(1);
        });
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

describe('updateCli', () => {
    it('updates ani-cli, reads the new version and tells the user', async () => {
        const updated = { found: true, path: '/data/bin/ani-cli', version: '5.2.0', source: 'updated' as const };
        mock.api.updateAniCli.mockResolvedValue({ ok: true, output: 'Updated ani-cli 5.1.4 → 5.2.0.' });
        mock.api.getAnimeStatus.mockResolvedValue(makeStatus({ aniCli: updated }));

        const updating = useAnimeStore.getState().updateCli();
        expect(useAnimeStore.getState().updatingCli).toBe(true);
        await updating;

        expect(useAnimeStore.getState().updatingCli).toBe(false);
        expect(useAnimeStore.getState().status.aniCli).toEqual(updated);
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'Updated ani-cli 5.1.4 → 5.2.0.' });
    });

    it('tells the user when the update failed', async () => {
        mock.api.updateAniCli.mockResolvedValue({ ok: false, output: 'getaddrinfo ENOTFOUND' });
        mock.api.getAnimeStatus.mockResolvedValue(makeStatus());
        await useAnimeStore.getState().updateCli();
        expect(useAnimeStore.getState().updatingCli).toBe(false);
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'getaddrinfo ENOTFOUND' });
    });

    it('says something even when the result has no text', async () => {
        mock.api.getAnimeStatus.mockResolvedValue(makeStatus());
        mock.api.updateAniCli.mockResolvedValue({ ok: true, output: '' });
        await useAnimeStore.getState().updateCli();
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'yt-dlp is up to date.' });
        mock.api.updateAniCli.mockResolvedValue({ ok: false, output: '' });
        await useAnimeStore.getState().updateCli();
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'Update failed.' });
    });
});

describe('resetCli', () => {
    it('goes back to the ani-cli that ships with the app, reads which one is used and tells the user', async () => {
        const bundled = { found: true, path: '/app/resources/bin/ani/ani-cli', version: '5.1.4', source: 'bundled' as const };
        mock.api.resetAniCli.mockResolvedValue({ ok: true, output: 'Using the ani-cli that ships with the app again.' });
        mock.api.getAnimeStatus.mockResolvedValue(makeStatus({ aniCli: bundled }));

        const resetting = useAnimeStore.getState().resetCli();
        expect(useAnimeStore.getState().updatingCli).toBe(true);
        await resetting;

        expect(mock.api.resetAniCli).toHaveBeenCalledTimes(1);
        expect(mock.api.updateAniCli).not.toHaveBeenCalled();
        expect(useAnimeStore.getState().updatingCli).toBe(false);
        expect(useAnimeStore.getState().status.aniCli).toEqual(bundled);
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'Using the ani-cli that ships with the app again.' });
    });

    it('tells the user when there was nothing to remove', async () => {
        mock.api.resetAniCli.mockResolvedValue({ ok: false, output: 'There is no updated ani-cli to remove: the one that ships with the app is already in use.' });
        mock.api.getAnimeStatus.mockResolvedValue(makeStatus());
        await useAnimeStore.getState().resetCli();
        expect(useAnimeStore.getState().updatingCli).toBe(false);
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'There is no updated ani-cli to remove: the one that ships with the app is already in use.' });
    });

    it('says something even when the result has no text', async () => {
        mock.api.getAnimeStatus.mockResolvedValue(makeStatus());
        mock.api.resetAniCli.mockResolvedValue({ ok: true, output: '' });
        await useAnimeStore.getState().resetCli();
        expect(useAppStore.getState().notice).toEqual({ kind: 'info', message: 'yt-dlp is up to date.' });
        mock.api.resetAniCli.mockResolvedValue({ ok: false, output: '' });
        await useAnimeStore.getState().resetCli();
        expect(useAppStore.getState().notice).toEqual({ kind: 'error', message: 'Update failed.' });
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
        mock.api.searchAnime.mockResolvedValue({ ok: true, results: [RESULT] });
        useAnimeStore.getState().setQuery('  naruto ');

        const running = useAnimeStore.getState().runSearch();
        expect(useAnimeStore.getState().search.status).toBe('searching');
        await running;

        expect(mock.api.searchAnime).toHaveBeenCalledWith('naruto', 'dub');
        expect(useAnimeStore.getState().search).toMatchObject({ status: 'done', results: [RESULT], searchedQuery: 'naruto', searchedAudio: 'dub', error: null });
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
            searchedAudio: 'dub'
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
        expect(useAnimeStore.getState().streaming).toEqual({ title: 'Naruto', episode: '2', status: 'loading', stream: null, error: null });
        await watching;

        expect(mock.api.openAnimeStream).toHaveBeenCalledWith({ query: 'naruto', index: 2, audio: 'dub', episode: '2' });
        expect(useAnimeStore.getState().streaming).toEqual({ title: 'Naruto', episode: '2', status: 'ready', stream: STREAM, error: null });
    });

    it('keeps the error when the video cannot be found', async () => {
        const error = { code: 'NO_SOURCES' as const, raw: 'No sources found for dub!' };
        mock.api.openAnimeStream.mockResolvedValue({ ok: false, error });
        useAnimeStore.setState({ selection });
        await useAnimeStore.getState().watchEpisode('1');
        expect(useAnimeStore.getState().streaming).toEqual({ title: 'Naruto', episode: '1', status: 'error', stream: null, error });
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

    it('closes the stream the main process opened', () => {
        useAnimeStore.setState({ streaming: { title: 'Naruto', episode: '1', status: 'ready', stream: STREAM, error: null } });
        useAnimeStore.getState().closeStream();
        expect(mock.api.closeAnimeStream).toHaveBeenCalledWith('s1');
        expect(useAnimeStore.getState().streaming).toBeNull();
    });

    it('has nothing to tell the main process when no stream was opened yet', () => {
        useAnimeStore.setState({ streaming: { title: 'Naruto', episode: '1', status: 'loading', stream: null, error: null } });
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

    it('cancels and retries through the api', async () => {
        await useAnimeStore.getState().cancelJob(4);
        await useAnimeStore.getState().retryJob(5);
        expect(mock.api.cancelAnimeJob).toHaveBeenCalledWith(4);
        expect(mock.api.retryAnimeJob).toHaveBeenCalledWith(5);
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
    const ENTRY: AnimeHistoryEntry = { id: 1, title: 'Naruto', query: 'naruto', searchIndex: 2, audio: 'dub', episode: null, openedAt: 10 };
    const WATCHED: AnimeHistoryEntry = { id: 2, title: 'Bleach', query: 'bleach', searchIndex: 4, audio: 'sub', episode: '12', openedAt: 20 };

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

        it('looks the anime up only by the name that found it in the source, when the source is known to have it', async () => {
            useAnimeStore.setState({ availability: { 2: { anilistId: 2, state: 'available', query: 'Dan Da Dan', index: 4, title: 'Dan Da Dan' } } });
            mock.api.searchAnime.mockResolvedValue({ ok: true, results: [{ index: 4, title: 'Dan Da Dan' }] });

            await useAnimeStore.getState().openScheduleEntry(DANDADAN);

            expect(mock.api.searchAnime.mock.calls).toEqual([['Dan Da Dan', 'sub']]);
            expect(useAnimeStore.getState().search).toMatchObject({ query: 'Dan Da Dan', status: 'done', results: [{ index: 4, title: 'Dan Da Dan' }] });
        });

        it.each([['unavailable' as const], ['unknown' as const]])('looks the anime up by its names, as before, when the source answered %s', async (state) => {
            useAnimeStore.setState({ availability: { 2: { anilistId: 2, state } } });
            mock.api.searchAnime.mockResolvedValue({ ok: true, results: [{ index: 1, title: 'Dandadan' }] });

            await useAnimeStore.getState().openScheduleEntry(DANDADAN);

            expect(mock.api.searchAnime.mock.calls).toEqual([['Dandadan', 'sub']]);
        });

        it('ignores what is known about another anime', async () => {
            useAnimeStore.setState({ availability: { 9: { anilistId: 9, state: 'available', query: 'Other', index: 1, title: 'Other' } } });
            mock.api.searchAnime.mockResolvedValue({ ok: true, results: [{ index: 1, title: 'Dandadan' }] });

            await useAnimeStore.getState().openScheduleEntry(DANDADAN);

            expect(mock.api.searchAnime.mock.calls).toEqual([['Dandadan', 'sub']]);
        });
    });

    describe('availability in the source', () => {
        beforeEach(() => {
            useAnimeStore.setState({ availability: {} });
            mock.api.getAnimeStatus.mockResolvedValue(SUPPORTED);
        });

        it('starts with nothing known', () => {
            expect(initialAnime.availability).toEqual({});
        });

        it('asks for the anime that were listed, by their ids and their two names, once the listing is in', async () => {
            setSchedule();
            const dandadan = makeScheduleEntry({ anilistId: 2, title: 'Dandadan', english: 'Dandadan', romaji: null, names: ['Dandadan'] });
            mock.api.listAnimeSchedule.mockResolvedValue({ ok: true, entries: [FRIEREN, dandadan] });

            await useAnimeStore.getState().loadSchedule();

            expect(mock.api.checkAnimeAvailability).toHaveBeenCalledTimes(1);
            expect(mock.api.checkAnimeAvailability).toHaveBeenCalledWith([
                { anilistId: 154587, english: 'Frieren: Beyond Journey\'s End', romaji: 'Sousou no Frieren' },
                { anilistId: 2, english: 'Dandadan', romaji: null }
            ]);
        });

        it('keeps what was already known when the answer comes', async () => {
            setSchedule();
            mock.api.listAnimeSchedule.mockResolvedValue({ ok: true, entries: [FRIEREN] });
            mock.api.checkAnimeAvailability.mockResolvedValue([{ anilistId: 154587, state: 'unavailable' }]);

            await useAnimeStore.getState().loadSchedule();

            expect(useAnimeStore.getState().availability).toEqual({ 154587: { anilistId: 154587, state: 'unavailable' } });
        });

        it('does not ask when the listing failed', async () => {
            setSchedule();
            mock.api.listAnimeSchedule.mockResolvedValue({ ok: false, error: { code: 'NETWORK', raw: 'down' } });

            await useAnimeStore.getState().loadSchedule();

            expect(mock.api.checkAnimeAvailability).not.toHaveBeenCalled();
        });

        it('keeps each answer that comes later, one at a time, next to the others', () => {
            useAnimeStore.setState({ availability: { 1: { anilistId: 1, state: 'unavailable' } } });
            return useAnimeStore.getState().init().then((dispose) => {
                mock.emitAnimeAvailability({ anilistId: 2, state: 'available', query: 'Dandadan', index: 1, title: 'Dandadan' });
                mock.emitAnimeAvailability({ anilistId: 3, state: 'unknown' });

                expect(useAnimeStore.getState().availability).toEqual({
                    1: { anilistId: 1, state: 'unavailable' },
                    2: { anilistId: 2, state: 'available', query: 'Dandadan', index: 1, title: 'Dandadan' },
                    3: { anilistId: 3, state: 'unknown' }
                });
                dispose();
            });
        });

        it('replaces what was known about an anime when it is told again', async () => {
            const dispose = await useAnimeStore.getState().init();
            mock.emitAnimeAvailability({ anilistId: 2, state: 'unavailable' });
            mock.emitAnimeAvailability({ anilistId: 2, state: 'available', query: 'Dandadan', index: 1, title: 'Dandadan' });

            expect(useAnimeStore.getState().availability).toEqual({ 2: { anilistId: 2, state: 'available', query: 'Dandadan', index: 1, title: 'Dandadan' } });
            dispose();
        });

        it('asks again for what could not be checked the last time, and keeps what was found', async () => {
            useAnimeStore.setState({
                availability: {
                    154587: { anilistId: 154587, state: 'unknown' },
                    2: { anilistId: 2, state: 'unavailable' }
                }
            });
            let seenWhileAsking: unknown = null;
            mock.api.checkAnimeAvailability.mockImplementation(async () => {
                seenWhileAsking = { ...useAnimeStore.getState().availability };
                return [];
            });

            await useAnimeStore.getState().checkAvailability([FRIEREN, DANDADAN]);

            expect(seenWhileAsking).toEqual({ 2: { anilistId: 2, state: 'unavailable' } });
            expect(useAnimeStore.getState().availability).toEqual({ 2: { anilistId: 2, state: 'unavailable' } });
        });

        it('leaves the cards as they are when the answer cannot be had', async () => {
            useAnimeStore.setState({ availability: { 2: { anilistId: 2, state: 'unavailable' } } });
            mock.api.checkAnimeAvailability.mockRejectedValue(new Error('ipc failed'));

            await expect(useAnimeStore.getState().checkAvailability([DANDADAN])).resolves.toBeUndefined();

            expect(useAnimeStore.getState().availability).toEqual({ 2: { anilistId: 2, state: 'unavailable' } });
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

    it('does not ask again for a title that has no cover', async () => {
        mock.api.findAnimeCover.mockResolvedValue(null);

        await useAnimeStore.getState().loadCover('Unknown');
        await useAnimeStore.getState().loadCover('Unknown');

        expect(mock.api.findAnimeCover).toHaveBeenCalledTimes(1);
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
