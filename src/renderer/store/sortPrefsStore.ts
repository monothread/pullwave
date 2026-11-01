import { create } from 'zustand';
import { LIBRARY_SORTS, type LibrarySort } from '../spotlight/spotlightData';

// The orders the user chose for the grids of the libraries and for the lists of chapters and episodes. They are kept in the storage of the
// window, so they are the same when the app opens again; storage that is empty, broken or refuses to be read gives the defaults.
export const SORT_PREFS_STORAGE_KEY = 'pullwave.sort';

// The order of a list of chapters or episodes: the first one on top, or the last one on top.
export type ListOrder = 'asc' | 'desc';

export const LIST_ORDERS: readonly ListOrder[] = ['asc', 'desc'];

export type LibraryKind = 'anime' | 'manga';

// The lists whose order is kept: the chapters of a manga and the episodes of an anime.
export type ListKind = 'chapters' | 'episodes';

export interface SortPrefs {
    library: Record<LibraryKind, LibrarySort>;
    list: Record<ListKind, ListOrder>;
}

export const DEFAULT_SORT_PREFS: SortPrefs = {
    library: { anime: 'recent', manga: 'recent' },
    list: { chapters: 'asc', episodes: 'asc' }
};

export interface SortPrefsState extends SortPrefs {
    setLibrarySort: (kind: LibraryKind, sort: LibrarySort) => void;
    setListOrder: (kind: ListKind, order: ListOrder) => void;
}

function pick<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
    return options.find((option) => {
        return option === value;
    }) ?? fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

// The orders kept in the storage; each one that is missing or unknown is the default one.
export function readSortPrefs(): SortPrefs {
    try {
        const raw = asRecord(JSON.parse(window.localStorage.getItem(SORT_PREFS_STORAGE_KEY) ?? '{}'));
        const library = asRecord(raw['library']);
        const list = asRecord(raw['list']);
        return {
            library: {
                anime: pick(library['anime'], LIBRARY_SORTS, DEFAULT_SORT_PREFS.library.anime),
                manga: pick(library['manga'], LIBRARY_SORTS, DEFAULT_SORT_PREFS.library.manga)
            },
            list: {
                chapters: pick(list['chapters'], LIST_ORDERS, DEFAULT_SORT_PREFS.list.chapters),
                episodes: pick(list['episodes'], LIST_ORDERS, DEFAULT_SORT_PREFS.list.episodes)
            }
        };
    } catch {
        return DEFAULT_SORT_PREFS;
    }
}

function writeSortPrefs(prefs: SortPrefs): void {
    try {
        window.localStorage.setItem(SORT_PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        // Storage can be unavailable: the choice then lasts until the window closes.
    }
}

export const useSortPrefsStore = create<SortPrefsState>((set, get) => {
    const save = (changes: Partial<SortPrefs>): void => {
        const { library, list } = get();
        const next: SortPrefs = { library, list, ...changes };
        writeSortPrefs(next);
        set(next);
    };
    return {
        ...readSortPrefs(),
        setLibrarySort: (kind, sort) => {
            save({ library: { ...get().library, [kind]: sort } });
        },
        setListOrder: (kind, order) => {
            save({ list: { ...get().list, [kind]: order } });
        }
    };
});

// The order of the grid of a library and the way to change it (the change is kept).
export function useLibrarySort(kind: LibraryKind): [LibrarySort, (sort: LibrarySort) => void] {
    const sort = useSortPrefsStore((state) => {
        return state.library[kind];
    });
    const setLibrarySort = useSortPrefsStore((state) => {
        return state.setLibrarySort;
    });
    return [
        sort,
        (next) => {
            setLibrarySort(kind, next);
        }
    ];
}

// The order of a list of chapters or episodes and the way to change it (the change is kept).
export function useListOrder(kind: ListKind): [ListOrder, (order: ListOrder) => void] {
    const order = useSortPrefsStore((state) => {
        return state.list[kind];
    });
    const setListOrder = useSortPrefsStore((state) => {
        return state.setListOrder;
    });
    return [
        order,
        (next) => {
            setListOrder(kind, next);
        }
    ];
}

// The items of a list (already from the first to the last) in the order chosen.
export function inListOrder<T>(items: readonly T[], order: ListOrder): T[] {
    return order === 'desc' ? [...items].reverse() : [...items];
}
