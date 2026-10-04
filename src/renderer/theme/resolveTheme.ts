import { THEME_STYLES, THEMES } from '@shared/constants';
import type { ThemeName } from '@shared/types';

export type AppliedTheme = Exclude<ThemeName, 'device'>;

export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';
export const THEME_STORAGE_KEY = 'cyber-dl-theme';

// "device" follows the light/dark choice of the operating system; the other themes are fixed.
export function resolveTheme(theme: ThemeName, systemPrefersDark: boolean): AppliedTheme {
    if (theme === 'device') {
        return systemPrefersDark ? 'dark' : 'light';
    }
    return theme;
}

export function systemPrefersDark(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia(DARK_SCHEME_QUERY).matches;
}

// The theme goes in data-theme and its style (neon or flat) in data-theme-style, which is what the shared rules of the CSS look at.
export function applyTheme(theme: ThemeName): void {
    const applied = resolveTheme(theme, systemPrefersDark());
    document.documentElement.dataset.theme = applied;
    document.documentElement.dataset.themeStyle = THEME_STYLES[applied];
}

// The last theme is kept outside the settings file so the first paint already uses it, instead of flashing the
// default until the settings arrive from the main process.
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
