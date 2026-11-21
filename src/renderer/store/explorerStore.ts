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
import {
    filterAndSortEntries,
    type ExplorerFilter,
    type ExplorerSortBy,
    type ExplorerSortDirection,
    type ExplorerViewMode
} from '../components/explorerHelpers';

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
    showHidden: boolean;
    filter: ExplorerFilter;
    query: string;
    sortBy: ExplorerSortBy;
    sortDirection: ExplorerSortDirection;
    viewMode: ExplorerViewMode;
    playing: ExplorerPlayerState | null;
    open: (directory?: string) => Promise<void>;
    refresh: () => Promise<void>;
    goBack: () => Promise<void>;
    goForward: () => Promise<void>;
    goUp: () => Promise<void>;
    chooseFolder: () => Promise<void>;
    setShowHidden: (showHidden: boolean) => Promise<void>;
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

    async function loadDirectory(target: string | undefined, historyUpdate: 'push' | 'none' | { index: number }): Promise<void> {
        requestSeq += 1;
        const seq = requestSeq;
        if (typeof historyUpdate === 'object') {
            set({ loading: true, error: null, historyIndex: historyUpdate.index });
        } else {
            set({ loading: true, error: null });
        }
        try {
            const response = await window.api.explorer.list(target, get().showHidden);
            if (seq !== requestSeq) {
                return;
            }
            if (!response.ok) {
                set({ loading: false, loaded: true, error: response.reason });
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
                historyIndex: nextIndex
            });
        } catch {
            if (seq === requestSeq) {
                set({ loading: false, loaded: true, error: 'failed' });
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
        showHidden: false,
        filter: 'all',
        query: '',
        sortBy: 'name',
        sortDirection: 'asc',
        viewMode: 'grid',
        playing: null,

        open: async (directory) => {
            await loadDirectory(directory, 'push');
        },

        refresh: async () => {
            const current = get().directory;
            await loadDirectory(current.length > 0 ? current : undefined, 'none');
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

        chooseFolder: async () => {
            try {
                const chosen = await window.api.explorer.chooseFolder();
                if (chosen !== null && chosen.length > 0) {
                    await loadDirectory(chosen, 'push');
                }
            } catch {
                return undefined;
            }
        },

        setShowHidden: async (showHidden) => {
            set({ showHidden });
            const current = get().directory;
            if (current.length > 0) {
                await loadDirectory(current, 'none');
            }
        },

        setFilter: (filter) => {
            set({ filter });
        },

        setQuery: (query) => {
            set({ query });
        },

        setSortBy: (sortBy) => {
            set({ sortBy });
        },

        toggleSortDirection: () => {
            set((state) => {
                return { sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc' };
            });
        },

        setViewMode: (viewMode) => {
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
                                    url: activePlaying.converted ? activePlaying.url : updated.mediaUrl
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
