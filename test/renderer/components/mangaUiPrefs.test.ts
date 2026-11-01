// @vitest-environment jsdom
import { DEFAULT_MANGA_UI_PREFS, loadMangaUiPrefs, MANGA_UI_PREFS_KEY, saveMangaUiPrefs } from '@renderer/components/mangaUiPrefs';

beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
});

describe('manga screen preferences', () => {
    it('start from only the installed extensions', () => {
        expect(DEFAULT_MANGA_UI_PREFS).toEqual({ onlyInstalled: true });
        expect(loadMangaUiPrefs()).toEqual(DEFAULT_MANGA_UI_PREFS);
    });

    it('are kept and read back', () => {
        saveMangaUiPrefs({ onlyInstalled: false });
        expect(window.localStorage.getItem(MANGA_UI_PREFS_KEY)).toBe('{"onlyInstalled":false}');
        expect(loadMangaUiPrefs()).toEqual({ onlyInstalled: false });
    });

    it('keep what was not given when only one choice changes', () => {
        saveMangaUiPrefs({ onlyInstalled: false });
        saveMangaUiPrefs({});
        expect(loadMangaUiPrefs()).toEqual({ onlyInstalled: false });
    });

    it('leave out the languages that older versions kept: the language is a setting of the app now', () => {
        window.localStorage.setItem(MANGA_UI_PREFS_KEY, JSON.stringify({ sourceLanguage: 'pt', extensionLanguage: 'en', onlyInstalled: false }));
        expect(loadMangaUiPrefs()).toEqual({ onlyInstalled: false });
    });

    it('fall back to the default for each value that is not valid', () => {
        window.localStorage.setItem(MANGA_UI_PREFS_KEY, JSON.stringify({ onlyInstalled: 'yes' }));
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
