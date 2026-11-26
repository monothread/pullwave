import { create } from 'zustand';
import { useFxStore } from '../fx/fxStore';
import { batchNavigation } from '../navigation/navigationBatch';
import { hasChapterFile, IDLE_MANGA_CHECK_STATE, LOCAL_MANGA_SOURCE_ID, MAX_READING_KEPT } from '@shared/manga';
import type { MessageKey, MessageParams } from '@shared/i18n/core';
import { createTranslator } from '../i18n/catalogs';
import type {
    ExtensionAction,
    LibraryManga,
    MangaChapter,
    MangaChapterMove,
    MangaDetailsWithChapters,
    MangaCheckState,
    MangaCloudflareActivity,
    MangaDetails,
    MangaError,
    MangaFilter,
    MangaExtension,
    MangaGroup,
    MangaGroupDirection,
    MangaGroupResponse,
    MangaHealth,
    MangaUpdateEntry,
    ReadingEntry,
    ReadingRecord,
    MangaToolUpdateResult,
    MangaToolVersions,
    MangaExtensionStore,
    MangaJob,
    MangaListKind,
    MangaMigrationFailure,
    MangaMigrationProgress,
    MangaMigrationResponse,
    MangaRenameSeriesResponse,
    MangaSeriesRequest,
    MangaSeriesResponse,
    MangaSourceMigrationRequest,
    MangaSourceMigrationResponse,
    MangaSource,
    MangaSourcePreference,
    MangaStatusInfo,
    MangaSummary
} from '@shared/manga';
import { resolveAppLanguage, systemLocale } from '../i18n/language';
import { adjacentSeason, ALL_LANGUAGES, chapterMovesByNumber, chapterState, downloadablePicks, libraryChapterIds, libraryEntry, listedSources, localDetails, readerChapters, resolveMangaLanguage, withLibraryChapters, type ExtensionFilter } from '../components/mangaText';
import { activateFilter, type TermKind } from '../components/mangaFilterSearch';
import { RESULTS_PER_SOURCE, runLimited, SEARCH_CONCURRENCY, searchableSources, sourceLanguages } from '../components/mangaSearchSources';
import { loadMangaUiPrefs, saveMangaUiPrefs } from '../components/mangaUiPrefs';
import { copiedReadKeys, copyChapterProgress, hasReadUnderTitle, loadReadKeys, moveMangaReading, movedReadKeys, orphanReadIds, saveReadKeys } from '../components/readerPrefs';
import { useAppStore } from './appStore';
import { libraryEntryRefresh, withEntry } from './libraryEntryRefresh';
import { mangaListKey, useSortPrefsStore } from './sortPrefsStore';

export type MangaView = 'browse' | 'search' | 'updates' | 'library' | 'history' | 'extensions' | 'settings' | 'downloads';
export type MangaBrowseView = Exclude<MangaView, 'downloads'>;

export type MangaSearchSourceStatus = 'waiting' | 'searching' | 'found' | 'none' | 'error';

export interface MangaSearchSourceResult {
    source: MangaSource;
    status: MangaSearchSourceStatus;
    items: MangaSummary[];
    error: MangaError | null;
}

export interface MangaSearchState {
    query: string;
    searchedFor: string;
    status: 'idle' | 'searching' | 'done';
    results: MangaSearchSourceResult[];
    allLanguages: boolean;
}

export interface MangaBrowseState {
    sources: MangaSource[];
    sourcesStatus: 'idle' | 'loading' | 'ready' | 'error';
    sourcesError: MangaError | null;
    sourceId: string | null;
    mode: MangaListKind;
    query: string;
    filters: MangaFilter[];
    initialFilters: MangaFilter[];
    filtersStatus: 'idle' | 'loading' | 'ready' | 'error';
    filtersOpen: boolean;
    status: 'idle' | 'loading' | 'done' | 'error';
    items: MangaSummary[];
    page: number;
    hasNextPage: boolean;
    loadingMore: boolean;
    error: MangaError | null;
}

export interface MangaSelection {
    manga: MangaSummary;
    status: 'loading' | 'ready' | 'error';
    details: MangaDetails | null;
    chapters: MangaChapter[];
    selected: number[];
    error: MangaError | null;
}

export interface MangaExtensionsState {
    stores: MangaExtensionStore[];
    extensions: MangaExtension[];
    status: 'idle' | 'loading' | 'ready' | 'error';
    error: MangaError | null;
    busy: string[];
    filter: Omit<ExtensionFilter, 'lang'>;
}

export interface MangaSourceSettingsState {
    open: boolean;
    status: 'idle' | 'loading' | 'ready' | 'error';
    preferences: MangaSourcePreference[];
    error: MangaError | null;
    saving: boolean;
}

export const UPDATE_ALL_KEY = 'update-all';
export const DONE_JOB_LINGER_MS = 1500;

export type ChapterSelectionKind = 'all' | 'none' | 'missing';

const EMPTY_STATUS: MangaStatusInfo = { supported: false, tool: null, helper: null, helperProblem: null, helperExternal: false, server: 'stopped', serverError: null };

const EMPTY_BROWSE: MangaBrowseState = {
    sources: [],
    sourcesStatus: 'idle',
    sourcesError: null,
    sourceId: null,
    mode: 'popular',
    query: '',
    filters: [],
    initialFilters: [],
    filtersStatus: 'idle',
    filtersOpen: false,
    status: 'idle',
    items: [],
    page: 1,
    hasNextPage: false,
    loadingMore: false,
    error: null
};

const EMPTY_SOURCE_SETTINGS: MangaSourceSettingsState = { open: false, status: 'idle', preferences: [], error: null, saving: false };

const EMPTY_EXTENSIONS: MangaExtensionsState = {
    stores: [],
    extensions: [],
    status: 'idle',
    error: null,
    busy: [],
    filter: { query: '', onlyInstalled: true }
};

export interface ReaderChapter {
    remoteId: number;
    libraryChapterId: number | null;
    name: string;
    number: number | null;
}

export interface MangaReaderState {
    status: 'closed' | 'loading' | 'ready' | 'error';
    mangaTitle: string;
    chapters: ReaderChapter[];
    index: number;
    pages: string[];
    local: boolean;
    missing: number[];
    error: MangaError | null;
    manga?: MangaSummary | null;
    resume?: boolean;
    entry?: 'start' | 'end';
}

const EMPTY_SEARCH: MangaSearchState = { query: '', searchedFor: '', status: 'idle', results: [], allLanguages: false };

let searchRun = 0;

const CLOSED_READER: MangaReaderState = { status: 'closed', mangaTitle: '', chapters: [], index: 0, pages: [], local: false, missing: [], error: null };

interface MangaState {
    reader: MangaReaderState;
    selectionFrom: 'browse' | 'search' | 'library';
    status: MangaStatusInfo;
    view: MangaBrowseView | 'downloads';
    previousView: MangaBrowseView;
    library: LibraryManga[];
    groups: MangaGroup[];
    libraryGroup: number | null;
    librarySeries: string | null;
    jobs: MangaJob[];
    queueHeld: boolean;
    browse: MangaBrowseState;
    search: MangaSearchState;
    selection: MangaSelection | null;
    selectionRefresh: { loading: boolean; error: MangaError | null };
    sourceSettings: MangaSourceSettingsState;
    extensions: MangaExtensionsState;
    cloudflare: MangaCloudflareActivity[];
    migration: MangaMigrationProgress | null;
    readKeys: string[];
    failedRetitles: number[];
    triedRecoveries: number[];
    toolVersions: MangaToolVersions | null;
    toolsChecking: boolean;
    updateResults: { helper: MangaToolUpdateResult | null };
    updating: { helper: boolean };
    health: MangaHealth | null;
    healthChecking: boolean;
    programsRestarting: boolean;
    updates: MangaUpdateEntry[];
    history: ReadingEntry[];
    checkingNew: number | 'all' | null;
    checkState: MangaCheckState;

    loadUpdates: () => Promise<void>;
    clearUpdates: () => Promise<void>;
    checkNewChapters: (mangaId: number | null) => Promise<void>;
    loadHistory: () => Promise<void>;
    removeReading: (id: number) => Promise<void>;
    clearReading: () => Promise<void>;
    openFromHistory: (entry: ReadingEntry) => Promise<void>;
    openFromUpdate: (entry: MangaUpdateEntry) => Promise<void>;
    openLibraryManga: (mangaId: number) => Promise<void>;
    recordReading: (record: ReadingRecord) => Promise<void>;
    checkToolUpdates: () => Promise<void>;
    updateHelper: () => Promise<void>;
    checkHealth: (start: boolean) => Promise<void>;
    restartPrograms: () => Promise<void>;
    markRead: (keys: readonly string[], read: boolean) => void;
    moveReading: (fromTitle: string, toTitle: string, moves: readonly MangaChapterMove[]) => void;
    init: () => Promise<() => void>;
    refreshStatus: () => Promise<void>;
    retryInstall: () => Promise<void>;
    installHelper: () => Promise<void>;
    removeHelper: () => Promise<void>;
    setView: (view: MangaBrowseView) => void;
    openDownloads: () => void;
    closeDownloads: () => void;

    loadSources: () => Promise<void>;
    setSearchAllLanguages: (value: boolean) => void;
    setSearchQuery: (query: string) => void;
    runSearch: () => Promise<void>;
    openSource: (sourceId: string, mode?: MangaListKind) => void;
    closeSource: () => void;
    openSourceSettings: () => Promise<void>;
    closeSourceSettings: () => void;
    changePreference: (preference: MangaSourcePreference, value: MangaSourcePreference['value']) => Promise<void>;
    setMode: (mode: MangaListKind) => void;
    setQuery: (query: string) => void;
    openReader: (mangaTitle: string, chapters: ReaderChapter[], index: number, resume?: boolean, entry?: 'start' | 'end', manga?: MangaSummary) => Promise<void>;
    goToChapter: (step: 1 | -1, byScroll?: boolean) => Promise<boolean>;
    goToChapterIndex: (index: number) => Promise<boolean>;
    closeReader: () => void;
    runList: () => Promise<void>;
    loadFilters: () => Promise<void>;
    setFilters: (filters: MangaFilter[]) => void;
    resetFilters: () => void;
    toggleFilters: () => void;
    loadMore: () => Promise<void>;
    openManga: (manga: MangaSummary) => Promise<void>;
    closeManga: () => void;
    toggleChapter: (remoteId: number) => void;
    selectChapters: (kind: ChapterSelectionKind) => void;
    downloadSelected: () => Promise<void>;
    downloadChapter: (remoteId: number) => Promise<void>;
    addToLibrary: () => Promise<boolean>;
    showInLibrary: () => Promise<void>;
    showInSource: () => Promise<void>;
    searchByTerm: (term: string, kind?: TermKind) => Promise<void>;
    termFilters: { sourceId: string | null; status: 'idle' | 'loading' | 'ready' | 'error'; filters: MangaFilter[] };
    loadTermFilters: (sourceId: string) => Promise<void>;

    refreshLibrary: () => Promise<void>;
    refreshGroups: () => Promise<void>;
    openSeries: (key: string) => void;
    closeSeries: () => void;
    setLibraryGroup: (groupId: number | null) => void;
    setSeries: (request: MangaSeriesRequest) => Promise<MangaSeriesResponse>;
    renameSeries: (mangaIds: number[], series: string) => Promise<MangaRenameSeriesResponse>;
    createGroup: (name: string) => Promise<MangaGroupResponse>;
    renameGroup: (groupId: number, name: string) => Promise<MangaGroupResponse>;
    deleteGroup: (groupId: number) => Promise<void>;
    moveGroup: (groupId: number, direction: MangaGroupDirection) => Promise<void>;
    setGroupMembers: (groupId: number, mangaIds: number[], member: boolean) => Promise<void>;
    migrateSource: (request: MangaSourceMigrationRequest) => Promise<MangaSourceMigrationResponse>;
    downloadMissing: (mangaId: number) => Promise<void>;
    openFolder: (mangaId: number) => Promise<void>;
    openSite: (url: string) => Promise<void>;
    migrateFolder: () => Promise<MangaMigrationResponse>;
    importLibrary: () => Promise<void>;
    removeManga: (mangaId: number) => Promise<void>;
    removeDownload: (chapterId: number) => Promise<void>;

    cancelJob: (chapterId: number) => Promise<void>;
    retryJob: (chapterId: number) => Promise<void>;
    repairChapter: (chapterId: number) => Promise<void>;
    repairReaderPage: (pageIndex: number) => Promise<MangaError | null>;
    retryFailedJobs: () => Promise<void>;
    pauseJob: (chapterId: number) => Promise<void>;
    pauseAllJobs: () => Promise<void>;
    resumeAllJobs: () => Promise<void>;
    pauseMangaJobs: (mangaIds: number[]) => Promise<void>;
    resumeMangaJobs: (mangaIds: number[]) => Promise<void>;
    cancelMangaJobs: (mangaIds: number[]) => Promise<void>;
    resumeJob: (chapterId: number) => Promise<void>;
    clearFinishedJobs: () => Promise<void>;

    loadExtensions: (refresh?: boolean) => Promise<void>;
    addStore: (indexUrl: string) => Promise<boolean>;
    removeStore: (indexUrl: string) => Promise<void>;
    updateAllExtensions: () => Promise<void>;
    changeExtension: (pkgName: string, action: ExtensionAction) => Promise<void>;
    setExtensionFilter: (filter: Partial<Omit<ExtensionFilter, 'lang'>>) => void;
}

function translateNow(key: MessageKey, params?: MessageParams): string {
    return createTranslator(resolveAppLanguage(useAppStore.getState().settings.language))(key, params);
}

let filtersLoad: { sourceId: string; promise: Promise<void> } | null = null;

function toast(key: MessageKey, params?: MessageParams): void {
    useAppStore.getState().pushToast(translateNow(key, params));
}

const MIGRATION_ERRORS: Record<Exclude<MangaMigrationFailure, 'cancelled'>, MessageKey> = {
    busy: 'manga.migrate.error.busy',
    same: 'manga.migrate.error.same',
    inside: 'manga.migrate.error.inside',
    conflict: 'manga.migrate.error.conflict',
    failed: 'manga.migrate.error.failed'
};

function asOnePage(steps: () => Promise<void>): Promise<void> {
    let rest: Promise<void> = Promise.resolve();
    batchNavigation(() => {
        rest = steps();
    });
    return rest;
}

export function upsertMangaJob(jobs: readonly MangaJob[], job: MangaJob): MangaJob[] {
    const index = jobs.findIndex((candidate) => {
        return candidate.chapterId === job.chapterId;
    });
    if (index === -1) {
        return [...jobs, job];
    }
    return jobs.map((candidate, position) => {
        return position === index ? job : candidate;
    });
}

function summaryOf(selection: MangaSelection, library: readonly LibraryManga[]): MangaSummary {
    const summary =
        selection.details === null
            ? selection.manga
            : { remoteId: selection.details.remoteId, sourceId: selection.details.sourceId, title: selection.details.title, thumbnailUrl: selection.details.thumbnailUrl };
    const saved = libraryEntry(library, summary.sourceId, summary.remoteId);
    return saved === null ? summary : { ...summary, title: saved.title };
}

export const useMangaStore = create<MangaState>((set, get) => {
    const refreshLibraryEntry = libraryEntryRefresh<LibraryManga>({
        read: (mangaId) => {
            return window.api.manga.libraryEntry(mangaId);
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

    function patchBrowse(patch: Partial<MangaBrowseState>): void {
        set((state) => {
            return { browse: { ...state.browse, ...patch } };
        });
    }

    let extensionMutationVersion = 0;

    function patchExtensions(patch: Partial<MangaExtensionsState>): void {
        set((state) => {
            return { extensions: { ...state.extensions, ...patch } };
        });
    }

    function setBusy(key: string, busy: boolean): void {
        set((state) => {
            const others = state.extensions.busy.filter((item) => {
                return item !== key;
            });
            return { extensions: { ...state.extensions, busy: busy ? [...others, key] : others } };
        });
    }

    function followRenamedReader(fromTitle: string, toTitle: string): void {
        const { reader } = get();
        if (reader.status !== 'closed' && reader.mangaTitle === fromTitle) {
            set({ reader: { ...reader, mangaTitle: toTitle } });
        }
    }

    async function adoptTitleReadUnder(saved: LibraryManga, sourceTitle: string): Promise<string> {
        if (saved.title === sourceTitle || get().failedRetitles.includes(saved.id)) {
            return saved.title;
        }
        const chapterRemoteIds = saved.chapters.map((chapter) => {
            return chapter.remoteId;
        });
        if (!hasReadUnderTitle(get().readKeys, sourceTitle, chapterRemoteIds)) {
            return saved.title;
        }
        const response = await window.api.manga.retitle({ mangaId: saved.id, title: sourceTitle });
        if (!response.ok) {
            if (response.reason !== 'busy') {
                set({ failedRetitles: [...get().failedRetitles, saved.id] });
            }
            return saved.title;
        }
        followRenamedReader(saved.title, response.manga.title);
        get().moveReading(
            saved.title,
            response.manga.title,
            chapterRemoteIds.map((chapterRemoteId) => {
                return { from: chapterRemoteId, to: chapterRemoteId };
            })
        );
        await get().refreshLibrary();
        return response.manga.title;
    }

    function copyReading(fromTitle: string, toTitle: string, moves: readonly MangaChapterMove[]): void {
        copyChapterProgress(fromTitle, toTitle, moves);
        set((state) => {
            const readKeys = copiedReadKeys(state.readKeys, fromTitle, toTitle, moves);
            saveReadKeys(readKeys);
            return { readKeys };
        });
    }

    async function recoverOrphanReads(saved: LibraryManga, title: string, sourceChapters: readonly MangaChapter[]): Promise<void> {
        if (get().triedRecoveries.includes(saved.id)) {
            return;
        }
        const titles = saved.title === title ? [title] : [saved.title, title];
        const current = withLibraryChapters(sourceChapters, saved);
        const known = libraryChapterIds(get().library);
        current.forEach((chapter) => {
            known.add(chapter.remoteId);
        });
        const orphans = orphanReadIds(get().readKeys, titles, known);
        if (orphans.length === 0) {
            return;
        }
        set({ triedRecoveries: [...get().triedRecoveries, saved.id] });
        const result = await window.api.manga.chaptersByIds(orphans);
        if (!result.ok) {
            set({
                triedRecoveries: get().triedRecoveries.filter((mangaId) => {
                    return mangaId !== saved.id;
                })
            });
            return;
        }
        const moves = chapterMovesByNumber(result.value, current);
        if (moves.length > 0) {
            titles.forEach((fromTitle) => {
                copyReading(fromTitle, title, moves);
            });
        }
    }

    async function repairReading(manga: MangaSummary, source: MangaDetailsWithChapters): Promise<void> {
        const saved = libraryEntry(get().library, manga.sourceId, manga.remoteId);
        if (saved === null) {
            return;
        }
        const title = await adoptTitleReadUnder(saved, source.details.title);
        await recoverOrphanReads(saved, title, source.chapters);
    }

    function chaptersToSend(selection: MangaSelection): MangaChapter[] {
        const picked = new Set(downloadablePicks(libraryEntry(get().library, selection.manga.sourceId, selection.manga.remoteId), selection.selected));
        return selection.chapters.filter((chapter) => {
            return picked.has(chapter.remoteId);
        });
    }

    const initialPrefs = loadMangaUiPrefs();

    return {
        status: EMPTY_STATUS,
        view: 'browse',
        previousView: 'browse',
        library: [],
        groups: [],
        libraryGroup: null,
        librarySeries: null,
        jobs: [],
        queueHeld: false,
        browse: EMPTY_BROWSE,
        search: EMPTY_SEARCH,
        selection: null,
        selectionRefresh: { loading: false, error: null },
        sourceSettings: EMPTY_SOURCE_SETTINGS,
        reader: CLOSED_READER,
        selectionFrom: 'browse',
        migration: null,
        readKeys: loadReadKeys(),
        failedRetitles: [],
        triedRecoveries: [],
        toolVersions: null,
        toolsChecking: false,
        updateResults: { helper: null },
        updating: { helper: false },
        health: null,
        healthChecking: false,
        programsRestarting: false,
        termFilters: { sourceId: null, status: 'idle', filters: [] },
        updates: [],
        history: [],
        checkingNew: null,
        checkState: IDLE_MANGA_CHECK_STATE,
        extensions: { ...EMPTY_EXTENSIONS, filter: { ...EMPTY_EXTENSIONS.filter, onlyInstalled: initialPrefs.onlyInstalled } },
        cloudflare: [],

        init: async () => {
            const api = window.api.manga;
            const status = await api.status();
            set({ status });
            if (!status.supported) {
                return (): void => {
                    return undefined;
                };
            }
            const [library, jobs, groups, queueHeld, checkState] = await Promise.all([api.library(), api.jobs(), api.groups(), api.queueHeld(), api.checkState()]);
            set({ library, jobs, groups, queueHeld, checkState });
            let active = true;
            let extensionsChecked = false;
            const refreshInstalledExtensionsOnStart = async (): Promise<void> => {
                if (extensionsChecked || !active || get().status.server !== 'running') {
                    return;
                }
                extensionsChecked = true;
                const revisionAtStart = extensionMutationVersion;
                try {
                    const current = await api.extensions(false);
                    if (!active || !current.ok || revisionAtStart !== extensionMutationVersion) {
                        return;
                    }
                    const hasInstalled = current.value.some((extension) => {
                        return extension.isInstalled;
                    });
                    if (!hasInstalled) {
                        return;
                    }
                    const [stores, refreshed] = await Promise.all([api.stores(), api.extensions(true)]);
                    if (!active || revisionAtStart !== extensionMutationVersion || !stores.ok || !refreshed.ok) {
                        return;
                    }
                    patchExtensions({ status: 'ready', error: null, stores: stores.value, extensions: refreshed.value });
                } catch {
                    return;
                }
            };
            const unsubscribers = [
                api.onToolState((tool) => {
                    set((state) => {
                        return { status: tool.id === 'flaresolverr' ? { ...state.status, helper: tool } : { ...state.status, tool } };
                    });
                    if (tool.status === 'ready' || tool.status === 'error') {
                        void get().refreshStatus();
                    }
                }),
                api.onServerStatus((server) => {
                    set((state) => {
                        return { status: { ...state.status, server } };
                    });
                    if (server === 'running') {
                        void get().refreshLibrary();
                        void refreshInstalledExtensionsOnStart();
                    }
                    if (server === 'error') {
                        void get().refreshStatus();
                    }
                }),
                api.onCloudflareActivity((cloudflare) => {
                    set({ cloudflare });
                }),
                api.onJobUpdate((job) => {
                    if (job.status === 'done') {
                        set((state) => {
                            return { jobs: upsertMangaJob(state.jobs, job) };
                        });
                        setTimeout(() => {
                            set((state) => {
                                return {
                                    jobs: state.jobs.filter((candidate) => {
                                        return candidate.chapterId !== job.chapterId || candidate.status !== 'done';
                                    })
                                };
                            });
                        }, DONE_JOB_LINGER_MS);
                        const title = `${job.mangaTitle} · ${job.chapterName}`;
                        if (job.missingPages > 0) {
                            toast('manga.notice.downloadIncomplete', { title, count: job.missingPages });
                        } else {
                            toast('notice.downloadDone', { title });
                            useFxStore.getState().celebrate();
                        }
                        return;
                    }
                    set((state) => {
                        return { jobs: upsertMangaJob(state.jobs, job) };
                    });
                }),
                api.onQueueHeld((queueHeld) => {
                    set({ queueHeld });
                }),
                api.onLibraryChanged(() => {
                    void get().refreshLibrary();
                    if (get().view === 'updates') {
                        void get().loadUpdates();
                    }
                }),
                api.onLibraryEntryChanged((mangaId) => {
                    void refreshLibraryEntry(mangaId);
                    if (get().view === 'updates') {
                        void get().loadUpdates();
                    }
                }),
                api.onMigrationProgress((migration) => {
                    if (get().migration !== null) {
                        set({ migration });
                    }
                }),
                api.onCheckState((checkState) => {
                    set({ checkState });
                }),
                api.onNewChapters((news) => {
                    toast('manga.notice.newChapters', { count: news.count, titles: news.titles.join(', ') });
                })
            ];
            await get().refreshStatus();
            if (get().status.server === 'running') {
                void refreshInstalledExtensionsOnStart();
            }
            return (): void => {
                active = false;
                unsubscribers.forEach((unsubscribe) => {
                    unsubscribe();
                });
            };
        },

        loadUpdates: async () => {
            set({ updates: await window.api.manga.updates() });
        },

        clearUpdates: async () => {
            await window.api.manga.clearUpdates();
            set({ updates: [] });
        },

        checkNewChapters: async (mangaId) => {
            if (get().checkingNew !== null || get().checkState.running) {
                return;
            }
            set({ checkingNew: mangaId ?? 'all' });
            try {
                const response = await window.api.manga.checkNewChapters(mangaId);
                if (!response.ok) {
                    toast('manga.notice.checkFailed', { message: response.error.message });
                } else {
                    if (response.count === 0) {
                        toast(response.failed > 0 ? 'manga.notice.checkUnreached' : 'manga.notice.checkNone', { failed: response.failed });
                    }
                    if (response.skipped > 0) {
                        toast('manga.notice.checkSkipped', { skipped: response.skipped });
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

        loadHistory: async () => {
            set({ history: await window.api.manga.readingHistory() });
        },

        removeReading: async (id) => {
            await window.api.manga.removeReading(id);
            set((state) => {
                return {
                    history: state.history.filter((entry) => {
                        return entry.id !== id;
                    })
                };
            });
        },

        clearReading: async () => {
            await window.api.manga.clearReading();
            set({ history: [] });
        },

        openFromHistory: async (entry) => {
            const saved =
                entry.libraryMangaId === null
                    ? null
                    : (get().library.find((manga) => {
                          return manga.id === entry.libraryMangaId;
                      }) ?? null);
            const summary: MangaSummary = { remoteId: entry.mangaRemoteId, sourceId: entry.sourceId, title: saved?.title ?? entry.title, thumbnailUrl: saved?.thumbnailUrl ?? entry.thumbnailUrl };
            await asOnePage(() => {
                set({ view: saved === null ? 'browse' : 'library', librarySeries: null, selection: null });
                return get().openManga(summary);
            });
        },

        openFromUpdate: async (entry) => {
            await get().openLibraryManga(entry.mangaId);
        },

        openLibraryManga: async (mangaId) => {
            const saved = get().library.find((manga) => {
                return manga.id === mangaId;
            });
            if (saved === undefined) {
                return;
            }
            await asOnePage(() => {
                set({ view: 'library', librarySeries: null, selection: null });
                return get().openManga({ remoteId: saved.remoteId, sourceId: saved.sourceId, title: saved.title, thumbnailUrl: saved.thumbnailUrl });
            });
        },

        recordReading: async (record) => {
            const saved = await window.api.manga.recordReading(record);
            if (saved !== null && saved !== undefined && get().history.length > 0) {
                set((state) => {
                    const others = state.history.filter((entry) => {
                        return !(entry.sourceId === saved.sourceId && entry.mangaRemoteId === saved.mangaRemoteId);
                    });
                    const merged = [saved, ...others].sort((first, second) => {
                        return second.readAt - first.readAt || second.id - first.id;
                    });
                    return { history: merged.slice(0, MAX_READING_KEPT) };
                });
                return;
            }
            await get()
                .loadHistory()
                .catch(() => {
                    return undefined;
                });
        },

        checkToolUpdates: async () => {
            set({ toolsChecking: true });
            try {
                set({ toolVersions: await window.api.manga.checkToolUpdates() });
            } finally {
                set({ toolsChecking: false });
            }
        },

        updateHelper: async () => {
            set((state) => {
                return { updating: { ...state.updating, helper: true }, updateResults: { ...state.updateResults, helper: null } };
            });
            const result = await window.api.manga.updateHelper();
            set((state) => {
                return { updating: { ...state.updating, helper: false }, updateResults: { ...state.updateResults, helper: result } };
            });
            await get().checkToolUpdates();
            await get().refreshStatus();
        },

        checkHealth: async (start) => {
            set({ healthChecking: true });
            try {
                set({ health: await window.api.manga.health(start) });
            } finally {
                set({ healthChecking: false });
            }
        },

        restartPrograms: async () => {
            set({ programsRestarting: true });
            try {
                set({ health: await window.api.manga.restartPrograms() });
            } finally {
                set({ programsRestarting: false });
            }
        },

        markRead: (keys, read) => {
            set((state) => {
                const wanted = new Set(keys);
                const others = state.readKeys.filter((key) => {
                    return !wanted.has(key);
                });
                const readKeys = read ? [...others, ...wanted] : others;
                saveReadKeys(readKeys);
                return { readKeys };
            });
        },

        moveReading: (fromTitle, toTitle, moves) => {
            moveMangaReading(fromTitle, toTitle, moves);
            set((state) => {
                const readKeys = movedReadKeys(state.readKeys, fromTitle, toTitle, moves);
                saveReadKeys(readKeys);
                return { readKeys };
            });
        },

        refreshStatus: async () => {
            set({ status: await window.api.manga.status() });
        },

        retryInstall: async () => {
            await window.api.manga.install();
            await get().refreshStatus();
        },

        installHelper: async () => {
            await window.api.manga.installHelper();
            await get().refreshStatus();
        },

        removeHelper: async () => {
            await window.api.manga.removeHelper();
            await get().refreshStatus();
        },

        setView: (view) => {
            set({ view });
        },

        openDownloads: () => {
            set((state) => {
                return { view: 'downloads', previousView: state.view === 'downloads' ? state.previousView : state.view };
            });
        },

        closeDownloads: () => {
            set((state) => {
                return { view: state.previousView };
            });
        },

        loadSources: async () => {
            patchBrowse({ sourcesStatus: 'loading', sourcesError: null });
            const [result, stores] = await Promise.all([window.api.manga.sources(), window.api.manga.stores()]);
            if (stores.ok) {
                patchExtensions({ stores: stores.value });
            }
            if (!result.ok) {
                patchBrowse({ sourcesStatus: 'error', sourcesError: result.error });
                return;
            }
            const sources = result.value.filter((source) => {
                return source.id !== '0';
            });
            const current = get().browse.sourceId;
            const stillThere = sources.some((source) => {
                return source.id === current;
            });
            patchBrowse({ sources, sourcesStatus: 'ready', ...(stillThere ? {} : { sourceId: null, status: 'idle', items: [], page: 1, hasNextPage: false, error: null }) });
            if (!stillThere) {
                set({ sourceSettings: EMPTY_SOURCE_SETTINGS });
            }
        },

        setSearchAllLanguages: (value) => {
            set((state) => {
                return { search: { ...state.search, allLanguages: value } };
            });
        },

        setSearchQuery: (query) => {
            if (query.trim().length === 0) {
                searchRun += 1;
                set((state) => {
                    return { search: { ...EMPTY_SEARCH, allLanguages: state.search.allLanguages } };
                });
                return;
            }
            set((state) => {
                return { search: { ...state.search, query } };
            });
        },

        runSearch: async () => {
            const query = get().search.query.trim();
            if (query.length === 0) {
                return;
            }
            searchRun += 1;
            const run = searchRun;
            const { mangaShowAdult, mangaLanguage } = useAppStore.getState().settings;
            const { sources } = get().browse;
            const language = get().search.allLanguages ? ALL_LANGUAGES : resolveMangaLanguage(mangaLanguage, sourceLanguages(listedSources(sources, mangaShowAdult)), systemLocale());
            const targets = searchableSources(sources, language, mangaShowAdult);
            const patchResult = (sourceId: string, changes: Partial<MangaSearchSourceResult>): void => {
                if (run !== searchRun) {
                    return;
                }
                set((state) => {
                    return {
                        search: {
                            ...state.search,
                            results: state.search.results.map((result) => {
                                return result.source.id === sourceId ? { ...result, ...changes } : result;
                            })
                        }
                    };
                });
            };
            set((state) => {
                return {
                    search: {
                        ...state.search,
                        searchedFor: query,
                        status: 'searching',
                        results: targets.map((source) => {
                            return { source, status: 'waiting', items: [], error: null };
                        })
                    }
                };
            });
            await runLimited(targets, SEARCH_CONCURRENCY, async (source) => {
                if (run !== searchRun) {
                    return;
                }
                patchResult(source.id, { status: 'searching' });
                const response = await window.api.manga.list({ sourceId: source.id, kind: 'search', page: 1, query });
                if (!response.ok) {
                    patchResult(source.id, { status: 'error', error: response.error });
                    return;
                }
                const items = response.value.items.slice(0, RESULTS_PER_SOURCE);
                patchResult(source.id, { status: items.length > 0 ? 'found' : 'none', items });
            });
            if (run === searchRun) {
                set((state) => {
                    return { search: { ...state.search, status: 'done' } };
                });
            }
        },

        openSource: (sourceId, mode = 'popular') => {
            patchBrowse({ sourceId, mode, query: '', filters: [], initialFilters: [], filtersStatus: 'idle', filtersOpen: false, status: 'idle', items: [], page: 1, hasNextPage: false, loadingMore: false, error: null });
            set({ sourceSettings: EMPTY_SOURCE_SETTINGS, selection: null });
        },

        closeSource: () => {
            patchBrowse({ sourceId: null, query: '', filters: [], initialFilters: [], filtersStatus: 'idle', filtersOpen: false, status: 'idle', items: [], page: 1, hasNextPage: false, loadingMore: false, error: null });
            set({ sourceSettings: EMPTY_SOURCE_SETTINGS });
        },

        openSourceSettings: async () => {
            const { sourceId } = get().browse;
            if (sourceId === null) {
                return;
            }
            set({ sourceSettings: { ...EMPTY_SOURCE_SETTINGS, open: true, status: 'loading' } });
            const result = await window.api.manga.sourcePreferences(sourceId);
            if (get().browse.sourceId !== sourceId || !get().sourceSettings.open) {
                return;
            }
            set({ sourceSettings: result.ok ? { ...EMPTY_SOURCE_SETTINGS, open: true, status: 'ready', preferences: result.value } : { ...EMPTY_SOURCE_SETTINGS, open: true, status: 'error', error: result.error } });
        },

        closeSourceSettings: () => {
            set({ sourceSettings: EMPTY_SOURCE_SETTINGS });
        },

        changePreference: async (preference, value) => {
            const { sourceId } = get().browse;
            if (sourceId === null) {
                return;
            }
            set((state) => {
                return { sourceSettings: { ...state.sourceSettings, saving: true, error: null } };
            });
            const result = await window.api.manga.setSourcePreference({ sourceId, position: preference.position, type: preference.type, value });
            if (get().browse.sourceId !== sourceId) {
                return;
            }
            if (!result.ok) {
                set((state) => {
                    return { sourceSettings: { ...state.sourceSettings, saving: false, error: result.error } };
                });
                return;
            }
            set((state) => {
                return { sourceSettings: { ...state.sourceSettings, saving: false, status: 'ready', preferences: result.value } };
            });
            patchBrowse({ status: 'idle', items: [], page: 1, hasNextPage: false, error: null });
        },

        setMode: (mode) => {
            patchBrowse({ mode, status: 'idle', items: [], page: 1, hasNextPage: false, error: null });
        },

        setQuery: (query) => {
            if (query.trim().length === 0 && get().browse.mode === 'search') {
                patchBrowse({ query, status: 'idle', items: [], page: 1, hasNextPage: false, loadingMore: false, error: null });
                return;
            }
            patchBrowse({ query });
        },

        loadFilters: async () => {
            const { sourceId, filtersStatus } = get().browse;
            if (sourceId === null || filtersStatus === 'ready') {
                return;
            }
            if (filtersLoad !== null && filtersLoad.sourceId === sourceId) {
                await filtersLoad.promise;
                return;
            }
            patchBrowse({ filtersStatus: 'loading' });
            const promise = (async (): Promise<void> => {
                const result = await window.api.manga.sourceFilters(sourceId);
                if (get().browse.sourceId !== sourceId) {
                    return;
                }
                patchBrowse(result.ok ? { filtersStatus: 'ready', filters: result.value, initialFilters: result.value } : { filtersStatus: 'error' });
            })();
            filtersLoad = { sourceId, promise };
            try {
                await promise;
            } finally {
                if (filtersLoad?.promise === promise) {
                    filtersLoad = null;
                }
            }
        },

        loadTermFilters: async (sourceId) => {
            const current = get().termFilters;
            if (current.sourceId === sourceId && (current.status === 'loading' || current.status === 'ready')) {
                return;
            }
            set({ termFilters: { sourceId, status: 'loading', filters: [] } });
            const result = await window.api.manga.sourceFilters(sourceId);
            if (get().termFilters.sourceId !== sourceId) {
                return;
            }
            set({ termFilters: result.ok ? { sourceId, status: 'ready', filters: result.value } : { sourceId, status: 'error', filters: [] } });
        },

        setFilters: (filters) => {
            patchBrowse({ filters });
        },

        resetFilters: () => {
            patchBrowse({ filters: get().browse.initialFilters });
        },

        toggleFilters: () => {
            patchBrowse({ filtersOpen: !get().browse.filtersOpen });
        },

        runList: async () => {
            const { sourceId, mode, query, filters } = get().browse;
            if (sourceId === null || (mode === 'search' && query.trim().length === 0 && filters.length === 0)) {
                return;
            }
            patchBrowse({ status: 'loading', error: null, items: [], page: 1, hasNextPage: false });
            const result = await window.api.manga.list({ sourceId, kind: mode, page: 1, query: query.trim(), ...(mode === 'search' ? { filters } : {}) });
            const now = get().browse;
            if (now.sourceId !== sourceId || now.mode !== mode || now.query !== query) {
                return;
            }
            if (!result.ok) {
                patchBrowse({ status: 'error', error: result.error });
                return;
            }
            patchBrowse({ status: 'done', items: result.value.items, hasNextPage: result.value.hasNextPage, page: 1 });
        },

        loadMore: async () => {
            const { sourceId, mode, query, filters, page, hasNextPage, loadingMore } = get().browse;
            if (sourceId === null || !hasNextPage || loadingMore) {
                return;
            }
            patchBrowse({ loadingMore: true });
            const result = await window.api.manga.list({ sourceId, kind: mode, page: page + 1, query: query.trim(), ...(mode === 'search' ? { filters } : {}) });
            const now = get().browse;
            if (now.sourceId !== sourceId || now.mode !== mode || now.query !== query) {
                patchBrowse({ loadingMore: false });
                return;
            }
            if (!result.ok) {
                patchBrowse({ loadingMore: false, error: result.error });
                return;
            }
            const known = new Set(
                now.items.map((item) => {
                    return item.remoteId;
                })
            );
            patchBrowse({
                loadingMore: false,
                page: page + 1,
                hasNextPage: result.value.hasNextPage,
                items: [
                    ...now.items,
                    ...result.value.items.filter((item) => {
                        return !known.has(item.remoteId);
                    })
                ]
            });
        },

        openManga: async (manga) => {
            const fromLibrary = get().view === 'library';
            const saved = fromLibrary ? libraryEntry(get().library, manga.sourceId, manga.remoteId) : null;
            const local = saved === null ? null : localDetails(saved);
            const isLocalOnly = manga.sourceId === LOCAL_MANGA_SOURCE_ID && local !== null;
            set({
                selection: local === null ? { manga, status: 'loading', details: null, chapters: [], selected: [], error: null } : { manga, status: 'ready', details: local.details, chapters: local.chapters, selected: [], error: null },
                selectionRefresh: { loading: local !== null && !isLocalOnly, error: null },
                selectionFrom: fromLibrary ? 'library' : get().view === 'search' ? 'search' : 'browse'
            });
            if (isLocalOnly) {
                return;
            }
            const result = await window.api.manga.details(manga.remoteId);
            const current = get().selection;
            if (current === null || current.manga.remoteId !== manga.remoteId) {
                return;
            }
            if (!result.ok) {
                set(
                    local === null
                        ? { selection: { ...current, status: 'error', error: result.error } }
                        : { selectionRefresh: { loading: false, error: result.error } }
                );
                return;
            }
            set({ selection: { ...current, status: 'ready', details: result.value.details, chapters: result.value.chapters }, selectionRefresh: { loading: false, error: null } });
            await repairReading(manga, result.value);
        },

        openReader: async (mangaTitle, chapters, index, resume = false, entry, readManga) => {
            const chapter = chapters[index];
            if (chapter === undefined) {
                return;
            }
            const manga = readManga ?? get().selection?.manga ?? get().reader.manga ?? null;
            set({ reader: { status: 'loading', mangaTitle, chapters, index, pages: [], local: false, missing: [], error: null, manga, resume, ...(entry === undefined ? {} : { entry }) } });
            const result = await window.api.manga.readPages({ chapterRemoteId: chapter.remoteId, libraryChapterId: chapter.libraryChapterId });
            const now = get().reader;
            if (now.status === 'closed' || now.index !== index || now.chapters !== chapters) {
                return;
            }
            set({
                reader: result.ok
                    ? { ...now, status: 'ready', pages: result.value.pages, local: result.value.local, missing: result.value.missing, error: null }
                    : { ...now, status: 'error', pages: [], error: result.error }
            });
        },

        goToChapter: async (step, byScroll = false) => {
            const { reader } = get();
            if (reader.status === 'closed') {
                return false;
            }
            const entry = byScroll ? (step > 0 ? 'start' : 'end') : undefined;
            const target = reader.index + step;
            if (reader.chapters[target] !== undefined) {
                await get().openReader(reader.mangaTitle, reader.chapters, target, false, entry, reader.manga ?? undefined);
                return true;
            }
            const season = adjacentSeason(get().library, reader.manga, step);
            if (season === null) {
                return false;
            }
            const chapters = readerChapters(season);
            await get().openReader(season.title, chapters, step > 0 ? 0 : chapters.length - 1, false, entry, { remoteId: season.remoteId, sourceId: season.sourceId, title: season.title, thumbnailUrl: season.thumbnailUrl });
            return true;
        },

        goToChapterIndex: async (index) => {
            const { reader } = get();
            if (reader.status === 'closed' || reader.chapters[index] === undefined) {
                return false;
            }
            await get().openReader(reader.mangaTitle, reader.chapters, index);
            return true;
        },

        closeReader: () => {
            set({ reader: CLOSED_READER });
        },

        closeManga: () => {
            set({ selection: null, selectionRefresh: { loading: false, error: null } });
        },

        toggleChapter: (remoteId) => {
            set((state) => {
                if (state.selection === null) {
                    return {};
                }
                const selected = state.selection.selected.includes(remoteId)
                    ? state.selection.selected.filter((item) => {
                          return item !== remoteId;
                      })
                    : [...state.selection.selected, remoteId];
                return { selection: { ...state.selection, selected } };
            });
        },

        selectChapters: (kind) => {
            set((state) => {
                const { selection, library } = state;
                if (selection === null) {
                    return {};
                }
                const inLibrary = libraryEntry(library, selection.manga.sourceId, selection.manga.remoteId);
                const ids = selection.chapters
                    .filter((chapter) => {
                        return kind === 'all' || (kind === 'missing' && !hasChapterFile(chapterState(inLibrary, chapter.remoteId)?.status ?? 'idle'));
                    })
                    .map((chapter) => {
                        return chapter.remoteId;
                    });
                return { selection: { ...selection, selected: ids } };
            });
        },

        downloadSelected: async () => {
            const { selection } = get();
            if (selection === null || selection.status !== 'ready') {
                return;
            }
            const chapters = chaptersToSend(selection);
            if (chapters.length === 0) {
                return;
            }
            const library = await window.api.manga.download({ manga: summaryOf(selection, get().library), details: selection.details, chapters });
            if (library !== null) {
                toast('manga.notice.queued', { count: chapters.length });
            }
            await get().refreshLibrary();
            set((state) => {
                return state.selection === null ? {} : { selection: { ...state.selection, selected: [] } };
            });
        },

        downloadChapter: async (remoteId) => {
            const { selection } = get();
            if (selection === null || selection.status !== 'ready') {
                return;
            }
            const entry = libraryEntry(get().library, selection.manga.sourceId, selection.manga.remoteId);
            const chapter = selection.chapters.find((item) => {
                return item.remoteId === remoteId;
            });
            if (chapter === undefined || downloadablePicks(entry, [remoteId]).length === 0) {
                return;
            }
            const library = await window.api.manga.download({ manga: summaryOf(selection, get().library), details: selection.details, chapters: [chapter] });
            if (library !== null) {
                toast('manga.notice.queued', { count: 1 });
            }
            await get().refreshLibrary();
        },

        addToLibrary: async () => {
            const { selection } = get();
            if (selection === null || selection.status !== 'ready' || selection.chapters.length === 0) {
                return false;
            }
            const library = await window.api.manga.addToLibrary({ manga: summaryOf(selection, get().library), details: selection.details, chapters: selection.chapters });
            await get().refreshLibrary();
            if (library !== null) {
                toast('manga.notice.added', { title: library.title });
            }
            return library !== null;
        },

        showInLibrary: async () => {
            const { selection } = get();
            if (selection === null) {
                return;
            }
            const manga = summaryOf(selection, get().library);
            await asOnePage(() => {
                set({ view: 'library', selection: null });
                return get().openManga(manga);
            });
        },

        showInSource: async () => {
            const { selection } = get();
            if (selection === null) {
                return;
            }
            const manga = summaryOf(selection, get().library);
            await asOnePage(() => {
                set({ view: 'browse' });
                get().openSource(manga.sourceId, 'popular');
                return get().openManga(manga);
            });
        },

        searchByTerm: async (term, kind = 'tag') => {
            const { selection } = get();
            const text = term.trim();
            if (selection === null || text.length === 0) {
                return;
            }
            set({ view: 'browse' });
            get().openSource(selection.manga.sourceId, 'search');
            await get().loadFilters();
            const { filters } = get().browse;
            const activated = activateFilter(filters, text, kind);
            if (activated !== null) {
                patchBrowse({ filters: activated });
            }
            await get().runList();
        },

        refreshLibrary: async () => {
            const [library, groups] = await Promise.all([window.api.manga.library(), window.api.manga.groups()]);
            set((state) => {
                const stillThere = state.libraryGroup === null || groups.some((group) => {
                    return group.id === state.libraryGroup;
                });
                if (state.history.length === 0) {
                    return { library, groups, libraryGroup: stillThere ? state.libraryGroup : null };
                }
                const libraryIdByKey = new Map<string, number>();
                library.forEach((manga) => {
                    libraryIdByKey.set(mangaListKey(manga.sourceId, manga.remoteId), manga.id);
                });
                let historyChanged = false;
                const history = state.history.map((entry) => {
                    const nextId = libraryIdByKey.get(mangaListKey(entry.sourceId, entry.mangaRemoteId)) ?? null;
                    if (entry.libraryMangaId === nextId) {
                        return entry;
                    }
                    historyChanged = true;
                    return { ...entry, libraryMangaId: nextId };
                });
                return { library, groups, libraryGroup: stillThere ? state.libraryGroup : null, history: historyChanged ? history : state.history };
            });
        },

        refreshGroups: async () => {
            const groups = await window.api.manga.groups();
            set((state) => {
                const stillThere = state.libraryGroup === null || groups.some((group) => {
                    return group.id === state.libraryGroup;
                });
                return { groups, libraryGroup: stillThere ? state.libraryGroup : null };
            });
        },

        openSeries: (key) => {
            set({ librarySeries: key });
        },

        closeSeries: () => {
            set({ librarySeries: null });
        },

        setLibraryGroup: (groupId) => {
            set({ libraryGroup: groupId, librarySeries: null });
        },

        setSeries: async (request) => {
            const response = await window.api.manga.setSeries(request);
            if (response.ok) {
                await get().refreshLibrary();
            }
            return response;
        },

        renameSeries: async (mangaIds, series) => {
            const response = await window.api.manga.renameSeries(mangaIds, series);
            if (response.ok) {
                await get().refreshLibrary();
            }
            return response;
        },

        createGroup: async (name) => {
            const response = await window.api.manga.createGroup(name);
            if (response.ok) {
                await get().refreshGroups();
            }
            return response;
        },

        renameGroup: async (groupId, name) => {
            const response = await window.api.manga.renameGroup(groupId, name);
            if (response.ok) {
                await get().refreshGroups();
            }
            return response;
        },

        deleteGroup: async (groupId) => {
            await window.api.manga.deleteGroup(groupId);
            useSortPrefsStore.getState().clearMangaGroupSorts(groupId);
            await get().refreshLibrary();
        },

        moveGroup: async (groupId, direction) => {
            await window.api.manga.moveGroup(groupId, direction);
            await get().refreshGroups();
        },

        setGroupMembers: async (groupId, mangaIds, member) => {
            await window.api.manga.setGroupMembers(groupId, mangaIds, member);
            await get().refreshLibrary();
        },

        migrateSource: async (request) => {
            const response = await window.api.manga.migrateSource(request);
            if (response.ok) {
                get().moveReading(response.previousTitle, response.manga.title, response.chapterMoves);
                await get().refreshLibrary();
                const manga = response.manga;
                set({ selection: null });
                await get().openManga({ remoteId: manga.remoteId, sourceId: manga.sourceId, title: manga.title, thumbnailUrl: manga.thumbnailUrl });
                toast('manga.migrateSource.done', { matched: response.matched, added: response.added, dropped: response.dropped });
            }
            return response;
        },

        downloadMissing: async (mangaId) => {
            await window.api.manga.downloadMissing([mangaId]);
            await get().refreshLibrary();
        },

        openFolder: async (mangaId) => {
            await window.api.manga.openFolder(mangaId);
        },

        openSite: async (url) => {
            await window.api.manga.openSite(url);
        },

        migrateFolder: async () => {
            if (get().migration !== null) {
                return { ok: false, reason: 'busy' };
            }
            set({ migration: { done: 0, total: 0 } });
            try {
                const response = await window.api.manga.migrateFolder();
                if (response.ok) {
                    useAppStore.getState().setNotice({ kind: 'info', message: translateNow('manga.migrate.done', { chapters: response.chapters, folder: response.destination }) });
                } else if (response.reason !== 'cancelled') {
                    useAppStore.getState().setNotice({ kind: 'error', message: translateNow(MIGRATION_ERRORS[response.reason]) });
                }
                return response;
            } finally {
                set({ migration: null });
            }
        },

        importLibrary: async () => {
            const response = await window.api.manga.importLibrary();
            if (!response.ok) {
                if (response.reason === 'outside') {
                    useAppStore.getState().setNotice({ kind: 'error', message: translateNow('manga.import.outside', { folder: response.folder }) });
                } else if (response.reason === 'busy') {
                    useAppStore.getState().setNotice({ kind: 'error', message: translateNow('manga.import.busy') });
                }
                return;
            }
            await get().refreshLibrary();
            useAppStore.getState().setNotice({
                kind: 'info',
                message: translateNow('manga.import.done', {
                    added: response.added,
                    relinked: response.relinked,
                    skipped: response.skipped,
                    ignored: response.ignored
                })
            });
        },

        removeManga: async (mangaId) => {
            const removed = get().library.find((candidate) => {
                return candidate.id === mangaId;
            });
            await window.api.manga.removeManga(mangaId);
            if (removed !== undefined) {
                useSortPrefsStore.getState().clearListOrder('chapters', mangaListKey(removed.sourceId, removed.remoteId));
            }
            await get().refreshLibrary();
        },

        removeDownload: async (chapterId) => {
            await window.api.manga.removeDownload(chapterId);
            await get().refreshLibrary();
        },

        cancelJob: async (chapterId) => {
            await window.api.manga.cancel(chapterId);
        },

        retryJob: async (chapterId) => {
            await window.api.manga.retry(chapterId);
        },

        repairChapter: async (chapterId) => {
            const result = await window.api.manga.repairChapter(chapterId, null);
            if (!result.ok) {
                toast('manga.notice.repairFailed', { message: result.error.message });
                return;
            }
            toast(result.value.missing.length === 0 ? 'manga.notice.repairDone' : 'manga.notice.repairPartial', { count: result.value.missing.length });
        },

        repairReaderPage: async (pageIndex) => {
            const { reader } = get();
            const chapterId = reader.chapters[reader.index]?.libraryChapterId ?? null;
            if (chapterId === null) {
                return { code: 'INVALID_REQUEST', message: 'The chapter is not in the library.' };
            }
            const result = await window.api.manga.repairChapter(chapterId, pageIndex);
            if (!result.ok) {
                return result.error;
            }
            set((state) => {
                const sameChapter = state.reader.chapters === reader.chapters && state.reader.index === reader.index;
                return sameChapter ? { reader: { ...state.reader, missing: result.value.missing } } : {};
            });
            return null;
        },

        retryFailedJobs: async () => {
            const failed = get().jobs.filter((job) => {
                return job.status === 'error' || job.status === 'cancelled';
            });
            await Promise.all(
                failed.map((job) => {
                    return window.api.manga.retry(job.chapterId);
                })
            );
        },

        pauseJob: async (chapterId) => {
            await window.api.manga.pause(chapterId);
        },

        resumeJob: async (chapterId) => {
            await window.api.manga.resume(chapterId);
        },

        pauseAllJobs: async () => {
            await window.api.manga.pauseAll();
        },

        resumeAllJobs: async () => {
            await window.api.manga.resumeAll();
        },

        pauseMangaJobs: async (mangaIds) => {
            await window.api.manga.pauseMangas(mangaIds);
        },

        resumeMangaJobs: async (mangaIds) => {
            await window.api.manga.resumeMangas(mangaIds);
        },

        cancelMangaJobs: async (mangaIds) => {
            await window.api.manga.cancelMangas(mangaIds);
        },

        clearFinishedJobs: async () => {
            await window.api.manga.clearFinished();
            set((state) => {
                return {
                    jobs: state.jobs.filter((job) => {
                        return job.status === 'queued' || job.status === 'running' || job.status === 'paused';
                    })
                };
            });
        },

        loadExtensions: async (refresh = false) => {
            if (refresh) {
                extensionMutationVersion += 1;
            }
            patchExtensions({ status: 'loading', error: null });
            const stores = await window.api.manga.stores();
            if (!stores.ok) {
                patchExtensions({ status: 'error', error: stores.error });
                return;
            }
            patchExtensions({ stores: stores.value });
            const extensions = await window.api.manga.extensions(refresh);
            if (!extensions.ok) {
                patchExtensions({ status: 'error', error: extensions.error, stores: stores.value });
                return;
            }
            patchExtensions({ status: 'ready', stores: stores.value, extensions: extensions.value });
        },

        addStore: async (indexUrl) => {
            extensionMutationVersion += 1;
            setBusy(indexUrl, true);
            const result = await window.api.manga.addStore(indexUrl);
            setBusy(indexUrl, false);
            if (!result.ok) {
                patchExtensions({ error: result.error });
                return false;
            }
            await get().loadExtensions(true);
            return true;
        },

        removeStore: async (indexUrl) => {
            extensionMutationVersion += 1;
            setBusy(indexUrl, true);
            const result = await window.api.manga.removeStore(indexUrl);
            setBusy(indexUrl, false);
            if (!result.ok) {
                patchExtensions({ error: result.error });
                return;
            }
            await get().loadExtensions(false);
        },

        changeExtension: async (pkgName, action) => {
            extensionMutationVersion += 1;
            setBusy(pkgName, true);
            const result = await window.api.manga.changeExtension(pkgName, action);
            setBusy(pkgName, false);
            if (!result.ok) {
                patchExtensions({ error: result.error });
                return;
            }
            patchExtensions({ error: null });
            await get().loadExtensions(false);
            await get().loadSources();
        },

        updateAllExtensions: async () => {
            extensionMutationVersion += 1;
            setBusy(UPDATE_ALL_KEY, true);
            const result = await window.api.manga.updateAllExtensions();
            setBusy(UPDATE_ALL_KEY, false);
            if (!result.ok) {
                patchExtensions({ error: result.error });
                return;
            }
            patchExtensions({ error: null });
            await get().loadExtensions(false);
            await get().loadSources();
        },

        setExtensionFilter: (filter) => {
            if (filter.onlyInstalled !== undefined) {
                saveMangaUiPrefs({ onlyInstalled: filter.onlyInstalled });
            }
            set((state) => {
                return { extensions: { ...state.extensions, filter: { ...state.extensions.filter, ...filter } } };
            });
        }
    };
});
