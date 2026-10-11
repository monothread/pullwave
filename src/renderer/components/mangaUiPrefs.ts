import { ALL_LANGUAGES } from './mangaText';

// What the manga section remembers of the choices made on its screens: the language of the sources and of the extensions, and whether
// only the installed extensions are listed. It lives in the storage of the window, which can be empty or refuse to be read: the section
// then starts from its defaults.

export interface MangaUiPrefs {
    sourceLanguage: string;
    extensionLanguage: string;
    onlyInstalled: boolean;
}

export const DEFAULT_MANGA_UI_PREFS: MangaUiPrefs = { sourceLanguage: ALL_LANGUAGES, extensionLanguage: ALL_LANGUAGES, onlyInstalled: true };

export const MANGA_UI_PREFS_KEY = 'pullwave.manga.ui';

function pickText(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

export function loadMangaUiPrefs(): MangaUiPrefs {
    try {
        const raw = JSON.parse(window.localStorage.getItem(MANGA_UI_PREFS_KEY) ?? '{}') as Record<string, unknown>;
        return {
            sourceLanguage: pickText(raw['sourceLanguage'], DEFAULT_MANGA_UI_PREFS.sourceLanguage),
            extensionLanguage: pickText(raw['extensionLanguage'], DEFAULT_MANGA_UI_PREFS.extensionLanguage),
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
