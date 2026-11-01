// What the manga section remembers of the choices made on its screens: whether only the installed extensions are listed (the language is
// a setting of the app, see `mangaLanguage`). It lives in the storage of the window, which can be empty or refuse to be read: the section
// then starts from its defaults.

export interface MangaUiPrefs {
    onlyInstalled: boolean;
}

export const DEFAULT_MANGA_UI_PREFS: MangaUiPrefs = { onlyInstalled: true };

export const MANGA_UI_PREFS_KEY = 'pullwave.manga.ui';

export function loadMangaUiPrefs(): MangaUiPrefs {
    try {
        const raw = JSON.parse(window.localStorage.getItem(MANGA_UI_PREFS_KEY) ?? '{}') as Record<string, unknown>;
        return {
            onlyInstalled: typeof raw['onlyInstalled'] === 'boolean' ? raw['onlyInstalled'] : DEFAULT_MANGA_UI_PREFS.onlyInstalled
        };
    } catch {
        return DEFAULT_MANGA_UI_PREFS;
    }
}

// Keeps the choices that were given; the others stay as they were.
export function saveMangaUiPrefs(changes: Partial<MangaUiPrefs>): void {
    try {
        window.localStorage.setItem(MANGA_UI_PREFS_KEY, JSON.stringify({ ...loadMangaUiPrefs(), ...changes }));
    } catch {
        // Not kept: the next time the section starts from its defaults.
    }
}
