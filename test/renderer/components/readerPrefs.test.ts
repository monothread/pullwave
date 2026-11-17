// @vitest-environment jsdom
import {
    copiedReadKeys,
    copyChapterProgress,
    DEFAULT_READER_PREFS,
    hasReadUnderTitle,
    LAST_CHAPTER_KEY,
    LAST_PAGE_KEY,
    loadAllProgress,
    loadLastChapter,
    loadLastPosition,
    loadProgress,
    loadReadKeys,
    MAX_READ_CHAPTERS,
    MAX_REMEMBERED_MANGAS,
    moveMangaReading,
    movedReadKeys,
    orphanReadIds,
    READ_KEY,
    saveLastChapter,
    saveLastPosition,
    saveReadKeys,
    loadReaderPrefs,
    MAX_REMEMBERED_CHAPTERS,
    PREFS_BY_MANGA_KEY,
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
        expect(loadReaderPrefs()).toEqual({ mode: 'single', direction: 'ltr', scale: 'width', background: 'dark', autoScrollSpeed: 80, pageGap: 8, chapterSwitch: true, twoPages: false });
        expect(DEFAULT_READER_PREFS).toEqual({ mode: 'single', direction: 'ltr', scale: 'width', background: 'dark', autoScrollSpeed: 80, pageGap: 8, chapterSwitch: true, twoPages: false });
    });

    it('are kept and read back', () => {
        saveReaderPrefs({ mode: 'webtoon', direction: 'rtl', scale: 'width', background: 'black', autoScrollSpeed: 150, pageGap: 0, chapterSwitch: false, twoPages: true });
        expect(window.localStorage.getItem(PREFS_KEY)).toBe('{"mode":"webtoon","direction":"rtl","scale":"width","background":"black","autoScrollSpeed":150,"pageGap":0,"chapterSwitch":false,"twoPages":true}');
        expect(loadReaderPrefs()).toEqual({ mode: 'webtoon', direction: 'rtl', scale: 'width', background: 'black', autoScrollSpeed: 150, pageGap: 0, chapterSwitch: false, twoPages: true });
    });

    it('have two pages side by side off by default, and keep it as it was saved', () => {
        expect(DEFAULT_READER_PREFS.twoPages).toBe(false);
        expect(loadReaderPrefs().twoPages).toBe(false);
        window.localStorage.setItem(PREFS_KEY, JSON.stringify({ twoPages: true }));
        expect(loadReaderPrefs().twoPages).toBe(true);
        window.localStorage.setItem(PREFS_KEY, JSON.stringify({ twoPages: false }));
        expect(loadReaderPrefs().twoPages).toBe(false);
    });

    it.each([['true'], [1], [null], [undefined], [{}]])('fall back to two pages off for %j', (stored) => {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify({ twoPages: stored }));
        expect(loadReaderPrefs().twoPages).toBe(false);
    });

    it('fall back to the default for each value that is not valid', () => {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: 'vertical', direction: 'up', scale: 5, background: null, autoScrollSpeed: 'fast', pageGap: 'wide' }));
        expect(loadReaderPrefs()).toEqual({ mode: 'vertical', direction: 'ltr', scale: 'width', background: 'dark', autoScrollSpeed: 80, pageGap: 8, chapterSwitch: true, twoPages: false });
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

describe('the setting that switches the chapter while scrolling', () => {
    it('is on until the user turns it off', () => {
        expect(loadReaderPrefs().chapterSwitch).toBe(true);
        expect(DEFAULT_READER_PREFS.chapterSwitch).toBe(true);
    });

    it('is kept when it is off, and read back', () => {
        saveReaderPrefs({ ...DEFAULT_READER_PREFS, chapterSwitch: false });
        expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}')).toMatchObject({ chapterSwitch: false });
        expect(loadReaderPrefs().chapterSwitch).toBe(false);
        saveReaderPrefs({ ...DEFAULT_READER_PREFS, chapterSwitch: true });
        expect(loadReaderPrefs().chapterSwitch).toBe(true);
    });

    it('is on for preferences kept before it existed, and for a value that is not true or false', () => {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: 'vertical' }));
        expect(loadReaderPrefs()).toMatchObject({ mode: 'vertical', chapterSwitch: true });
        ['no', 0, null, 'false'].forEach((value) => {
            window.localStorage.setItem(PREFS_KEY, JSON.stringify({ chapterSwitch: value }));
            expect(loadReaderPrefs().chapterSwitch).toBe(true);
        });
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

describe('reader preferences of each manga', () => {
    const webtoon = { ...DEFAULT_READER_PREFS, mode: 'webtoon' as const, direction: 'rtl' as const, twoPages: true };
    const single = { ...DEFAULT_READER_PREFS, mode: 'single' as const, background: 'black' as const };

    it('are the ones chosen last for a manga that has none, and the defaults when nothing was ever chosen', () => {
        expect(loadReaderPrefs('One Piece')).toEqual(DEFAULT_READER_PREFS);
        saveReaderPrefs(webtoon);
        expect(loadReaderPrefs('One Piece')).toEqual(webtoon);
        expect(loadReaderPrefs()).toEqual(webtoon);
    });

    it('are kept for the manga and as the ones chosen last, in two keys of the storage', () => {
        saveReaderPrefs(webtoon, 'One Piece');
        expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}')).toEqual(webtoon);
        expect(JSON.parse(window.localStorage.getItem(PREFS_BY_MANGA_KEY) ?? '{}')).toEqual({ 'One Piece': webtoon });
        expect(loadReaderPrefs('One Piece')).toEqual(webtoon);
    });

    it('stay with each manga whatever another one is set to', () => {
        saveReaderPrefs(webtoon, 'One Piece');
        saveReaderPrefs(single, 'Naruto');
        expect(loadReaderPrefs('One Piece')).toEqual(webtoon);
        expect(loadReaderPrefs('Naruto')).toEqual(single);
        expect(loadReaderPrefs('Bleach')).toEqual(single);
        expect(loadReaderPrefs()).toEqual(single);
    });

    it('are changed for the manga that is set again, and only for it', () => {
        saveReaderPrefs(webtoon, 'One Piece');
        saveReaderPrefs(single, 'Naruto');
        saveReaderPrefs({ ...webtoon, mode: 'vertical' }, 'One Piece');
        expect(loadReaderPrefs('One Piece').mode).toBe('vertical');
        expect(loadReaderPrefs('Naruto')).toEqual(single);
    });

    it('are not touched by what is saved with no manga', () => {
        saveReaderPrefs(webtoon, 'One Piece');
        saveReaderPrefs(single);
        expect(loadReaderPrefs('One Piece')).toEqual(webtoon);
        expect(loadReaderPrefs('Other')).toEqual(single);
        expect(JSON.parse(window.localStorage.getItem(PREFS_BY_MANGA_KEY) ?? '{}')).toEqual({ 'One Piece': webtoon });
    });

    it('fall back to the default for each value of a manga that is not valid', () => {
        window.localStorage.setItem(PREFS_BY_MANGA_KEY, JSON.stringify({ 'One Piece': { mode: 'sideways', direction: 'rtl', scale: 9, twoPages: 'yes', pageGap: 400 } }));
        expect(loadReaderPrefs('One Piece')).toEqual({ ...DEFAULT_READER_PREFS, direction: 'rtl', pageGap: 100 });
    });

    it.each([['not json'], ['null'], ['[1,2]'], ['5'], ['{"One Piece":"webtoon"}'], ['{"One Piece":null}'], ['{"One Piece":[1]}']])('read the shared ones when the storage of the mangas holds %s', (stored) => {
        saveReaderPrefs(webtoon);
        window.localStorage.setItem(PREFS_BY_MANGA_KEY, stored);
        expect(loadReaderPrefs('One Piece')).toEqual(webtoon);
    });

    it('keep the last mangas set, and let the oldest go when there are too many', () => {
        for (let index = 0; index < MAX_REMEMBERED_MANGAS + 3; index += 1) {
            saveReaderPrefs({ ...single, autoScrollSpeed: 10 + index }, `Manga ${String(index)}`);
        }
        const kept = JSON.parse(window.localStorage.getItem(PREFS_BY_MANGA_KEY) ?? '{}') as Record<string, unknown>;
        expect(Object.keys(kept)).toHaveLength(MAX_REMEMBERED_MANGAS);
        expect(kept['Manga 0']).toBeUndefined();
        expect(kept['Manga 2']).toBeUndefined();
        expect(kept['Manga 3']).toBeDefined();
        expect(kept[`Manga ${String(MAX_REMEMBERED_MANGAS + 2)}`]).toBeDefined();
    });

    it('put a manga that is set again at the end, so it is the last to go', () => {
        saveReaderPrefs(single, 'First');
        saveReaderPrefs(single, 'Second');
        saveReaderPrefs(webtoon, 'First');
        expect(Object.keys(JSON.parse(window.localStorage.getItem(PREFS_BY_MANGA_KEY) ?? '{}') as Record<string, unknown>)).toEqual(['Second', 'First']);
    });

    it('are not kept, with no error, when the storage refuses', () => {
        const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('full');
        });
        try {
            expect(() => {
                saveReaderPrefs(webtoon, 'One Piece');
            }).not.toThrow();
        } finally {
            refuse.mockRestore();
        }
        expect(loadReaderPrefs('One Piece')).toEqual(DEFAULT_READER_PREFS);
    });
});

describe('hasReadUnderTitle', () => {
    const KEYS = [progressKey('New Title', 11), progressKey('One Piece', 12)];

    it('is true when one of the chapters is read under the title', () => {
        expect(hasReadUnderTitle(KEYS, 'New Title', [10, 11])).toBe(true);
    });

    it('is false when the chapters are read only under another title', () => {
        expect(hasReadUnderTitle(KEYS, 'New Title', [12])).toBe(false);
    });

    it('is false when none of the chapters is read, or there is no chapter', () => {
        expect(hasReadUnderTitle(KEYS, 'New Title', [13, 14])).toBe(false);
        expect(hasReadUnderTitle(KEYS, 'New Title', [])).toBe(false);
        expect(hasReadUnderTitle([], 'New Title', [11])).toBe(false);
    });
});

describe('orphanReadIds', () => {
    it('gives once each chapter read under one of the titles that no known chapter has', () => {
        const keys = [progressKey('Old Title', 1), progressKey('Old Title', 2), progressKey('New Title', 3), progressKey('New Title', 1), progressKey('Other', 4)];
        expect(orphanReadIds(keys, ['Old Title', 'New Title'], new Set([2]))).toEqual([1, 3]);
    });

    it('reads the title of a key up to its last bar', () => {
        expect(orphanReadIds([progressKey('A | B', 5)], ['A | B'], new Set())).toEqual([5]);
    });

    it('ignores keys that are not a title and a chapter id', () => {
        expect(orphanReadIds(['Old Title', 'Old Title|', 'Old Title|x', 'Old Title|0', 'Old Title|-2', 'Old Title|1.5', '|7'], ['Old Title', ''], new Set())).toEqual([]);
    });

    it('gives nothing when every chapter is known, or without titles', () => {
        expect(orphanReadIds([progressKey('Old Title', 1)], ['Old Title'], new Set([1]))).toEqual([]);
        expect(orphanReadIds([progressKey('Old Title', 1)], [], new Set())).toEqual([]);
    });
});

describe('copiedReadKeys', () => {
    const MOVES = [
        { from: 1, to: 101 },
        { from: 2, to: 102 }
    ];

    it('adds the key of each chapter read to its new title and id, keeping every key there was', () => {
        const keys = [progressKey('Other', 1), progressKey('Old', 1), progressKey('Old', 3), progressKey('Old', 2)];
        expect(copiedReadKeys(keys, 'Old', 'New', MOVES)).toEqual([progressKey('Other', 1), progressKey('Old', 1), progressKey('Old', 3), progressKey('Old', 2), progressKey('New', 101), progressKey('New', 102)]);
    });

    it('does not add a key that is there already, and adds nothing for a chapter not read', () => {
        const keys = [progressKey('New', 101), progressKey('Old', 1)];
        expect(copiedReadKeys(keys, 'Old', 'New', MOVES)).toEqual([progressKey('New', 101), progressKey('Old', 1)]);
    });

    it('copies under the same title, and changes nothing without moves', () => {
        expect(copiedReadKeys([progressKey('Same', 1)], 'Same', 'Same', MOVES)).toEqual([progressKey('Same', 1), progressKey('Same', 101)]);
        expect(copiedReadKeys([progressKey('Old', 1)], 'Old', 'New', [])).toEqual([progressKey('Old', 1)]);
    });
});

describe('copyChapterProgress', () => {
    const MOVES = [
        { from: 1, to: 101 },
        { from: 2, to: 102 }
    ];

    it('copies the page each chapter was left on, keeping the one there already and every page there was', () => {
        saveProgress(progressKey('Old', 1), 3);
        saveProgress(progressKey('Old', 2), 5);
        saveProgress(progressKey('New', 102), 8);
        copyChapterProgress('Old', 'New', MOVES);
        expect(JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? '{}')).toEqual({ [progressKey('Old', 1)]: 3, [progressKey('Old', 2)]: 5, [progressKey('New', 102)]: 8, [progressKey('New', 101)]: 3 });
    });

    it('writes nothing when there is nothing to copy', () => {
        saveProgress(progressKey('New', 101), 8);
        const write = vi.spyOn(Storage.prototype, 'setItem');
        copyChapterProgress('Old', 'New', MOVES);
        copyChapterProgress('New', 'New', [{ from: 101, to: 101 }]);
        expect(write).not.toHaveBeenCalled();
        write.mockRestore();
    });

    it('does not fail when the browser refuses to keep it', () => {
        saveProgress(progressKey('Old', 1), 3);
        const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('full');
        });
        try {
            expect(() => {
                copyChapterProgress('Old', 'New', MOVES);
            }).not.toThrow();
        } finally {
            write.mockRestore();
        }
        expect(loadProgress(progressKey('New', 101))).toBe(0);
    });
});

describe('movedReadKeys', () => {
    const MOVES = [
        { from: 1, to: 101 },
        { from: 2, to: 102 }
    ];

    it('gives each moved chapter its new title and id in its place, and keeps everything else as it is', () => {
        const keys = [progressKey('Other', 1), progressKey('Old', 1), progressKey('Old', 3), progressKey('Old', 2)];
        expect(movedReadKeys(keys, 'Old', 'New', MOVES)).toEqual([progressKey('Other', 1), progressKey('New', 101), progressKey('Old', 3), progressKey('New', 102)]);
    });

    it('keeps one key when the chapter was read under both titles', () => {
        const keys = [progressKey('New', 101), progressKey('Old', 1), progressKey('Old', 2)];
        expect(movedReadKeys(keys, 'Old', 'New', MOVES)).toEqual([progressKey('New', 101), progressKey('New', 102)]);
    });

    it('moves the chapters to the new title when they keep their ids', () => {
        const keys = [progressKey('Old', 1), progressKey('New', 1)];
        expect(
            movedReadKeys(keys, 'Old', 'New', [
                { from: 1, to: 1 },
                { from: 2, to: 2 }
            ])
        ).toEqual([progressKey('New', 1)]);
    });

    it('moves the ids under the same title', () => {
        expect(movedReadKeys([progressKey('Same', 1)], 'Same', 'Same', MOVES)).toEqual([progressKey('Same', 101)]);
    });

    it('changes nothing without moves', () => {
        const keys = [progressKey('Old', 1)];
        expect(movedReadKeys(keys, 'Old', 'New', [])).toEqual(keys);
    });
});

describe('moveMangaReading', () => {
    const MOVES = [
        { from: 1, to: 101 },
        { from: 2, to: 102 }
    ];

    function stored(key: string): unknown {
        return JSON.parse(window.localStorage.getItem(key) ?? 'null') as unknown;
    }

    it('moves the page each chapter was left on, keeping the one already under the new title and what is not moved', () => {
        saveProgress(progressKey('Other', 1), 7);
        saveProgress(progressKey('Old', 1), 3);
        saveProgress(progressKey('Old', 2), 5);
        saveProgress(progressKey('Old', 9), 6);
        saveProgress(progressKey('New', 102), 8);
        moveMangaReading('Old', 'New', MOVES);
        expect(stored(PROGRESS_KEY)).toEqual({ [progressKey('Other', 1)]: 7, [progressKey('New', 101)]: 3, [progressKey('Old', 9)]: 6, [progressKey('New', 102)]: 8 });
    });

    it('moves the last chapter and the last position to the new title with the new id', () => {
        saveLastChapter('Other', 1);
        saveLastChapter('Old', 2);
        saveLastPosition('Old', 1, 4);
        moveMangaReading('Old', 'New', MOVES);
        expect(stored(LAST_CHAPTER_KEY)).toEqual({ Other: 1, New: 102 });
        expect(stored(LAST_PAGE_KEY)).toEqual({ New: { chapterRemoteId: 101, page: 4 } });
    });

    it('keeps the last chapter and the last position already under the new title, and drops the old ones', () => {
        saveLastChapter('New', 105);
        saveLastChapter('Old', 2);
        saveLastPosition('New', 105, 9);
        saveLastPosition('Old', 1, 4);
        moveMangaReading('Old', 'New', MOVES);
        expect(stored(LAST_CHAPTER_KEY)).toEqual({ New: 105 });
        expect(stored(LAST_PAGE_KEY)).toEqual({ New: { chapterRemoteId: 105, page: 9 } });
    });

    it('leaves the last chapter and the last position alone when their chapter is not moved', () => {
        saveLastChapter('Old', 9);
        saveLastPosition('Old', 9, 2);
        moveMangaReading('Old', 'New', MOVES);
        expect(stored(LAST_CHAPTER_KEY)).toEqual({ Old: 9 });
        expect(stored(LAST_PAGE_KEY)).toEqual({ Old: { chapterRemoteId: 9, page: 2 } });
        expect(loadLastChapter('New')).toBeNull();
    });

    it('moves the ids of the last chapter and the last position under the same title', () => {
        saveLastChapter('Same', 1);
        saveLastPosition('Same', 2, 3);
        moveMangaReading('Same', 'Same', MOVES);
        expect(stored(LAST_CHAPTER_KEY)).toEqual({ Same: 101 });
        expect(stored(LAST_PAGE_KEY)).toEqual({ Same: { chapterRemoteId: 102, page: 3 } });
    });

    it('moves the reader preferences of the manga to the new title, unless the new title has its own', () => {
        const webtoon = { ...DEFAULT_READER_PREFS, mode: 'webtoon' as const };
        const vertical = { ...DEFAULT_READER_PREFS, mode: 'vertical' as const };
        saveReaderPrefs(webtoon, 'Old');
        moveMangaReading('Old', 'New', MOVES);
        expect(stored(PREFS_BY_MANGA_KEY)).toEqual({ New: webtoon });
        saveReaderPrefs(webtoon, 'Old');
        saveReaderPrefs(vertical, 'New');
        moveMangaReading('Old', 'New', MOVES);
        expect(stored(PREFS_BY_MANGA_KEY)).toEqual({ New: vertical });
    });

    it('leaves the reader preferences alone under the same title', () => {
        const webtoon = { ...DEFAULT_READER_PREFS, mode: 'webtoon' as const };
        saveReaderPrefs(webtoon, 'Same');
        moveMangaReading('Same', 'Same', MOVES);
        expect(stored(PREFS_BY_MANGA_KEY)).toEqual({ Same: webtoon });
    });

    it('writes only the pages left on when nothing else is kept', () => {
        const write = vi.spyOn(Storage.prototype, 'setItem');
        moveMangaReading('Old', 'New', MOVES);
        expect(write.mock.calls).toEqual([[PROGRESS_KEY, '{}']]);
        write.mockRestore();
        expect(stored(LAST_CHAPTER_KEY)).toBeNull();
        expect(stored(LAST_PAGE_KEY)).toBeNull();
        expect(stored(PREFS_BY_MANGA_KEY)).toBeNull();
    });

    it('does not fail when the browser refuses to keep it', () => {
        saveProgress(progressKey('Old', 1), 3);
        const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('full');
        });
        try {
            expect(() => {
                moveMangaReading('Old', 'New', MOVES);
            }).not.toThrow();
        } finally {
            write.mockRestore();
        }
        expect(loadProgress(progressKey('Old', 1))).toBe(3);
    });
});
