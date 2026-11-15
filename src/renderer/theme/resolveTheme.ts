import { THEME_STYLES, THEMES } from '@shared/constants';
import type { ThemeName } from '@shared/types';

export type AppliedTheme = Exclude<ThemeName, 'device'>;

export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';
export const THEME_STORAGE_KEY = 'cyber-dl-theme';

export function resolveTheme(theme: ThemeName, systemPrefersDark: boolean): AppliedTheme {
    if (theme === 'device') {
        return systemPrefersDark ? 'dark' : 'light';
    }
    return theme;
}

export function systemPrefersDark(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia(DARK_SCHEME_QUERY).matches;
}

export function applyTheme(theme: ThemeName): void {
    const applied = resolveTheme(theme, systemPrefersDark());
    document.documentElement.dataset.theme = applied;
    document.documentElement.dataset.themeStyle = THEME_STYLES[applied];
}

export function rememberTheme(theme: ThemeName): void {
    try {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
        // Storage can be unavailable; the theme is then applied once the settings load.
    }
}

export function rememberedTheme(): ThemeName {
    try {
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
        return THEMES.find((theme) => {
            return theme === stored;
        }) ?? 'device';
    } catch {
        return 'device';
    }
}
