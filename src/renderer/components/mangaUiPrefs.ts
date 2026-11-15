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

export function saveMangaUiPrefs(changes: Partial<MangaUiPrefs>): void {
    try {
        window.localStorage.setItem(MANGA_UI_PREFS_KEY, JSON.stringify({ ...loadMangaUiPrefs(), ...changes }));
    } catch {
        // Not kept: the next time the section starts from its defaults.
    }
}
