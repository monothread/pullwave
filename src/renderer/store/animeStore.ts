import { create } from 'zustand';
import { useFxStore } from '../fx/fxStore';
import { batchNavigation } from '../navigation/navigationBatch';
import type { AniError, AnimeAiringOverride, AnimeCheckState, AnimeHistoryEntry, AnimeHistoryRequest, AnimeMigrationFailure, AnimeMigrationProgress, AnimeMigrationResponse, AnimeRenameSeriesResponse, AnimeSeriesResponse, AnimeJob, AnimeProgressUpdate, AnimeRecord, AnimeScheduleEntry, AnimeSearchResult, AnimeStatus, AnimeStream, AnimeUpdateEntry, LibraryAnime, SubtitleTranslationJob } from '@shared/anime';
import { IDLE_CHECK_STATE } from '@shared/anime';
import { cleanSeasonName, cleanSeriesName, isValidSeason, type SeriesChoice } from '@shared/series';
import { resolveTimeZone, zonedDayLimits } from '@shared/timezone';
import type { MessageKey, MessageParams } from '@shared/i18n/core';
import { createTranslator } from '../i18n/catalogs';
import { resolveAppLanguage } from '../i18n/language';
import { downloadedEpisodeCount, groupLibrary, isRepairable, libraryEntry, libraryProblems, nextListedEpisode, type AudioReport } from '../components/animeText';
import { useAppStore } from './appStore';
import { libraryEntryRefresh, withEntry } from './libraryEntryRefresh';
import { createDoneLinger } from './doneLinger';
import { animeListKey, useSortPrefsStore } from './sortPrefsStore';
import { activitiesOf, updatesOf, upsertSubtitleActivity, type SubtitleActivity } from './subtitleActivity';

export type AnimeView = 'schedule' | 'search' | 'library' | 'updates' | 'history' | 'settings' | 'downloads' | 'subtitles';
export type AnimeOverlayView = Extract<AnimeView, 'downloads' | 'subtitles'>;
export type AnimeBrowseView = Exclude<AnimeView, AnimeOverlayView>;

function isOverlayView(view: AnimeView): view is AnimeOverlayView {
    return view === 'downloads' || view === 'subtitles';
}

export interface AnimeSearchState {
    query: string;
    status: 'idle' | 'searching' | 'done' | 'error';
    results: AnimeSearchResult[];
    error: AniError | null;
    searchedQuery: string;
    hasNextPage: boolean;
    limited: boolean;
    loadingMore: boolean;
}

const NO_MORE_RESULTS = { hasNextPage: false, limited: false, loadingMore: false } as const;

export type AnimeCoverState = { status: 'found'; url: string } | { status: 'none' } | { status: 'failed' };

export type AnimeScheduleView = 'day' | 'week';

export interface AnimeScheduleState {
    status: 'idle' | 'loading' | 'ready' | 'error';
    entries: AnimeScheduleEntry[];
    error: AniError | null;
    view: AnimeScheduleView;
    limits: number[];
}

export interface AnimeSelection {
    result: AnimeSearchResult;
    query: string;
    status: 'loading' | 'ready' | 'error';
    episodes: string[];
    error: AniError | null;
}

export interface PlayingEpisode {
    animeId: number;
    episodeId: number;
}

export interface StreamingEpisode {
    title: string;
    episode: string;
    status: 'loading' | 'ready' | 'error';
    stream: AnimeStream | null;
    error: AniError | null;
    nextEpisode: string | null;
}

export interface AnimeState {
    status: AnimeStatus;
    migration: AnimeMigrationProgress | null;
    checkingAudio: boolean;
    audioReport: AudioReport | null;
    view: AnimeView;
    returnView: AnimeBrowseView;
    jobs: AnimeJob[];
    subtitleJobs: SubtitleActivity[];
    translationUpdates: Record<number, SubtitleTranslationJob>;
    queueHeld: boolean;
    library: LibraryAnime[];
    history: AnimeHistoryEntry[];
    search: AnimeSearchState;
    schedule: AnimeScheduleState;
    covers: Record<string, AnimeCoverState>;
    updates: AnimeUpdateEntry[];
    checkingNew: number | 'all' | null;
    checkState: AnimeCheckState;
    selection: AnimeSelection | null;
    playing: PlayingEpisode | null;
    streaming: StreamingEpisode | null;
    libraryFocus: number | null;
    librarySeries: string | null;
    librarySeason: number | null;
    init: () => Promise<() => void>;
    refreshStatus: () => Promise<void>;
    setView: (view: AnimeBrowseView) => void;
    openDownloads: () => void;
    closeDownloads: () => void;
    openSubtitleJobs: () => void;
    closeSubtitleJobs: () => void;
    cancelSubtitleJob: (activity: SubtitleActivity) => Promise<void>;
    cancelAllSubtitleJobs: () => Promise<void>;
    forgetTranslationUpdates: (episodeIds: readonly number[]) => void;
    openSeries: (key: string) => void;
    closeSeries: () => void;
    openSeason: (animeId: number) => void;
    closeSeason: () => void;
    setQuery: (query: string) => void;
    runSearch: () => Promise<void>;
    loadMoreSearch: () => Promise<void>;
    loadCover: (title: string) => Promise<void>;
    loadSchedule: (refresh?: boolean) => Promise<void>;
    setScheduleView: (view: AnimeScheduleView) => void;
    openScheduleEntry: (entry: AnimeScheduleEntry) => Promise<void>;
    openResult: (result: AnimeSearchResult) => Promise<void>;
    openLibraryAnime: (anime: Pick<AnimeRecord, 'title' | 'query' | 'searchIndex'> & Partial<Pick<AnimeRecord, 'sourceId'>>) => Promise<void>;
    openHistoryEntry: (entry: AnimeHistoryEntry) => Promise<void>;
    importLibrary: () => Promise<void>;
    migrateFolder: () => Promise<AnimeMigrationResponse>;
    checkAudio: () => Promise<void>;
    closeAudioReport: () => void;
    redownloadProblems: () => Promise<void>;
    repairProblems: () => Promise<void>;
    showInLibrary: (animeId: number) => void;
    closeResult: () => void;
    downloadEpisodes: (episodes: string[], joined?: SeriesChoice | null) => Promise<void>;
    addToLibrary: (joined: SeriesChoice | null) => Promise<boolean>;
    downloadMissing: (animeIds: number[]) => Promise<void>;
    renameSeries: (animeIds: number[], name: string) => Promise<AnimeRenameSeriesResponse>;
    setSeries: (animeId: number, series: string | null, season: number | null, seasonName: string | null) => Promise<AnimeSeriesResponse>;
    cancelJob: (episodeId: number) => Promise<void>;
    retryJob: (episodeId: number) => Promise<void>;
    redownloadEpisode: (episodeId: number) => Promise<void>;
    pauseJob: (episodeId: number) => Promise<void>;
    resumeJob: (episodeId: number) => Promise<void>;
    pauseAllJobs: () => Promise<void>;
    resumeAllJobs: () => Promise<void>;
    pauseAnimeJobs: (animeIds: number[]) => Promise<void>;
    resumeAnimeJobs: (animeIds: number[]) => Promise<void>;
    cancelAnimeJobs: (animeIds: number[]) => Promise<void>;
    retryFailedJobs: () => Promise<void>;
    clearFinishedJobs: () => Promise<void>;
    removeEpisode: (episodeId: number) => Promise<void>;
    removeAnime: (animeId: number) => Promise<void>;
    play: (animeId: number, episodeId: number) => void;
    closePlayer: () => void;
    watchEpisode: (episode: string) => Promise<void>;
    closeStream: () => void;
    saveProgress: (update: AnimeProgressUpdate) => Promise<void>;
    setWatched: (episodeId: number, watched: boolean) => Promise<void>;
    refreshLibrary: () => Promise<void>;
    loadUpdates: () => Promise<void>;
    clearUpdates: () => Promise<void>;
    checkNewEpisodes: (animeId: number | null) => Promise<void>;
    openFromUpdate: (entry: AnimeUpdateEntry) => void;
    setAiring: (animeId: number, override: AnimeAiringOverride | null) => Promise<void>;
    refreshHistory: () => Promise<void>;
    removeHistoryEntry: (id: number) => Promise<void>;
    clearHistory: () => Promise<void>;
}

export const INITIAL_SEARCH: AnimeSearchState = {
    query: '',
    status: 'idle',
    results: [],
    error: null,
    searchedQuery: '',
    ...NO_MORE_RESULTS
};

export const INITIAL_SCHEDULE: AnimeScheduleState = {
    status: 'idle',
    entries: [],
    error: null,
    view: 'day',
    limits: []
};

export const MAX_SCHEDULE_SEARCH_NAMES = 3;
export function coverKey(title: string): string {
    return title.trim().toLowerCase();
}

const coversAsked = new Set<string>();
let scheduleRequest = 0;
let searchGeneration = 0;

export const UNSUPPORTED_STATUS: AnimeStatus = { supported: false, available: false, aniCli: null };

function sourceIdOf(result: AnimeSearchResult): { sourceId?: string } {
    return result.sourceId === undefined ? {} : { sourceId: result.sourceId };
}

function overlayOpened(state: Pick<AnimeState, 'view' | 'returnView'>, view: AnimeOverlayView): Pick<AnimeState, 'view' | 'returnView'> {
    if (state.view === view) {
        return state;
    }
    return { view, returnView: isOverlayView(state.view) ? state.returnView : state.view };
}

function overlayClosed(state: Pick<AnimeState, 'returnView'>): Pick<AnimeState, 'view'> {
    return { view: state.returnView };
}

const doneLinger = createDoneLinger<number>();

function translateNow(key: MessageKey, params?: MessageParams): string {
    return createTranslator(resolveAppLanguage(useAppStore.getState().settings.language))(key, params);
}

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

export const useAnimeStore = create<AnimeState>((set, get) => {
    const refreshLibraryEntry = libraryEntryRefresh<LibraryAnime>({
        read: (animeId) => {
            return window.api.getAnimeLibraryEntry(animeId);
        },
        current: () => {
            return get().library;
        },
        put: (entry) => {
            set((state) => {
                return { library: withEntry(state.library, entry) };
            });
        },
        refreshAll: () => {
            return get().refreshLibrary();
        }
    });

    return {
        status: UNSUPPORTED_STATUS,
        migration: null,
        checkingAudio: false,
        audioReport: null,
        view: 'schedule',
        returnView: 'schedule',
        subtitleJobs: [],
        translationUpdates: {},
        jobs: [],
        queueHeld: false,
        library: [],
        history: [],
        search: INITIAL_SEARCH,
        schedule: INITIAL_SCHEDULE,
        covers: {},
        updates: [],
        checkingNew: null,
        checkState: IDLE_CHECK_STATE,
        selection: null,
        playing: null,
        streaming: null,
        libraryFocus: null,
        librarySeries: null,
        librarySeason: null,

        init: async () => {
            const api = window.api;
            const status = await api.getAnimeStatus();
            set({ status });
            if (!status.supported) {
                return (): void => {
                    return undefined;
                };
            }
            const [library, jobs, history, checkState, queueHeld, subtitleJobs] = await Promise.all([
                api.listAnimeLibrary(),
                api.listAnimeJobs(),
                api.listAnimeHistory(),
                api.getAnimeCheckState(),
                api.animeQueueHeld(),
                api.listSubtitleJobs()
            ]);
            set({ library, jobs, history, checkState, queueHeld, subtitleJobs: activitiesOf(subtitleJobs), translationUpdates: updatesOf(subtitleJobs.translations) });
            const unsubscribers = [
                api.onSubtitleTranslationUpdate((job) => {
                    set((state) => {
                        return {
                            subtitleJobs: upsertSubtitleActivity(state.subtitleJobs, { kind: 'translation', job }),
                            translationUpdates: { ...state.translationUpdates, [job.episodeId]: job }
                        };
                    });
                }),
                api.onSubtitleGenerationUpdate((job) => {
                    set((state) => {
                        return { subtitleJobs: upsertSubtitleActivity(state.subtitleJobs, { kind: 'generation', job }) };
                    });
                }),
                api.onAnimeJobUpdate((job) => {
                    set((state) => {
                        return { jobs: upsertAnimeJob(state.jobs, job) };
                    });
                    if (job.status !== 'done') {
                        doneLinger.cancel(job.episodeId);
                        return;
                    }
                    useAppStore.getState().pushToast(translateNow('notice.downloadDone', { title: translateNow('anime.job.title', { title: job.animeTitle, episode: job.episode }) }));
                    useFxStore.getState().celebrate();
                    doneLinger.schedule(job.episodeId, () => {
                        set((state) => {
                            return {
                                jobs: state.jobs.filter((candidate) => {
                                    return candidate.episodeId !== job.episodeId || candidate.status !== 'done';
                                })
                            };
                        });
                    });
                }),
                api.onAnimeQueueHeld((queueHeld) => {
                    set({ queueHeld });
                }),
                api.onAnimeLibraryChanged(() => {
                    void get().refreshLibrary();
                    if (get().view === 'updates') {
                        void get().loadUpdates();
                    }
                }),
                api.onAnimeLibraryEntryChanged((animeId) => {
                    void refreshLibraryEntry(animeId);
                    if (get().view === 'updates') {
                        void get().loadUpdates();
                    }
                }),
                api.onAnimeMigrationProgress((migration) => {
                    if (get().migration !== null) {
                        set({ migration });
                    }
                }),
                api.onAnimeCoverUpdate((update) => {
                    set((state) => {
                        return { covers: { ...state.covers, [coverKey(update.title)]: { status: 'found', url: update.url } } };
                    });
                }),
                api.onAnimeCheckState((checkState) => {
                    set({ checkState });
                }),
                api.onAnimeAutoTranslateOff((reason) => {
                    void useAppStore.getState().refreshSettings();
                    useAppStore.getState().pushToast(translateNow(`anime.notice.autoTranslateOff.${reason}`));
                }),
                api.onAnimeNewEpisodes((news) => {
                    useAppStore.getState().pushToast(translateNow('anime.notice.newEpisodes', { count: news.count, titles: news.titles.join(', ') }));
                    if (news.notDownloaded.length > 0) {
                        useAppStore.getState().pushToast(translateNow('anime.notice.newEpisodesNotDownloaded', { titles: news.notDownloaded.join(', ') }));
                    }
                })
            ];
            return (): void => {
                unsubscribers.forEach((unsubscribe) => {
                    unsubscribe();
                });
            };
        },

        refreshStatus: async () => {
            set({ status: await window.api.getAnimeStatus() });
        },

        setView: (view) => {
            set({ view, returnView: view, libraryFocus: null, librarySeries: null, librarySeason: null });
            if (view === 'library') {
                void get().refreshLibrary();
            }
        },

        openDownloads: () => {
            set((state) => {
                return overlayOpened(state, 'downloads');
            });
        },

        closeDownloads: () => {
            set(overlayClosed);
        },

        openSubtitleJobs: () => {
            set((state) => {
                return overlayOpened(state, 'subtitles');
            });
        },

        closeSubtitleJobs: () => {
            set(overlayClosed);
        },

        forgetTranslationUpdates: (episodeIds) => {
            set((state) => {
                const kept = { ...state.translationUpdates };
                episodeIds.forEach((episodeId) => {
                    delete kept[episodeId];
                });
                return { translationUpdates: kept };
            });
        },

        cancelAllSubtitleJobs: async () => {
            const generations = get().subtitleJobs.filter((activity) => {
                return activity.kind === 'generation';
            });
            await Promise.all([
                window.api.cancelAnimeSubtitleTranslation(null),
                ...generations.map((activity) => {
                    return window.api.cancelAnimeSubtitleGeneration(activity.job.episodeId);
                })
            ]);
        },

        cancelSubtitleJob: async (activity) => {
            if (activity.kind === 'translation') {
                await window.api.cancelAnimeSubtitleTranslation(activity.job.episodeId);
                return;
            }
            await window.api.cancelAnimeSubtitleGeneration(activity.job.episodeId);
        },

        openSeries: (key) => {
            set({ librarySeries: key, librarySeason: null });
        },

        closeSeries: () => {
            set({ librarySeries: null, librarySeason: null, libraryFocus: null });
        },

        openSeason: (animeId) => {
            set({ librarySeason: animeId });
        },

        closeSeason: () => {
            set({ librarySeason: null });
        },

        setQuery: (query) => {
            set((state) => {
                if (query.trim().length === 0) {
                    return { search: { ...state.search, query, status: 'idle', results: [], error: null, ...NO_MORE_RESULTS } };
                }
                return { search: { ...state.search, query } };
            });
        },

        runSearch: async () => {
            searchGeneration += 1;
            const generation = searchGeneration;
            const { search } = get();
            const query = search.query.trim();
            if (query.length === 0) {
                return;
            }
            set((state) => {
                return { selection: null, search: { ...state.search, status: 'searching', error: null, results: [], ...NO_MORE_RESULTS } };
            });
            const response = await window.api.searchAnime(query);
            set((state) => {
                if (state.search.query.trim().length === 0 || generation !== searchGeneration) {
                    return state;
                }
                if (response.ok) {
                    return { search: { ...state.search, status: 'done', results: response.results, searchedQuery: query, hasNextPage: response.hasNextPage, limited: response.limited, loadingMore: false } };
                }
                return { search: { ...state.search, status: 'error', error: response.error, searchedQuery: query } };
            });
        },

        loadMoreSearch: async () => {
            const { search } = get();
            if (search.status !== 'done' || !search.hasNextPage || search.loadingMore) {
                return;
            }
            const { searchedQuery, results } = search;
            const generation = searchGeneration;
            set((state) => {
                return { search: { ...state.search, loadingMore: true } };
            });
            const response = await window.api.searchAnime(searchedQuery, results.length);
            const now = get().search;
            if (generation !== searchGeneration || now.searchedQuery !== searchedQuery || now.results.length !== results.length) {
                return;
            }
            set((state) => {
                if (!response.ok) {
                    return { search: { ...state.search, loadingMore: false, hasNextPage: false, error: response.error } };
                }
                const lastIndex = state.search.results.reduce((last, result) => {
                    return Math.max(last, result.index);
                }, 0);
                const arrived = response.results.filter((result) => {
                    return result.index > lastIndex;
                });
                return {
                    search: {
                        ...state.search,
                        results: [...state.search.results, ...arrived],
                        hasNextPage: response.hasNextPage && arrived.length > 0,
                        limited: response.limited,
                        loadingMore: false
                    }
                };
            });
        },

        loadSchedule: async (refresh = false) => {
            const { view, limits: currentLimits } = get().schedule;
            const timeZone = resolveTimeZone(useAppStore.getState().settings.timeZone);
            const limits = zonedDayLimits(Date.now(), timeZone, view === 'week' ? 7 : 1);
            const limitsChanged =
                currentLimits.length > 0 &&
                (limits.length !== currentLimits.length ||
                    limits.some((limit, index) => {
                        return limit !== currentLimits[index];
                    }));
            const asked = scheduleRequest + 1;
            scheduleRequest = asked;
            set((state) => {
                return {
                    schedule: {
                        ...state.schedule,
                        status: 'loading',
                        error: null,
                        limits,
                        entries: limitsChanged ? [] : state.schedule.entries
                    }
                };
            });
            const response = await window.api.listAnimeSchedule({ from: limits[0] as number, to: limits[limits.length - 1] as number, refresh });
            if (asked !== scheduleRequest) {
                return;
            }
            set((state) => {
                if (response.ok) {
                    return { schedule: { ...state.schedule, status: 'ready', entries: response.entries, error: null } };
                }
                return { schedule: { ...state.schedule, status: 'error', entries: [], error: response.error } };
            });
        },

        loadCover: async (title) => {
            const key = coverKey(title);
            const known = get().covers[key];
            if (key.length === 0 || known?.status === 'found' || coversAsked.has(key)) {
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
            if (state.status === 'none' && get().covers[key]?.status === 'none') {
                return;
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

        openScheduleEntry: async (entry) => {
            const names = (entry.names.length > 0 ? entry.names : [entry.title]).slice(0, MAX_SCHEDULE_SEARCH_NAMES);
            set((state) => {
                return { view: 'search', returnView: 'search', selection: null, search: { ...state.search, query: names[0] as string, status: 'idle', error: null, results: [], ...NO_MORE_RESULTS } };
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
                status: 'loading',
                episodes: [],
                error: null
            };
            set({ selection });
            recordHistory({ title: result.title, query: selection.query, index: result.index, episode: null });
            const response = await window.api.listAnimeEpisodes(selection.query, result.index);
            set((state) => {
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
            if (get().migration !== null) {
                return { ok: false, reason: 'busy' };
            }
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

        checkAudio: async () => {
            set({ checkingAudio: true });
            try {
                const response = await window.api.checkAnimeAudio();
                if (!response.ok) {
                    if (response.reason === 'busy') {
                        notify('error', translateNow('anime.audio.busy'));
                    }
                    return;
                }
                const library = await window.api.listAnimeLibrary();
                const summary = {
                    checked: response.checked,
                    withoutAudio: response.withoutAudio,
                    unreadable: response.unreadable,
                    unreadableIds: response.unreadableIds,
                    missing: response.missing
                };
                set({ library, audioReport: { summary, downloaded: downloadedEpisodeCount(library), problems: libraryProblems(library, response.unreadableIds) } });
            } finally {
                set({ checkingAudio: false });
            }
        },

        closeAudioReport: () => {
            set({ audioReport: null });
        },

        redownloadProblems: async () => {
            const report = get().audioReport;
            if (report === null) {
                return;
            }
            set({ audioReport: null });
            const problems = report.problems.filter((problem) => {
                return !isRepairable(problem);
            });
            if (problems.length === 0) {
                return;
            }
            await window.api.redownloadAnimeEpisodes(
                problems.map((problem) => {
                    return problem.episodeId;
                })
            );
            notify('info', translateNow('anime.audio.queued', { count: problems.length }));
        },

        repairProblems: async () => {
            const report = get().audioReport;
            if (report === null) {
                return;
            }
            const unreadable = report.problems.filter(isRepairable);
            if (unreadable.length === 0) {
                return;
            }
            set({ audioReport: null });
            const response = await window.api.repairAnimeEpisodes(
                unreadable.map((problem) => {
                    return problem.episodeId;
                })
            );
            if (!response.ok) {
                if (response.reason === 'busy') {
                    notify('error', translateNow('anime.audio.repairBusy'));
                }
                return;
            }
            set({ library: await window.api.listAnimeLibrary() });
            notify('info', translateNow('anime.audio.repaired', { repaired: response.repaired, failed: response.failed }));
        },

        openLibraryAnime: async (anime) => {
            if (anime.searchIndex < 1) {
                set((state) => {
                    return {
                        view: 'search',
                        returnView: 'search',
                        selection: null,
                        search: { ...state.search, query: anime.query, status: 'idle', error: null, results: [], ...NO_MORE_RESULTS }
                    };
                });
                await get().runSearch();
                return;
            }
            const result: AnimeSearchResult = { index: anime.searchIndex, title: anime.title, ...(anime.sourceId === undefined || anime.sourceId === null ? {} : { sourceId: anime.sourceId }) };
            let opening: Promise<void> = Promise.resolve();
            batchNavigation(() => {
                set((state) => {
                return {
                    view: 'search',
                    returnView: 'search',
                    search: {
                        ...state.search,
                        query: anime.query,
                        status: 'done',
                        error: null,
                        results: [result],
                        searchedQuery: anime.query,
                        ...NO_MORE_RESULTS
                    }
                };
                });
                opening = get().openResult(result);
            });
            await opening;
        },

        openHistoryEntry: async (entry) => {
            const saved = libraryEntry(get().library, entry.title);
            if (saved) {
                get().showInLibrary(saved.id);
                return;
            }
            await get().openLibraryAnime(entry);
        },

        showInLibrary: (animeId) => {
            const group = groupLibrary(get().library).find((candidate) => {
                return candidate.entries.some((entry) => {
                    return entry.id === animeId;
                });
            });
            set({ view: 'library', returnView: 'library', selection: null, libraryFocus: animeId, librarySeries: group?.key ?? null, librarySeason: null });
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
                ...sourceIdOf(selection.result),
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
                ...sourceIdOf(selection.result),
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

        redownloadEpisode: async (episodeId) => {
            await window.api.redownloadAnimeEpisode(episodeId);
        },

        pauseJob: async (episodeId) => {
            await window.api.pauseAnimeJob(episodeId);
        },

        resumeJob: async (episodeId) => {
            await window.api.resumeAnimeJob(episodeId);
        },

        pauseAllJobs: async () => {
            await window.api.pauseAllAnimeJobs();
        },

        resumeAllJobs: async () => {
            await window.api.resumeAllAnimeJobs();
        },

        pauseAnimeJobs: async (animeIds) => {
            await window.api.pauseAnimes(animeIds);
        },

        resumeAnimeJobs: async (animeIds) => {
            await window.api.resumeAnimes(animeIds);
        },

        cancelAnimeJobs: async (animeIds) => {
            await window.api.cancelAnimes(animeIds);
        },

        retryFailedJobs: async () => {
            const failed = get().jobs.filter((job) => {
                return job.status === 'error' || job.status === 'cancelled';
            });
            await Promise.all(
                failed.map((job) => {
                    return window.api.retryAnimeJob(job.episodeId);
                })
            );
        },

        clearFinishedJobs: async () => {
            await window.api.clearFinishedAnimeJobs();
            set({ jobs: await window.api.listAnimeJobs() });
        },

        removeEpisode: async (episodeId) => {
            await window.api.removeAnimeEpisode(episodeId);
            set((state) => {
                return {
                    library: state.library.map((anime) => {
                        if (
                            !anime.episodes.some((episode) => {
                                return episode.id === episodeId;
                            })
                        ) {
                            return anime;
                        }
                        return {
                            ...anime,
                            episodes: anime.episodes.filter((episode) => {
                                return episode.id !== episodeId;
                            })
                        };
                    }),
                    jobs: state.jobs.filter((job) => {
                        return job.episodeId !== episodeId;
                    })
                };
            });
        },

        removeAnime: async (animeId) => {
            const removed = get().library.find((candidate) => {
                return candidate.id === animeId;
            });
            await window.api.removeAnime(animeId);
            if (removed !== undefined) {
                useSortPrefsStore.getState().clearListOrder('episodes', animeListKey(removed.title));
            }
            set((state) => {
                return {
                    library: state.library.filter((anime) => {
                        return anime.id !== animeId;
                    }),
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
                recordHistory({ title: anime.title, query: anime.query, index: anime.searchIndex, episode: episode.number });
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
            const before = get().streaming;
            if (before?.stream) {
                void window.api.closeAnimeStream(before.stream.sessionId);
            }
            const loading: StreamingEpisode = {
                title: selection.result.title,
                episode,
                status: 'loading',
                stream: null,
                error: null,
                nextEpisode: nextListedEpisode(selection.episodes, episode)
            };
            set({ streaming: loading });
            recordHistory({ title: selection.result.title, query: selection.query, index: selection.result.index, episode });
            const response = await window.api.openAnimeStream({ query: selection.query, index: selection.result.index, episode });
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

        loadUpdates: async () => {
            set({ updates: await window.api.listAnimeUpdates() });
        },

        clearUpdates: async () => {
            await window.api.clearAnimeUpdates();
            set({ updates: [] });
        },

        checkNewEpisodes: async (animeId) => {
            if (get().checkingNew !== null || get().checkState.running) {
                return;
            }
            set({ checkingNew: animeId ?? 'all' });
            try {
                const response = await window.api.checkNewAnimeEpisodes(animeId);
                if (!response.ok) {
                    useAppStore.getState().pushToast(translateNow('anime.notice.checkFailed', { message: response.error.message }));
                } else {
                    if (response.count === 0) {
                        useAppStore.getState().pushToast(translateNow(response.failed > 0 ? 'anime.notice.checkUnreached' : 'anime.notice.checkNone', { failed: response.failed }));
                    }
                    if (response.skipped > 0) {
                        useAppStore.getState().pushToast(translateNow('anime.notice.checkSkipped', { skipped: response.skipped }));
                    }
                }
                await get().refreshLibrary();
                if (get().view === 'updates') {
                    await get().loadUpdates();
                }
            } finally {
                set({ checkingNew: null });
            }
        },

        openFromUpdate: (entry) => {
            get().showInLibrary(entry.animeId);
        },

        setAiring: async (animeId, override) => {
            await window.api.setAnimeAiring(animeId, override);
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
