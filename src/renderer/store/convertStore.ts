import { create } from 'zustand';
import {
    MAX_CONVERT_ITEMS,
    type ConvertAudioFormat,
    type ConvertMedia,
    type ConvertOutputMode,
    type ConvertProbeFailure,
    type ConvertRun,
    type ConvertStartFailure
} from '@shared/convert';

export type ConvertUiError = ConvertProbeFailure | 'dropped';

export interface ConvertState {
    items: ConvertMedia[];
    choosing: boolean;
    error: ConvertUiError | null;
    rejectedCount: number;
    format: ConvertAudioFormat;
    formatTouched: boolean;
    outputMode: ConvertOutputMode;
    customOutputDir: string;
    starting: boolean;
    startError: ConvertStartFailure | null;
    cancelling: boolean;
    run: ConvertRun | null;
    init: () => Promise<() => void>;
    choose: () => Promise<void>;
    addPaths: (paths: string[]) => Promise<void>;
    rejectDrop: () => void;
    removeItem: (path: string) => void;
    setFormat: (format: ConvertAudioFormat) => void;
    syncDefaultFormat: (format: ConvertAudioFormat) => void;
    setOutputMode: (mode: ConvertOutputMode) => void;
    chooseOutputDir: () => Promise<void>;
    start: () => Promise<void>;
    cancel: () => Promise<void>;
    clear: () => Promise<void>;
}

function mergeMedia(current: readonly ConvertMedia[], incoming: readonly ConvertMedia[]): ConvertMedia[] {
    const existing = new Set(
        current.map((item) => {
            return item.path;
        })
    );
    const added = incoming.filter((item) => {
        if (existing.has(item.path)) {
            return false;
        }
        existing.add(item.path);
        return true;
    });
    return [...current, ...added].slice(0, MAX_CONVERT_ITEMS);
}

export const useConvertStore = create<ConvertState>((set, get) => {
    return {
        items: [],
        choosing: false,
        error: null,
        rejectedCount: 0,
        format: 'mp3',
        formatTouched: false,
        outputMode: 'downloads',
        customOutputDir: '',
        starting: false,
        startError: null,
        cancelling: false,
        run: null,

        init: async () => {
            let receivedProgress = false;
            const unsubscribe = window.api.convert.onProgress((run) => {
                receivedProgress = true;
                set((state) => {
                    return { run, cancelling: run.status === 'running' ? state.cancelling : false };
                });
            });
            try {
                const current = await window.api.convert.current();
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
                const response = await window.api.convert.choose();
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
                        items: mergeMedia(state.items, response.media),
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
                    const current = await window.api.convert.current();
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
            const existing = new Set(
                get().items.map((item) => {
                    return item.path;
                })
            );
            const candidates = paths.filter((path) => {
                if (path.length === 0 || existing.has(path)) {
                    return false;
                }
                existing.add(path);
                return true;
            });
            if (candidates.length === 0) {
                return;
            }
            set({ choosing: true, error: null, rejectedCount: 0 });
            try {
                const added: ConvertMedia[] = [];
                let rejected = 0;
                let firstFailure: ConvertProbeFailure | null = null;
                for (const path of candidates) {
                    const probed = await window.api.convert.probe(path);
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
                        items: mergeMedia(state.items, added),
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

        removeItem: (path) => {
            if (get().run?.status === 'running' || get().starting) {
                return;
            }
            set((state) => {
                return {
                    items: state.items.filter((item) => {
                        return item.path !== path;
                    }),
                    startError: null
                };
            });
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
            const { items, format, outputMode, customOutputDir, starting, choosing, run } = get();
            if (items.length === 0 || starting || choosing || run?.status === 'running') {
                return;
            }
            if (outputMode === 'custom' && customOutputDir.length === 0) {
                set({ startError: 'invalid' });
                return;
            }
            set({ starting: true, startError: null, cancelling: false });
            try {
                const response = await window.api.convert.start({
                    paths: items.map((item) => {
                        return item.path;
                    }),
                    format,
                    outputMode,
                    ...(outputMode === 'custom' ? { outputDirectory: customOutputDir } : {})
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
                await window.api.convert.cancel();
            } catch {
                set({ cancelling: false });
            }
        },

        clear: async () => {
            if (get().run?.status === 'running' || get().starting || get().choosing) {
                return;
            }
            set({ items: [], error: null, rejectedCount: 0, startError: null, run: null });
            try {
                await window.api.convert.clear();
            } catch {
                return undefined;
            }
        }
    };
});
