import { create } from 'zustand';
import type { CutChooseFailure, CutChooseResponse, CutMedia, CutPreviewFailure, CutRun, CutSegment, CutStartFailure } from '@shared/cut';
import { checkRow, segmentsToCut, type SegmentRow } from '../components/cutText';

// The picture of the file chosen: being made, made (its address), or none (an audio with no cover, or it could not be made).
export type CutThumbnail = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'none' };

// A part seen in the player before it is cut (D-131). `loading`: asking where to play it. `converting`: the player could not play the file as
// it is, and the part is being made into a file it plays. `ready`: playing `url` from `start` to `end`. `failed`: it cannot be played.
export interface CutPreviewState {
    rowId: number;
    // The number of the part on the screen (from 1).
    number: number;
    segment: CutSegment;
    status: 'loading' | 'converting' | 'ready' | 'failed';
    url: string | null;
    start: number;
    end: number;
    converted: boolean;
    error: CutPreviewFailure | null;
}

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
    thumbnail: CutThumbnail | null;
    preview: CutPreviewState | null;
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
    // Opens the player on a part (a row that is a part), to see it before it is cut.
    openPreview: (rowId: number) => Promise<void>;
    // The player could not play the file as it is: the part is made into a file it plays (once).
    convertPreview: () => Promise<void>;
    closePreview: () => void;
    // Takes the file away and clears the parts and the options (the file stays where it is); not while a cut goes on.
    clear: () => Promise<void>;
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
            audioOnly: false,
            preview: null,
            thumbnail: { status: 'loading' }
        });
        const url = await window.api.cut.thumbnail();
        // Another file may have been chosen while the picture was made.
        if (get().media === response.media) {
            set({ thumbnail: url === null ? { status: 'none' } : { status: 'ready', url } });
        }
    }

    // Asks where to play the part, as it is or converted, and shows it (unless the player was closed or opened on another part meanwhile).
    async function loadPreview(preview: CutPreviewState, convert: boolean): Promise<void> {
        const response = await window.api.cut.preview({ segment: preview.segment, convert });
        if (get().preview?.rowId !== preview.rowId || get().preview?.status === 'ready') {
            return;
        }
        if (response.ok) {
            set({ preview: { ...preview, status: 'ready', url: response.url, start: response.start, end: response.end, converted: response.converted, error: null } });
            return;
        }
        if (response.reason !== 'cancelled') {
            set({ preview: { ...preview, status: 'failed', error: response.reason } });
        }
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
        thumbnail: null,
        preview: null,

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
        },

        openPreview: async (rowId) => {
            const { media, rows } = get();
            const index = rows.findIndex((row) => {
                return row.id === rowId;
            });
            const row = rows[index];
            const segment = media === null || row === undefined ? null : checkRow(row, media.durationSeconds).segment;
            if (segment === null) {
                return;
            }
            const preview: CutPreviewState = { rowId, number: index + 1, segment, status: 'loading', url: null, start: segment.start, end: segment.end, converted: false, error: null };
            set({ preview });
            await loadPreview(preview, false);
        },

        convertPreview: async () => {
            const preview = get().preview;
            if (preview === null || preview.converted || preview.status === 'converting') {
                return;
            }
            const converting: CutPreviewState = { ...preview, status: 'converting', url: null };
            set({ preview: converting });
            await loadPreview(converting, true);
        },

        closePreview: () => {
            set({ preview: null });
        },

        clear: async () => {
            if (get().run?.status === 'running' || get().starting || get().choosing) {
                return;
            }
            set({ media: null, rows: [newRow()], audioOnly: false, chooseError: null, startError: null, run: null, thumbnail: null, preview: null });
            await window.api.cut.clear();
        }
    };
});
