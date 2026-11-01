import { create } from 'zustand';
import type { CutChooseFailure, CutChooseResponse, CutMedia, CutRun, CutStartFailure } from '@shared/cut';
import { segmentsToCut, type SegmentRow } from '../components/cutText';

export interface CutState {
    media: CutMedia | null;
    // The window of the files is open, or the file is being read.
    choosing: boolean;
    chooseError: Exclude<CutChooseFailure, 'cancelled'> | 'dropped' | null;
    rows: SegmentRow[];
    audioOnly: boolean;
    // The cut was asked for and has not begun yet.
    starting: boolean;
    startError: CutStartFailure | null;
    // The cut was ended by the user and the part being made is still stopping.
    cancelling: boolean;
    run: CutRun | null;
    // Follows the cut that goes on, also when the screen opens in the middle of it; gives what stops it.
    init: () => Promise<() => void>;
    choose: () => Promise<void>;
    // Reads a file that was dropped on the screen, by its path (nothing happens while a file is being read or a cut goes on).
    openPath: (path: string) => Promise<void>;
    // Tells that a file could not be taken from what was dropped.
    rejectDrop: () => void;
    addRow: () => void;
    updateRow: (id: number, changes: Partial<Pick<SegmentRow, 'start' | 'end'>>) => void;
    removeRow: (id: number) => void;
    setAudioOnly: (value: boolean) => void;
    start: () => Promise<void>;
    cancel: () => Promise<void>;
}

let nextRowId = 1;

function newRow(): SegmentRow {
    const row = { id: nextRowId, start: '', end: '' };
    nextRowId += 1;
    return row;
}

export const useCutStore = create<CutState>((set, get) => {
    // Takes the file an answer gives (the one chosen in the window, or the one dropped): the screen shows that it is reading until then.
    async function readFile(read: () => Promise<CutChooseResponse>): Promise<void> {
        if (get().choosing) {
            return;
        }
        set({ choosing: true, chooseError: null });
        const response = await read();
        if (!response.ok) {
            set({ choosing: false, chooseError: response.reason === 'cancelled' ? get().chooseError : response.reason });
            return;
        }
        set({
            choosing: false,
            media: response.media,
            chooseError: null,
            startError: null,
            run: null,
            rows: [newRow()],
            audioOnly: false
        });
    }

    return {
        media: null,
        choosing: false,
        chooseError: null,
        rows: [newRow()],
        audioOnly: false,
        starting: false,
        startError: null,
        cancelling: false,
        run: null,

        init: async () => {
            const unsubscribe = window.api.cut.onProgress((run) => {
                set((state) => {
                    return { run, cancelling: run.status === 'running' ? state.cancelling : false };
                });
            });
            const current = await window.api.cut.current();
            if (current !== null) {
                set({ run: current });
            }
            return unsubscribe;
        },

        choose: async () => {
            await readFile(() => {
                return window.api.cut.choose();
            });
        },

        openPath: async (path) => {
            if (get().run?.status === 'running' || get().starting) {
                return;
            }
            await readFile(() => {
                return window.api.cut.probe(path);
            });
        },

        rejectDrop: () => {
            if (!get().choosing) {
                set({ chooseError: 'dropped' });
            }
        },

        addRow: () => {
            set((state) => {
                return { rows: [...state.rows, newRow()] };
            });
        },

        updateRow: (id, changes) => {
            set((state) => {
                return {
                    startError: null,
                    rows: state.rows.map((row) => {
                        return row.id === id ? { ...row, ...changes } : row;
                    })
                };
            });
        },

        removeRow: (id) => {
            set((state) => {
                const rows = state.rows.filter((row) => {
                    return row.id !== id;
                });
                return { rows: rows.length > 0 ? rows : [newRow()] };
            });
        },

        setAudioOnly: (audioOnly) => {
            set({ audioOnly });
        },

        start: async () => {
            const { media, rows, audioOnly, starting } = get();
            if (media === null || starting) {
                return;
            }
            const segments = segmentsToCut(rows, media.durationSeconds);
            if (segments === null) {
                return;
            }
            set({ starting: true, startError: null, cancelling: false });
            const response = await window.api.cut.start({ path: media.path, segments, audioOnly: audioOnly && media.kind === 'video' });
            if (response.ok) {
                set({ starting: false, run: response.run });
                return;
            }
            set({ starting: false, startError: response.reason });
        },

        cancel: async () => {
            if (get().run?.status !== 'running' || get().cancelling) {
                return;
            }
            set({ cancelling: true });
            await window.api.cut.cancel();
        }
    };
});
