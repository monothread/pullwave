// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import {
    DEFAULT_SORT_PREFS,
    LIST_ORDERS,
    SORT_PREFS_STORAGE_KEY,
    inListOrder,
    readSortPrefs,
    useLibrarySort,
    useListOrder,
    useSortPrefsStore
} from '@renderer/store/sortPrefsStore';

function stored(): unknown {
    return JSON.parse(window.localStorage.getItem(SORT_PREFS_STORAGE_KEY) ?? 'null');
}

afterEach(() => {
    window.localStorage.removeItem(SORT_PREFS_STORAGE_KEY);
    useSortPrefsStore.setState({ library: { ...DEFAULT_SORT_PREFS.library }, list: { ...DEFAULT_SORT_PREFS.list } });
    vi.restoreAllMocks();
});

describe('the constants', () => {
    it('keeps the orders under their own key of the storage of the window', () => {
        expect(SORT_PREFS_STORAGE_KEY).toBe('pullwave.sort');
    });

    it('has a list from the first to the last and from the last to the first', () => {
        expect(LIST_ORDERS).toEqual(['asc', 'desc']);
    });

    it('starts the libraries with the titles added last and the lists from the first one', () => {
        expect(DEFAULT_SORT_PREFS).toEqual({ library: { anime: 'recent', manga: 'recent' }, list: { chapters: 'asc', episodes: 'asc' } });
    });
});

describe('readSortPrefs', () => {
    it('gives the defaults when nothing is kept', () => {
        expect(readSortPrefs()).toEqual(DEFAULT_SORT_PREFS);
    });

    it('gives what is kept', () => {
        window.localStorage.setItem(SORT_PREFS_STORAGE_KEY, JSON.stringify({ library: { anime: 'za', manga: 'last' }, list: { chapters: 'desc', episodes: 'desc' } }));
        expect(readSortPrefs()).toEqual({ library: { anime: 'za', manga: 'last' }, list: { chapters: 'desc', episodes: 'desc' } });
    });

    it('takes the default for each one that is missing or unknown, and keeps the others', () => {
        window.localStorage.setItem(SORT_PREFS_STORAGE_KEY, JSON.stringify({ library: { anime: 'az', manga: 'by-size' }, list: { episodes: 'desc', chapters: 7 } }));
        expect(readSortPrefs()).toEqual({ library: { anime: 'az', manga: 'recent' }, list: { chapters: 'asc', episodes: 'desc' } });
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
    it('changes the order of one library, keeps the other, and saves them all', () => {
        useSortPrefsStore.getState().setLibrarySort('manga', 'za');
        expect(useSortPrefsStore.getState().library).toEqual({ anime: 'recent', manga: 'za' });
        expect(stored()).toEqual({ library: { anime: 'recent', manga: 'za' }, list: { chapters: 'asc', episodes: 'asc' } });
        useSortPrefsStore.getState().setLibrarySort('anime', 'last');
        expect(stored()).toEqual({ library: { anime: 'last', manga: 'za' }, list: { chapters: 'asc', episodes: 'asc' } });
    });

    it('changes the order of one list, keeps the other, and saves them all', () => {
        useSortPrefsStore.getState().setListOrder('episodes', 'desc');
        expect(useSortPrefsStore.getState().list).toEqual({ chapters: 'asc', episodes: 'desc' });
        expect(stored()).toEqual({ library: { anime: 'recent', manga: 'recent' }, list: { chapters: 'asc', episodes: 'desc' } });
        useSortPrefsStore.getState().setListOrder('chapters', 'desc');
        expect(stored()).toEqual({ library: { anime: 'recent', manga: 'recent' }, list: { chapters: 'desc', episodes: 'desc' } });
    });

    it('still changes the order when the storage cannot be written', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('full');
        });
        useSortPrefsStore.getState().setListOrder('chapters', 'desc');
        expect(useSortPrefsStore.getState().list.chapters).toBe('desc');
    });

    it('reads what was kept when the app opens again', async () => {
        window.localStorage.setItem(SORT_PREFS_STORAGE_KEY, JSON.stringify({ library: { anime: 'az', manga: 'za' }, list: { chapters: 'desc', episodes: 'asc' } }));
        vi.resetModules();
        const reopened = await import('@renderer/store/sortPrefsStore');
        expect(reopened.useSortPrefsStore.getState()).toMatchObject({ library: { anime: 'az', manga: 'za' }, list: { chapters: 'desc', episodes: 'asc' } });
    });
});

describe('useLibrarySort and useListOrder', () => {
    it('give the order of a library and change it', () => {
        const { result } = renderHook(() => {
            return useLibrarySort('anime');
        });
        expect(result.current[0]).toBe('recent');
        act(() => {
            result.current[1]('za');
        });
        expect(result.current[0]).toBe('za');
        expect(useSortPrefsStore.getState().library).toEqual({ anime: 'za', manga: 'recent' });
    });

    it('give the order of a list and change it', () => {
        const { result } = renderHook(() => {
            return useListOrder('chapters');
        });
        expect(result.current[0]).toBe('asc');
        act(() => {
            result.current[1]('desc');
        });
        expect(result.current[0]).toBe('desc');
        expect(useSortPrefsStore.getState().list).toEqual({ chapters: 'desc', episodes: 'asc' });
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
