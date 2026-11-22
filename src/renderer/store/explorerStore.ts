import { create } from 'zustand';
import type {
    ExplorerBreadcrumb,
    ExplorerCreateFolderResponse,
    ExplorerEntry,
    ExplorerListFailure,
    ExplorerPreviewFailure,
    ExplorerRenameResponse,
    ExplorerRoot,
    ExplorerTrashResponse
} from '@shared/explorer';
import type { MessageKey } from '@shared/i18n/core';
import {
    filterAndSortEntries,
    type ExplorerFilter,
    type ExplorerSortBy,
    type ExplorerSortDirection,
    type ExplorerViewMode
} from '../components/explorerHelpers';
import { createTranslator } from '../i18n/catalogs';
import { resolveAppLanguage } from '../i18n/language';
import { onDownloadFinished, useAppStore } from './appStore';

export const EXPLORER_PREFS_STORAGE_KEY = 'pullwave.explorer.prefs';

const SORT_BY_OPTIONS: readonly ExplorerSortBy[] = ['name', 'modified', 'size', 'kind'];
const SORT_DIRECTIONS: readonly ExplorerSortDirection[] = ['asc', 'desc'];
const VIEW_MODES: readonly ExplorerViewMode[] = ['grid', 'list'];

export interface ExplorerPrefs {
    sortBy: ExplorerSortBy;
    sortDirection: ExplorerSortDirection;
    viewMode: ExplorerViewMode;
}

export const DEFAULT_EXPLORER_PREFS: ExplorerPrefs = {
    sortBy: 'name',
    sortDirection: 'asc',
    viewMode: 'grid'
};

function pickOption<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
    return (
        options.find((option) => {
            return option === value;
        }) ?? fallback
    );
}

export function readExplorerPrefs(): ExplorerPrefs {
    try {
        const raw = window.localStorage.getItem(EXPLORER_PREFS_STORAGE_KEY);
        if (raw === null) {
            return DEFAULT_EXPLORER_PREFS;
        }
        const parsed: unknown = JSON.parse(raw);
        const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
        return {
            sortBy: pickOption(record['sortBy'], SORT_BY_OPTIONS, DEFAULT_EXPLORER_PREFS.sortBy),
            sortDirection: pickOption(record['sortDirection'], SORT_DIRECTIONS, DEFAULT_EXPLORER_PREFS.sortDirection),
            viewMode: pickOption(record['viewMode'], VIEW_MODES, DEFAULT_EXPLORER_PREFS.viewMode)
        };
    } catch {
        return DEFAULT_EXPLORER_PREFS;
    }
}

function writeExplorerPrefs(prefs: ExplorerPrefs): void {
    try {
        window.localStorage.setItem(EXPLORER_PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        return undefined;
    }
}

function parentDirectoryOf(filePath: string): string | null {
    const trimmed = filePath.trim();
    if (trimmed.length === 0) {
        return null;
    }
    const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    if (slash < 0) {
        return null;
    }
    if (slash === 0) {
        return '/';
    }
    if (slash === 2 && /^[a-zA-Z]:/.test(trimmed)) {
        return trimmed.slice(0, 3);
    }
    return trimmed.slice(0, slash);
}

function fileBaseNameOf(filePath: string): string {
    const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return slash >= 0 ? filePath.slice(slash + 1) : filePath;
}

function notifyRevealFailure(key: MessageKey): void {
    const appState = useAppStore.getState();
    const message = createTranslator(resolveAppLanguage(appState.settings.language))(key);
    appState.setNotice({ kind: 'error', message });
}

export interface ExplorerPlayerState {
    entry: ExplorerEntry;
    status: 'ready' | 'converting' | 'failed';
    url: string | null;
    converted: boolean;
    error: ExplorerPreviewFailure | null;
}

export interface ExplorerState {
    directory: string;
    parent: string | null;
    breadcrumbs: ExplorerBreadcrumb[];
    roots: ExplorerRoot[];
    entries: ExplorerEntry[];
    loaded: boolean;
    loading: boolean;
    error: ExplorerListFailure | null;
    history: string[];
    historyIndex: number;
    filter: ExplorerFilter;
    query: string;
    sortBy: ExplorerSortBy;
    sortDirection: ExplorerSortDirection;
    viewMode: ExplorerViewMode;
    highlightedPath: string | null;
    playing: ExplorerPlayerState | null;
    open: (directory?: string) => Promise<void>;
    refresh: () => Promise<void>;
    refreshIfLoaded: () => Promise<void>;
    goBack: () => Promise<void>;
    goForward: () => Promise<void>;
    goUp: () => Promise<void>;
    revealFile: (filePath: string) => Promise<void>;
    clearHighlight: () => void;
    setFilter: (filter: ExplorerFilter) => void;
    setQuery: (query: string) => void;
    setSortBy: (sortBy: ExplorerSortBy) => void;
    toggleSortDirection: () => void;
    setViewMode: (viewMode: ExplorerViewMode) => void;
    createFolder: (name: string) => Promise<ExplorerCreateFolderResponse>;
    renameEntry: (entry: ExplorerEntry, newName: string) => Promise<ExplorerRenameResponse>;
    trashEntry: (entry: ExplorerEntry) => Promise<ExplorerTrashResponse>;
    playEntry: (entry: ExplorerEntry) => void;
    playStep: (delta: -1 | 1) => void;
    convertPlayback: () => Promise<void>;
    closePlayer: () => void;
}

export const useExplorerStore = create<ExplorerState>((set, get) => {
    let requestSeq = 0;
    let playbackSeq = 0;
    let inFlight = false;
    let pendingRefresh = false;

    async function loadDirectory(
        target: string | undefined,
        historyUpdate: 'push' | 'none' | { index: number },
        keepHighlight = false,
        silent = false
    ): Promise<void> {
        requestSeq += 1;
        const seq = requestSeq;
        inFlight = true;
        if (!silent) {
            if (typeof historyUpdate === 'object') {
                set({ loading: true, error: null, historyIndex: historyUpdate.index });
            } else {
                set({ loading: true, error: null });
            }
        }
        try {
            let response = await window.api.explorer.list(target);
            if (!response.ok && response.reason === 'denied' && target !== undefined) {
                response = await window.api.explorer.list(undefined);
            }
            if (seq !== requestSeq) {
                return;
            }
            if (!response.ok) {
                if (!silent) {
                    set({ loading: false, loaded: true, error: response.reason });
                }
                return;
            }
            const { listing } = response;
            const state = get();
            let nextHistory = state.history;
            let nextIndex = state.historyIndex;
            if (historyUpdate === 'push') {
                if (state.history[state.historyIndex] !== listing.directory) {
                    nextHistory = [...state.history.slice(0, state.historyIndex + 1), listing.directory];
                    nextIndex = nextHistory.length - 1;
                }
            } else if (typeof historyUpdate === 'object') {
                nextIndex = historyUpdate.index;
            }
            set({
                directory: listing.directory,
                parent: listing.parent,
                breadcrumbs: listing.breadcrumbs,
                roots: listing.roots,
                entries: listing.entries,
                loaded: true,
                loading: false,
                error: null,
                history: nextHistory,
                historyIndex: nextIndex,
                highlightedPath: keepHighlight ? state.highlightedPath : null
            });
        } catch {
            if (seq === requestSeq && !silent) {
                set({ loading: false, loaded: true, error: 'failed' });
            }
        } finally {
            if (seq === requestSeq) {
                inFlight = false;
                if (pendingRefresh) {
                    pendingRefresh = false;
                    const current = get();
                    const mode = current.history.length === 0 ? 'push' : 'none';
                    void loadDirectory(current.directory.length > 0 ? current.directory : undefined, mode, true, true);
                }
            }
        }
    }

    return {
        directory: '',
        parent: null,
        breadcrumbs: [],
        roots: [],
        entries: [],
        loaded: false,
        loading: false,
        error: null,
        history: [],
        historyIndex: -1,
        filter: 'all',
        query: '',
        ...readExplorerPrefs(),
        highlightedPath: null,
        playing: null,

        open: async (directory) => {
            await loadDirectory(directory, 'push');
        },

        refresh: async () => {
            const current = get().directory;
            await loadDirectory(current.length > 0 ? current : undefined, 'none', true);
        },

        refreshIfLoaded: async () => {
            const { loaded, directory, history } = get();
            if (inFlight) {
                pendingRefresh = true;
                return;
            }
            if (!loaded) {
                return;
            }
            const historyMode = history.length === 0 ? 'push' : 'none';
            await loadDirectory(directory.length > 0 ? directory : undefined, historyMode, true, true);
        },

        goBack: async () => {
            const { history, historyIndex } = get();
            if (historyIndex <= 0) {
                return;
            }
            const nextIndex = historyIndex - 1;
            await loadDirectory(history[nextIndex], { index: nextIndex });
        },

        goForward: async () => {
            const { history, historyIndex } = get();
            if (historyIndex < 0 || historyIndex >= history.length - 1) {
                return;
            }
            const nextIndex = historyIndex + 1;
            await loadDirectory(history[nextIndex], { index: nextIndex });
        },

        goUp: async () => {
            const parent = get().parent;
            if (parent !== null) {
                await loadDirectory(parent, 'push');
            }
        },

        revealFile: async (filePath) => {
            const trimmed = filePath.trim();
            if (trimmed.length === 0) {
                return;
            }
            const parentDir = parentDirectoryOf(trimmed);
            if (parentDir === null) {
                notifyRevealFailure('explorer.reveal.not-found');
                return;
            }
            requestSeq += 1;
            const seq = requestSeq;
            try {
                const response = await window.api.explorer.list(parentDir);
                if (seq !== requestSeq) {
                    return;
                }
                if (!response.ok) {
                    notifyRevealFailure(response.reason === 'denied' ? 'explorer.reveal.outside-downloads' : 'explorer.reveal.not-found');
                    return;
                }
                const { listing } = response;
                const targetName = fileBaseNameOf(trimmed).toLowerCase();
                const matched = listing.entries.find((entry) => {
                    return entry.kind !== 'directory' && (entry.path === trimmed || entry.name.toLowerCase() === targetName);
                });
                if (matched === undefined) {
                    notifyRevealFailure('explorer.reveal.not-found');
                    return;
                }
                const state = get();
                let nextHistory = state.history;
                let nextIndex = state.historyIndex;
                if (state.history[state.historyIndex] !== listing.directory) {
                    nextHistory = [...state.history.slice(0, state.historyIndex + 1), listing.directory];
                    nextIndex = nextHistory.length - 1;
                }
                set({
                    directory: listing.directory,
                    parent: listing.parent,
                    breadcrumbs: listing.breadcrumbs,
                    roots: listing.roots,
                    entries: listing.entries,
                    loaded: true,
                    loading: false,
                    error: null,
                    history: nextHistory,
                    historyIndex: nextIndex,
                    filter: 'all',
                    query: '',
                    highlightedPath: matched.path
                });
                useAppStore.getState().setDownloadsView('explorer');
            } catch {
                if (seq === requestSeq) {
                    notifyRevealFailure('explorer.reveal.not-found');
                }
            }
        },

        clearHighlight: () => {
            if (get().highlightedPath !== null) {
                set({ highlightedPath: null });
            }
        },

        setFilter: (filter) => {
            set({ filter });
        },

        setQuery: (query) => {
            set({ query });
        },

        setSortBy: (sortBy) => {
            const { sortDirection, viewMode } = get();
            writeExplorerPrefs({ sortBy, sortDirection, viewMode });
            set({ sortBy });
        },

        toggleSortDirection: () => {
            const { sortBy, sortDirection, viewMode } = get();
            const nextDirection: ExplorerSortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            writeExplorerPrefs({ sortBy, sortDirection: nextDirection, viewMode });
            set({ sortDirection: nextDirection });
        },

        setViewMode: (viewMode) => {
            const { sortBy, sortDirection } = get();
            writeExplorerPrefs({ sortBy, sortDirection, viewMode });
            set({ viewMode });
        },

        createFolder: async (name) => {
            try {
                const response = await window.api.explorer.createFolder(get().directory, name);
                if (response.ok) {
                    await get().refresh();
                }
                return response;
            } catch {
                return { ok: false, reason: 'failed' };
            }
        },

        renameEntry: async (entry, newName) => {
            try {
                const response = await window.api.explorer.rename(entry.path, newName);
                if (response.ok) {
                    await get().refresh();
                    const activePlaying = get().playing;
                    if (activePlaying !== null && activePlaying.entry.path === entry.path) {
                        const updated = get().entries.find((item) => {
                            return item.path === response.path;
                        });
                        if (updated !== undefined && updated.mediaUrl !== null) {
                            set({
                                playing: {
                                    ...activePlaying,
                                    entry: updated,
                                    url: updated.mediaUrl,
                                    converted: false
                                }
                            });
                        }
                    }
                }
                return response;
            } catch {
                return { ok: false, reason: 'failed' };
            }
        },

        trashEntry: async (entry) => {
            try {
                const response = await window.api.explorer.trash(entry.path);
                if (response.ok) {
                    if (get().playing?.entry.path === entry.path) {
                        get().closePlayer();
                    }
                    await get().refresh();
                }
                return response;
            } catch {
                return { ok: false, reason: 'failed' };
            }
        },

        playEntry: (entry) => {
            if (entry.kind === 'directory' || entry.mediaUrl === null) {
                return;
            }
            playbackSeq += 1;
            void window.api.explorer.cancelPreview();
            set({
                playing: {
                    entry,
                    status: 'ready',
                    url: entry.mediaUrl,
                    converted: false,
                    error: null
                }
            });
        },

        playStep: (delta) => {
            const state = get();
            if (state.playing === null) {
                return;
            }
            const playable = filterAndSortEntries(state.entries, state.filter, state.query, state.sortBy, state.sortDirection).filter((item) => {
                return item.kind !== 'directory' && item.mediaUrl !== null;
            });
            const index = playable.findIndex((item) => {
                return item.path === state.playing?.entry.path;
            });
            if (index < 0) {
                return;
            }
            const next = playable[index + delta];
            if (next !== undefined) {
                get().playEntry(next);
            }
        },

        convertPlayback: async () => {
            const current = get().playing;
            if (current === null || current.status === 'converting') {
                return;
            }
            if (current.converted || current.entry.token === null) {
                set({
                    playing: {
                        entry: current.entry,
                        status: 'failed',
                        url: null,
                        converted: current.converted,
                        error: 'failed'
                    }
                });
                return;
            }
            playbackSeq += 1;
            const seq = playbackSeq;
            set({ playing: { ...current, status: 'converting', url: null, error: null } });
            try {
                const response = await window.api.explorer.preview(current.entry.token);
                if (seq !== playbackSeq) {
                    return;
                }
                if (response.ok) {
                    set({
                        playing: {
                            entry: current.entry,
                            status: 'ready',
                            url: response.url,
                            converted: response.converted,
                            error: null
                        }
                    });
                    return;
                }
                if (response.reason !== 'cancelled') {
                    set({
                        playing: {
                            entry: current.entry,
                            status: 'failed',
                            url: null,
                            converted: false,
                            error: response.reason
                        }
                    });
                }
            } catch {
                if (seq === playbackSeq) {
                    set({
                        playing: {
                            entry: current.entry,
                            status: 'failed',
                            url: null,
                            converted: false,
                            error: 'failed'
                        }
                    });
                }
            }
        },

        closePlayer: () => {
            playbackSeq += 1;
            void window.api.explorer.cancelPreview();
            set({ playing: null });
        }
    };
});

onDownloadFinished(() => {
    void useExplorerStore.getState().refreshIfLoaded();
});
