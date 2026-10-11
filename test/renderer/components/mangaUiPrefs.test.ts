// @vitest-environment jsdom
import { DEFAULT_MANGA_UI_PREFS, loadMangaUiPrefs, MANGA_UI_PREFS_KEY, saveMangaUiPrefs } from '@renderer/components/mangaUiPrefs';

beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
});

describe('manga screen preferences', () => {
    it('start from every language and only the installed extensions', () => {
        expect(DEFAULT_MANGA_UI_PREFS).toEqual({ sourceLanguage: 'all-languages', extensionLanguage: 'all-languages', onlyInstalled: true });
        expect(loadMangaUiPrefs()).toEqual(DEFAULT_MANGA_UI_PREFS);
    });

    it('are kept and read back', () => {
        saveMangaUiPrefs({ sourceLanguage: 'pt', extensionLanguage: 'en', onlyInstalled: false });
        expect(window.localStorage.getItem(MANGA_UI_PREFS_KEY)).toBe('{"sourceLanguage":"pt","extensionLanguage":"en","onlyInstalled":false}');
        expect(loadMangaUiPrefs()).toEqual({ sourceLanguage: 'pt', extensionLanguage: 'en', onlyInstalled: false });
    });

    it('keep what was not given when only one choice changes', () => {
        saveMangaUiPrefs({ sourceLanguage: 'pt' });
        saveMangaUiPrefs({ onlyInstalled: false });
        expect(loadMangaUiPrefs()).toEqual({ sourceLanguage: 'pt', extensionLanguage: 'all-languages', onlyInstalled: false });
    });

    it('fall back to the default for each value that is not valid', () => {
        window.localStorage.setItem(MANGA_UI_PREFS_KEY, JSON.stringify({ sourceLanguage: 5, extensionLanguage: '  ', onlyInstalled: 'yes' }));
        expect(loadMangaUiPrefs()).toEqual(DEFAULT_MANGA_UI_PREFS);
    });

    it('fall back to the defaults when the storage holds something that is not JSON', () => {
        window.localStorage.setItem(MANGA_UI_PREFS_KEY, '{oops');
        expect(loadMangaUiPrefs()).toEqual(DEFAULT_MANGA_UI_PREFS);
    });

    it('fall back to the defaults when the storage refuses to be read', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(loadMangaUiPrefs()).toEqual(DEFAULT_MANGA_UI_PREFS);
    });

    it('are not kept, without an error, when the storage refuses to be written', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('full');
        });
        expect(() => {
            saveMangaUiPrefs({ onlyInstalled: false });
        }).not.toThrow();
    });
});
