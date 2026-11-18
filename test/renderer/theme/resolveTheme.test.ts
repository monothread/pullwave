// @vitest-environment jsdom
import { applyTheme, DARK_SCHEME_QUERY, rememberedTheme, rememberTheme, systemPrefersDark, THEME_STORAGE_KEY } from '@renderer/theme/resolveTheme';
import { THEME_FAMILIES, THEME_STYLES } from '@shared/constants';
import type { ThemeChoice } from '@shared/types';

function mockSystem(dark: boolean): ReturnType<typeof vi.fn> {
    const matchMedia = vi.fn((query: string) => {
        return { media: query, matches: dark };
    });
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: matchMedia });
    return matchMedia;
}

function rootTheme(): [string | undefined, string | undefined, string | undefined] {
    const { theme, themeStyle, themeScheme } = document.documentElement.dataset;
    return [theme, themeStyle, themeScheme];
}

const DEFAULT_CHOICE: ThemeChoice = { themeMode: 'device', themeFamily: 'default' };
const NORD_CHOICE: ThemeChoice = { themeMode: 'device', themeFamily: 'nord' };

afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.themeStyle;
    delete document.documentElement.dataset.themeScheme;
    vi.restoreAllMocks();
});

describe('systemPrefersDark', () => {
    it('asks the dark color scheme query', () => {
        const matchMedia = mockSystem(true);
        expect(systemPrefersDark()).toBe(true);
        expect(matchMedia).toHaveBeenCalledWith(DARK_SCHEME_QUERY);
        expect(DARK_SCHEME_QUERY).toBe('(prefers-color-scheme: dark)');
    });

    it('is false for a light system', () => {
        mockSystem(false);
        expect(systemPrefersDark()).toBe(false);
    });

    it('is false when matchMedia does not exist', () => {
        expect(systemPrefersDark()).toBe(false);
    });
});

describe('applyTheme', () => {
    it('follows a dark system with the dark theme of the family, and returns it', () => {
        mockSystem(true);
        expect(applyTheme(NORD_CHOICE)).toBe('nord');
        expect(rootTheme()).toEqual(['nord', 'flat', 'dark']);
    });

    it('follows a light system with the light theme of the family, and returns it', () => {
        mockSystem(false);
        expect(applyTheme(NORD_CHOICE)).toBe('nord-light');
        expect(rootTheme()).toEqual(['nord-light', 'flat', 'light']);
    });

    it('uses the light theme of the family when the system mode cannot be read', () => {
        expect(applyTheme(NORD_CHOICE)).toBe('nord-light');
    });

    it('keeps the dark theme in the dark mode, whatever the system says', () => {
        mockSystem(false);
        expect(applyTheme({ themeMode: 'dark', themeFamily: 'nord' })).toBe('nord');
        expect(rootTheme()).toEqual(['nord', 'flat', 'dark']);
    });

    it('keeps the light theme in the light mode, whatever the system says', () => {
        mockSystem(true);
        expect(applyTheme({ themeMode: 'light', themeFamily: 'nord' })).toBe('nord-light');
        expect(rootTheme()).toEqual(['nord-light', 'flat', 'light']);
    });

    it.each(THEME_FAMILIES)('puts the dark theme of the $id family on the document with its style and the dark scheme', ({ id, dark }) => {
        applyTheme({ themeMode: 'dark', themeFamily: id });
        expect(rootTheme()).toEqual([dark, THEME_STYLES[dark], 'dark']);
    });

    it.each(THEME_FAMILIES)('puts the light theme of the $id family on the document with its style and the light scheme', ({ id, light }) => {
        applyTheme({ themeMode: 'light', themeFamily: id });
        expect(rootTheme()).toEqual([light, THEME_STYLES[light], 'light']);
    });

    it('gives the light version of a neon family the neon style', () => {
        applyTheme({ themeMode: 'light', themeFamily: 'cyberpunk' });
        expect(rootTheme()).toEqual(['cyberpunk-light', 'neon', 'light']);
    });
});

describe('remembering the theme', () => {
    it('stores the whole choice and reads it back', () => {
        rememberTheme(NORD_CHOICE);
        expect(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) ?? '')).toEqual(NORD_CHOICE);
        expect(rememberedTheme()).toEqual(NORD_CHOICE);
    });

    it('has no choice when nothing is stored, so no theme is guessed before the settings load', () => {
        expect(rememberedTheme()).toBeNull();
    });

    it.each([
        ['nord', { themeMode: 'dark', themeFamily: 'nord' }],
        ['sakura', { themeMode: 'light', themeFamily: 'sakura' }],
        ['sakura-dark', { themeMode: 'dark', themeFamily: 'sakura' }],
        ['light', { themeMode: 'light', themeFamily: 'default' }],
        ['device', { themeMode: 'device', themeFamily: 'default' }]
    ] as const)('reads the theme %s stored by an older version as its mode and family', (stored, choice) => {
        window.localStorage.setItem(THEME_STORAGE_KEY, stored);
        expect(rememberedTheme()).toEqual(choice);
    });

    it.each(['solarized', '42', 'null', '"nord"', '[1]'])('falls back to the default choice when %s is stored', (stored) => {
        window.localStorage.setItem(THEME_STORAGE_KEY, stored);
        expect(rememberedTheme()).toEqual(DEFAULT_CHOICE);
    });

    it('cleans a stored choice with an unknown family', () => {
        window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ themeMode: 'light', themeFamily: 'solarized' }));
        expect(rememberedTheme()).toEqual({ themeMode: 'light', themeFamily: 'default' });
    });

    it('does not fail when the storage cannot be used, and has no choice then', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(() => {
            rememberTheme(NORD_CHOICE);
        }).not.toThrow();
        expect(rememberedTheme()).toBeNull();
    });
});
