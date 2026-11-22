import {
    DARK_THEMES,
    DEFAULT_SETTINGS,
    LIGHT_THEMES,
    THEME_FAMILIES,
    THEME_FAMILY_BY_ID,
    THEME_FAMILY_IDS,
    THEME_FAMILY_OF,
    THEME_MODES,
    THEME_STYLES,
    THEMES
} from '@shared/constants';
import { DEFAULT_THEME_CHOICE, isDarkTheme, resolveThemeChoice, sanitizeThemeChoice, themeChoiceOf, themeScheme } from '@shared/themeChoice';
import type { ThemeMode } from '@shared/types';

const EXPECTED_FAMILIES = [
    { id: 'cyberpunk', dark: 'cyberpunk', light: 'cyberpunk-light', style: 'neon' },
    { id: 'synthwave', dark: 'synthwave', light: 'synthwave-light', style: 'neon' },
    { id: 'terminal', dark: 'terminal', light: 'terminal-light', style: 'neon' },
    { id: 'neon-tokyo', dark: 'neon-tokyo', light: 'neon-tokyo-light', style: 'neon' },
    { id: 'acid-rain', dark: 'acid-rain', light: 'acid-rain-light', style: 'neon' },
    { id: 'amber-city', dark: 'amber-city', light: 'amber-city-light', style: 'neon' },
    { id: 'ultraviolet', dark: 'ultraviolet', light: 'ultraviolet-light', style: 'neon' },
    { id: 'ultramagenta', dark: 'ultramagenta', light: 'ultramagenta-light', style: 'neon' },
    { id: 'pink-noir', dark: 'pink-noir', light: 'pink-noir-light', style: 'neon' },
    { id: 'cyber-gold', dark: 'cyber-gold', light: 'cyber-gold-light', style: 'neon' },
    { id: 'ice-neon', dark: 'ice-neon', light: 'ice-neon-light', style: 'neon' },
    { id: 'default', dark: 'dark', light: 'light', style: 'flat' },
    { id: 'tokyo-night', dark: 'tokyo-night', light: 'tokyo-night-light', style: 'flat' },
    { id: 'nord', dark: 'nord', light: 'nord-light', style: 'flat' },
    { id: 'dracula', dark: 'dracula', light: 'dracula-light', style: 'flat' },
    { id: 'gruvbox', dark: 'gruvbox', light: 'gruvbox-light', style: 'flat' },
    { id: 'amoled', dark: 'amoled', light: 'amoled-light', style: 'flat' },
    { id: 'high-contrast', dark: 'high-contrast', light: 'high-contrast-light', style: 'flat' },
    { id: 'sakura', dark: 'sakura-dark', light: 'sakura', style: 'flat' }
] as const;

const NEON_FAMILIES = ['cyberpunk', 'synthwave', 'terminal', 'neon-tokyo', 'acid-rain', 'amber-city', 'ultraviolet', 'ultramagenta', 'pink-noir', 'cyber-gold', 'ice-neon'];

describe('the theme families', () => {
    it('has nineteen families, each with its dark and its light theme, in the order of the list', () => {
        expect(THEME_FAMILIES).toEqual(EXPECTED_FAMILIES);
        expect(THEME_FAMILY_IDS).toEqual(
            EXPECTED_FAMILIES.map((family) => {
                return family.id;
            })
        );
    });

    it('lists the dark themes and the light themes in the order of the families, thirty-eight themes in all, none of them twice', () => {
        expect(DARK_THEMES).toEqual(
            EXPECTED_FAMILIES.map((family) => {
                return family.dark;
            })
        );
        expect(LIGHT_THEMES).toEqual(
            EXPECTED_FAMILIES.map((family) => {
                return family.light;
            })
        );
        expect(THEMES).toEqual([...DARK_THEMES, ...LIGHT_THEMES]);
        expect(new Set(THEMES).size).toBe(38);
    });

    it.each(EXPECTED_FAMILIES)('finds the $id family by its id, and finds it back from $dark and from $light', (family) => {
        expect(THEME_FAMILY_BY_ID[family.id]).toEqual(family);
        expect(THEME_FAMILY_OF[family.dark]).toBe(family.id);
        expect(THEME_FAMILY_OF[family.light]).toBe(family.id);
    });

    it('knows the family of every theme and of nothing else', () => {
        expect(Object.keys(THEME_FAMILY_OF).sort()).toEqual([...THEMES].sort());
        expect(Object.keys(THEME_FAMILY_BY_ID).sort()).toEqual([...THEME_FAMILY_IDS].sort());
    });

    it.each(EXPECTED_FAMILIES)('gives both themes of the $id family the $style style of the family', ({ id, dark, light, style }) => {
        expect(style).toBe(NEON_FAMILIES.includes(id) ? 'neon' : 'flat');
        expect(THEME_STYLES[dark]).toBe(style);
        expect(THEME_STYLES[light]).toBe(style);
    });

    it('has a style for every theme and for nothing else', () => {
        expect(Object.keys(THEME_STYLES).sort()).toEqual([...THEMES].sort());
    });

    it('offers following the system, dark and light as the modes', () => {
        expect(THEME_MODES).toEqual(['device', 'dark', 'light']);
    });
});

describe('DEFAULT_THEME_CHOICE', () => {
    it('is the theme part of the default settings: follow the system, with the default family', () => {
        expect(DEFAULT_THEME_CHOICE).toEqual({ themeMode: 'device', themeFamily: 'default' });
        expect(DEFAULT_THEME_CHOICE).toEqual({ themeMode: DEFAULT_SETTINGS.themeMode, themeFamily: DEFAULT_SETTINGS.themeFamily });
    });
});

describe('isDarkTheme and themeScheme', () => {
    it.each(DARK_THEMES)('say %s is dark', (theme) => {
        expect(isDarkTheme(theme)).toBe(true);
        expect(themeScheme(theme)).toBe('dark');
    });

    it.each(LIGHT_THEMES)('say %s is light', (theme) => {
        expect(isDarkTheme(theme)).toBe(false);
        expect(themeScheme(theme)).toBe('light');
    });
});

describe('themeChoiceOf', () => {
    it.each(EXPECTED_FAMILIES)('gives the dark mode of the $id family for $dark and its light mode for $light', ({ id, dark, light }) => {
        expect(themeChoiceOf(dark)).toEqual({ themeMode: 'dark', themeFamily: id });
        expect(themeChoiceOf(light)).toEqual({ themeMode: 'light', themeFamily: id });
    });

    it('gives a new object each time', () => {
        expect(themeChoiceOf('nord')).not.toBe(themeChoiceOf('nord'));
    });
});

describe('sanitizeThemeChoice', () => {
    it.each(THEME_MODES)('keeps the %s mode with the chosen family', (themeMode) => {
        expect(sanitizeThemeChoice({ themeMode, themeFamily: 'nord' })).toEqual({ themeMode, themeFamily: 'nord' });
    });

    it.each(THEME_FAMILY_IDS)('keeps the %s family', (themeFamily) => {
        expect(sanitizeThemeChoice({ themeMode: 'dark', themeFamily })).toEqual({ themeMode: 'dark', themeFamily });
    });

    it('returns only the theme fields', () => {
        expect(sanitizeThemeChoice({ themeMode: 'light', themeFamily: 'nord', language: 'pt', theme: 'sakura' })).toEqual({ themeMode: 'light', themeFamily: 'nord' });
    });

    it.each([undefined, 'solarized', 'nord-light', 'dark', 'light', 7])('puts back the default family when it is %j', (themeFamily) => {
        expect(sanitizeThemeChoice({ themeMode: 'dark', themeFamily })).toEqual({ themeMode: 'dark', themeFamily: 'default' });
    });

    it.each(EXPECTED_FAMILIES)('turns the old theme $dark into the dark mode of the $id family', ({ id, dark }) => {
        expect(sanitizeThemeChoice({ theme: dark })).toEqual({ themeMode: 'dark', themeFamily: id });
    });

    it.each(EXPECTED_FAMILIES)('turns the old theme $light into the light mode of the $id family', ({ id, light }) => {
        expect(sanitizeThemeChoice({ theme: light })).toEqual({ themeMode: 'light', themeFamily: id });
    });

    it.each(['device', 'solarized', 'Nord', 'default', 3, null, undefined])('turns the old theme %j into the default choice', (theme) => {
        expect(sanitizeThemeChoice({ theme })).toEqual({ themeMode: 'device', themeFamily: 'default' });
    });

    it('uses the old theme when the mode is missing or unknown, and ignores a family saved beside it', () => {
        expect(sanitizeThemeChoice({ theme: 'gruvbox', themeFamily: 'nord' })).toEqual({ themeMode: 'dark', themeFamily: 'gruvbox' });
        expect(sanitizeThemeChoice({ theme: 'sakura', themeMode: 'auto' })).toEqual({ themeMode: 'light', themeFamily: 'sakura' });
    });

    it('gives a new object each time, so the default choice is never changed by a caller', () => {
        const first = sanitizeThemeChoice({});
        first.themeFamily = 'nord';
        expect(sanitizeThemeChoice({})).toEqual({ themeMode: 'device', themeFamily: 'default' });
        expect(DEFAULT_THEME_CHOICE.themeFamily).toBe('default');
    });
});

describe('resolveThemeChoice', () => {
    it.each([
        ['device', true, 'dracula'],
        ['device', false, 'dracula-light'],
        ['dark', true, 'dracula'],
        ['dark', false, 'dracula'],
        ['light', true, 'dracula-light'],
        ['light', false, 'dracula-light']
    ] as const)('resolves the %s mode with a system that prefers dark = %s to %s', (themeMode: ThemeMode, systemPrefersDark, expected) => {
        expect(resolveThemeChoice({ themeMode, themeFamily: 'dracula' }, systemPrefersDark)).toBe(expected);
    });

    it.each(EXPECTED_FAMILIES)('resolves the $id family to $dark in the dark mode and to $light in the light mode', ({ id, dark, light }) => {
        expect(resolveThemeChoice({ themeMode: 'dark', themeFamily: id }, false)).toBe(dark);
        expect(resolveThemeChoice({ themeMode: 'light', themeFamily: id }, true)).toBe(light);
    });
});
