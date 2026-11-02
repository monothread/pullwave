import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keyframesOf, mediaStyleOf, readStylesheet, styleOf, type CssRule } from '../../helpers/cssRules';

const sheet = readStylesheet('console.css');
const MAIN_SOURCE = readFileSync(resolve(__dirname, '../../../src/renderer/main.tsx'), 'utf-8');
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const VERY_NARROW = '(max-width: 520px)';

// The boxes that can hold a window fixed to the screen: a transform that stays on them would move the window into the box.
const BOXES = ['.panel', '.url-input', '.job', '.history__item', '.cover-card', '.app__main > *', '.settings > .panel', '.history__list > .history__item', '.cover-grid > .cover-card', '.series-menu__panel', '.toast'];

// What sizes a control: the layer must not change it (the e2e tests measure a field and the buttons beside it at --control-height).
const SIZE_PROPERTIES = ['height', 'min-height', 'max-height', 'padding', 'padding-block', 'padding-top', 'padding-bottom', 'font-size', 'line-height', 'border', 'border-width', '--control-height'];

function topLevel(): CssRule[] {
    return sheet.rules.filter((rule) => {
        return rule.media === null;
    });
}

function animationName(value: string): string {
    return value.split(' ')[0] ?? '';
}

describe('the console layer: where it is loaded', () => {
    it('is loaded after the other style sheets, so it is the last word on shapes and movement', () => {
        const order = ['cyberpunk.css', 'themes.css', 'responsive.css', 'console.css'].map((file) => {
            return MAIN_SOURCE.indexOf(`import './theme/${file}';`);
        });
        order.forEach((position) => {
            expect(position).toBeGreaterThan(-1);
        });
        expect([...order].sort((a, b) => {
            return a - b;
        })).toEqual(order);
    });
});

describe('the console layer: tokens', () => {
    it('defines its tokens from the variables of the themes', () => {
        expect(styleOf(sheet, ':root')).toEqual({
            '--bp-radius': '14px',
            '--bp-radius-small': '10px',
            '--bp-radius-pill': '999px',
            '--bp-ease-spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
            '--bp-ease-out': 'cubic-bezier(0.22, 1, 0.36, 1)',
            '--bp-accent-gradient': 'linear-gradient(120deg, var(--cyan), var(--magenta))',
            '--bp-focus': 'var(--yellow)',
            '--bp-shadow': '0 10px 28px -14px rgba(0, 0, 0, 0.65)',
            '--bp-shadow-hover': '0 18px 40px -16px color-mix(in srgb, var(--cyan) 55%, transparent)',
            '--bp-ring': '0 0 0 1px color-mix(in srgb, var(--cyan) 55%, transparent)',
            '--bp-aurora-opacity': '0.55',
            '--bp-aurora-a': 'color-mix(in srgb, var(--cyan) 22%, transparent)',
            '--bp-aurora-b': 'color-mix(in srgb, var(--magenta) 20%, transparent)',
            '--bp-aurora-c': 'color-mix(in srgb, var(--yellow) 10%, transparent)',
            '--bp-surface': 'color-mix(in srgb, var(--panel) 92%, transparent)',
            '--bp-sheen': 'rgba(255, 255, 255, 0.14)'
        });
    });

    it('writes no colour of its own: every colour comes from the theme (only white and black are mixed in)', () => {
        expect(sheet.text).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        const colours = [...sheet.text.matchAll(/rgba?\(([^)]*)\)/g)].map((match) => {
            return (match[1] ?? '').split(',').slice(0, 3).map((channel) => {
                return channel.trim();
            }).join(',');
        });
        expect(colours.length).toBeGreaterThan(0);
        colours.forEach((colour) => {
            expect(['255,255,255', '0,0,0', '31,36,48']).toContain(colour);
        });
    });

    it('keeps the cut corners of the neon themes by barely rounding their boxes', () => {
        expect(styleOf(sheet, ":root[data-theme-style='neon']")).toEqual({ '--bp-radius': '3px', '--bp-radius-small': '2px', '--bp-aurora-opacity': '0.8' });
    });

    it.each(["light", "sakura"])('gives the %s theme soft shadows and a pale aurora', (theme) => {
        expect(styleOf(sheet, `:root[data-theme='${theme}']`)).toEqual({
            '--bp-shadow': '0 10px 26px -16px rgba(31, 36, 48, 0.35)',
            '--bp-shadow-hover': '0 16px 34px -18px color-mix(in srgb, var(--cyan) 60%, transparent)',
            '--bp-aurora-opacity': '0.35',
            '--bp-sheen': 'rgba(255, 255, 255, 0.5)'
        });
    });

    it('does not give the soft shadows and the pale aurora of the light themes to Sakura Dark, which is dark like the others', () => {
        expect(styleOf(sheet, ":root[data-theme='sakura-dark']")).toEqual({});
        expect(styleOf(sheet, ":root[data-theme='dark']")).toEqual({});
    });

    it('keeps the screen plain black in AMOLED: no aurora and no soft shadows', () => {
        expect(styleOf(sheet, ":root[data-theme='amoled']")).toEqual({ '--bp-aurora-opacity': '0', '--bp-shadow': 'none', '--bp-shadow-hover': 'none' });
    });

    it('keeps high contrast plain too, with a ring in the colour of the text', () => {
        expect(styleOf(sheet, ":root[data-theme='high-contrast']")).toEqual({ '--bp-aurora-opacity': '0', '--bp-shadow': 'none', '--bp-shadow-hover': 'none', '--bp-ring': '0 0 0 2px var(--text)' });
    });
});

describe('the console layer: the aurora', () => {
    it('lies under everything, does not take the mouse and uses the opacity of the theme', () => {
        expect(styleOf(sheet, 'body::before')).toMatchObject({
            content: "''",
            position: 'fixed',
            inset: '-25%',
            'z-index': '-1',
            'pointer-events': 'none',
            opacity: 'var(--bp-aurora-opacity)',
            animation: 'bp-aurora-drift 36s ease-in-out infinite alternate'
        });
    });

    it('does not touch the scanlines of the neon themes, which stay in body::after', () => {
        expect(styleOf(sheet, 'body::after')).toEqual({});
    });
});

describe('the console layer: the top bar and the navigation', () => {
    it('draws five bars for the wave of the name, each a little after the one before', () => {
        expect(styleOf(sheet, '.brand__bar')).toMatchObject({ animation: 'bp-wave-bar 1.2s ease-in-out infinite', background: 'var(--bp-accent-gradient)' });
        expect([1, 2, 3, 4, 5].map((index) => {
            return styleOf(sheet, `.brand__bar:nth-child(${index})`)['animation-delay'];
        })).toEqual(['-1.1s', '-0.85s', '-0.6s', '-0.35s', '-0.1s']);
    });

    it('shows the clock with digits of one width so it does not jump', () => {
        expect(styleOf(sheet, '.topbar__clock')).toMatchObject({ 'font-variant-numeric': 'tabular-nums', 'white-space': 'nowrap' });
    });

    it('leaves the menu of the sections to bp-shell.css: it has no rule of the old bar of sections', () => {
        expect(sheet.rules.filter((rule) => {
            return rule.selector.includes('.tabs--main') && !rule.selector.includes(':not(.tabs--main)');
        })).toEqual([]);
    });

    it('draws the pictures of the sections and their hop', () => {
        expect(styleOf(sheet, '.tab__decoration')).toEqual({ display: 'inline-flex', flex: 'none', transition: 'transform 0.35s var(--bp-ease-spring)' });
        expect(styleOf(sheet, '.tab__decoration .section-icon')).toEqual({ display: 'block', filter: 'drop-shadow(var(--text-glow))' });
        expect(keyframesOf(sheet, 'bp-hop')).toBeDefined();
    });

    it('hides the wave of the name on a very narrow window', () => {
        expect(mediaStyleOf(sheet, VERY_NARROW, '.brand__wave')).toEqual({ display: 'none' });
    });

    it('draws the line under the active tab of a section, and leaves the gear of a section with its own line', () => {
        expect(styleOf(sheet, '.tabs:not(.tabs--main) .tab--active')).toEqual({ 'border-bottom-color': 'transparent' });
        expect(styleOf(sheet, '.tabs:not(.tabs--main) .tab--icon::after')).toEqual({ display: 'none' });
        expect(styleOf(sheet, '.tabs:not(.tabs--main) .tab--icon.tab--active')).toEqual({ 'border-bottom-color': 'var(--magenta)' });
    });
});

describe('the console layer: what it must not do', () => {
    it.each(BOXES)('never leaves a transform on %s, a box that can hold a window', (selector) => {
        // The box itself, alone or with a state (:hover), but not what is inside it nor its pseudo-elements.
        sheet.rules
            .filter((rule) => {
                const rest = rule.selector.slice(selector.length);
                return rule.selector.startsWith(selector) && (rest === '' || (rest.startsWith(':') && !rest.startsWith('::') && !/\s/.test(rest)));
            })
            .forEach((rule) => {
                expect(rule.declarations.transform, `${rule.selector} ${rule.media ?? ''}`).toBeUndefined();
                expect(rule.declarations.translate, rule.selector).toBeUndefined();
                expect(rule.declarations.filter, rule.selector).toBeUndefined();
                expect(rule.declarations['will-change'], rule.selector).toBeUndefined();
            });
    });

    it('animates the boxes only with a movement that leaves nothing behind (backwards fill, ending with no transform)', () => {
        const boxAnimations = topLevel()
            .filter((rule) => {
                return BOXES.includes(rule.selector) && rule.declarations.animation !== undefined;
            })
            .map((rule) => {
                return [rule.selector, rule.declarations.animation ?? ''];
            });
        expect(boxAnimations).toEqual([
            ['.app__main > *', 'bp-fade-in 0.35s var(--bp-ease-out) backwards'],
            ['.settings > .panel', 'bp-rise 0.45s var(--bp-ease-out) backwards'],
            ['.history__list > .history__item', 'bp-rise 0.4s var(--bp-ease-out) backwards'],
            ['.cover-grid > .cover-card', 'bp-rise 0.4s var(--bp-ease-out) backwards'],
            ['.toast', 'bp-toast-in 0.5s var(--bp-ease-spring) backwards']
        ]);
        expect(keyframesOf(sheet, 'bp-fade-in')?.body).not.toContain('transform');
        expect(keyframesOf(sheet, 'bp-rise')?.body.replace(/\s+/g, ' ')).toContain('to { opacity: 1; transform: none; }');
        expect(keyframesOf(sheet, 'bp-toast-in')?.body.replace(/\s+/g, ' ')).toContain('to { opacity: 1; transform: none; }');
    });

    it('does not change the size of a field or of a button', () => {
        sheet.rules
            .filter((rule) => {
                return /(^|[\s,>])\.(btn|input)(?![-_\w])/.test(rule.selector) && !rule.selector.includes('::');
            })
            .forEach((rule) => {
                SIZE_PROPERTIES.forEach((property) => {
                    expect(rule.declarations[property], `${rule.selector} sets ${property}`).toBeUndefined();
                });
            });
        expect(sheet.text).not.toContain('--control-height');
    });

    it('positions only the main button, which holds its light, and not every button', () => {
        expect(styleOf(sheet, '.btn').position).toBeUndefined();
        expect(styleOf(sheet, '.btn--primary')).toMatchObject({ position: 'relative', overflow: 'hidden' });
        expect(styleOf(sheet, '.btn--primary::after')).toMatchObject({ 'pointer-events': 'none', animation: 'bp-sheen 3.6s ease-in-out infinite' });
        expect(styleOf(sheet, '.btn--primary:disabled::after')).toEqual({ animation: 'none' });
    });

    it('puts the ring of an empty screen only on the screens, not inside a player, the reader or a window', () => {
        const ring = sheet.rules.filter((rule) => {
            return rule.selector.startsWith('.empty') && rule.media === null;
        });
        expect(ring.map((rule) => {
            return rule.selector;
        })).toEqual(['.empty:not(:is(.player, .reader, .modal) .empty)::before']);
    });

    it('keeps the light over a tile inside the tile, without taking the mouse', () => {
        expect(styleOf(sheet, '.cover-card::before')).toMatchObject({ position: 'absolute', inset: '0', 'pointer-events': 'none', 'border-radius': 'inherit' });
        expect(styleOf(sheet, '.cover-card')).toEqual({ position: 'relative', 'border-radius': 'var(--bp-radius)' });
    });
});

describe('the console layer: focus', () => {
    it('gives every control that can take the focus a thick ring that breathes', () => {
        ['.btn:focus-visible', '.tab:focus-visible', '.episode-chip:focus-visible', '.player__button:focus-visible'].forEach((selector) => {
            expect(styleOf(sheet, selector)).toEqual({
                outline: '3px solid var(--bp-focus)',
                'outline-offset': '3px',
                'box-shadow': '0 0 0 6px color-mix(in srgb, var(--bp-focus) 25%, transparent)',
                animation: 'bp-focus-breathe 1.8s ease-in-out infinite'
            });
        });
    });

    it('rings a card that opens when its link has the focus', () => {
        expect(styleOf(sheet, '.row--link:has(.row-link:focus-visible)')).toMatchObject({ outline: '3px solid var(--bp-focus)', 'outline-offset': '3px' });
    });
});

describe('the console layer: movement', () => {
    const animated = topLevel()
        .filter((rule) => {
            const value = rule.declarations.animation;
            return value !== undefined && value !== 'none';
        })
        .map((rule) => {
            return [rule.selector, rule.declarations.animation ?? ''] as const;
        });

    it('has animations to check', () => {
        expect(animated.length).toBeGreaterThanOrEqual(15);
    });

    it.each(animated)('defines the keyframes %s uses', (_selector, animation) => {
        expect(keyframesOf(sheet, animationName(animation))).toBeDefined();
    });

    it('keeps every animation and transition on whatever the system says about motion: it has no rule for less motion (D-130)', () => {
        expect(sheet.text).not.toContain('prefers-reduced-motion');
        expect(sheet.rules.filter((rule) => {
            return rule.media?.includes(REDUCED_MOTION) === true;
        })).toEqual([]);
    });

    it('defines every keyframes it names once, and names only its own (bp-) keyframes', () => {
        const names = sheet.atRules
            .filter((block) => {
                return block.prelude.startsWith('@keyframes');
            })
            .map((block) => {
                return block.prelude.replace('@keyframes ', '');
            });
        expect(new Set(names).size).toBe(names.length);
        names.forEach((name) => {
            expect(name).toMatch(/^bp-/);
        });
        expect(names.sort()).toEqual(['bp-aurora-drift', 'bp-banner-sheen', 'bp-fade-in', 'bp-focus-breathe', 'bp-hop', 'bp-ping', 'bp-pop', 'bp-rise', 'bp-sheen', 'bp-sparks', 'bp-toast-in', 'bp-wave-bar']);
    });
});
