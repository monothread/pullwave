// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import {
    DEFAULT_LIBRARY_SORT,
    DEFAULT_LIST_ORDER,
    DEFAULT_SORT_PREFS,
    LIST_ORDERS,
    SORT_PREFS_STORAGE_KEY,
    animeListKey,
    inListOrder,
    mangaGroupKey,
    mangaListKey,
    readSortPrefs,
    useAnimeLibrarySort,
    useListOrder,
    useMangaLibrarySort,
    useSortPrefsStore,
    type SortPrefs
} from '@renderer/store/sortPrefsStore';

const RECENT_EVERYWHERE = { all: 'recent', news: 'recent', complete: 'recent', ongoing: 'recent' } as const;

function stored(): unknown {
    return JSON.parse(window.localStorage.getItem(SORT_PREFS_STORAGE_KEY) ?? 'null');
}

function keepRaw(raw: unknown): void {
    window.localStorage.setItem(SORT_PREFS_STORAGE_KEY, JSON.stringify(raw));
}

afterEach(() => {
    window.localStorage.removeItem(SORT_PREFS_STORAGE_KEY);
    useSortPrefsStore.setState({ library: DEFAULT_SORT_PREFS.library, list: DEFAULT_SORT_PREFS.list });
    vi.restoreAllMocks();
});

describe('the constants', () => {
    it('keeps the orders under their own key of the storage of the window', () => {
        expect(SORT_PREFS_STORAGE_KEY).toBe('pullwave.sort');
    });

    it('has a list from the first to the last and from the last to the first', () => {
        expect(LIST_ORDERS).toEqual(['asc', 'desc']);
    });

    it('has the titles added last and the first episode on top as the defaults', () => {
        expect(DEFAULT_LIBRARY_SORT).toBe('recent');
        expect(DEFAULT_LIST_ORDER).toBe('asc');
    });

    it('starts every filter of the anime library with the titles added last, and no tab of the manga library or title with an order of its own', () => {
        expect(DEFAULT_SORT_PREFS).toEqual({
            library: { anime: RECENT_EVERYWHERE, manga: {} },
            list: { chapters: {}, episodes: {} }
        });
    });
});

describe('the keys of the tabs of groups', () => {
    it('has a key for the tab of all and one for each group', () => {
        expect(mangaGroupKey(null)).toBe('all');
        expect(mangaGroupKey(3)).toBe('group:3');
        expect(mangaGroupKey(12)).toBe('group:12');
    });
});

describe('the keys of the titles', () => {
    it('starts the key of an anime with "sub|" as it did when the anime had an audio, so the orders kept then are found', () => {
        expect(animeListKey('Frieren')).toBe('sub|Frieren');
        expect(animeListKey('A|B: the sequel')).toBe('sub|A|B: the sequel');
    });

    it('joins the source and the id the source gives to a manga', () => {
        expect(mangaListKey('src-1', 42)).toBe('src-1:42');
        expect(mangaListKey('src-2', 42)).toBe('src-2:42');
    });
});

describe('readSortPrefs', () => {
    it('gives the defaults when nothing is kept', () => {
        expect(readSortPrefs()).toEqual(DEFAULT_SORT_PREFS);
    });

    it('gives what is kept', () => {
        const prefs: SortPrefs = {
            library: {
                anime: { all: 'za', news: 'last', complete: 'az', ongoing: 'recent' },
                manga: {
                    all: { all: 'last', news: 'az', complete: 'za', ongoing: 'last' },
                    'group:3': { all: 'za', news: 'recent', complete: 'recent', ongoing: 'az' }
                }
            },
            list: { chapters: { 'src-1:42': 'desc' }, episodes: { 'sub|Frieren': 'desc', 'dub|Frieren': 'asc' } }
        };
        keepRaw(prefs);
        expect(readSortPrefs()).toEqual(prefs);
    });

    it('takes the default for each filter that is missing or unknown, in the anime and in each tab of the manga, and keeps the others', () => {
        keepRaw({
            library: { anime: { all: 'az', news: 'by-size', ongoing: 7 }, manga: { all: { complete: 'za' }, 'group:3': { news: 'last', all: null } } },
            list: {}
        });
        expect(readSortPrefs().library).toEqual({
            anime: { all: 'az', news: 'recent', complete: 'recent', ongoing: 'recent' },
            manga: {
                all: { all: 'recent', news: 'recent', complete: 'za', ongoing: 'recent' },
                'group:3': { all: 'recent', news: 'last', complete: 'recent', ongoing: 'recent' }
            }
        });
    });

    it('leaves out of the manga library what is not the orders of a tab', () => {
        keepRaw({ library: { anime: {}, manga: { all: 'za', 'group:3': 7, 'group:4': null, 'group:5': { news: 'az' } } }, list: {} });
        expect(readSortPrefs().library.manga).toEqual({ 'group:5': { all: 'recent', news: 'az', complete: 'recent', ongoing: 'recent' } });
    });

    it('gives the defaults for the manga library of the version that kept one order for each filter, whatever the tab', () => {
        keepRaw({ library: { anime: { all: 'za', news: 'recent', complete: 'recent', ongoing: 'recent' }, manga: { all: 'za', news: 'last', complete: 'az', ongoing: 'recent' } }, list: {} });
        expect(readSortPrefs().library).toEqual({ anime: { all: 'za', news: 'recent', complete: 'recent', ongoing: 'recent' }, manga: {} });
    });

    it('leaves out the titles whose order is unknown, and keeps the others', () => {
        keepRaw({ library: {}, list: { chapters: { 'src-1:1': 'desc', 'src-1:2': 'sideways', 'src-1:3': 3 }, episodes: { 'sub|A': 'asc', 'sub|B': null } } });
        expect(readSortPrefs().list).toEqual({ chapters: { 'src-1:1': 'desc' }, episodes: { 'sub|A': 'asc' } });
    });

    it('gives the defaults for what an older version kept (one order for every title and filter)', () => {
        keepRaw({ library: { anime: 'za', manga: 'last' }, list: { chapters: 'desc', episodes: 'desc' } });
        expect(readSortPrefs()).toEqual(DEFAULT_SORT_PREFS);
    });

    it.each([['[1, 2]'], ['"za"'], ['null'], ['{"library": "za", "list": ["desc"]}']])('gives the defaults when what is kept is %s', (raw) => {
        window.localStorage.setItem(SORT_PREFS_STORAGE_KEY, raw);
        expect(readSortPrefs()).toEqual(DEFAULT_SORT_PREFS);
    });

    it('gives the defaults when what is kept is not JSON', () => {
        window.localStorage.setItem(SORT_PREFS_STORAGE_KEY, '{broken');
        expect(readSortPrefs()).toEqual(DEFAULT_SORT_PREFS);
    });

    it('gives the defaults when the storage cannot be read', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        expect(readSortPrefs()).toEqual(DEFAULT_SORT_PREFS);
    });
});

describe('useSortPrefsStore', () => {
    it('changes the order of one filter of the anime library, keeps everything else, and saves it all', () => {
        useSortPrefsStore.getState().setAnimeLibrarySort('news', 'za');
        expect(useSortPrefsStore.getState().library).toEqual({ anime: { ...RECENT_EVERYWHERE, news: 'za' }, manga: {} });
        expect(stored()).toEqual({
            library: { anime: { ...RECENT_EVERYWHERE, news: 'za' }, manga: {} },
            list: { chapters: {}, episodes: {} }
        });
        useSortPrefsStore.getState().setAnimeLibrarySort('ongoing', 'last');
        expect(stored()).toEqual({
            library: { anime: { ...RECENT_EVERYWHERE, news: 'za', ongoing: 'last' }, manga: {} },
            list: { chapters: {}, episodes: {} }
        });
    });

    it('changes the order of one filter of one tab of the manga library, keeps the other filters, tabs and lists, and saves it all', () => {
        useSortPrefsStore.getState().setMangaLibrarySort(null, 'news', 'za');
        expect(useSortPrefsStore.getState().library).toEqual({ anime: RECENT_EVERYWHERE, manga: { all: { ...RECENT_EVERYWHERE, news: 'za' } } });
        useSortPrefsStore.getState().setMangaLibrarySort(3, 'news', 'az');
        useSortPrefsStore.getState().setMangaLibrarySort(3, 'all', 'last');
        useSortPrefsStore.getState().setMangaLibrarySort(null, 'all', 'az');
        expect(stored()).toEqual({
            library: {
                anime: RECENT_EVERYWHERE,
                manga: { all: { ...RECENT_EVERYWHERE, all: 'az', news: 'za' }, 'group:3': { ...RECENT_EVERYWHERE, all: 'last', news: 'az' } }
            },
            list: { chapters: {}, episodes: {} }
        });
    });

    it('forgets the orders of one group only, and saves it', () => {
        useSortPrefsStore.getState().setMangaLibrarySort(null, 'all', 'za');
        useSortPrefsStore.getState().setMangaLibrarySort(3, 'all', 'za');
        useSortPrefsStore.getState().setMangaLibrarySort(4, 'news', 'az');
        useSortPrefsStore.getState().clearMangaGroupSorts(3);
        expect(useSortPrefsStore.getState().library.manga).toEqual({ all: { ...RECENT_EVERYWHERE, all: 'za' }, 'group:4': { ...RECENT_EVERYWHERE, news: 'az' } });
        expect(stored()).toEqual({
            library: { anime: RECENT_EVERYWHERE, manga: { all: { ...RECENT_EVERYWHERE, all: 'za' }, 'group:4': { ...RECENT_EVERYWHERE, news: 'az' } } },
            list: { chapters: {}, episodes: {} }
        });
    });

    it('does nothing, and saves nothing, when the group has no orders of its own to forget', () => {
        useSortPrefsStore.getState().setMangaLibrarySort(null, 'all', 'za');
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        const before = useSortPrefsStore.getState().library;
        useSortPrefsStore.getState().clearMangaGroupSorts(9);
        expect(useSortPrefsStore.getState().library).toBe(before);
        expect(setItem).not.toHaveBeenCalled();
    });

    it('changes the order of the list of one title, keeps the other titles and lists, and saves it all', () => {
        useSortPrefsStore.getState().setListOrder('episodes', 'sub|Frieren', 'desc');
        expect(useSortPrefsStore.getState().list).toEqual({ chapters: {}, episodes: { 'sub|Frieren': 'desc' } });
        useSortPrefsStore.getState().setListOrder('episodes', 'sub|One Piece', 'desc');
        useSortPrefsStore.getState().setListOrder('chapters', 'src-1:42', 'desc');
        useSortPrefsStore.getState().setListOrder('episodes', 'sub|Frieren', 'asc');
        expect(stored()).toEqual({
            library: { anime: RECENT_EVERYWHERE, manga: {} },
            list: { chapters: { 'src-1:42': 'desc' }, episodes: { 'sub|Frieren': 'asc', 'sub|One Piece': 'desc' } }
        });
    });

    it('forgets the order of one title only, and saves it', () => {
        useSortPrefsStore.getState().setListOrder('episodes', 'sub|Frieren', 'desc');
        useSortPrefsStore.getState().setListOrder('episodes', 'dub|Frieren', 'desc');
        useSortPrefsStore.getState().setListOrder('chapters', 'sub|Frieren', 'desc');
        useSortPrefsStore.getState().clearListOrder('episodes', 'sub|Frieren');
        expect(useSortPrefsStore.getState().list).toEqual({ chapters: { 'sub|Frieren': 'desc' }, episodes: { 'dub|Frieren': 'desc' } });
        expect(stored()).toEqual({
            library: { anime: RECENT_EVERYWHERE, manga: {} },
            list: { chapters: { 'sub|Frieren': 'desc' }, episodes: { 'dub|Frieren': 'desc' } }
        });
    });

    it('does nothing, and saves nothing, when the title has no order of its own to forget', () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        const before = useSortPrefsStore.getState().list;
        useSortPrefsStore.getState().clearListOrder('episodes', 'sub|Never opened');
        expect(useSortPrefsStore.getState().list).toBe(before);
        expect(setItem).not.toHaveBeenCalled();
    });

    it('still changes the order when the storage cannot be written', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('full');
        });
        useSortPrefsStore.getState().setListOrder('chapters', 'src-1:42', 'desc');
        useSortPrefsStore.getState().setAnimeLibrarySort('all', 'za');
        useSortPrefsStore.getState().setMangaLibrarySort(3, 'all', 'az');
        expect(useSortPrefsStore.getState().list.chapters).toEqual({ 'src-1:42': 'desc' });
        expect(useSortPrefsStore.getState().library.anime.all).toBe('za');
        expect(useSortPrefsStore.getState().library.manga['group:3']?.all).toBe('az');
    });

    it('reads what was kept when the app opens again', async () => {
        keepRaw({
            library: { anime: { all: 'az', news: 'recent', complete: 'recent', ongoing: 'last' }, manga: { 'group:3': { all: 'za', news: 'recent', complete: 'recent', ongoing: 'recent' } } },
            list: { chapters: { 'src-1:42': 'desc' }, episodes: { 'sub|Frieren': 'asc' } }
        });
        vi.resetModules();
        const reopened = await import('@renderer/store/sortPrefsStore');
        expect(reopened.useSortPrefsStore.getState()).toMatchObject({
            library: { anime: { all: 'az', news: 'recent', complete: 'recent', ongoing: 'last' }, manga: { 'group:3': { all: 'za', news: 'recent', complete: 'recent', ongoing: 'recent' } } },
            list: { chapters: { 'src-1:42': 'desc' }, episodes: { 'sub|Frieren': 'asc' } }
        });
    });
});

describe('useAnimeLibrarySort', () => {
    it('gives the order of a filter of the anime library and changes only that one', () => {
        const { result } = renderHook(() => {
            return useAnimeLibrarySort('ongoing');
        });
        expect(result.current[0]).toBe('recent');
        act(() => {
            result.current[1]('za');
        });
        expect(result.current[0]).toBe('za');
        expect(useSortPrefsStore.getState().library).toEqual({ anime: { ...RECENT_EVERYWHERE, ongoing: 'za' }, manga: {} });
    });

    it('follows the filter: each one has the order it was left with', () => {
        useSortPrefsStore.getState().setAnimeLibrarySort('all', 'az');
        useSortPrefsStore.getState().setAnimeLibrarySort('news', 'last');
        const { result, rerender } = renderHook(
            ({ filter }: { filter: 'all' | 'news' | 'ongoing' }) => {
                return useAnimeLibrarySort(filter);
            },
            { initialProps: { filter: 'all' } }
        );
        expect(result.current[0]).toBe('az');
        rerender({ filter: 'news' });
        expect(result.current[0]).toBe('last');
        rerender({ filter: 'ongoing' });
        expect(result.current[0]).toBe('recent');
    });
});

describe('useMangaLibrarySort', () => {
    it('gives the default order for a tab that has none kept, and changes only that filter of that tab', () => {
        const { result } = renderHook(() => {
            return useMangaLibrarySort(3, 'news');
        });
        expect(result.current[0]).toBe('recent');
        act(() => {
            result.current[1]('za');
        });
        expect(result.current[0]).toBe('za');
        expect(useSortPrefsStore.getState().library).toEqual({ anime: RECENT_EVERYWHERE, manga: { 'group:3': { ...RECENT_EVERYWHERE, news: 'za' } } });
    });

    it('follows the tab and the filter: each combination has the order it was left with', () => {
        useSortPrefsStore.getState().setMangaLibrarySort(null, 'all', 'az');
        useSortPrefsStore.getState().setMangaLibrarySort(null, 'news', 'last');
        useSortPrefsStore.getState().setMangaLibrarySort(3, 'all', 'za');
        const { result, rerender } = renderHook(
            ({ groupId, filter }: { groupId: number | null; filter: 'all' | 'news' }) => {
                return useMangaLibrarySort(groupId, filter);
            },
            { initialProps: { groupId: null as number | null, filter: 'all' as 'all' | 'news' } }
        );
        expect(result.current[0]).toBe('az');
        rerender({ groupId: null, filter: 'news' });
        expect(result.current[0]).toBe('last');
        rerender({ groupId: 3, filter: 'all' });
        expect(result.current[0]).toBe('za');
        rerender({ groupId: 3, filter: 'news' });
        expect(result.current[0]).toBe('recent');
        rerender({ groupId: 4, filter: 'all' });
        expect(result.current[0]).toBe('recent');
    });

    it('does not change the anime library', () => {
        const { result } = renderHook(() => {
            return useMangaLibrarySort(null, 'all');
        });
        act(() => {
            result.current[1]('za');
        });
        expect(useSortPrefsStore.getState().library.anime).toEqual(RECENT_EVERYWHERE);
    });
});

describe('useListOrder', () => {
    it('gives the first one on top for a title with no order of its own, and changes only that title', () => {
        const { result } = renderHook(() => {
            return useListOrder('chapters', 'src-1:42');
        });
        expect(result.current[0]).toBe('asc');
        act(() => {
            result.current[1]('desc');
        });
        expect(result.current[0]).toBe('desc');
        expect(useSortPrefsStore.getState().list).toEqual({ chapters: { 'src-1:42': 'desc' }, episodes: {} });
    });

    it('gives the order kept for each title', () => {
        useSortPrefsStore.getState().setListOrder('episodes', 'sub|Frieren', 'desc');
        const frieren = renderHook(() => {
            return useListOrder('episodes', 'sub|Frieren');
        });
        const onePiece = renderHook(() => {
            return useListOrder('episodes', 'sub|One Piece');
        });
        const dubbed = renderHook(() => {
            return useListOrder('episodes', 'dub|Frieren');
        });
        expect(frieren.result.current[0]).toBe('desc');
        expect(onePiece.result.current[0]).toBe('asc');
        expect(dubbed.result.current[0]).toBe('asc');
    });

    it('gives the default order and changes nothing without a title', () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        const { result } = renderHook(() => {
            return useListOrder('episodes', null);
        });
        expect(result.current[0]).toBe('asc');
        act(() => {
            result.current[1]('desc');
        });
        expect(result.current[0]).toBe('asc');
        expect(useSortPrefsStore.getState().list).toEqual({ chapters: {}, episodes: {} });
        expect(setItem).not.toHaveBeenCalled();
    });
});

describe('inListOrder', () => {
    it('keeps the order from the first to the last, in a new list', () => {
        const items = [1, 2, 3];
        const ordered = inListOrder(items, 'asc');
        expect(ordered).toEqual([1, 2, 3]);
        expect(ordered).not.toBe(items);
    });

    it('turns the list around from the last to the first, without changing the one it was given', () => {
        const items = ['a', 'b', 'c'];
        expect(inListOrder(items, 'desc')).toEqual(['c', 'b', 'a']);
        expect(items).toEqual(['a', 'b', 'c']);
    });

    it('is empty with nothing', () => {
        expect(inListOrder([], 'desc')).toEqual([]);
    });
});
