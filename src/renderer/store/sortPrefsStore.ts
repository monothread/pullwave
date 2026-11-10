import { create } from 'zustand';
import type { AnimeAudio } from '@shared/anime';
import { LIBRARY_FILTERS, LIBRARY_SORTS, type LibraryFilter, type LibrarySort } from '../spotlight/spotlightData';

// The orders the user chose: for the grid of each library, one for each of its filters, and for the list of chapters of each manga and of
// episodes of each anime, one for each title. They are kept in the storage of the window, so they are the same when the app opens again;
// storage that is empty, broken or refuses to be read gives the defaults, and so does what was kept in the shape of an older version.
export const SORT_PREFS_STORAGE_KEY = 'pullwave.sort';

// The order of a list of chapters or episodes: the first one on top, or the last one on top.
export type ListOrder = 'asc' | 'desc';

export const LIST_ORDERS: readonly ListOrder[] = ['asc', 'desc'];

export type LibraryKind = 'anime' | 'manga';

// The lists whose order is kept: the chapters of a manga and the episodes of an anime.
export type ListKind = 'chapters' | 'episodes';

// The order of the grid of a library for each one of its filters.
export type LibrarySorts = Record<LibraryFilter, LibrarySort>;

// The order of the list of each title, by the key of the title (see `animeListKey` and `mangaListKey`). A title that is not here has the
// default order.
export type ListOrders = Record<string, ListOrder>;

export interface SortPrefs {
    library: Record<LibraryKind, LibrarySorts>;
    list: Record<ListKind, ListOrders>;
}

export const DEFAULT_LIBRARY_SORT: LibrarySort = 'recent';

export const DEFAULT_LIST_ORDER: ListOrder = 'asc';

const DEFAULT_LIBRARY_SORTS: LibrarySorts = { all: DEFAULT_LIBRARY_SORT, news: DEFAULT_LIBRARY_SORT, complete: DEFAULT_LIBRARY_SORT, ongoing: DEFAULT_LIBRARY_SORT };

export const DEFAULT_SORT_PREFS: SortPrefs = {
    library: { anime: DEFAULT_LIBRARY_SORTS, manga: DEFAULT_LIBRARY_SORTS },
    list: { chapters: {}, episodes: {} }
};

export interface SortPrefsState extends SortPrefs {
    setLibrarySort: (kind: LibraryKind, filter: LibraryFilter, sort: LibrarySort) => void;
    setListOrder: (kind: ListKind, key: string, order: ListOrder) => void;
    // Forgets the order of a title that left the library.
    clearListOrder: (kind: ListKind, key: string) => void;
}

// The key of an anime in the orders of its episodes: the audio comes first because it has no separator in it, the title can have any
// character. It is the same on the screen of the library and on the one of the search, so the order is the same on both.
export function animeListKey(title: string, audio: AnimeAudio): string {
    return `${audio}|${title}`;
}

// The key of a manga in the orders of its chapters: the source and the id the source gives it.
export function mangaListKey(sourceId: string, remoteId: number): string {
    return `${sourceId}:${String(remoteId)}`;
}

function pick<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
    return options.find((option) => {
        return option === value;
    }) ?? fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

// The orders of the filters of one library; each one that is missing or unknown is the default one.
function readLibrarySorts(value: unknown): LibrarySorts {
    const kept = asRecord(value);
    const sorts = { ...DEFAULT_LIBRARY_SORTS };
    LIBRARY_FILTERS.forEach((filter) => {
        sorts[filter] = pick(kept[filter], LIBRARY_SORTS, DEFAULT_LIBRARY_SORT);
    });
    return sorts;
}

// The orders of the titles of one list; the ones whose order is unknown are left out (they have the default one).
function readListOrders(value: unknown): ListOrders {
    const orders: ListOrders = {};
    Object.entries(asRecord(value)).forEach(([key, order]) => {
        const known = LIST_ORDERS.find((option) => {
            return option === order;
        });
        if (known !== undefined) {
            orders[key] = known;
        }
    });
    return orders;
}

// The orders kept in the storage; each one that is missing or unknown is the default one.
export function readSortPrefs(): SortPrefs {
    try {
        const raw = asRecord(JSON.parse(window.localStorage.getItem(SORT_PREFS_STORAGE_KEY) ?? '{}'));
        const library = asRecord(raw['library']);
        const list = asRecord(raw['list']);
        return {
            library: { anime: readLibrarySorts(library['anime']), manga: readLibrarySorts(library['manga']) },
            list: { chapters: readListOrders(list['chapters']), episodes: readListOrders(list['episodes']) }
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
        setLibrarySort: (kind, filter, sort) => {
            const { library } = get();
            save({ library: { ...library, [kind]: { ...library[kind], [filter]: sort } } });
        },
        setListOrder: (kind, key, order) => {
            const { list } = get();
            save({ list: { ...list, [kind]: { ...list[kind], [key]: order } } });
        },
        clearListOrder: (kind, key) => {
            const { list } = get();
            if (!Object.hasOwn(list[kind], key)) {
                return;
            }
            const kept = Object.fromEntries(
                Object.entries(list[kind]).filter(([candidate]) => {
                    return candidate !== key;
                })
            );
            save({ list: { ...list, [kind]: kept } });
        }
    };
});

// The order of the grid of a library under one of its filters and the way to change it (the change is kept).
export function useLibrarySort(kind: LibraryKind, filter: LibraryFilter): [LibrarySort, (sort: LibrarySort) => void] {
    const sort = useSortPrefsStore((state) => {
        return state.library[kind][filter];
    });
    const setLibrarySort = useSortPrefsStore((state) => {
        return state.setLibrarySort;
    });
    return [
        sort,
        (next) => {
            setLibrarySort(kind, filter, next);
        }
    ];
}

// The order of the list of chapters of a manga or of episodes of an anime and the way to change it (the change is kept). Without a title
// (`key` is null) it is the default order and there is nothing to change.
export function useListOrder(kind: ListKind, key: string | null): [ListOrder, (order: ListOrder) => void] {
    const order = useSortPrefsStore((state) => {
        return key === null ? undefined : state.list[kind][key];
    });
    const setListOrder = useSortPrefsStore((state) => {
        return state.setListOrder;
    });
    return [
        order ?? DEFAULT_LIST_ORDER,
        (next) => {
            if (key !== null) {
                setListOrder(kind, key, next);
            }
        }
    ];
}

// The items of a list (already from the first to the last) in the order chosen.
export function inListOrder<T>(items: readonly T[], order: ListOrder): T[] {
    return order === 'desc' ? [...items].reverse() : [...items];
}
