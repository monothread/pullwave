import { create } from 'zustand';
import type { ToolState } from '@shared/tools';
import { createTranslator, type MessageKey, type MessageParams } from '@shared/i18n';
import type {
    ExtensionAction,
    LibraryManga,
    MangaChapter,
    MangaCloudflareActivity,
    MangaDetails,
    MangaError,
    MangaFilter,
    MangaExtension,
    MangaGroup,
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
import { resolveAppLanguage } from '../i18n/language';
import { ALL_LANGUAGES, chapterState, downloadablePicks, libraryEntry, localDetails, type ExtensionFilter } from '../components/mangaText';
import { activateFilter, type TermKind } from '../components/mangaFilterSearch';
import { loadMangaUiPrefs, saveMangaUiPrefs } from '../components/mangaUiPrefs';
import { loadReadKeys, saveReadKeys } from '../components/readerPrefs';
import { useAppStore } from './appStore';

export type MangaView = 'browse' | 'updates' | 'library' | 'history' | 'extensions' | 'settings' | 'downloads';
// The views the downloads screen can go back to.
export type MangaBrowseView = Exclude<MangaView, 'downloads'>;

export interface MangaBrowseState {
    sources: MangaSource[];
    sourcesStatus: 'idle' | 'loading' | 'ready' | 'error';
    sourcesError: MangaError | null;
    // The language the list of sources is limited to (all of them by default).
    sourceLanguage: string;
    // The source that is open (its mangas are listed); null while the list of sources is shown.
    sourceId: string | null;
    mode: MangaListKind;
    query: string;
    // The filters of the search of the open source: what it offers (`initialFilters`, to start over from) and what the user has set.
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

// The manga that is open: what the source says about it, its chapters and the ones picked.
export interface MangaSelection {
    manga: MangaSummary;
    status: 'loading' | 'ready' | 'error';
    details: MangaDetails | null;
    chapters: MangaChapter[];
    // The chapters picked, by their number on the server.
    selected: number[];
    error: MangaError | null;
}

export interface MangaExtensionsState {
    stores: MangaExtensionStore[];
    extensions: MangaExtension[];
    status: 'idle' | 'loading' | 'ready' | 'error';
    error: MangaError | null;
    // What is being installed, updated or removed (the package name), or added or removed (the address of the store).
    busy: string[];
    filter: ExtensionFilter;
}

// The settings of the source that is being browsed.
export interface MangaSourceSettingsState {
    open: boolean;
    status: 'idle' | 'loading' | 'ready' | 'error';
    preferences: MangaSourcePreference[];
    error: MangaError | null;
    // A change is being saved.
    saving: boolean;
}

// What `busy` holds while every extension is being updated.
export const UPDATE_ALL_KEY = 'update-all';

export type ChapterSelectionKind = 'all' | 'none' | 'missing';

const EMPTY_STATUS: MangaStatusInfo = { supported: false, tool: null, helper: null, helperProblem: null, helperExternal: false, server: 'stopped', serverError: null };

const EMPTY_BROWSE: MangaBrowseState = {
    sources: [],
    sourcesStatus: 'idle',
    sourcesError: null,
    sourceLanguage: ALL_LANGUAGES,
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
    filter: { query: '', lang: ALL_LANGUAGES, onlyInstalled: true }
};

// A chapter that can be read: its number on the server and, when it is in the library, its number there (its file is read when it was
// downloaded).
export interface ReaderChapter {
    remoteId: number;
    libraryChapterId: number | null;
    name: string;
    number: number | null;
}

// The chapter being read, among the chapters of its manga (in reading order, the oldest first).
export interface MangaReaderState {
    status: 'closed' | 'loading' | 'ready' | 'error';
    mangaTitle: string;
    chapters: ReaderChapter[];
    index: number;
    pages: string[];
    // The pages are read from the downloaded file.
    local: boolean;
    error: MangaError | null;
    // The manga being read, to write where the user is in the history of reading (null when it is not known).
    manga?: MangaSummary | null;
    // The chapter was opened by CONTINUE READING: it starts on the page the manga was last read on (the last page too), not where the chapter was left.
    resume?: boolean;
    // The chapter was reached by scrolling through the zone between chapters: from the one before it opens on its first page, from the one after it
    // on its last (the user goes on in the direction they were scrolling).
    entry?: 'start' | 'end';
}

const CLOSED_READER: MangaReaderState = { status: 'closed', mangaTitle: '', chapters: [], index: 0, pages: [], local: false, error: null };

interface MangaState {
    reader: MangaReaderState;
    // The view the manga that is open was opened from: the browse and the library each show only their own.
    selectionFrom: 'browse' | 'library';
    status: MangaStatusInfo;
    view: MangaBrowseView | 'downloads';
    // Where the downloads screen goes back to.
    previousView: MangaBrowseView;
    library: LibraryManga[];
    // The groups the user made (Mangas, Manhwas...), and the one the library is limited to (null: every manga).
    groups: MangaGroup[];
    libraryGroup: number | null;
    // The groups hidden from the library for now (kept only while the app is open, not saved).
    hiddenGroupIds: number[];
    // The series that is open in the library (its key, see `groupLibrary`), or null for the cards.
    librarySeries: string | null;
    jobs: MangaJob[];
    browse: MangaBrowseState;
    selection: MangaSelection | null;
    // A manga of the library opens with what the library has while the source is asked in the background: whether it is being asked, and
    // why it could not be (the page stays as it is then).
    selectionRefresh: { loading: boolean; error: MangaError | null };
    sourceSettings: MangaSourceSettingsState;
    extensions: MangaExtensionsState;
    // The checks of Cloudflare that are going on (the helper is solving them in a browser, which can take a minute).
    cloudflare: MangaCloudflareActivity[];
    // How far the migration of the folder of the mangas is, or null when none is running.
    migration: MangaMigrationProgress | null;
    // The chapters that were read to the end or marked as read (see `progressKey`).
    readKeys: string[];
    // The latest versions found of the server and of the helper (null until they are looked for), and how the programs are doing.
    toolVersions: MangaToolVersions | null;
    toolsChecking: boolean;
    // The download of a newer server, and what the last update of each program answered.
    serverUpdate: ToolState | null;
    updateResults: { server: MangaToolUpdateResult | null; helper: MangaToolUpdateResult | null };
    updating: { server: boolean; helper: boolean };
    health: MangaHealth | null;
    healthChecking: boolean;
    // The chapters that arrived in the library (the updates screen) and the history of reading, as the main process last gave them.
    updates: MangaUpdateEntry[];
    history: ReadingEntry[];
    // What is being asked for new chapters: one manga of the library (its id), all of them, or nothing.
    checkingNew: number | 'all' | null;

    loadUpdates: () => Promise<void>;
    clearUpdates: () => Promise<void>;
    // Asks the sources for new chapters of one manga of the library, or of all of them (null), and says how it went.
    checkNewChapters: (mangaId: number | null) => Promise<void>;
    loadHistory: () => Promise<void>;
    removeReading: (id: number) => Promise<void>;
    clearReading: () => Promise<void>;
    // Goes to the page of a manga from the history: the one of the library when it is in it, otherwise the one of its source.
    openFromHistory: (entry: ReadingEntry) => Promise<void>;
    openFromUpdate: (entry: MangaUpdateEntry) => Promise<void>;
    recordReading: (record: ReadingRecord) => Promise<void>;
    checkToolUpdates: () => Promise<void>;
    updateServer: () => Promise<void>;
    resetServerVersion: () => Promise<void>;
    updateHelper: () => Promise<void>;
    restartApp: () => Promise<void>;
    // Looks at how the server and the helper are doing; with `start`, a stopped one is started.
    checkHealth: (start: boolean) => Promise<void>;
    // Marks chapters as read, or as not read.
    markRead: (keys: readonly string[], read: boolean) => void;
    init: () => Promise<() => void>;
    refreshStatus: () => Promise<void>;
    retryInstall: () => Promise<void>;
    // Installs, or removes, the helper for the sites protected by Cloudflare (it needs Docker).
    installHelper: () => Promise<void>;
    removeHelper: () => Promise<void>;
    setView: (view: MangaBrowseView) => void;
    openDownloads: () => void;
    closeDownloads: () => void;

    loadSources: () => Promise<void>;
    setSourceLanguage: (language: string) => void;
    // Opens a source, listing its popular (or latest) mangas, and goes back to the list of sources.
    openSource: (sourceId: string, mode?: MangaListKind) => void;
    closeSource: () => void;
    // Shows the settings of the source being browsed (reading them), or hides them.
    openSourceSettings: () => Promise<void>;
    closeSourceSettings: () => void;
    // Changes one setting of the source; the list is asked for again after, since what a source gives can depend on it.
    changePreference: (preference: MangaSourcePreference, value: MangaSourcePreference['value']) => Promise<void>;
    setMode: (mode: MangaListKind) => void;
    setQuery: (query: string) => void;
    // Lists the mangas of the source, from the first page.
    // Opens the reader on a chapter of the list (in reading order).
    openReader: (mangaTitle: string, chapters: ReaderChapter[], index: number, resume?: boolean, entry?: 'start' | 'end') => Promise<void>;
    // Goes to the next chapter (1) or the previous one (-1); false when there is none.
    // `byScroll`: the chapter is reached by scrolling through the zone between chapters (see MangaReaderState.entry).
    goToChapter: (step: 1 | -1, byScroll?: boolean) => Promise<boolean>;
    // Goes to the chapter at this place of the list; false when there is none.
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
    // Downloads one chapter of the open manga (when a download does something for it).
    downloadChapter: (remoteId: number) => Promise<void>;
    addToLibrary: () => Promise<boolean>;
    // Goes to the library, on the page of the manga that is open.
    showInLibrary: () => Promise<void>;
    // Goes to the source of the manga that is open (from the library), on the page of the manga there.
    showInSource: () => Promise<void>;
    // Opens the search of the source of the manga that is open with a genre, a tag, an author or an artist: as a filter when the source
    // has one by that name, else as the text of the search.
    // Opens the search of the source of the manga that is open with the filter that stands for the term turned on (never as the text of the
    // search: a term that is not one of the filters of the source is not searched).
    searchByTerm: (term: string, kind?: TermKind) => Promise<void>;
    // The filters of the source of the manga that is open, to tell which of its genres, author and artist can be searched.
    termFilters: { sourceId: string | null; status: 'idle' | 'loading' | 'ready' | 'error'; filters: MangaFilter[] };
    loadTermFilters: (sourceId: string) => Promise<void>;

    refreshLibrary: () => Promise<void>;
    refreshGroups: () => Promise<void>;
    openSeries: (key: string) => void;
    closeSeries: () => void;
    setLibraryGroup: (groupId: number | null) => void;
    // Hides a group (its tab, and so the mangas that are only in it) from the library, or shows it again.
    hideGroup: (groupId: number) => void;
    showGroup: (groupId: number) => void;
    // Joins a manga to a series with its place in it, or takes it out of one.
    setSeries: (request: MangaSeriesRequest) => Promise<MangaSeriesResponse>;
    renameSeries: (mangaIds: number[], series: string) => Promise<MangaRenameSeriesResponse>;
    createGroup: (name: string) => Promise<MangaGroupResponse>;
    renameGroup: (groupId: number, name: string) => Promise<MangaGroupResponse>;
    deleteGroup: (groupId: number) => Promise<void>;
    setGroupMembers: (groupId: number, mangaIds: number[], member: boolean) => Promise<void>;
    // Moves a manga of the library to the same manga in another source; on success the manga that is open is the one of the new source.
    migrateSource: (request: MangaSourceMigrationRequest) => Promise<MangaSourceMigrationResponse>;
    downloadMissing: (mangaId: number) => Promise<void>;
    openFolder: (mangaId: number) => Promise<void>;
    // Opens the page of the manga on the site of its source.
    openSite: (url: string) => Promise<void>;
    // Moves the downloaded chapters to a folder the user chooses, then says how it went. Returns what the migration answered.
    migrateFolder: () => Promise<MangaMigrationResponse>;
    removeManga: (mangaId: number) => Promise<void>;
    removeDownload: (chapterId: number) => Promise<void>;

    cancelJob: (chapterId: number) => Promise<void>;
    retryJob: (chapterId: number) => Promise<void>;
    // Tries again every download that failed or was cancelled.
    retryFailedJobs: () => Promise<void>;
    pauseJob: (chapterId: number) => Promise<void>;
    resumeJob: (chapterId: number) => Promise<void>;
    clearFinishedJobs: () => Promise<void>;

    loadExtensions: (refresh?: boolean) => Promise<void>;
    addStore: (indexUrl: string) => Promise<boolean>;
    removeStore: (indexUrl: string) => Promise<void>;
    // Updates every installed extension that has an update.
    updateAllExtensions: () => Promise<void>;
    changeExtension: (pkgName: string, action: ExtensionAction) => Promise<void>;
    setExtensionFilter: (filter: Partial<ExtensionFilter>) => void;
}

function translateNow(key: MessageKey, params?: MessageParams): string {
    return createTranslator(resolveAppLanguage(useAppStore.getState().settings.language))(key, params);
}

// The filters of a source that are being read, to wait for them when they are asked for again meanwhile.
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

// A job in the list replaced by its newer state (or added).
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

// The manga as the source describes it, kept as the summary the library knows it by.
function summaryOf(selection: MangaSelection): MangaSummary {
    return selection.details === null
        ? selection.manga
        : { remoteId: selection.details.remoteId, sourceId: selection.details.sourceId, title: selection.details.title, thumbnailUrl: selection.details.thumbnailUrl };
}

export const useMangaStore = create<MangaState>((set, get) => {
    function patchBrowse(patch: Partial<MangaBrowseState>): void {
        set((state) => {
            return { browse: { ...state.browse, ...patch } };
        });
    }

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

    // The chapters picked that a download does something for (not the ones downloaded already, or waiting or going on).
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
        hiddenGroupIds: [],
        librarySeries: null,
        jobs: [],
        browse: { ...EMPTY_BROWSE, sourceLanguage: initialPrefs.sourceLanguage },
        selection: null,
        selectionRefresh: { loading: false, error: null },
        sourceSettings: EMPTY_SOURCE_SETTINGS,
        reader: CLOSED_READER,
        selectionFrom: 'browse',
        migration: null,
        readKeys: loadReadKeys(),
        toolVersions: null,
        toolsChecking: false,
        serverUpdate: null,
        updateResults: { server: null, helper: null },
        updating: { server: false, helper: false },
        health: null,
        healthChecking: false,
        termFilters: { sourceId: null, status: 'idle', filters: [] },
        updates: [],
        history: [],
        checkingNew: null,
        extensions: { ...EMPTY_EXTENSIONS, filter: { ...EMPTY_EXTENSIONS.filter, lang: initialPrefs.extensionLanguage, onlyInstalled: initialPrefs.onlyInstalled } },
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
            const [library, jobs, groups] = await Promise.all([api.library(), api.jobs(), api.groups()]);
            set({ library, jobs, groups });
            const unsubscribers = [
                api.onToolState((tool) => {
                    // Two programs are downloaded: the one that runs the extensions, and the one that gets past Cloudflare.
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
                    // The covers of the library need the server: they are asked for again once it is up.
                    if (server === 'running') {
                        void get().refreshLibrary();
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
                        // A chapter that is complete says so and leaves the screen of the downloads: it is in the library.
                        set((state) => {
                            return {
                                jobs: state.jobs.filter((candidate) => {
                                    return candidate.chapterId !== job.chapterId;
                                })
                            };
                        });
                        toast('notice.downloadDone', { title: `${job.mangaTitle} · ${job.chapterName}` });
                        return;
                    }
                    set((state) => {
                        return { jobs: upsertMangaJob(state.jobs, job) };
                    });
                }),
                api.onLibraryChanged(() => {
                    void get().refreshLibrary();
                    if (get().view === 'updates') {
                        void get().loadUpdates();
                    }
                }),
                api.onServerUpdate((serverUpdate) => {
                    set({ serverUpdate });
                }),
                api.onMigrationProgress((migration) => {
                    set({ migration });
                }),
                api.onNewChapters((news) => {
                    toast('manga.notice.newChapters', { count: news.count, titles: news.titles.join(', ') });
                })
            ];
            return (): void => {
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
            set({ checkingNew: mangaId ?? 'all' });
            try {
                const response = await window.api.manga.checkNewChapters(mangaId);
                if (!response.ok) {
                    toast('manga.notice.checkFailed', { message: response.error.message });
                } else if (response.count === 0) {
                    toast(response.failed > 0 ? 'manga.notice.checkUnreached' : 'manga.notice.checkNone', { failed: response.failed });
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
            set({ view: saved === null ? 'browse' : 'library', librarySeries: null, selection: null });
            await get().openManga(summary);
        },

        openFromUpdate: async (entry) => {
            const saved = get().library.find((manga) => {
                return manga.id === entry.mangaId;
            });
            if (saved === undefined) {
                return;
            }
            set({ view: 'library', librarySeries: null, selection: null });
            await get().openManga({ remoteId: saved.remoteId, sourceId: saved.sourceId, title: saved.title, thumbnailUrl: saved.thumbnailUrl });
        },

        recordReading: async (record) => {
            await window.api.manga.recordReading(record);
        },

        checkToolUpdates: async () => {
            set({ toolsChecking: true });
            try {
                set({ toolVersions: await window.api.manga.checkToolUpdates() });
            } finally {
                set({ toolsChecking: false });
            }
        },

        updateServer: async () => {
            set((state) => {
                return { updating: { ...state.updating, server: true }, updateResults: { ...state.updateResults, server: null }, serverUpdate: null };
            });
            const result = await window.api.manga.updateServer();
            set((state) => {
                return { updating: { ...state.updating, server: false }, updateResults: { ...state.updateResults, server: result } };
            });
            await get().checkToolUpdates();
        },

        resetServerVersion: async () => {
            await window.api.manga.resetServerVersion();
            set((state) => {
                return { updateResults: { ...state.updateResults, server: null } };
            });
            await get().checkToolUpdates();
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

        restartApp: async () => {
            await window.api.manga.restartApp();
        },

        checkHealth: async (start) => {
            set({ healthChecking: true });
            try {
                set({ health: await window.api.manga.health(start) });
            } finally {
                set({ healthChecking: false });
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
            // The name of the store each source comes from is shown beside it; the list is shown even when the stores cannot be read.
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
            // A source that is not there any more (its extension was removed) is no longer open.
            patchBrowse({ sources, sourcesStatus: 'ready', ...(stillThere ? {} : { sourceId: null, status: 'idle', items: [], page: 1, hasNextPage: false, error: null }) });
            if (!stillThere) {
                set({ sourceSettings: EMPTY_SOURCE_SETTINGS });
            }
        },

        setSourceLanguage: (language) => {
            saveMangaUiPrefs({ sourceLanguage: language });
            patchBrowse({ sourceLanguage: language });
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
            // The source may have changed, or the settings been closed, meanwhile.
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
            // What the source gives can depend on its settings: the list is asked for again.
            patchBrowse({ status: 'idle', items: [], page: 1, hasNextPage: false, error: null });
        },

        setMode: (mode) => {
            patchBrowse({ mode, status: 'idle', items: [], page: 1, hasNextPage: false, error: null });
        },

        setQuery: (query) => {
            patchBrowse({ query });
        },

        loadFilters: async () => {
            const { sourceId, filtersStatus } = get().browse;
            if (sourceId === null || filtersStatus === 'ready') {
                return;
            }
            // Asked for while it is already being read (the screen of the filters asks too): wait for that one instead of going on without.
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
            // The answer of a list that was asked for before another one is not shown.
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
            // The library does not wait for the source: its page opens with what is saved, and the source is looked at in the background.
            const local = saved === null ? null : localDetails(saved);
            set({
                selection: local === null ? { manga, status: 'loading', details: null, chapters: [], selected: [], error: null } : { manga, status: 'ready', details: local.details, chapters: local.chapters, selected: [], error: null },
                selectionRefresh: { loading: local !== null, error: null },
                selectionFrom: fromLibrary ? 'library' : 'browse'
            });
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
        },

        openReader: async (mangaTitle, chapters, index, resume = false, entry) => {
            const chapter = chapters[index];
            if (chapter === undefined) {
                return;
            }
            const manga = get().selection?.manga ?? get().reader.manga ?? null;
            set({ reader: { status: 'loading', mangaTitle, chapters, index, pages: [], local: false, error: null, manga, resume, ...(entry === undefined ? {} : { entry }) } });
            const result = await window.api.manga.readPages({ chapterRemoteId: chapter.remoteId, libraryChapterId: chapter.libraryChapterId });
            // The answer for a chapter that is no longer the one on the screen is dropped.
            const now = get().reader;
            if (now.status === 'closed' || now.index !== index || now.chapters !== chapters) {
                return;
            }
            set({
                reader: result.ok
                    ? { ...now, status: 'ready', pages: result.value.pages, local: result.value.local, error: null }
                    : { ...now, status: 'error', pages: [], error: result.error }
            });
        },

        goToChapter: async (step, byScroll = false) => {
            const { reader } = get();
            const target = reader.index + step;
            if (reader.status === 'closed' || reader.chapters[target] === undefined) {
                return false;
            }
            await get().openReader(reader.mangaTitle, reader.chapters, target, false, byScroll ? (step > 0 ? 'start' : 'end') : undefined);
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
                        return kind === 'all' || (kind === 'missing' && chapterState(inLibrary, chapter.remoteId)?.status !== 'done');
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
            const library = await window.api.manga.download({ manga: summaryOf(selection), details: selection.details, chapters });
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
            const library = await window.api.manga.download({ manga: summaryOf(selection), details: selection.details, chapters: [chapter] });
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
            const library = await window.api.manga.addToLibrary({ manga: summaryOf(selection), details: selection.details, chapters: selection.chapters });
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
            const manga = summaryOf(selection);
            set({ view: 'library', selection: null });
            await get().openManga(manga);
        },

        showInSource: async () => {
            const { selection } = get();
            if (selection === null) {
                return;
            }
            const manga = summaryOf(selection);
            set({ view: 'browse' });
            get().openSource(manga.sourceId, 'popular');
            await get().openManga(manga);
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
                patchBrowse({ filters: activated, filtersOpen: true });
            }
            await get().runList();
        },

        refreshLibrary: async () => {
            const [library, groups] = await Promise.all([window.api.manga.library(), window.api.manga.groups()]);
            set((state) => {
                // A group that is gone is no longer the one the library is limited to.
                const stillThere = state.libraryGroup === null || groups.some((group) => {
                    return group.id === state.libraryGroup;
                });
                return { library, groups, libraryGroup: stillThere ? state.libraryGroup : null };
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

        hideGroup: (groupId) => {
            set((state) => {
                return {
                    hiddenGroupIds: state.hiddenGroupIds.includes(groupId) ? state.hiddenGroupIds : [...state.hiddenGroupIds, groupId],
                    libraryGroup: state.libraryGroup === groupId ? null : state.libraryGroup
                };
            });
        },

        showGroup: (groupId) => {
            set((state) => {
                return {
                    hiddenGroupIds: state.hiddenGroupIds.filter((id) => {
                        return id !== groupId;
                    })
                };
            });
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
            await get().refreshLibrary();
        },

        setGroupMembers: async (groupId, mangaIds, member) => {
            await window.api.manga.setGroupMembers(groupId, mangaIds, member);
            await get().refreshLibrary();
        },

        migrateSource: async (request) => {
            const response = await window.api.manga.migrateSource(request);
            if (response.ok) {
                await get().refreshLibrary();
                // The manga that is open is the one of the new source now.
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

        removeManga: async (mangaId) => {
            await window.api.manga.removeManga(mangaId);
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
            patchExtensions({ status: 'loading', error: null });
            const stores = await window.api.manga.stores();
            if (!stores.ok) {
                patchExtensions({ status: 'error', error: stores.error });
                return;
            }
            // The stores are shown while the extensions are still coming.
            patchExtensions({ stores: stores.value });
            const extensions = await window.api.manga.extensions(refresh);
            if (!extensions.ok) {
                patchExtensions({ status: 'error', error: extensions.error, stores: stores.value });
                return;
            }
            patchExtensions({ status: 'ready', stores: stores.value, extensions: extensions.value });
        },

        addStore: async (indexUrl) => {
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
            setBusy(pkgName, true);
            const result = await window.api.manga.changeExtension(pkgName, action);
            setBusy(pkgName, false);
            if (!result.ok) {
                patchExtensions({ error: result.error });
                return;
            }
            patchExtensions({ error: null });
            await get().loadExtensions(false);
            // What the sources are changes with the extensions.
            await get().loadSources();
        },

        updateAllExtensions: async () => {
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
            if (filter.lang !== undefined) {
                saveMangaUiPrefs({ extensionLanguage: filter.lang });
            }
            if (filter.onlyInstalled !== undefined) {
                saveMangaUiPrefs({ onlyInstalled: filter.onlyInstalled });
            }
            set((state) => {
                return { extensions: { ...state.extensions, filter: { ...state.extensions.filter, ...filter } } };
            });
        }
    };
});
