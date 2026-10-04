import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { THEME_STYLES, THEMES } from '@shared/constants';
import type { ThemeName } from '@shared/types';

const THEME_DIRECTORY = resolve(__dirname, '../../../src/renderer/theme');
const THEMES_CSS = readFileSync(resolve(THEME_DIRECTORY, 'themes.css'), 'utf-8');
const CYBERPUNK_CSS = readFileSync(resolve(THEME_DIRECTORY, 'cyberpunk.css'), 'utf-8');

type Variables = Record<string, string>;

// The themes written in themes.css (cyberpunk, the default one, is the :root of cyberpunk.css).
const LISTED = THEMES.filter((theme) => {
    return theme !== 'device' && theme !== 'cyberpunk';
}) as Array<Exclude<ThemeName, 'device' | 'cyberpunk'>>;

const LIGHT_THEMES: readonly ThemeName[] = ['light', 'sakura'];
const ACCENTS = ['--cyan', '--magenta', '--yellow', '--red', '--green'] as const;
const SURFACES = ['--bg', '--panel', '--panel-2', '--input-bg'] as const;
const MIN_CONTRAST = 4.5;

function variablesOf(css: string, selector: string): Variables {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) {
        return {};
    }
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
    const variables: Variables = {};
    body.split(';').forEach((declaration) => {
        const colon = declaration.indexOf(':');
        if (colon > 0) {
            variables[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
        }
    });
    return variables;
}

function themeVariables(theme: ThemeName): Variables {
    return theme === 'cyberpunk' ? variablesOf(CYBERPUNK_CSS, ':root') : variablesOf(THEMES_CSS, `:root[data-theme='${theme}']`);
}

function luminance(hex: string): number {
    const channels = [1, 3, 5].map((index) => {
        const value = parseInt(hex.slice(index, index + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (channels[0] as number) + 0.7152 * (channels[1] as number) + 0.0722 * (channels[2] as number);
}

function contrast(first: string, second: string): number {
    const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => {
        return b - a;
    });
    return ((lighter as number) + 0.05) / ((darker as number) + 0.05);
}

function color(variables: Variables, name: string): string {
    const value = variables[name] ?? '';
    expect(value, `${name} is a #rrggbb color`).toMatch(/^#[0-9a-f]{6}$/);
    return value;
}

describe('the themes in themes.css', () => {
    it('has a block for every theme of the list but device and cyberpunk, and no other', () => {
        const written = [...THEMES_CSS.matchAll(/^:root\[data-theme='([a-z-]+)'\] \{$/gm)].map((match) => {
            return match[1];
        });
        expect(written.sort()).toEqual([...LISTED].sort());
    });

    it('does not repeat a block', () => {
        LISTED.forEach((theme) => {
            expect(THEMES_CSS.split(`:root[data-theme='${theme}'] {`)).toHaveLength(2);
        });
    });

    it.each(LISTED)('%s defines every variable the dark theme does, and nothing else', (theme) => {
        expect(Object.keys(themeVariables(theme)).sort()).toEqual(Object.keys(themeVariables('dark')).sort());
    });

    it.each(LISTED)('%s has no variable that is empty', (theme) => {
        Object.entries(themeVariables(theme)).forEach(([name, value]) => {
            expect(value, name).not.toBe('');
        });
    });

    it.each(THEMES.filter((theme) => {
        return theme !== 'device';
    }))('%s tells the browser if it is light or dark', (theme) => {
        const scheme = themeVariables(theme)['color-scheme'];
        expect(scheme).toBe(LIGHT_THEMES.includes(theme) ? 'light' : 'dark');
    });
});

describe('the style of each theme', () => {
    it.each(LISTED.filter((theme) => {
        return THEME_STYLES[theme] === 'flat';
    }))('%s is flat: no glow, no scanlines and no cut corners', (theme) => {
        const variables = themeVariables(theme);
        ['--glow', '--glow-strong', '--glow-hot', '--glow-red', '--glow-yellow', '--glow-green', '--glow-inset', '--text-glow', '--logo-glow', '--scanlines'].forEach((name) => {
            expect(variables[name], name).toBe('none');
        });
        expect(variables['--cut']).toBe('0px');
        expect(variables['--font']).toContain('system-ui');
        expect(variables['--body-bg']).toBe('var(--bg)');
    });

    it.each(['synthwave', 'terminal'] as const)('%s is neon: it has a glow and scanlines, and the monospace font of the cyberpunk theme', (theme) => {
        const variables = themeVariables(theme);
        ['--glow', '--glow-strong', '--glow-hot', '--glow-red', '--glow-yellow', '--glow-green', '--glow-inset', '--text-glow', '--logo-glow', '--scanlines'].forEach((name) => {
            expect(variables[name], name).not.toBe('none');
        });
        expect(variables['--font']).toBe(themeVariables('cyberpunk')['--font']);
        expect(THEME_STYLES[theme]).toBe('neon');
    });

    it('keeps the cut corners of synthwave and drops them in terminal, which is square', () => {
        expect(themeVariables('synthwave')['--cut']).toBe('8px');
        expect(themeVariables('terminal')['--cut']).toBe('0px');
    });

    it('gives the flat rules (logo, buttons, fields) to the flat themes by their style, not by their names', () => {
        expect(THEMES_CSS).toContain(":root[data-theme-style='flat'] .btn {");
        expect(THEMES_CSS).toContain(":root[data-theme-style='flat'] .logo::before,");
        expect(THEMES_CSS).toContain(":root[data-theme-style='flat'] .url-input {");
        expect(THEMES_CSS).not.toMatch(/data-theme='(dark|light)'\] \./);
    });

    it('gives the neon rules of the player to the neon themes by their style, with the colors of the theme', () => {
        expect(CYBERPUNK_CSS).toContain("html[data-theme-style='neon'] .player__stage:fullscreen .player__controls .player__seek {");
        expect(CYBERPUNK_CSS).not.toContain("html[data-theme='cyberpunk']");
        const player = CYBERPUNK_CSS.slice(CYBERPUNK_CSS.indexOf('@keyframes player-wave'));
        expect(player).not.toContain('0, 240, 255');
        expect(player).not.toContain('255, 43, 214');
        expect(player).toContain('color-mix(in srgb, var(--cyan)');
        expect(player).toContain('color-mix(in srgb, var(--magenta)');
    });
});

describe('the colors of each theme can be read', () => {
    const READABLE: Array<Exclude<ThemeName, 'device' | 'cyberpunk'>> = LISTED;

    it.each(READABLE)('%s: the text and the muted text, on every surface', (theme) => {
        const variables = themeVariables(theme);
        SURFACES.forEach((surface) => {
            expect(contrast(color(variables, '--text'), color(variables, surface)), `text on ${surface}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
            expect(contrast(color(variables, '--muted'), color(variables, surface)), `muted on ${surface}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
        });
    });

    it.each(READABLE)('%s: every accent, on every surface', (theme) => {
        const variables = themeVariables(theme);
        ACCENTS.forEach((accent) => {
            SURFACES.forEach((surface) => {
                expect(contrast(color(variables, accent), color(variables, surface)), `${accent} on ${surface}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
            });
        });
    });

    it.each(READABLE)('%s: the text on a button painted with an accent', (theme) => {
        const variables = themeVariables(theme);
        ACCENTS.forEach((accent) => {
            expect(contrast(color(variables, '--on-accent'), color(variables, accent)), `on-accent on ${accent}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
        });
    });

    it.each(READABLE)('%s: the line is told apart from the panel', (theme) => {
        const variables = themeVariables(theme);
        expect(contrast(color(variables, '--line'), color(variables, '--panel')), 'line on panel').toBeGreaterThan(1.2);
    });

    it('the themes of the list are not the same palette twice', () => {
        const palettes = LISTED.map((theme) => {
            const variables = themeVariables(theme);
            return ['--bg', '--panel', '--text', '--cyan', '--magenta'].map((name) => {
                return variables[name];
            }).join('|');
        });
        expect(new Set(palettes).size).toBe(LISTED.length);
    });
});
