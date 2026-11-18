import { THEME_STYLES } from '@shared/constants';
import { resolveThemeChoice, sanitizeThemeChoice, themeScheme } from '@shared/themeChoice';
import type { ThemeChoice, ThemeName } from '@shared/types';

export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';
export const THEME_STORAGE_KEY = 'cyber-dl-theme';

export function systemPrefersDark(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia(DARK_SCHEME_QUERY).matches;
}

export function applyTheme(choice: ThemeChoice): ThemeName {
    const applied = resolveThemeChoice(choice, systemPrefersDark());
    const root = document.documentElement;
    root.dataset.theme = applied;
    root.dataset.themeStyle = THEME_STYLES[applied];
    root.dataset.themeScheme = themeScheme(applied);
    return applied;
}

export function rememberTheme(choice: ThemeChoice): void {
    try {
        window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(choice));
    } catch {
        // Storage can be unavailable; the theme is then applied once the settings load.
    }
}

function parseStoredChoice(stored: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(stored);
        return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
        return { theme: stored };
    }
}

export function rememberedTheme(): ThemeChoice | null {
    try {
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
        return stored === null ? null : sanitizeThemeChoice(parseStoredChoice(stored));
    } catch {
        return null;
    }
}
