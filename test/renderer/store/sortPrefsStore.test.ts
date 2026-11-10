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
    mangaListKey,
    readSortPrefs,
    useLibrarySort,
    useListOrder,
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

    it('starts every filter of the libraries with the titles added last, and no title with an order of its own', () => {
        expect(DEFAULT_SORT_PREFS).toEqual({
            library: { anime: RECENT_EVERYWHERE, manga: RECENT_EVERYWHERE },
            list: { chapters: {}, episodes: {} }
        });
    });
});

describe('the keys of the titles', () => {
    it('puts the audio before the title of an anime, so a title with any character gets its own key', () => {
        expect(animeListKey('Frieren', 'sub')).toBe('sub|Frieren');
        expect(animeListKey('Frieren', 'dub')).toBe('dub|Frieren');
        expect(animeListKey('A|B: the sequel', 'sub')).toBe('sub|A|B: the sequel');
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
                manga: { all: 'last', news: 'az', complete: 'za', ongoing: 'last' }
            },
            list: { chapters: { 'src-1:42': 'desc' }, episodes: { 'sub|Frieren': 'desc', 'dub|Frieren': 'asc' } }
        };
        keepRaw(prefs);
        expect(readSortPrefs()).toEqual(prefs);
    });

    it('takes the default for each filter that is missing or unknown, and keeps the others', () => {
        keepRaw({ library: { anime: { all: 'az', news: 'by-size', ongoing: 7 }, manga: { complete: 'za' } }, list: {} });
        expect(readSortPrefs().library).toEqual({
            anime: { all: 'az', news: 'recent', complete: 'recent', ongoing: 'recent' },
            manga: { all: 'recent', news: 'recent', complete: 'za', ongoing: 'recent' }
        });
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
    it('changes the order of one filter of one library, keeps everything else, and saves it all', () => {
        useSortPrefsStore.getState().setLibrarySort('manga', 'news', 'za');
        expect(useSortPrefsStore.getState().library).toEqual({ anime: RECENT_EVERYWHERE, manga: { ...RECENT_EVERYWHERE, news: 'za' } });
        expect(stored()).toEqual({
            library: { anime: RECENT_EVERYWHERE, manga: { ...RECENT_EVERYWHERE, news: 'za' } },
            list: { chapters: {}, episodes: {} }
        });
        useSortPrefsStore.getState().setLibrarySort('anime', 'ongoing', 'last');
        useSortPrefsStore.getState().setLibrarySort('manga', 'all', 'az');
        expect(stored()).toEqual({
            library: { anime: { ...RECENT_EVERYWHERE, ongoing: 'last' }, manga: { ...RECENT_EVERYWHERE, all: 'az', news: 'za' } },
            list: { chapters: {}, episodes: {} }
        });
    });

    it('changes the order of the list of one title, keeps the other titles and lists, and saves it all', () => {
        useSortPrefsStore.getState().setListOrder('episodes', 'sub|Frieren', 'desc');
        expect(useSortPrefsStore.getState().list).toEqual({ chapters: {}, episodes: { 'sub|Frieren': 'desc' } });
        useSortPrefsStore.getState().setListOrder('episodes', 'sub|One Piece', 'desc');
        useSortPrefsStore.getState().setListOrder('chapters', 'src-1:42', 'desc');
        useSortPrefsStore.getState().setListOrder('episodes', 'sub|Frieren', 'asc');
        expect(stored()).toEqual({
            library: { anime: RECENT_EVERYWHERE, manga: RECENT_EVERYWHERE },
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
            library: { anime: RECENT_EVERYWHERE, manga: RECENT_EVERYWHERE },
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
        useSortPrefsStore.getState().setLibrarySort('anime', 'all', 'za');
        expect(useSortPrefsStore.getState().list.chapters).toEqual({ 'src-1:42': 'desc' });
        expect(useSortPrefsStore.getState().library.anime.all).toBe('za');
    });

    it('reads what was kept when the app opens again', async () => {
        keepRaw({
            library: { anime: { all: 'az', news: 'recent', complete: 'recent', ongoing: 'last' }, manga: { all: 'za', news: 'recent', complete: 'recent', ongoing: 'recent' } },
            list: { chapters: { 'src-1:42': 'desc' }, episodes: { 'sub|Frieren': 'asc' } }
        });
        vi.resetModules();
        const reopened = await import('@renderer/store/sortPrefsStore');
        expect(reopened.useSortPrefsStore.getState()).toMatchObject({
            library: { anime: { all: 'az', news: 'recent', complete: 'recent', ongoing: 'last' }, manga: { all: 'za', news: 'recent', complete: 'recent', ongoing: 'recent' } },
            list: { chapters: { 'src-1:42': 'desc' }, episodes: { 'sub|Frieren': 'asc' } }
        });
    });
});

describe('useLibrarySort', () => {
    it('gives the order of a filter of a library and changes only that one', () => {
        const { result } = renderHook(() => {
            return useLibrarySort('anime', 'ongoing');
        });
        expect(result.current[0]).toBe('recent');
        act(() => {
            result.current[1]('za');
        });
        expect(result.current[0]).toBe('za');
        expect(useSortPrefsStore.getState().library).toEqual({ anime: { ...RECENT_EVERYWHERE, ongoing: 'za' }, manga: RECENT_EVERYWHERE });
    });

    it('follows the filter: each one has the order it was left with', () => {
        useSortPrefsStore.getState().setLibrarySort('manga', 'all', 'az');
        useSortPrefsStore.getState().setLibrarySort('manga', 'news', 'last');
        const { result, rerender } = renderHook(
            ({ filter }: { filter: 'all' | 'news' | 'ongoing' }) => {
                return useLibrarySort('manga', filter);
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
