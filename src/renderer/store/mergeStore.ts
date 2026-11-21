import { create } from 'zustand';
import {
    MAX_MERGE_ITEMS,
    MIN_MERGE_ITEMS,
    type MergeMedia,
    type MergeOutputMode,
    type MergeProbeFailure,
    type MergeRun,
    type MergeStartFailure,
    type MergeVideoFormat
} from '@shared/merge';

export type MergeUiError = MergeProbeFailure | 'dropped';

export interface MergeListItem {
    id: number;
    media: MergeMedia;
}

export interface MergeState {
    items: MergeListItem[];
    choosing: boolean;
    error: MergeUiError | null;
    rejectedCount: number;
    outputName: string;
    format: MergeVideoFormat;
    formatTouched: boolean;
    outputMode: MergeOutputMode;
    customOutputDir: string;
    starting: boolean;
    startError: MergeStartFailure | null;
    cancelling: boolean;
    run: MergeRun | null;
    init: () => Promise<() => void>;
    choose: () => Promise<void>;
    addPaths: (paths: string[]) => Promise<void>;
    rejectDrop: () => void;
    removeItem: (id: number) => void;
    moveItem: (id: number, direction: 'up' | 'down') => void;
    setOutputName: (name: string) => void;
    setFormat: (format: MergeVideoFormat) => void;
    syncDefaultFormat: (format: MergeVideoFormat) => void;
    setOutputMode: (mode: MergeOutputMode) => void;
    chooseOutputDir: () => Promise<void>;
    start: () => Promise<void>;
    cancel: () => Promise<void>;
    clear: () => Promise<void>;
}

let nextItemId = 1;

function wrapMedia(media: readonly MergeMedia[]): MergeListItem[] {
    return media.map((entry) => {
        const item: MergeListItem = { id: nextItemId, media: entry };
        nextItemId += 1;
        return item;
    });
}

function appendItems(current: readonly MergeListItem[], incoming: readonly MergeMedia[]): MergeListItem[] {
    const remaining = Math.max(0, MAX_MERGE_ITEMS - current.length);
    if (remaining === 0) {
        return [...current];
    }
    return [...current, ...wrapMedia(incoming.slice(0, remaining))];
}

export const useMergeStore = create<MergeState>((set, get) => {
    return {
        items: [],
        choosing: false,
        error: null,
        rejectedCount: 0,
        outputName: '',
        format: 'mp4',
        formatTouched: false,
        outputMode: 'downloads',
        customOutputDir: '',
        starting: false,
        startError: null,
        cancelling: false,
        run: null,

        init: async () => {
            let receivedProgress = false;
            const unsubscribe = window.api.merge.onProgress((run) => {
                receivedProgress = true;
                set((state) => {
                    return { run, cancelling: run.status === 'running' ? state.cancelling : false };
                });
            });
            try {
                const current = await window.api.merge.current();
                if (!receivedProgress && current !== null) {
                    set({ run: current });
                }
            } catch {
                return unsubscribe;
            }
            return unsubscribe;
        },

        choose: async () => {
            if (get().choosing || get().starting || get().run?.status === 'running') {
                return;
            }
            const previousError = get().error;
            set({ choosing: true, error: null, rejectedCount: 0 });
            try {
                const response = await window.api.merge.choose();
                if (!response.ok) {
                    set({
                        choosing: false,
                        error: response.reason === 'cancelled' ? previousError : response.reason
                    });
                    return;
                }
                set((state) => {
                    return {
                        choosing: false,
                        items: appendItems(state.items, response.media),
                        error: null,
                        rejectedCount: response.rejected.length,
                        startError: null
                    };
                });
            } catch {
                set({ choosing: false, error: 'unreadable' });
            }
        },

        addPaths: async (paths) => {
            if (get().choosing || get().starting || paths.length === 0) {
                return;
            }
            if (get().run?.status === 'running') {
                try {
                    const current = await window.api.merge.current();
                    if (current !== null) {
                        set({ run: current });
                    }
                    if (current?.status === 'running') {
                        return;
                    }
                } catch {
                    return;
                }
            }
            const candidates = paths.filter((path) => {
                return path.length > 0;
            });
            if (candidates.length === 0) {
                return;
            }
            set({ choosing: true, error: null, rejectedCount: 0 });
            try {
                const added: MergeMedia[] = [];
                let rejected = 0;
                let firstFailure: MergeProbeFailure | null = null;
                for (const path of candidates) {
                    const probed = await window.api.merge.probe(path);
                    if (probed.ok) {
                        added.push(probed.media);
                    } else {
                        if (probed.reason === 'no-ffmpeg') {
                            set({ choosing: false, error: 'no-ffmpeg', rejectedCount: 0 });
                            return;
                        }
                        rejected += 1;
                        firstFailure ??= probed.reason;
                    }
                }
                if (added.length === 0) {
                    set({ choosing: false, error: firstFailure ?? 'unreadable', rejectedCount: 0 });
                    return;
                }
                set((state) => {
                    return {
                        choosing: false,
                        items: appendItems(state.items, added),
                        error: null,
                        rejectedCount: rejected,
                        startError: null
                    };
                });
            } catch {
                set({ choosing: false, error: 'unreadable', rejectedCount: 0 });
            }
        },

        rejectDrop: () => {
            if (!get().choosing) {
                set({ error: 'dropped', rejectedCount: 0 });
            }
        },

        removeItem: (id) => {
            if (get().run?.status === 'running' || get().starting || get().choosing) {
                return;
            }
            set((state) => {
                return {
                    items: state.items.filter((item) => {
                        return item.id !== id;
                    }),
                    startError: null
                };
            });
        },

        moveItem: (id, direction) => {
            if (get().run?.status === 'running' || get().starting || get().choosing) {
                return;
            }
            set((state) => {
                const index = state.items.findIndex((item) => {
                    return item.id === id;
                });
                if (index < 0) {
                    return state;
                }
                const target = direction === 'up' ? index - 1 : index + 1;
                if (target < 0 || target >= state.items.length) {
                    return state;
                }
                const next = [...state.items];
                const current = next[index]!;
                next[index] = next[target]!;
                next[target] = current;
                return { items: next, startError: null };
            });
        },

        setOutputName: (outputName) => {
            set({ outputName, startError: null });
        },

        setFormat: (format) => {
            set({ format, formatTouched: true, startError: null });
        },

        syncDefaultFormat: (format) => {
            if (!get().formatTouched) {
                set({ format });
            }
        },

        setOutputMode: (outputMode) => {
            set({ outputMode, startError: null });
        },

        chooseOutputDir: async () => {
            try {
                const chosen = await window.api.chooseDirectory();
                if (chosen !== null && chosen.length > 0) {
                    set({ customOutputDir: chosen, outputMode: 'custom', startError: null });
                }
            } catch {
                return undefined;
            }
        },

        start: async () => {
            const { items, outputName, format, outputMode, customOutputDir, starting, choosing, run } = get();
            if (items.length < MIN_MERGE_ITEMS || starting || choosing || run?.status === 'running') {
                return;
            }
            if (outputMode === 'custom' && customOutputDir.length === 0) {
                set({ startError: 'invalid' });
                return;
            }
            set({ starting: true, startError: null, cancelling: false });
            try {
                const trimmedName = outputName.trim();
                const response = await window.api.merge.start({
                    paths: items.map((item) => {
                        return item.media.path;
                    }),
                    format,
                    outputMode,
                    ...(outputMode === 'custom' ? { outputDirectory: customOutputDir } : {}),
                    ...(trimmedName.length > 0 ? { outputName: trimmedName } : {})
                });
                if (response.ok) {
                    set((state) => {
                        return {
                            starting: false,
                            run: state.run?.id === response.run.id ? state.run : response.run
                        };
                    });
                    return;
                }
                set({ starting: false, startError: response.reason });
            } catch {
                set({ starting: false, startError: 'invalid' });
            }
        },

        cancel: async () => {
            if (get().run?.status !== 'running' || get().cancelling) {
                return;
            }
            set({ cancelling: true });
            try {
                await window.api.merge.cancel();
            } catch {
                set({ cancelling: false });
            }
        },

        clear: async () => {
            if (get().run?.status === 'running' || get().starting || get().choosing) {
                return;
            }
            set({ items: [], outputName: '', error: null, rejectedCount: 0, startError: null, run: null });
            try {
                await window.api.merge.clear();
            } catch {
                return undefined;
            }
        }
    };
});
