import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keyframesOf, mediaStyleOf, readStylesheet, styleOf, type Stylesheet } from '../../helpers/cssRules';

const SHEETS = ['bp-shell.css', 'bp-home.css', 'bp-library.css', 'bp-downloads.css'] as const;
const sheets: Record<(typeof SHEETS)[number], Stylesheet> = {
    'bp-shell.css': readStylesheet('bp-shell.css'),
    'bp-home.css': readStylesheet('bp-home.css'),
    'bp-library.css': readStylesheet('bp-library.css'),
    'bp-downloads.css': readStylesheet('bp-downloads.css')
};
const base = readStylesheet('console.css');
const shell = sheets['bp-shell.css'];
const home = sheets['bp-home.css'];
const library = sheets['bp-library.css'];
const downloads = sheets['bp-downloads.css'];
const MAIN_SOURCE = readFileSync(resolve(__dirname, '../../../src/renderer/main.tsx'), 'utf-8');
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const DOCK = '(max-width: 760px)';

// Boxes that can hold a window fixed to the screen (a card, a page, a panel): no transform may stay on them.
const BOXES = ['.app__main', '.home', '.hero', '.spotlight', '.spotlight__slide', '.section-cards', '.section-card', '.library-controls', '.series.detail', '.manga__head.detail-hero', '.download-hero', '.cover-grid > .cover-card', '.sidenav'];

function keyframesNamed(name: string): boolean {
    return [base, ...Object.values(sheets)].some((sheet) => {
        return keyframesOf(sheet, name) !== undefined;
    });
}

describe('the screens of the console interface: where they are loaded', () => {
    it('are loaded after console.css, in this order', () => {
        const order = ['console.css', ...SHEETS].map((file) => {
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

describe.each(SHEETS)('%s', (file) => {
    const sheet = sheets[file];
    const animated = sheet.rules
        .filter((rule) => {
            const value = rule.declarations.animation;
            return rule.media === null && value !== undefined && value !== 'none';
        })
        .map((rule) => {
            return [rule.selector, rule.declarations.animation ?? ''] as const;
        });

    it('writes no colour of its own (only black, white and the variables of the themes)', () => {
        expect(sheet.text).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        [...sheet.text.matchAll(/rgba?\(([^)]*)\)/g)].forEach((match) => {
            const channels = (match[1] ?? '').split(',').slice(0, 3).map((channel) => {
                return channel.trim();
            }).join(',');
            expect(['0,0,0', '255,255,255']).toContain(channels);
        });
    });

    it('does not change the size of a field or of a button', () => {
        sheet.rules
            .filter((rule) => {
                return /(^|[\s,>])\.(btn|input)(?![-_\w])/.test(rule.selector) && !rule.selector.includes('::');
            })
            .forEach((rule) => {
                ['height', 'min-height', 'padding-top', 'padding-bottom', 'padding-block', 'font-size', 'line-height', 'border-width'].forEach((property) => {
                    expect(rule.declarations[property], `${rule.selector} sets ${property}`).toBeUndefined();
                });
            });
        expect(sheet.text).not.toContain('--control-height');
    });

    it('has animations to check', () => {
        expect(animated.length).toBeGreaterThan(0);
    });

    it.each(animated)('defines the keyframes that %s uses', (_selector, animation) => {
        expect(keyframesNamed(animation.split(' ')[0] ?? '')).toBe(true);
    });

    it('keeps every animation and transition on whatever the system says about motion: it has no rule for less motion (D-130)', () => {
        expect(sheet.text).not.toContain('prefers-reduced-motion');
        expect(sheet.rules.filter((rule) => {
            return rule.media?.includes(REDUCED_MOTION) === true;
        })).toEqual([]);
    });

    it.each(BOXES)('never leaves a transform on %s', (selector) => {
        sheet.rules
            .filter((rule) => {
                const rest = rule.selector.slice(selector.length);
                return rule.selector.startsWith(selector) && (rest === '' || (rest.startsWith(':') && !rest.startsWith('::') && !/\s/.test(rest)));
            })
            .forEach((rule) => {
                expect(rule.declarations.transform, rule.selector).toBeUndefined();
                expect(rule.declarations.translate, rule.selector).toBeUndefined();
                expect(rule.declarations.filter, rule.selector).toBeUndefined();
            });
    });

    it('names only its own (bp-) keyframes, once each', () => {
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
    });
});

describe('bp-shell.css', () => {
    it('lays the screen out as a grid: the top bar, the banner, the rail of the menu and the page', () => {
        expect(styleOf(shell, ':root')).toEqual({ '--rail': '84px', '--rail-open': '340px' });
        expect(styleOf(shell, '.app')).toMatchObject({ display: 'grid', 'grid-template-columns': 'var(--rail) minmax(0, 1fr)', 'grid-template-rows': 'auto auto minmax(0, 1fr)', padding: '0' });
        expect(styleOf(shell, '.app > .app__header')).toEqual({ 'grid-area': 'header', margin: '0' });
        expect(styleOf(shell, '.app > .sidenav')).toEqual({ 'grid-area': 'rail', margin: '0' });
        expect(styleOf(shell, '.app > .app__main')).toEqual({ '--main-pad-top': '18px', 'grid-area': 'main', 'padding-top': 'var(--main-pad-top)' });
    });

    it('opens the menu over the page, never wider than the window', () => {
        expect(styleOf(shell, '.sidenav--open')).toMatchObject({ width: 'min(var(--rail-open), calc(100vw - 40px))' });
        expect(styleOf(shell, '.sidenav:not(.sidenav--open) .tab__label')).toMatchObject({ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', 'clip-path': 'inset(50%)' });
        expect(styleOf(shell, '.sidenav--open .tab__label')).toEqual({ 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis' });
        expect(styleOf(shell, '.sidenav--open .tab--icon::after')).toEqual({});
    });

    it('puts the drawn gear of the settings at the bottom of the menu, turning it when pointed at or chosen, and at its place in the dock', () => {
        expect(styleOf(shell, '.sidenav .tab:last-child')).toEqual({ 'margin-top': 'auto' });
        expect(styleOf(shell, '.sidenav .section-icon--settings')).toEqual({ transition: 'transform 0.6s var(--bp-ease-spring)' });
        expect(styleOf(shell, '.sidenav .tab:hover .section-icon--settings')).toEqual({ transform: 'rotate(90deg)' });
        expect(styleOf(shell, '.sidenav .tab--active .section-icon--settings')).toEqual({ transform: 'rotate(90deg)' });
        expect(mediaStyleOf(shell, DOCK, '.sidenav .tab:last-child')).toEqual({ 'margin-top': '0' });
        expect(styleOf(shell, '.sidenav .tab--icon')).toEqual({});
        expect(styleOf(shell, '.sidenav__scrim')).toMatchObject({ position: 'fixed', inset: '0', 'z-index': '55' });
    });

    it('turns the menu into a dock at the bottom on a narrow window, with no menu button and no shade', () => {
        expect(mediaStyleOf(shell, DOCK, '.app')).toMatchObject({ 'grid-template-columns': 'minmax(0, 1fr)', 'grid-template-rows': 'auto auto minmax(0, 1fr) auto' });
        expect(mediaStyleOf(shell, DOCK, '.topbar__menu')).toEqual({ display: 'none' });
        expect(mediaStyleOf(shell, DOCK, '.sidenav')).toMatchObject({ 'flex-direction': 'row', width: 'auto', 'border-top': '1px solid var(--line)' });
        expect(mediaStyleOf(shell, DOCK, '.sidenav__scrim')).toEqual({ display: 'none' });
    });

    it('puts the menu and the name together at the start of the top bar', () => {
        expect(styleOf(shell, '.topbar__start')).toEqual({ display: 'flex', 'align-items': 'center', gap: 'inherit', 'min-width': '0' });
    });

    it('centers the search in the window with room: three columns, the start and the end as wide as each other', () => {
        const WIDE = '(min-width: 1101px)';
        expect(mediaStyleOf(shell, WIDE, '.topbar')).toEqual({ display: 'grid', 'grid-template-columns': '1fr minmax(240px, 560px) 1fr', 'padding-inline': '24px' });
        expect(mediaStyleOf(shell, WIDE, '.topbar .global-search')).toEqual({ width: '100%' });
        expect(mediaStyleOf(shell, WIDE, '.topbar__end')).toEqual({ 'justify-self': 'end' });
        expect(mediaStyleOf(shell, '(max-width: 1100px)', '.global-search')).toEqual({ order: '10', flex: '1 1 100%', 'max-width': 'none' });
    });

    it('keeps the player over the shell, under the windows (200) and the notices (250)', () => {
        expect(styleOf(shell, '.player')).toEqual({ 'z-index': '150' });
        expect(Number(styleOf(shell, '.sidenav')['z-index'])).toBeLessThan(150);
        expect(Number(styleOf(shell, '.topbar')['z-index'])).toBeLessThan(150);
    });

    it('puts the cover behind everything, readable, and never in AMOLED or high contrast', () => {
        expect(styleOf(shell, '.backdrop')).toMatchObject({ position: 'fixed', inset: '0', 'z-index': '-1', 'pointer-events': 'none' });
        expect(styleOf(shell, '.backdrop__image')).toMatchObject({ filter: 'blur(42px) saturate(1.25)', opacity: '0.32' });
        expect(styleOf(shell, ":root[data-theme='high-contrast'] .backdrop")).toEqual({ display: 'none' });
        expect(styleOf(shell, ":root[data-theme='amoled'] .backdrop")).toEqual({ display: 'none' });
    });

    it('names the page and the covers for a change of page only while it is animated', () => {
        expect(styleOf(shell, '.vt-active .app__main')).toEqual({ 'view-transition-name': 'bp-page' });
        ['.vt-cover', '.vt-active .series.detail > .detail__art .cover', '.vt-active .manga__head.detail-hero .cover', '.vt-active .detail-screen .series__cover .cover'].forEach((selector) => {
            expect(styleOf(shell, selector)).toEqual({ 'view-transition-name': 'bp-cover' });
        });
        expect(styleOf(shell, '::view-transition-old(bp-page)')).toEqual({ animation: 'bp-page-out 0.22s ease-in both' });
        expect(styleOf(shell, '::view-transition-new(bp-page)')).toEqual({ animation: 'bp-page-in 0.42s var(--bp-ease-out) both' });
        expect(shell.rules.some((rule) => {
            return rule.selector === '.app__main' && rule.declarations['view-transition-name'] !== undefined;
        })).toBe(false);
    });
});

describe('bp-home.css', () => {
    it('blurs the cover behind a slide in its own layer', () => {
        expect(styleOf(home, '.hero')).toMatchObject({ position: 'relative', isolation: 'isolate', overflow: 'hidden' });
        expect(styleOf(home, '.hero::before')).toMatchObject({ background: 'var(--hero-image, none) center / cover no-repeat', filter: 'blur(26px) saturate(1.3)', 'z-index': '-2' });
        expect(styleOf(home, '.hero--welcome::before')).toEqual({ content: 'none' });
    });

    it('puts the slide that leaves and the one that comes in one cell, the new one coming over the old one', () => {
        expect(styleOf(home, '.spotlight__stage')).toEqual({ display: 'grid', 'overflow-x': 'clip' });
        expect(styleOf(home, '.spotlight__stage > .spotlight__slide')).toEqual({ 'grid-area': '1 / 1' });
        expect(styleOf(home, '.spotlight__slide--entering')).toEqual({ 'z-index': '1', animation: 'bp-slide-in 0.7s var(--bp-ease-out) backwards' });
        expect(styleOf(home, '.spotlight__slide--leaving')).toEqual({ 'z-index': '0', 'pointer-events': 'none', animation: 'bp-slide-out 0.7s var(--bp-ease-out) forwards' });
        expect(styleOf(home, '.spotlight__slide--forward')).toEqual({ '--slide-from': '48px' });
        expect(styleOf(home, '.spotlight__slide--back')).toEqual({ '--slide-from': '-48px' });
    });

    it('ends the slide that comes with no transform, and the one that leaves out of sight', () => {
        expect(keyframesOf(home, 'bp-slide-in')?.body.replace(/\s+/g, ' ')).toContain('to { opacity: 1; transform: none; }');
        expect(keyframesOf(home, 'bp-slide-out')?.body.replace(/\s+/g, ' ')).toContain('to { opacity: 0;');
    });

    it('draws the dot of the slide shown as a long pill', () => {
        expect(styleOf(home, '.spotlight__dot--current')).toEqual({ width: '28px', background: 'var(--bp-accent-gradient)', 'box-shadow': 'var(--glow)' });
        expect(styleOf(home, '.spotlight__dot')).toMatchObject({ width: '10px', height: '10px' });
    });

    it('lays the blocks of the sections out as a grid that wraps, the busy one lit on its edge', () => {
        expect(styleOf(home, '.section-cards')).toEqual({ display: 'grid', 'grid-template-columns': 'repeat(auto-fit, minmax(240px, 1fr))', gap: '18px', margin: '0', padding: '0', 'list-style': 'none' });
        expect(styleOf(home, '.section-card--busy')).toEqual({ 'border-color': 'color-mix(in srgb, var(--magenta) 55%, var(--line))' });
        expect(styleOf(home, '.section-card__actions')).toMatchObject({ 'margin-top': 'auto', 'flex-wrap': 'wrap' });
    });

    it('draws the chips of a library as pills, the one chosen lit, and keeps their words on one line', () => {
        expect(styleOf(home, '.chip-toggle')).toMatchObject({ 'border-radius': 'var(--bp-radius-pill)', 'white-space': 'nowrap' });
        expect(styleOf(home, '.chip-toggle--on')).toEqual({ 'border-color': 'var(--cyan)', background: 'var(--tint-cyan)', color: 'var(--cyan)', 'box-shadow': 'var(--glow)' });
        expect(mediaStyleOf(home, DOCK, '.library-controls__sort')).toEqual({ 'min-width': '0', flex: '1 1 100%' });
    });

    it('puts the order of a list of chapters or episodes at the right, over the list or at the end of its bar', () => {
        expect(styleOf(home, '.list-order-bar')).toEqual({ display: 'flex', 'justify-content': 'flex-end' });
        expect(styleOf(home, '.queue__toolbar .list-order')).toEqual({ 'margin-left': 'auto' });
    });
});

describe('bp-library.css', () => {
    it('makes the grid of covers a grid of tiles of the same width', () => {
        expect(styleOf(library, '.cover-grid')).toEqual({ 'grid-template-columns': 'repeat(auto-fill, minmax(176px, 1fr))', gap: '26px 20px' });
        expect(mediaStyleOf(library, DOCK, '.cover-grid')).toEqual({ 'grid-template-columns': 'repeat(auto-fill, minmax(140px, 1fr))', gap: '20px 14px' });
        expect(styleOf(library, '.cover-grid > .cover-card')).toEqual({ padding: '0 0 4px', background: 'transparent', 'border-color': 'transparent', 'box-shadow': 'none' });
    });

    it('gives the page of one title its cover on the left and the long lists the whole width', () => {
        expect(styleOf(library, '.series.detail')).toMatchObject({ display: 'grid', 'grid-template-columns': '170px minmax(0, 1fr)' });
        ['.series.detail > .episode-cards', '.series.detail > .cover-grid', '.series.detail > .series-editor', '.series.detail > .series-rename'].forEach((selector) => {
            expect(styleOf(library, selector)).toEqual({ 'grid-column': '1 / -1' });
        });
        expect(mediaStyleOf(library, DOCK, '.series.detail')).toMatchObject({ 'grid-template-columns': '96px minmax(0, 1fr)' });
    });

    it('lets the audio of a season go under its chip when the tile is narrow', () => {
        expect(styleOf(library, '.season-card__top')).toEqual({ 'flex-wrap': 'wrap', 'row-gap': '6px' });
    });
});

describe('bp-downloads.css', () => {
    it('shows the picture of the file chosen in the cutter as a small 16:9 tile, a glow while it is made, and the mark of its kind without one', () => {
        expect(styleOf(downloads, '.cut__thumb')).toMatchObject({ flex: 'none', width: '96px', 'aspect-ratio': '16 / 9', 'object-fit': 'cover', 'border-radius': 'var(--bp-radius-small)' });
        expect(styleOf(downloads, '.cut__thumb--empty')).toEqual({ display: 'grid', 'place-items': 'center', color: 'var(--cyan)', 'font-size': '28px', 'text-shadow': 'var(--text-glow)' });
        expect(styleOf(downloads, '.cut__thumb--loading')).toMatchObject({ animation: 'bp-thumb-shine 1.2s linear infinite' });
        expect(downloads.atRules.map((rule) => { return rule.prelude; })).toContain('@keyframes bp-thumb-shine');
    });

    it('lets the play of a part grow under the mouse without changing its colours, so the glyph never melts into its background', () => {
        expect(styleOf(downloads, '.cut__play')).toEqual({ 'min-width': '40px', 'margin-bottom': '2px', transition: 'transform 0.25s var(--bp-ease-spring)' });
        expect(styleOf(downloads, '.cut__play:not(:disabled):hover')).toEqual({ transform: 'scale(1.08)' });
    });

    it('keeps the place of the player of a part while it is opened or converted', () => {
        expect(styleOf(downloads, '.cut-preview__wait')).toEqual({ display: 'grid', flex: '1', 'min-height': '240px', 'place-items': 'center', border: '1px solid var(--line)', background: 'black' });
    });

    it('draws the words of the banner from their data-text', () => {
        expect(styleOf(downloads, '.drawn::before')).toEqual({ content: 'attr(data-text)' });
    });

    it('lays the download going on out as cover, body and graph, and stacks it on a narrow window', () => {
        expect(styleOf(downloads, '.download-hero')).toMatchObject({ display: 'grid', 'grid-template-columns': '110px minmax(0, 1fr) minmax(200px, 320px)' });
        expect(mediaStyleOf(downloads, '(max-width: 1000px)', '.download-hero')).toEqual({ 'grid-template-columns': '90px minmax(0, 1fr)' });
        expect(mediaStyleOf(downloads, '(max-width: 520px)', '.download-hero')).toEqual({ 'grid-template-columns': 'minmax(0, 1fr)', padding: '16px' });
        expect(mediaStyleOf(downloads, '(max-width: 520px)', '.download-hero__art')).toEqual({ display: 'none' });
    });

    it('draws the line of the graph in the colour of the theme, the same width at any size', () => {
        expect(styleOf(downloads, '.speed-graph__line')).toEqual({ stroke: 'var(--cyan)', 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke', filter: 'drop-shadow(0 0 4px var(--cyan))' });
    });
});
