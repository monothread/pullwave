// @vitest-environment jsdom
import {
    applyTheme,
    DARK_SCHEME_QUERY,
    rememberedTheme,
    rememberTheme,
    resolveTheme,
    systemPrefersDark,
    THEME_STORAGE_KEY
} from '@renderer/theme/resolveTheme';
import { THEME_STYLES, THEMES } from '@shared/constants';

function mockSystem(dark: boolean): ReturnType<typeof vi.fn> {
    const matchMedia = vi.fn((query: string) => {
        return { media: query, matches: dark };
    });
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: matchMedia });
    return matchMedia;
}

afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.themeStyle;
    vi.restoreAllMocks();
});

describe('resolveTheme', () => {
    it.each([
        ['device', true, 'dark'],
        ['device', false, 'light'],
        ['cyberpunk', true, 'cyberpunk'],
        ['cyberpunk', false, 'cyberpunk'],
        ['synthwave', true, 'synthwave'],
        ['terminal', false, 'terminal'],
        ['tokyo-night', false, 'tokyo-night'],
        ['nord', true, 'nord'],
        ['dracula', false, 'dracula'],
        ['gruvbox', true, 'gruvbox'],
        ['amoled', false, 'amoled'],
        ['high-contrast', true, 'high-contrast'],
        ['dark', false, 'dark'],
        ['light', true, 'light'],
        ['sakura', true, 'sakura']
    ] as const)('resolves %s with a system that prefers dark = %s to %s', (theme, dark, expected) => {
        expect(resolveTheme(theme, dark)).toBe(expected);
    });
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
    it('puts the resolved theme on the document', () => {
        mockSystem(true);
        applyTheme('device');
        expect(document.documentElement.dataset.theme).toBe('dark');
        applyTheme('light');
        expect(document.documentElement.dataset.theme).toBe('light');
        applyTheme('cyberpunk');
        expect(document.documentElement.dataset.theme).toBe('cyberpunk');
    });

    it.each([
        ['cyberpunk', 'neon'],
        ['synthwave', 'neon'],
        ['terminal', 'neon'],
        ['dark', 'flat'],
        ['tokyo-night', 'flat'],
        ['nord', 'flat'],
        ['dracula', 'flat'],
        ['gruvbox', 'flat'],
        ['amoled', 'flat'],
        ['high-contrast', 'flat'],
        ['light', 'flat'],
        ['sakura', 'flat']
    ] as const)('puts the %s theme on the document with the %s style', (theme, style) => {
        mockSystem(false);
        applyTheme(theme);
        expect(document.documentElement.dataset.theme).toBe(theme);
        expect(document.documentElement.dataset.themeStyle).toBe(style);
    });

    it('gives the device theme the style of the theme it follows', () => {
        mockSystem(true);
        applyTheme('device');
        expect([document.documentElement.dataset.theme, document.documentElement.dataset.themeStyle]).toEqual(['dark', 'flat']);
        mockSystem(false);
        applyTheme('device');
        expect([document.documentElement.dataset.theme, document.documentElement.dataset.themeStyle]).toEqual(['light', 'flat']);
    });

    it('has a style for every theme that can be applied, and none for device', () => {
        expect(Object.keys(THEME_STYLES).sort()).toEqual(
            THEMES.filter((theme) => {
                return theme !== 'device';
            }).sort()
        );
    });
});

describe('remembering the theme', () => {
    it('stores the chosen theme and reads it back', () => {
        rememberTheme('light');
        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
        expect(rememberedTheme()).toBe('light');
    });

    it.each(['synthwave', 'terminal', 'tokyo-night', 'nord', 'dracula', 'gruvbox', 'amoled', 'high-contrast', 'sakura'] as const)('stores %s and reads it back', (theme) => {
        rememberTheme(theme);
        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(theme);
        expect(rememberedTheme()).toBe(theme);
    });

    it('falls back to device when nothing or something unknown is stored', () => {
        expect(rememberedTheme()).toBe('device');
        window.localStorage.setItem(THEME_STORAGE_KEY, 'solarized');
        expect(rememberedTheme()).toBe('device');
    });

    it('does not fail when the storage cannot be used', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(() => {
            rememberTheme('dark');
        }).not.toThrow();
        expect(rememberedTheme()).toBe('device');
    });
});
