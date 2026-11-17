import { DARK_THEMES, DEFAULT_SETTINGS, THEME_FAMILY_BY_ID, THEME_FAMILY_IDS, THEME_FAMILY_OF, THEME_MODES, THEMES } from './constants';
import type { DarkThemeName, ThemeChoice, ThemeName, ThemeScheme } from './types';

export const DEFAULT_THEME_CHOICE: Readonly<ThemeChoice> = {
    themeMode: DEFAULT_SETTINGS.themeMode,
    themeFamily: DEFAULT_SETTINGS.themeFamily
};

const DARK_THEME_SET: ReadonlySet<ThemeName> = new Set(DARK_THEMES);

function findAllowed<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
    return allowed.find((candidate) => {
        return candidate === value;
    });
}

export function isDarkTheme(theme: ThemeName): theme is DarkThemeName {
    return DARK_THEME_SET.has(theme);
}

export function themeScheme(theme: ThemeName): ThemeScheme {
    return isDarkTheme(theme) ? 'dark' : 'light';
}

export function themeChoiceOf(theme: ThemeName): ThemeChoice {
    return { themeMode: themeScheme(theme), themeFamily: THEME_FAMILY_OF[theme] };
}

function choiceFromLegacyTheme(legacyTheme: unknown): ThemeChoice {
    const theme = findAllowed(THEMES, legacyTheme);
    return theme === undefined ? { ...DEFAULT_THEME_CHOICE } : themeChoiceOf(theme);
}

export function sanitizeThemeChoice(raw: Readonly<Record<string, unknown>>): ThemeChoice {
    const themeMode = findAllowed(THEME_MODES, raw.themeMode);
    if (themeMode === undefined) {
        return choiceFromLegacyTheme(raw.theme);
    }
    return { themeMode, themeFamily: findAllowed(THEME_FAMILY_IDS, raw.themeFamily) ?? DEFAULT_THEME_CHOICE.themeFamily };
}

export function resolveThemeChoice(choice: ThemeChoice, systemPrefersDark: boolean): ThemeName {
    const scheme: ThemeScheme = choice.themeMode === 'device' ? (systemPrefersDark ? 'dark' : 'light') : choice.themeMode;
    const family = THEME_FAMILY_BY_ID[choice.themeFamily];
    return scheme === 'dark' ? family.dark : family.light;
}
