import { create } from 'zustand';
import type { AnimeAudio } from '@shared/anime';
import { LIBRARY_FILTERS, LIBRARY_SORTS, type LibraryFilter, type LibrarySort } from '../spotlight/spotlightData';

// The orders the user chose: for the grid of the anime library, one for each of its filters; for the grid of the manga library, one for each
// filter of each tab of groups; and for the list of chapters of each manga and of episodes of each anime, one for each title. They are kept in the storage of the window, so they are the same when the app opens again;
// storage that is empty, broken or refuses to be read gives the defaults, and so does what was kept in the shape of an older version.
export const SORT_PREFS_STORAGE_KEY = 'pullwave.sort';

// The order of a list of chapters or episodes: the first one on top, or the last one on top.
export type ListOrder = 'asc' | 'desc';

export const LIST_ORDERS: readonly ListOrder[] = ['asc', 'desc'];

// The lists whose order is kept: the chapters of a manga and the episodes of an anime.
export type ListKind = 'chapters' | 'episodes';

// The order of the grid of a library for each one of its filters.
export type LibrarySorts = Record<LibraryFilter, LibrarySort>;

// The order of the list of each title, by the key of the title (see `animeListKey` and `mangaListKey`). A title that is not here has the
// default order.
export type ListOrders = Record<string, ListOrder>;

// The order of the grid of the manga library for each one of its tabs of groups, by the key of the tab (see `mangaGroupKey`). A tab that is
// not here has the default order under every filter.
export type MangaGroupSorts = Record<string, LibrarySorts>;

export interface SortPrefs {
    library: { anime: LibrarySorts; manga: MangaGroupSorts };
    list: Record<ListKind, ListOrders>;
}

export const DEFAULT_LIBRARY_SORT: LibrarySort = 'recent';

export const DEFAULT_LIST_ORDER: ListOrder = 'asc';

const DEFAULT_LIBRARY_SORTS: LibrarySorts = { all: DEFAULT_LIBRARY_SORT, news: DEFAULT_LIBRARY_SORT, complete: DEFAULT_LIBRARY_SORT, ongoing: DEFAULT_LIBRARY_SORT };

export const DEFAULT_SORT_PREFS: SortPrefs = {
    library: { anime: DEFAULT_LIBRARY_SORTS, manga: {} },
    list: { chapters: {}, episodes: {} }
};

export interface SortPrefsState extends SortPrefs {
    setAnimeLibrarySort: (filter: LibraryFilter, sort: LibrarySort) => void;
    setMangaLibrarySort: (groupId: number | null, filter: LibraryFilter, sort: LibrarySort) => void;
    // Forgets the orders of a group that was deleted.
    clearMangaGroupSorts: (groupId: number) => void;
    setListOrder: (kind: ListKind, key: string, order: ListOrder) => void;
    // Forgets the order of a title that left the library.
    clearListOrder: (kind: ListKind, key: string) => void;
}

// The key of a tab of the manga library in the orders of its grid: the tab of all (the mangas that are in no group, `null`) or one group.
export function mangaGroupKey(groupId: number | null): string {
    return groupId === null ? 'all' : `group:${String(groupId)}`;
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

// The orders of the tabs of groups of the manga library; what is not an object of orders (what an earlier version kept, one order for each
// filter and no tabs) is left out.
function readMangaGroupSorts(value: unknown): MangaGroupSorts {
    const sorts: MangaGroupSorts = {};
    Object.entries(asRecord(value)).forEach(([key, kept]) => {
        if (typeof kept === 'object' && kept !== null) {
            sorts[key] = readLibrarySorts(kept);
        }
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
            library: { anime: readLibrarySorts(library['anime']), manga: readMangaGroupSorts(library['manga']) },
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
        setAnimeLibrarySort: (filter, sort) => {
            const { library } = get();
            save({ library: { ...library, anime: { ...library.anime, [filter]: sort } } });
        },
        setMangaLibrarySort: (groupId, filter, sort) => {
            const { library } = get();
            const key = mangaGroupKey(groupId);
            const updated: LibrarySorts = { ...(library.manga[key] ?? DEFAULT_LIBRARY_SORTS) };
            updated[filter] = sort;
            save({ library: { ...library, manga: { ...library.manga, [key]: updated } } });
        },
        clearMangaGroupSorts: (groupId) => {
            const { library } = get();
            const key = mangaGroupKey(groupId);
            if (!Object.hasOwn(library.manga, key)) {
                return;
            }
            const kept = Object.fromEntries(
                Object.entries(library.manga).filter(([candidate]) => {
                    return candidate !== key;
                })
            );
            save({ library: { ...library, manga: kept } });
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

// The order of the grid of the anime library under one of its filters and the way to change it (the change is kept).
export function useAnimeLibrarySort(filter: LibraryFilter): [LibrarySort, (sort: LibrarySort) => void] {
    const sort = useSortPrefsStore((state) => {
        return state.library.anime[filter];
    });
    const setAnimeLibrarySort = useSortPrefsStore((state) => {
        return state.setAnimeLibrarySort;
    });
    return [
        sort,
        (next) => {
            setAnimeLibrarySort(filter, next);
        }
    ];
}

// The order of the grid of the manga library under one of its filters, in one of its tabs of groups (`null` is the tab of all), and the way
// to change it (the change is kept).
export function useMangaLibrarySort(groupId: number | null, filter: LibraryFilter): [LibrarySort, (sort: LibrarySort) => void] {
    const key = mangaGroupKey(groupId);
    const sort = useSortPrefsStore((state) => {
        return state.library.manga[key]?.[filter];
    });
    const setMangaLibrarySort = useSortPrefsStore((state) => {
        return state.setMangaLibrarySort;
    });
    return [
        sort ?? DEFAULT_LIBRARY_SORT,
        (next) => {
            setMangaLibrarySort(groupId, filter, next);
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
