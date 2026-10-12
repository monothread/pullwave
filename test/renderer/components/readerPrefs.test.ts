// @vitest-environment jsdom
import {
    DEFAULT_READER_PREFS,
    LAST_CHAPTER_KEY,
    LAST_PAGE_KEY,
    loadAllProgress,
    loadLastChapter,
    loadLastPosition,
    loadProgress,
    loadReadKeys,
    MAX_READ_CHAPTERS,
    MAX_REMEMBERED_MANGAS,
    READ_KEY,
    saveLastChapter,
    saveLastPosition,
    saveReadKeys,
    loadReaderPrefs,
    MAX_REMEMBERED_CHAPTERS,
    PREFS_KEY,
    PROGRESS_KEY,
    progressKey,
    saveProgress,
    saveReaderPrefs
} from '@renderer/components/readerPrefs';

beforeEach(() => {
    window.localStorage.clear();
});

describe('reader preferences', () => {
    it('start from the defaults', () => {
        expect(loadReaderPrefs()).toEqual({ mode: 'single', direction: 'ltr', scale: 'width', background: 'dark', autoScrollSpeed: 80, pageGap: 8 });
        expect(DEFAULT_READER_PREFS).toEqual({ mode: 'single', direction: 'ltr', scale: 'width', background: 'dark', autoScrollSpeed: 80, pageGap: 8 });
    });

    it('are kept and read back', () => {
        saveReaderPrefs({ mode: 'webtoon', direction: 'rtl', scale: 'width', background: 'black', autoScrollSpeed: 150, pageGap: 0 });
        expect(window.localStorage.getItem(PREFS_KEY)).toBe('{"mode":"webtoon","direction":"rtl","scale":"width","background":"black","autoScrollSpeed":150,"pageGap":0}');
        expect(loadReaderPrefs()).toEqual({ mode: 'webtoon', direction: 'rtl', scale: 'width', background: 'black', autoScrollSpeed: 150, pageGap: 0 });
    });

    it('fall back to the default for each value that is not valid', () => {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: 'vertical', direction: 'up', scale: 5, background: null, autoScrollSpeed: 'fast', pageGap: 'wide' }));
        expect(loadReaderPrefs()).toEqual({ mode: 'vertical', direction: 'ltr', scale: 'width', background: 'dark', autoScrollSpeed: 80, pageGap: 8 });
    });

    it.each([
        [5, 10],
        [10, 10],
        [333.4, 333],
        [600, 600],
        [9000, 600],
        [-20, 10]
    ])('keep the speed of the auto scroll %j inside its limits: %j', (stored, expected) => {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify({ autoScrollSpeed: stored }));
        expect(loadReaderPrefs().autoScrollSpeed).toBe(expected);
    });

    it.each([
        [-5, 0],
        [0, 0],
        [12.4, 12],
        [100, 100],
        [900, 100]
    ])('keep the space between the pages %j inside its limits: %j', (stored, expected) => {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify({ pageGap: stored }));
        expect(loadReaderPrefs().pageGap).toBe(expected);
    });

    it.each([[null], ['8'], [Number.NaN], [undefined]])('fall back to the default space between the pages for %j', (stored) => {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify({ pageGap: stored }));
        expect(loadReaderPrefs().pageGap).toBe(8);
    });

    it.each([[null], ['80'], [Number.NaN], [undefined]])('fall back to the default speed for %j', (stored) => {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify({ autoScrollSpeed: stored }));
        expect(loadReaderPrefs().autoScrollSpeed).toBe(80);
    });

    it('fall back to the defaults when what is stored is not JSON, and when the storage refuses', () => {
        window.localStorage.setItem(PREFS_KEY, '{not json');
        expect(loadReaderPrefs()).toEqual(DEFAULT_READER_PREFS);
        const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(loadReaderPrefs()).toEqual(DEFAULT_READER_PREFS);
        read.mockRestore();
        const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(() => {
            saveReaderPrefs(DEFAULT_READER_PREFS);
        }).not.toThrow();
        write.mockRestore();
    });
});

describe('reader progress', () => {
    it('names a chapter by its manga and its number on the server', () => {
        expect(progressKey('One Piece', 11)).toBe('One Piece|11');
    });

    it('is 0 for a chapter that was not read, and the page where it was left otherwise', () => {
        expect(loadProgress('a|1')).toBe(0);
        saveProgress('a|1', 7);
        saveProgress('b|2', 3);
        expect(loadProgress('a|1')).toBe(7);
        expect(loadProgress('b|2')).toBe(3);
        saveProgress('a|1', 9);
        expect(loadProgress('a|1')).toBe(9);
    });

    it('ignores what is stored and is not a page number', () => {
        window.localStorage.setItem(PROGRESS_KEY, JSON.stringify({ 'a|1': 'x', 'b|2': -1, 'c|3': 1.5, 'd|4': 4 }));
        expect(loadProgress('a|1')).toBe(0);
        expect(loadProgress('b|2')).toBe(0);
        expect(loadProgress('c|3')).toBe(0);
        expect(loadProgress('d|4')).toBe(4);
        window.localStorage.setItem(PROGRESS_KEY, '[1,2]');
        expect(loadProgress('d|4')).toBe(0);
        window.localStorage.setItem(PROGRESS_KEY, 'nonsense');
        expect(loadProgress('d|4')).toBe(0);
    });

    it('forgets the oldest chapters when there are too many', () => {
        for (let index = 0; index < MAX_REMEMBERED_CHAPTERS + 3; index += 1) {
            saveProgress(`m|${String(index)}`, index + 1);
        }
        expect(loadProgress('m|0')).toBe(0);
        expect(loadProgress('m|2')).toBe(0);
        expect(loadProgress('m|3')).toBe(4);
        expect(loadProgress(`m|${String(MAX_REMEMBERED_CHAPTERS + 2)}`)).toBe(MAX_REMEMBERED_CHAPTERS + 3);
    });

    it('does not throw when the storage refuses', () => {
        const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(() => {
            saveProgress('a|1', 2);
        }).not.toThrow();
        write.mockRestore();
    });
});

describe('every page left on', () => {
    it('reads all of them at once', () => {
        saveProgress('a|1', 4);
        saveProgress('b|2', 9);
        expect(loadAllProgress()).toEqual({ 'a|1': 4, 'b|2': 9 });
    });

    it('is empty when nothing was kept', () => {
        expect(loadAllProgress()).toEqual({});
    });
});

describe('chapters read', () => {
    it('are none at first', () => {
        expect(loadReadKeys()).toEqual([]);
    });

    it('are kept and read back', () => {
        saveReadKeys(['a|1', 'a|2']);
        expect(window.localStorage.getItem(READ_KEY)).toBe('["a|1","a|2"]');
        expect(loadReadKeys()).toEqual(['a|1', 'a|2']);
    });

    it('keep only the latest ones when there are too many', () => {
        const keys = Array.from({ length: MAX_READ_CHAPTERS + 3 }, (_unused, index) => {
            return `m|${String(index)}`;
        });
        saveReadKeys(keys);
        const kept = loadReadKeys();
        expect(kept).toHaveLength(MAX_READ_CHAPTERS);
        expect(kept[0]).toBe('m|3');
        expect(kept.at(-1)).toBe(`m|${String(MAX_READ_CHAPTERS + 2)}`);
    });

    it('leave out what is not a text, and are none when what is stored is not a list or not JSON', () => {
        window.localStorage.setItem(READ_KEY, JSON.stringify(['a|1', 5, null, 'a|2']));
        expect(loadReadKeys()).toEqual(['a|1', 'a|2']);
        window.localStorage.setItem(READ_KEY, JSON.stringify({ a: 1 }));
        expect(loadReadKeys()).toEqual([]);
        window.localStorage.setItem(READ_KEY, '{oops');
        expect(loadReadKeys()).toEqual([]);
    });

    it('are none when the storage refuses to be read, and are not kept when it refuses to be written', () => {
        const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(loadReadKeys()).toEqual([]);
        read.mockRestore();
        const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(() => {
            saveReadKeys(['a|1']);
        }).not.toThrow();
        write.mockRestore();
    });
});

describe('the chapter each manga was left on', () => {
    it('is none for a manga that was not read', () => {
        expect(loadLastChapter('One Piece')).toBeNull();
    });

    it('is kept by the title of the manga and read back, the latest one replacing the one before', () => {
        saveLastChapter('One Piece', 11);
        saveLastChapter('Bleach', 5);
        saveLastChapter('One Piece', 12);
        expect(loadLastChapter('One Piece')).toBe(12);
        expect(loadLastChapter('Bleach')).toBe(5);
    });

    it('forgets the mangas read longest ago when there are too many', () => {
        for (let index = 0; index < MAX_REMEMBERED_MANGAS + 2; index += 1) {
            saveLastChapter(`Manga ${String(index)}`, index);
        }
        expect(loadLastChapter('Manga 0')).toBeNull();
        expect(loadLastChapter('Manga 1')).toBeNull();
        expect(loadLastChapter('Manga 2')).toBe(2);
        expect(loadLastChapter(`Manga ${String(MAX_REMEMBERED_MANGAS + 1)}`)).toBe(MAX_REMEMBERED_MANGAS + 1);
    });

    it('ignores what is stored when it is not valid', () => {
        window.localStorage.setItem(LAST_CHAPTER_KEY, JSON.stringify({ a: 1, b: 'x', c: 1.5, d: null }));
        expect(loadLastChapter('a')).toBe(1);
        expect(loadLastChapter('b')).toBeNull();
        expect(loadLastChapter('c')).toBeNull();
        window.localStorage.setItem(LAST_CHAPTER_KEY, '[1]');
        expect(loadLastChapter('a')).toBeNull();
        window.localStorage.setItem(LAST_CHAPTER_KEY, '{oops');
        expect(loadLastChapter('a')).toBeNull();
    });

    it('is not kept, without an error, when the storage refuses to be written', () => {
        const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(() => {
            saveLastChapter('One Piece', 1);
        }).not.toThrow();
        write.mockRestore();
    });
});

describe('the chapter and the page each manga was last read on', () => {
    it('is none for a manga that was not read', () => {
        expect(loadLastPosition('One Piece')).toBeNull();
    });

    it('is kept by the title of the manga, the latest replacing the one before, and the last page of a chapter included', () => {
        saveLastPosition('One Piece', 11, 4);
        saveLastPosition('Bleach', 5, 0);
        saveLastPosition('One Piece', 11, 9);
        expect(loadLastPosition('One Piece')).toEqual({ chapterRemoteId: 11, page: 9 });
        saveLastPosition('One Piece', 12, 2);
        expect(loadLastPosition('One Piece')).toEqual({ chapterRemoteId: 12, page: 2 });
        expect(loadLastPosition('Bleach')).toEqual({ chapterRemoteId: 5, page: 0 });
    });

    it('does not write again what is kept already', () => {
        saveLastPosition('One Piece', 11, 4);
        const write = vi.spyOn(Storage.prototype, 'setItem');
        saveLastPosition('One Piece', 11, 4);
        expect(write).not.toHaveBeenCalled();
        saveLastPosition('One Piece', 11, 5);
        expect(write).toHaveBeenCalledTimes(1);
        write.mockRestore();
    });

    it('forgets the mangas read longest ago when there are too many', () => {
        for (let index = 0; index < MAX_REMEMBERED_MANGAS + 2; index += 1) {
            saveLastPosition(`Manga ${String(index)}`, index, 1);
        }
        expect(loadLastPosition('Manga 0')).toBeNull();
        expect(loadLastPosition('Manga 1')).toBeNull();
        expect(loadLastPosition('Manga 2')).toEqual({ chapterRemoteId: 2, page: 1 });
    });

    it('ignores what is stored when it is not valid', () => {
        window.localStorage.setItem(LAST_PAGE_KEY, JSON.stringify({ a: { chapterRemoteId: 1, page: 2 }, b: { chapterRemoteId: 1 }, c: { chapterRemoteId: 1.5, page: 2 }, d: { chapterRemoteId: 1, page: -1 }, e: 3, f: null }));
        expect(loadLastPosition('a')).toEqual({ chapterRemoteId: 1, page: 2 });
        ['b', 'c', 'd', 'e', 'f'].forEach((title) => {
            expect(loadLastPosition(title)).toBeNull();
        });
        window.localStorage.setItem(LAST_PAGE_KEY, '[1]');
        expect(loadLastPosition('a')).toBeNull();
        window.localStorage.setItem(LAST_PAGE_KEY, '{oops');
        expect(loadLastPosition('a')).toBeNull();
    });

    it('does not fail when the browser refuses to keep it', () => {
        const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('full');
        });
        expect(() => {
            saveLastPosition('One Piece', 1, 1);
        }).not.toThrow();
        write.mockRestore();
    });
});

