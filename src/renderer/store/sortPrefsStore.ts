import { create } from 'zustand';
import { LIBRARY_FILTERS, LIBRARY_SORTS, type LibraryFilter, type LibrarySort } from '../spotlight/spotlightData';

export const SORT_PREFS_STORAGE_KEY = 'pullwave.sort';

export type ListOrder = 'asc' | 'desc';

export const LIST_ORDERS: readonly ListOrder[] = ['asc', 'desc'];

export type ListKind = 'chapters' | 'episodes';

export type LibrarySorts = Record<LibraryFilter, LibrarySort>;

export type ListOrders = Record<string, ListOrder>;

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
    clearMangaGroupSorts: (groupId: number) => void;
    setListOrder: (kind: ListKind, key: string, order: ListOrder) => void;
    clearListOrder: (kind: ListKind, key: string) => void;
}

export function mangaGroupKey(groupId: number | null): string {
    return groupId === null ? 'all' : `group:${String(groupId)}`;
}

export function animeListKey(title: string): string {
    return `sub|${title}`;
}

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

function readLibrarySorts(value: unknown): LibrarySorts {
    const kept = asRecord(value);
    const sorts = { ...DEFAULT_LIBRARY_SORTS };
    LIBRARY_FILTERS.forEach((filter) => {
        sorts[filter] = pick(kept[filter], LIBRARY_SORTS, DEFAULT_LIBRARY_SORT);
    });
    return sorts;
}

function readMangaGroupSorts(value: unknown): MangaGroupSorts {
    const sorts: MangaGroupSorts = {};
    Object.entries(asRecord(value)).forEach(([key, kept]) => {
        if (typeof kept === 'object' && kept !== null) {
            sorts[key] = readLibrarySorts(kept);
        }
    });
    return sorts;
}

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

export function inListOrder<T>(items: readonly T[], order: ListOrder): T[] {
    return order === 'desc' ? [...items].reverse() : [...items];
}
