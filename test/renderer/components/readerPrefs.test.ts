// @vitest-environment jsdom
import {
    DEFAULT_READER_PREFS,
    loadProgress,
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
        expect(loadReaderPrefs()).toEqual({ mode: 'single', direction: 'ltr', scale: 'screen', background: 'dark' });
        expect(DEFAULT_READER_PREFS).toEqual({ mode: 'single', direction: 'ltr', scale: 'screen', background: 'dark' });
    });

    it('are kept and read back', () => {
        saveReaderPrefs({ mode: 'webtoon', direction: 'rtl', scale: 'width', background: 'black' });
        expect(window.localStorage.getItem(PREFS_KEY)).toBe('{"mode":"webtoon","direction":"rtl","scale":"width","background":"black"}');
        expect(loadReaderPrefs()).toEqual({ mode: 'webtoon', direction: 'rtl', scale: 'width', background: 'black' });
    });

    it('fall back to the default for each value that is not valid', () => {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: 'vertical', direction: 'up', scale: 5, background: null }));
        expect(loadReaderPrefs()).toEqual({ mode: 'vertical', direction: 'ltr', scale: 'screen', background: 'dark' });
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
