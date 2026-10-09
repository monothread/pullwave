import { create } from 'zustand';
import type { AniError, AnimeAudio, AnimeAvailability, AnimeHistoryEntry, AnimeHistoryRequest, AnimeMigrationFailure, AnimeMigrationProgress, AnimeMigrationResponse, AnimeRenameSeriesResponse, AnimeSeriesResponse, AnimeJob, AnimeProgressUpdate, AnimeRecord, AnimeScheduleEntry, AnimeSearchResult, AnimeStatus, AnimeStream, LibraryAnime } from '@shared/anime';
import { cleanSeasonName, cleanSeriesName, isValidSeason, type SeriesChoice } from '@shared/series';
import { machineTimeZone, zonedDayLimits } from '@shared/timezone';
import { readScheduleChoice, saveScheduleTimeZone, type AnimeScheduleView } from './scheduleChoice';
import { createTranslator, type MessageKey, type MessageParams } from '@shared/i18n';
import { resolveAppLanguage } from '../i18n/language';
import { groupLibrary, libraryEntry } from '../components/animeText';
import { useAppStore } from './appStore';

export type AnimeView = 'schedule' | 'search' | 'library' | 'history' | 'settings' | 'downloads';
// The views the downloads screen can go back to.
export type AnimeBrowseView = Exclude<AnimeView, 'downloads'>;

export interface AnimeSearchState {
    query: string;
    // The audio picked on the screen; null follows the setting.
    audio: AnimeAudio | null;
    status: 'idle' | 'searching' | 'done' | 'error';
    results: AnimeSearchResult[];
    error: AniError | null;
    // What the results belong to: positions mean something only for the search that produced them.
    searchedQuery: string;
    searchedAudio: AnimeAudio;
}

// What is known about the cover of an anime: it was found, AniList has none, or it could not be asked for (it is asked again the next
// time the card is shown).
export type AnimeCoverState = { status: 'found'; url: string } | { status: 'none' } | { status: 'failed' };

// Kept with the choice of the user, which is what it is read and saved as.
export type { AnimeScheduleView } from './scheduleChoice';

// The episodes that air today or this week, by the days of a time zone.
export interface AnimeScheduleState {
    status: 'idle' | 'loading' | 'ready' | 'error';
    entries: AnimeScheduleEntry[];
    error: AniError | null;
    view: AnimeScheduleView;
    // The time zone the days are counted in (the one of the machine until the user picks another).
    timeZone: string;
    // Where each day of what is listed starts, and where the last one ends, in seconds since the epoch.
    limits: number[];
}

export interface AnimeSelection {
    result: AnimeSearchResult;
    query: string;
    audio: AnimeAudio;
    status: 'loading' | 'ready' | 'error';
    episodes: string[];
    error: AniError | null;
}

export interface PlayingEpisode {
    animeId: number;
    episodeId: number;
}

// An episode being watched without downloading it.
export interface StreamingEpisode {
    title: string;
    episode: string;
    status: 'loading' | 'ready' | 'error';
    stream: AnimeStream | null;
    error: AniError | null;
}

export interface AnimeState {
    status: AnimeStatus;
    // ani-cli is being updated.
    updatingCli: boolean;
    // How far the migration of the anime folder is, or null when none is running.
    migration: AnimeMigrationProgress | null;
    view: AnimeView;
    // Where BACK goes from the downloads screen.
    returnView: AnimeBrowseView;
    jobs: AnimeJob[];
    library: LibraryAnime[];
    // What was opened or watched, the most recent first.
    history: AnimeHistoryEntry[];
    search: AnimeSearchState;
    schedule: AnimeScheduleState;
    // What is known so far about the cover of each anime, by its title (see `coverKey`).
    covers: Record<string, AnimeCoverState>;
    // Whether the source has each anime of the schedule, by its id: what is not here yet is still being checked.
    availability: Record<number, AnimeAvailability>;
    selection: AnimeSelection | null;
    playing: PlayingEpisode | null;
    streaming: StreamingEpisode | null;
    // The anime of the library the screen goes to when it is opened from the search (its episodes are shown).
    libraryFocus: number | null;
    // The series open on the screen of the library (the key of its card); null: the cards. It is a page of the app, so the back and forward
    // buttons of the mouse go through it.
    librarySeries: string | null;
    init: () => Promise<() => void>;
    updateCli: () => Promise<void>;
    // Goes back to the ani-cli that ships with the app.
    resetCli: () => Promise<void>;
    setView: (view: AnimeBrowseView) => void;
    openDownloads: () => void;
    closeDownloads: () => void;
    openSeries: (key: string) => void;
    closeSeries: () => void;
    setQuery: (query: string) => void;
    setAudio: (audio: AnimeAudio) => void;
    runSearch: () => Promise<void>;
    // Looks the cover of an anime up by its title (once: what was asked is not asked again while the app is open).
    loadCover: (title: string) => Promise<void>;
    // Lists the episodes of the day (or of the week) in the time zone that is set.
    // `refresh` asks AniList again instead of using what was listed in the last day.
    loadSchedule: (refresh?: boolean) => Promise<void>;
    // Asks which of the anime of the schedule the source has: what is known is kept at once, the rest as it is checked (an event).
    checkAvailability: (entries: readonly AnimeScheduleEntry[]) => Promise<void>;
    setScheduleView: (view: AnimeScheduleView) => void;
    setScheduleTimeZone: (timeZone: string) => void;
    // Goes to the search and looks the anime of an episode of the schedule up by its names.
    openScheduleEntry: (entry: AnimeScheduleEntry) => Promise<void>;
    openResult: (result: AnimeSearchResult) => Promise<void>;
    // Opens an anime of the library in the search, as if it had been found there, so more episodes can be downloaded.
    openLibraryAnime: (anime: Pick<AnimeRecord, 'title' | 'query' | 'searchIndex' | 'audio'>) => Promise<void>;
    // Opens an anime of the history: in the library, on its series, when it is there; otherwise in the search, with its episodes.
    openHistoryEntry: (entry: AnimeHistoryEntry) => Promise<void>;
    // Asks for a folder of anime and puts what is in it into the library, then says what it did.
    importLibrary: () => Promise<void>;
    // Moves all the anime to a folder the user chooses, then says how it went. Returns what the migration answered.
    migrateFolder: () => Promise<AnimeMigrationResponse>;
    // Goes to the library, to the anime that was being looked at in the search.
    showInLibrary: (animeId: number) => void;
    closeResult: () => void;
    // Downloads episodes of the opened anime; `joined` is the series and season it is saved under (none leaves it as it is).
    downloadEpisodes: (episodes: string[], joined?: SeriesChoice | null) => Promise<void>;
    // Puts the opened anime in the library with all its episodes, none of them downloaded; `joined` is the series and season it goes
    // under (none leaves it on its own). Says how it went, and returns whether it was added.
    addToLibrary: (joined: SeriesChoice | null) => Promise<boolean>;
    // Queues every episode of these anime of the library that is not downloaded yet.
    downloadMissing: (animeIds: number[]) => Promise<void>;
    // Gives all these anime (the ones of a series) another series name, then reads the library.
    renameSeries: (animeIds: number[], name: string) => Promise<AnimeRenameSeriesResponse>;
    // Changes the season (and the name shown) of an anime inside the series it is in, then reads the library. Its series cannot change.
    setSeries: (animeId: number, series: string | null, season: number | null, seasonName: string | null) => Promise<AnimeSeriesResponse>;
    cancelJob: (episodeId: number) => Promise<void>;
    retryJob: (episodeId: number) => Promise<void>;
    // Stops a download that is going on keeping what it downloaded, and goes on from there later.
    pauseJob: (episodeId: number) => Promise<void>;
    resumeJob: (episodeId: number) => Promise<void>;
    clearFinishedJobs: () => Promise<void>;
    removeEpisode: (episodeId: number) => Promise<void>;
    removeAnime: (animeId: number) => Promise<void>;
    play: (animeId: number, episodeId: number) => void;
    closePlayer: () => void;
    watchEpisode: (episode: string) => Promise<void>;
    closeStream: () => void;
    saveProgress: (update: AnimeProgressUpdate) => Promise<void>;
    // Marks an episode of the library as watched (or not), keeping the position it was left at.
    setWatched: (episodeId: number, watched: boolean) => Promise<void>;
    refreshLibrary: () => Promise<void>;
    refreshHistory: () => Promise<void>;
    removeHistoryEntry: (id: number) => Promise<void>;
    clearHistory: () => Promise<void>;
}

export const INITIAL_SEARCH: AnimeSearchState = {
    query: '',
    audio: null,
    status: 'idle',
    results: [],
    error: null,
    searchedQuery: '',
    searchedAudio: 'sub'
};

export const INITIAL_SCHEDULE: AnimeScheduleState = {
    status: 'idle',
    entries: [],
    error: null,
    view: 'day',
    timeZone: machineTimeZone(),
    limits: []
};

// The names of an anime that are tried in the search, one after the other, until one finds it.
export const MAX_SCHEDULE_SEARCH_NAMES = 3;
// What the covers are kept by: the title without the case and the spaces around it.
export function coverKey(title: string): string {
    return title.trim().toLowerCase();
}

// The covers being looked for now.
const coversAsked = new Set<string>();
// The last listing that was asked for: the answer of an older one is not shown.
let scheduleRequest = 0;

export const UNSUPPORTED_STATUS: AnimeStatus = { supported: false, available: false, aniCli: null };

// The audio in use: the one picked on the screen or, if none, the one in the settings.
export function effectiveAudio(search: AnimeSearchState, settingsAudio: AnimeAudio): AnimeAudio {
    return search.audio ?? settingsAudio;
}

function translateNow(key: MessageKey, params?: MessageParams): string {
    return createTranslator(resolveAppLanguage(useAppStore.getState().settings.language))(key, params);
}

// Keeps what was opened or watched in the history, then reads it again. It never stops what the viewer is doing.
function recordHistory(request: AnimeHistoryRequest): void {
    void window.api
        .recordAnimeHistory(request)
        .then(() => {
            return useAnimeStore.getState().refreshHistory();
        })
        .catch(() => {
            return undefined;
        });
}

function notify(kind: 'error' | 'info', message: string): void {
    useAppStore.getState().setNotice({ kind, message });
}

const MIGRATION_ERRORS: Record<Exclude<AnimeMigrationFailure, 'cancelled'>, MessageKey> = {
    busy: 'anime.migrate.error.busy',
    same: 'anime.migrate.error.same',
    inside: 'anime.migrate.error.inside',
    conflict: 'anime.migrate.error.conflict',
    failed: 'anime.migrate.error.failed'
};

function upsertAnimeJob(jobs: AnimeJob[], job: AnimeJob): AnimeJob[] {
    const exists = jobs.some((candidate) => {
        return candidate.episodeId === job.episodeId;
    });
    if (!exists) {
        return [...jobs, job];
    }
    return jobs.map((candidate) => {
        return candidate.episodeId === job.episodeId ? job : candidate;
    });
}

// The schedule as it starts: always on the day, in the time zone the user chose the last time when there is a choice.
function initialSchedule(): AnimeScheduleState {
    const { timeZone } = readScheduleChoice();
    return { ...INITIAL_SCHEDULE, timeZone: timeZone ?? INITIAL_SCHEDULE.timeZone };
}

export const useAnimeStore = create<AnimeState>((set, get) => {
    return {
        status: UNSUPPORTED_STATUS,
        updatingCli: false,
        migration: null,
        view: 'schedule',
        returnView: 'schedule',
        jobs: [],
        library: [],
        history: [],
        search: INITIAL_SEARCH,
        schedule: initialSchedule(),
        covers: {},
        availability: {},
        selection: null,
        playing: null,
        streaming: null,
        libraryFocus: null,
        librarySeries: null,

        init: async () => {
            const api = window.api;
            const status = await api.getAnimeStatus();
            set({ status });
            if (!status.supported) {
                return (): void => {
                    return undefined;
                };
            }
            const [library, jobs, history] = await Promise.all([api.listAnimeLibrary(), api.listAnimeJobs(), api.listAnimeHistory()]);
            set({ library, jobs, history });
            const unsubscribers = [
                api.onAnimeJobUpdate((job) => {
                    if (job.status === 'done') {
                        // A download that is complete says so for a few seconds and leaves the screen of the downloads: it is in the library.
                        set((state) => {
                            return {
                                jobs: state.jobs.filter((candidate) => {
                                    return candidate.episodeId !== job.episodeId;
                                })
                            };
                        });
                        useAppStore.getState().pushToast(translateNow('notice.downloadDone', { title: translateNow('anime.job.title', { title: job.animeTitle, episode: job.episode }) }));
                        return;
                    }
                    set((state) => {
                        return { jobs: upsertAnimeJob(state.jobs, job) };
                    });
                }),
                api.onAnimeLibraryChanged(() => {
                    void get().refreshLibrary();
                }),
                api.onAnimeMigrationProgress((migration) => {
                    set({ migration });
                }),
                api.onAnimeCoverUpdate((update) => {
                    set((state) => {
                        return { covers: { ...state.covers, [coverKey(update.title)]: { status: 'found', url: update.url } } };
                    });
                }),
                api.onAnimeAvailability((availability) => {
                    set((state) => {
                        return { availability: { ...state.availability, [availability.anilistId]: availability } };
                    });
                })
            ];
            return (): void => {
                unsubscribers.forEach((unsubscribe) => {
                    unsubscribe();
                });
            };
        },

        updateCli: async () => {
            set({ updatingCli: true });
            const result = await window.api.updateAniCli();
            set({ updatingCli: false, status: await window.api.getAnimeStatus() });
            notify(result.ok ? 'info' : 'error', result.output || translateNow(result.ok ? 'notice.ytdlpUpToDate' : 'notice.updateFailed'));
        },

        resetCli: async () => {
            set({ updatingCli: true });
            const result = await window.api.resetAniCli();
            set({ updatingCli: false, status: await window.api.getAnimeStatus() });
            notify(result.ok ? 'info' : 'error', result.output || translateNow(result.ok ? 'notice.ytdlpUpToDate' : 'notice.updateFailed'));
        },

        setView: (view) => {
            set({ view, returnView: view, libraryFocus: null, librarySeries: null });
            // Files can be moved or deleted while the app is open: the library says which ones are gone when it is shown.
            if (view === 'library') {
                void get().refreshLibrary();
            }
        },

        openDownloads: () => {
            set((state) => {
                return state.view === 'downloads' ? state : { view: 'downloads', returnView: state.view };
            });
        },

        closeDownloads: () => {
            set((state) => {
                return { view: state.returnView };
            });
        },

        openSeries: (key) => {
            set({ librarySeries: key });
        },

        closeSeries: () => {
            set({ librarySeries: null, libraryFocus: null });
        },

        setQuery: (query) => {
            set((state) => {
                // An empty name leaves nothing to show: the results (and the error) of the last search go away.
                if (query.trim().length === 0) {
                    return { search: { ...state.search, query, status: 'idle', results: [], error: null } };
                }
                return { search: { ...state.search, query } };
            });
        },

        setAudio: (audio) => {
            set((state) => {
                return { search: { ...state.search, audio } };
            });
        },

        runSearch: async () => {
            const { search } = get();
            const query = search.query.trim();
            if (query.length === 0) {
                return;
            }
            const audio = effectiveAudio(search, useAppStore.getState().settings.animeAudio);
            set((state) => {
                return { selection: null, search: { ...state.search, status: 'searching', error: null, results: [] } };
            });
            const response = await window.api.searchAnime(query, audio);
            set((state) => {
                // The name was emptied while the search ran: its answer is not shown.
                if (state.search.query.trim().length === 0) {
                    return state;
                }
                if (response.ok) {
                    return { search: { ...state.search, status: 'done', results: response.results, searchedQuery: query, searchedAudio: audio } };
                }
                return { search: { ...state.search, status: 'error', error: response.error, searchedQuery: query, searchedAudio: audio } };
            });
        },

        loadSchedule: async (refresh = false) => {
            const { view, timeZone } = get().schedule;
            const limits = zonedDayLimits(Date.now(), timeZone, view === 'week' ? 7 : 1);
            const asked = scheduleRequest + 1;
            scheduleRequest = asked;
            // What was listed for the same days stays on the screen while it is listed again.
            set((state) => {
                return { schedule: { ...state.schedule, status: 'loading', error: null, limits } };
            });
            const response = await window.api.listAnimeSchedule({ from: limits[0] as number, to: limits[limits.length - 1] as number, refresh });
            // Another listing was asked for while this one was loading.
            if (asked !== scheduleRequest) {
                return;
            }
            set((state) => {
                if (response.ok) {
                    return { schedule: { ...state.schedule, status: 'ready', entries: response.entries, error: null } };
                }
                return { schedule: { ...state.schedule, status: 'error', entries: [], error: response.error } };
            });
            if (response.ok) {
                await get().checkAvailability(response.entries);
            }
        },

        checkAvailability: async (entries) => {
            const targets = entries.map(({ anilistId, english, romaji }) => {
                return { anilistId, english, romaji };
            });
            // What could not be checked the last time is checked again: it goes back to being waited for.
            set((state) => {
                const kept = { ...state.availability };
                targets.forEach((target) => {
                    if (kept[target.anilistId]?.state === 'unknown') {
                        delete kept[target.anilistId];
                    }
                });
                return { availability: kept };
            });
            try {
                const known = await window.api.checkAnimeAvailability(targets);
                set((state) => {
                    const merged = { ...state.availability };
                    known.forEach((availability) => {
                        merged[availability.anilistId] = availability;
                    });
                    return { availability: merged };
                });
            } catch {
                // Without an answer the cards stay as they are, and can still be clicked.
                return;
            }
        },

        loadCover: async (title) => {
            const key = coverKey(title);
            const known = get().covers[key];
            if (key.length === 0 || (known !== undefined && known.status !== 'failed') || coversAsked.has(key)) {
                return;
            }
            coversAsked.add(key);
            let state: AnimeCoverState;
            try {
                const url = await window.api.findAnimeCover(title);
                state = url === null ? { status: 'none' } : { status: 'found', url };
            } catch {
                state = { status: 'failed' };
            } finally {
                coversAsked.delete(key);
            }
            set((current) => {
                return { covers: { ...current.covers, [key]: state } };
            });
        },

        setScheduleView: (view) => {
            set((state) => {
                return { schedule: { ...state.schedule, view, entries: [] } };
            });
        },

        setScheduleTimeZone: (timeZone) => {
            saveScheduleTimeZone(timeZone);
            set((state) => {
                return { schedule: { ...state.schedule, timeZone, entries: [] } };
            });
        },

        openScheduleEntry: async (entry) => {
            // When the source is known to have the anime, it is looked up by the name that found it (the english one when both did).
            const found = get().availability[entry.anilistId];
            const names = found?.state === 'available' ? [found.query] : (entry.names.length > 0 ? entry.names : [entry.title]).slice(0, MAX_SCHEDULE_SEARCH_NAMES);
            set((state) => {
                return { view: 'search', returnView: 'search', selection: null, search: { ...state.search, query: names[0] as string, status: 'idle', error: null, results: [] } };
            });
            for (const name of names) {
                get().setQuery(name);
                await get().runSearch();
                const { search } = get();
                if (search.status === 'done' && search.results.length > 0) {
                    return;
                }
            }
        },

        openResult: async (result) => {
            const { search } = get();
            const selection: AnimeSelection = {
                result,
                query: search.searchedQuery,
                audio: search.searchedAudio,
                status: 'loading',
                episodes: [],
                error: null
            };
            set({ selection });
            recordHistory({ title: result.title, query: selection.query, index: result.index, audio: selection.audio, episode: null });
            const response = await window.api.listAnimeEpisodes(selection.query, result.index, selection.audio);
            set((state) => {
                // The user may have gone back or opened another result while this one was loading.
                if (state.selection?.result !== result) {
                    return state;
                }
                if (response.ok) {
                    return { selection: { ...selection, status: 'ready', episodes: response.episodes } };
                }
                return { selection: { ...selection, status: 'error', error: response.error } };
            });
        },

        importLibrary: async () => {
            const response = await window.api.importAnimeLibrary();
            if (!response.ok) {
                if (response.reason === 'outside') {
                    notify('error', translateNow('anime.import.outside', { folder: response.folder }));
                }
                return;
            }
            set({ library: await window.api.listAnimeLibrary() });
            notify('info', translateNow('anime.import.done', { added: response.added, relinked: response.relinked, skipped: response.skipped, ignored: response.ignored }));
        },

        migrateFolder: async () => {
            set({ migration: { done: 0, total: 0 } });
            try {
                const response = await window.api.migrateAnimeFolder();
                if (response.ok) {
                    set({ library: await window.api.listAnimeLibrary() });
                    notify('info', translateNow('anime.migrate.done', { episodes: response.episodes, folder: response.destination }));
                } else if (response.reason !== 'cancelled') {
                    notify('error', translateNow(MIGRATION_ERRORS[response.reason]));
                }
                return response;
            } finally {
                set({ migration: null });
            }
        },

        openLibraryAnime: async (anime) => {
            // An anime that was found on the disk does not know its place in the search: it is searched by its title instead.
            if (anime.searchIndex < 1) {
                set((state) => {
                    return {
                        view: 'search',
                        returnView: 'search',
                        selection: null,
                        search: { ...state.search, query: anime.query, audio: anime.audio, status: 'idle', error: null, results: [] }
                    };
                });
                await get().runSearch();
                return;
            }
            const result: AnimeSearchResult = { index: anime.searchIndex, title: anime.title };
            set((state) => {
                return {
                    view: 'search',
                    returnView: 'search',
                    search: {
                        ...state.search,
                        query: anime.query,
                        audio: anime.audio,
                        status: 'done',
                        error: null,
                        results: [result],
                        searchedQuery: anime.query,
                        searchedAudio: anime.audio
                    }
                };
            });
            await get().openResult(result);
        },

        openHistoryEntry: async (entry) => {
            const saved = libraryEntry(get().library, entry.title, entry.audio);
            if (saved) {
                get().showInLibrary(saved.id);
                return;
            }
            await get().openLibraryAnime(entry);
        },

        showInLibrary: (animeId) => {
            // The series of the anime is open, with its seasons.
            const group = groupLibrary(get().library).find((candidate) => {
                return candidate.entries.some((entry) => {
                    return entry.id === animeId;
                });
            });
            set({ view: 'library', returnView: 'library', selection: null, libraryFocus: animeId, librarySeries: group?.key ?? null });
            void get().refreshLibrary();
        },

        closeResult: () => {
            set({ selection: null });
        },

        downloadEpisodes: async (episodes, joined = null) => {
            const { selection } = get();
            if (!selection || episodes.length === 0) {
                return;
            }
            const name = cleanSeasonName(joined?.seasonName ?? '');
            if (joined && (cleanSeriesName(joined.series) === null || !isValidSeason(joined.season) || name === undefined)) {
                notify('error', translateNow('anime.series.error.invalid'));
                return;
            }
            const response = await window.api.downloadAnime({
                title: selection.result.title,
                query: selection.query,
                index: selection.result.index,
                audio: selection.audio,
                episodes,
                ...(joined ? { series: cleanSeriesName(joined.series) as string, season: joined.season, seasonName: name as string | null } : {})
            });
            if (response.ok) {
                notify('info', translateNow('anime.notice.queued', { count: episodes.length, title: response.anime.title }));
                return;
            }
            notify('error', translateNow('anime.notice.queueFailed', { reason: response.message }));
        },

        addToLibrary: async (joined) => {
            const { selection } = get();
            if (!selection || selection.status !== 'ready' || selection.episodes.length === 0) {
                return false;
            }
            const name = cleanSeasonName(joined?.seasonName ?? '');
            if (joined && (cleanSeriesName(joined.series) === null || !isValidSeason(joined.season) || name === undefined)) {
                notify('error', translateNow('anime.series.error.invalid'));
                return false;
            }
            const response = await window.api.addAnimeToLibrary({
                title: selection.result.title,
                query: selection.query,
                index: selection.result.index,
                audio: selection.audio,
                episodes: selection.episodes,
                series: joined ? (cleanSeriesName(joined.series) as string) : null,
                season: joined ? joined.season : null,
                seasonName: joined ? (name as string | null) : null
            });
            if (response.ok) {
                set({ library: await window.api.listAnimeLibrary() });
                notify('info', translateNow('anime.notice.added', { title: response.anime.title, count: response.anime.episodes.length }));
                return true;
            }
            if (response.reason === 'season-taken') {
                notify('error', translateNow('anime.series.error.taken', { order: joined?.season ?? 1, suggested: response.suggested }));
            } else {
                notify('error', translateNow(response.reason === 'busy' ? 'anime.add.error.busy' : 'anime.add.error.invalid'));
            }
            return false;
        },

        downloadMissing: async (animeIds) => {
            await window.api.downloadMissingAnime(animeIds);
            await get().refreshLibrary();
        },

        renameSeries: async (animeIds, name) => {
            const response = await window.api.renameAnimeSeries(animeIds, name);
            if (response.ok) {
                set({ library: await window.api.listAnimeLibrary() });
            }
            return response;
        },

        setSeries: async (animeId, series, season, seasonName) => {
            const response = await window.api.setAnimeSeries(animeId, series, season, seasonName);
            if (response.ok) {
                set({ library: await window.api.listAnimeLibrary() });
            }
            return response;
        },

        cancelJob: async (episodeId) => {
            await window.api.cancelAnimeJob(episodeId);
        },

        retryJob: async (episodeId) => {
            await window.api.retryAnimeJob(episodeId);
        },

        pauseJob: async (episodeId) => {
            await window.api.pauseAnimeJob(episodeId);
        },

        resumeJob: async (episodeId) => {
            await window.api.resumeAnimeJob(episodeId);
        },

        clearFinishedJobs: async () => {
            await window.api.clearFinishedAnimeJobs();
            set({ jobs: await window.api.listAnimeJobs() });
        },

        removeEpisode: async (episodeId) => {
            await window.api.removeAnimeEpisode(episodeId);
            set((state) => {
                return {
                    jobs: state.jobs.filter((job) => {
                        return job.episodeId !== episodeId;
                    })
                };
            });
        },

        removeAnime: async (animeId) => {
            await window.api.removeAnime(animeId);
            set((state) => {
                return {
                    jobs: state.jobs.filter((job) => {
                        return job.animeId !== animeId;
                    })
                };
            });
        },

        play: (animeId, episodeId) => {
            set({ playing: { animeId, episodeId } });
            const anime = get().library.find((candidate) => {
                return candidate.id === animeId;
            });
            const episode = anime?.episodes.find((candidate) => {
                return candidate.id === episodeId;
            });
            if (anime && episode) {
                recordHistory({ title: anime.title, query: anime.query, index: anime.searchIndex, audio: anime.audio, episode: episode.number });
            }
        },

        closePlayer: () => {
            set({ playing: null });
        },

        watchEpisode: async (episode) => {
            const { selection } = get();
            if (!selection) {
                return;
            }
            const loading: StreamingEpisode = { title: selection.result.title, episode, status: 'loading', stream: null, error: null };
            set({ streaming: loading });
            recordHistory({ title: selection.result.title, query: selection.query, index: selection.result.index, audio: selection.audio, episode });
            const response = await window.api.openAnimeStream({ query: selection.query, index: selection.result.index, audio: selection.audio, episode });
            // The user may have closed the player (or started another episode) while the video was being found.
            if (get().streaming !== loading) {
                if (response.ok) {
                    void window.api.closeAnimeStream(response.stream.sessionId);
                }
                return;
            }
            set({ streaming: response.ok ? { ...loading, status: 'ready', stream: response.stream } : { ...loading, status: 'error', error: response.error } });
        },

        closeStream: () => {
            const { streaming } = get();
            if (streaming?.stream) {
                void window.api.closeAnimeStream(streaming.stream.sessionId);
            }
            set({ streaming: null });
        },

        saveProgress: async (update) => {
            await window.api.saveAnimeProgress(update);
        },

        setWatched: async (episodeId, watched) => {
            const episode = get()
                .library.flatMap((anime) => {
                    return anime.episodes;
                })
                .find((candidate) => {
                    return candidate.id === episodeId;
                });
            if (!episode) {
                return;
            }
            await window.api.saveAnimeProgress({ episodeId, positionSeconds: episode.positionSeconds, durationSeconds: episode.durationSeconds, watched });
            set({ library: await window.api.listAnimeLibrary() });
        },

        refreshLibrary: async () => {
            set({ library: await window.api.listAnimeLibrary() });
        },

        refreshHistory: async () => {
            set({ history: await window.api.listAnimeHistory() });
        },

        removeHistoryEntry: async (id) => {
            await window.api.removeAnimeHistory(id);
            await get().refreshHistory();
        },

        clearHistory: async () => {
            await window.api.clearAnimeHistory();
            set({ history: [] });
        }
    };
});
