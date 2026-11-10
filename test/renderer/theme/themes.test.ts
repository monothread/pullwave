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

const LIGHT_THEMES: readonly ThemeName[] = ['light', 'sakura', 'neon-tokyo-light'];
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

describe('Sakura Dark', () => {
    it('is the dark version of Sakura: the same pink and purple family, flat, on a dark plum background', () => {
        const sakura = themeVariables('sakura');
        const night = themeVariables('sakura-dark');
        expect(THEME_STYLES['sakura-dark']).toBe('flat');
        expect(night['color-scheme']).toBe('dark');
        expect(night['--font']).toBe(sakura['--font']);
        expect(night['--bg']).toBe('#1c1319');
        expect(night['--cyan']).toBe('#ff8fb8');
        expect(night['--magenta']).toBe('#c9a0ff');
        // The surfaces are darker than the text, which is the opposite of Sakura.
        expect(luminance(color(night, '--bg'))).toBeLessThan(luminance(color(night, '--text')));
        expect(luminance(color(night, '--bg'))).toBeLessThan(0.02);
        expect(luminance(color(sakura, '--bg'))).toBeGreaterThan(0.8);
    });
});

describe('Neon Tokyo Light', () => {
    const neon = themeVariables('neon-tokyo');
    const light = themeVariables('neon-tokyo-light');

    it('is the light version of Neon Tokyo: neon style, on a pale lavender background, telling the browser it is light', () => {
        expect(THEME_STYLES['neon-tokyo-light']).toBe('neon');
        expect(light['color-scheme']).toBe('light');
        expect(light['--bg']).toBe('#f3f0fb');
        expect(light['--panel']).toBe('#ffffff');
        expect(light['--text']).toBe('#1a1440');
        // The surfaces are lighter than the text, which is the opposite of Neon Tokyo.
        expect(luminance(color(light, '--bg'))).toBeGreaterThan(0.8);
        expect(luminance(color(light, '--bg'))).toBeGreaterThan(luminance(color(light, '--text')));
        expect(luminance(color(neon, '--bg'))).toBeLessThan(0.02);
    });

    it('keeps the pink as the main accent and the blue as the second one, both darker than in Neon Tokyo so they can be read', () => {
        expect(light['--cyan']).toBe('#c8006a');
        expect(light['--magenta']).toBe('#1f5fd6');
        expect(luminance(color(light, '--cyan'))).toBeLessThan(luminance(color(neon, '--cyan')));
        expect(luminance(color(light, '--magenta'))).toBeLessThan(luminance(color(neon, '--magenta')));
    });

    it('keeps the monospace font, the cut corners and the thin scanlines of the neon style, drawn in the dark ink of the theme', () => {
        expect(light['--font']).toBe(neon['--font']);
        expect(light['--font']).toBe(themeVariables('cyberpunk')['--font']);
        expect(light['--cut']).toBe('8px');
        expect(light['--scanlines']).toBe('repeating-linear-gradient(to bottom, rgba(26, 20, 64, 0.03) 0, rgba(26, 20, 64, 0.03) 1px, transparent 1px, transparent 3px)');
    });

    it('swaps the bright glow for a soft halo in the color of each accent', () => {
        expect(light['--glow']).toBe('0 0 12px rgba(200, 0, 106, 0.22)');
        expect(light['--glow-strong']).toBe('0 0 14px rgba(200, 0, 106, 0.35)');
        expect(light['--glow-hot']).toBe('0 0 16px rgba(31, 95, 214, 0.35)');
        expect(light['--glow-red']).toBe('0 0 12px rgba(196, 22, 63, 0.2)');
        expect(light['--glow-yellow']).toBe('0 0 12px rgba(138, 90, 0, 0.2)');
        expect(light['--glow-green']).toBe('0 0 12px rgba(8, 112, 72, 0.2)');
        expect(light['--glow-inset']).toBe('inset 0 0 30px rgba(200, 0, 106, 0.04)');
        expect(light['--text-glow']).toBe('0 0 5px rgba(200, 0, 106, 0.14)');
        expect(light['--logo-glow']).toBe('0 0 6px rgba(200, 0, 106, 0.35), 0 0 18px rgba(200, 0, 106, 0.25)');
    });

    it('tints the panels in the color of each accent, and paints a light sky behind the screen', () => {
        expect(light['--tint-cyan']).toBe('rgba(200, 0, 106, 0.07)');
        expect(light['--tint-red']).toBe('rgba(196, 22, 63, 0.08)');
        expect(light['--tint-yellow']).toBe('rgba(138, 90, 0, 0.09)');
        expect(light['--tint-green']).toBe('rgba(8, 112, 72, 0.07)');
        expect(light['--toast-error-text']).toBe('#7a0a26');
        expect(light['--body-bg']).toContain('#e3d8ff');
        expect(light['--body-bg']).toContain('#d6e6ff');
        expect(light['--body-bg']).toContain('var(--bg)');
    });

    it('is the only neon theme on a light background', () => {
        const lightNeon = LISTED.filter((theme) => {
            return THEME_STYLES[theme] === 'neon' && themeVariables(theme)['color-scheme'] === 'light';
        });
        expect(lightNeon).toEqual(['neon-tokyo-light']);
        expect(THEMES.indexOf('neon-tokyo-light')).toBe(THEMES.indexOf('ice-neon') + 1);
    });

    it('is not the same palette as Neon Tokyo or as the other light themes', () => {
        ['neon-tokyo', 'light', 'sakura'].forEach((theme) => {
            const other = themeVariables(theme as ThemeName);
            expect(other['--bg'], theme).not.toBe(light['--bg']);
            expect(other['--cyan'], theme).not.toBe(light['--cyan']);
        });
    });
});

describe('the neon variations of the cyberpunk theme', () => {
    // The two colors that paint each variation (--cyan is the main accent, --magenta the second), its background and the color of its glow.
    const VARIATIONS = [
        { theme: 'neon-tokyo', main: '#ff2e97', second: '#3d94ff', bg: '#070b1f', glow: '255, 46, 151' },
        { theme: 'acid-rain', main: '#b6ff00', second: '#00e5ff', bg: '#030a08', glow: '182, 255, 0' },
        { theme: 'amber-city', main: '#ff8a1f', second: '#19d3da', bg: '#0d0805', glow: '255, 138, 31' },
        { theme: 'ultraviolet', main: '#a96dff', second: '#ff3df2', bg: '#0a0518', glow: '169, 109, 255' },
        { theme: 'pink-noir', main: '#ff3d9a', second: '#ffe6f3', bg: '#050505', glow: '255, 61, 154' },
        { theme: 'cyber-gold', main: '#fcee0a', second: '#ff9100', bg: '#080600', glow: '252, 238, 10' },
        { theme: 'ice-neon', main: '#8ff3ff', second: '#6fb2ff', bg: '#02111a', glow: '143, 243, 255' }
    ] as const;

    it('has seven of them, all of the neon style', () => {
        expect(
            VARIATIONS.map((variation) => {
                return THEME_STYLES[variation.theme];
            })
        ).toEqual(['neon', 'neon', 'neon', 'neon', 'neon', 'neon', 'neon']);
        expect(THEMES.slice(THEMES.indexOf('terminal') + 1, THEMES.indexOf('terminal') + 8)).toEqual(
            VARIATIONS.map((variation) => {
                return variation.theme;
            })
        );
    });

    it.each(VARIATIONS)('$theme paints its main accent, its second one and its background', ({ theme, main, second, bg }) => {
        const variables = themeVariables(theme);
        expect(variables['--cyan']).toBe(main);
        expect(variables['--magenta']).toBe(second);
        expect(variables['--bg']).toBe(bg);
        expect(variables['color-scheme']).toBe('dark');
        // A neon theme sits on a very dark background, darker than a tenth of the luminance of its main accent.
        expect(luminance(color(variables, '--bg'))).toBeLessThan(0.02);
        expect(luminance(color(variables, '--bg'))).toBeLessThan(luminance(main) / 10);
    });

    it.each(VARIATIONS)('$theme glows in its main accent, and its logo too', ({ theme, glow }) => {
        const variables = themeVariables(theme);
        expect(variables['--glow']).toBe(`0 0 14px rgba(${glow}, 0.4)`);
        expect(variables['--glow-strong']).toBe(`0 0 16px rgba(${glow}, 0.65)`);
        expect(variables['--glow-inset']).toBe(`inset 0 0 30px rgba(${glow}, 0.05)`);
        expect(variables['--logo-glow']).toBe(`0 0 8px var(--cyan), 0 0 22px rgba(${glow}, 0.5)`);
        expect(variables['--tint-cyan']).toBe(`rgba(${glow}, 0.06)`);
        expect(variables['--text-glow']).toBe('0 0 8px var(--cyan)');
    });

    it.each(VARIATIONS)('$theme keeps the cut corners and the scanlines of the cyberpunk theme', ({ theme }) => {
        const variables = themeVariables(theme);
        expect(variables['--cut']).toBe('8px');
        expect(variables['--scanlines']).toBe(themeVariables('cyberpunk')['--scanlines']);
        expect(variables['--font']).toBe(themeVariables('cyberpunk')['--font']);
    });

    it('does not look like the cyberpunk theme, synthwave or terminal: no variation shares their main accent or background', () => {
        const taken = ['cyberpunk', 'synthwave', 'terminal'].map((theme) => {
            return themeVariables(theme as ThemeName)['--cyan'];
        });
        VARIATIONS.forEach((variation) => {
            expect(taken, variation.theme).not.toContain(variation.main);
        });
        const mains = VARIATIONS.map((variation) => {
            return variation.main;
        });
        expect(new Set(mains).size).toBe(VARIATIONS.length);
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

    it.each(['synthwave', 'terminal', 'neon-tokyo', 'acid-rain', 'amber-city', 'ultraviolet', 'pink-noir', 'cyber-gold', 'ice-neon', 'neon-tokyo-light'] as const)('%s is neon: it has a glow and scanlines, and the monospace font of the cyberpunk theme', (theme) => {
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

    it('gives the rules of the player in fullscreen to every theme, not only the neon ones, with the colors of the theme', () => {
        expect(CYBERPUNK_CSS).toContain('.player__stage:fullscreen .player__controls {');
        expect(CYBERPUNK_CSS).not.toMatch(/data-theme-style='neon'\]\s*\.player/);
        expect(CYBERPUNK_CSS).not.toContain("html[data-theme='cyberpunk']");
        const player = CYBERPUNK_CSS.slice(CYBERPUNK_CSS.indexOf('.player__timeline {'));
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
