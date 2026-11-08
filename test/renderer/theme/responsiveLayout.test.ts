import { mediaStyleOf, readStylesheet, styleOf } from '../../helpers/cssRules';

const responsive = readStylesheet('responsive.css');
const cyberpunk = readStylesheet('cyberpunk.css');
const shell = readStylesheet('bp-shell.css');

describe('responsive.css: the width of the page', () => {
    it('starts at 1000 px, with no magnification of the interface', () => {
        expect(styleOf(responsive, ':root')).toEqual({ '--app-max': '1000px', '--ui-zoom': '1' });
    });

    it('lets the page grow to 1240 px from 1280 px, to 1400 px from 1700 px and to 2400 px from 2200 px', () => {
        expect(mediaStyleOf(responsive, '(min-width: 1280px)', ':root')).toEqual({ '--app-max': '1240px' });
        expect(mediaStyleOf(responsive, '(min-width: 1700px)', ':root')).toEqual({ '--app-max': '1400px' });
        const wide = responsive.rules.find((rule) => {
            return rule.selector === ':root' && rule.media === '@media (min-width: 2200px)';
        });
        expect(wide?.declarations).toEqual({ '--app-max': '2400px' });
    });

    it('keeps the page in the middle, as wide as the window, with the gutter that centres --app-max', () => {
        expect(styleOf(responsive, '.app')).toEqual({ '--gutter': 'max(20px, calc((100% - var(--app-max)) / 2 + 20px))', 'max-width': 'none', 'padding-inline': '0' });
        expect(styleOf(responsive, '.app__main')).toMatchObject({ container: 'main / inline-size' });
    });
});

describe('responsive.css: the magnification of the interface on an ultrawide screen', () => {
    const MAGNIFIED = '(min-width: 2200px) and (min-height: 1300px)';

    it('magnifies the interface a fifth only where the screen is wide and tall: 1440 lines or more, never a 2560x1080 one', () => {
        expect(mediaStyleOf(responsive, MAGNIFIED, ':root')).toEqual({ '--ui-zoom': '1.2' });
        expect(mediaStyleOf(responsive, MAGNIFIED, 'html')).toEqual({ zoom: 'var(--ui-zoom)' });
        expect(styleOf(responsive, 'html')).toEqual({});
    });

    it('never magnifies a screen that is not an ultrawide one', () => {
        const zooms = responsive.rules.filter((rule) => {
            return rule.declarations['zoom'] !== undefined;
        });
        expect(zooms).toHaveLength(1);
        expect(zooms[0]?.media).toBe(`@media ${MAGNIFIED}`);
    });

    it('divides the units of the screen by the magnification, because they are magnified with the interface', () => {
        expect(styleOf(shell, '.sidenav--open')).toMatchObject({ width: 'min(var(--rail-open), calc(100vw / var(--ui-zoom) - 40px))' });
        expect(styleOf(cyberpunk, '.series-menu__panel')['max-width']).toBe('min(360px, calc(100vw / var(--ui-zoom, 1) - 32px))');
        expect(styleOf(cyberpunk, '.reader__stage--height .reader__img')).toMatchObject({ height: 'calc(100vh / var(--ui-zoom, 1) - 160px)' });
        expect(styleOf(cyberpunk, '.reader__stage--screen .reader__img')).toMatchObject({ 'max-height': 'calc(100vh / var(--ui-zoom, 1) - 160px)' });
        expect(styleOf(cyberpunk, '.reader__stage, .reader__scroll')['min-height'] ?? styleOf(cyberpunk, '.reader__stage')['min-height']).toBe('calc(40vh / var(--ui-zoom, 1))');
        expect(styleOf(cyberpunk, '.reader__loading-page')['min-height']).toBe('calc(70vh / var(--ui-zoom, 1))');
        expect(styleOf(cyberpunk, '.reader__chapter-loading')['min-height']).toBe('calc(70vh / var(--ui-zoom, 1))');
    });

    it('leaves no unit of the screen in the style sheets that is not divided by the magnification, but the ones of the portrait hero', () => {
        const sheets = ['cyberpunk.css', 'bp-shell.css', 'bp-home.css', 'bp-library.css', 'bp-downloads.css', 'bp-fun.css', 'console.css', 'responsive.css', 'themes.css'];
        const bare: string[] = [];
        sheets.forEach((name) => {
            readStylesheet(name).rules.forEach((rule) => {
                Object.entries(rule.declarations).forEach(([property, value]) => {
                    const mentionsScreen = /\d(vh|vw)\b/.test(value);
                    if (mentionsScreen && !value.includes('--ui-zoom') && rule.media !== '@media (orientation: portrait) and (min-height: 1200px)') {
                        bare.push(`${name} ${rule.selector} ${property}: ${value}`);
                    }
                });
            });
        });
        expect(bare).toEqual([]);
    });
});

describe('responsive.css: three columns on an ultrawide page', () => {
    const ULTRA = '@container main (min-width: 1700px)';

    it('lays the cards of the lists and the history in three columns, and the panels of the settings too', () => {
        expect(mediaStyleOf(responsive, ULTRA, '.queue')).toEqual({ 'grid-template-columns': 'repeat(3, minmax(0, 1fr))' });
        expect(mediaStyleOf(responsive, ULTRA, '.history > .history__list')).toEqual({ 'grid-template-columns': 'repeat(3, minmax(0, 1fr))' });
        expect(mediaStyleOf(responsive, ULTRA, '.anime__search > .history__list')).toEqual({ 'grid-template-columns': 'repeat(3, minmax(0, 1fr))' });
        expect(mediaStyleOf(responsive, ULTRA, '.settings')).toEqual({ 'column-count': '3' });
    });

    it('keeps two columns from 1100 px and two for the settings from 900 px, which the three columns come after', () => {
        expect(mediaStyleOf(responsive, '@container main (min-width: 1100px)', '.queue')).toEqual({ display: 'grid', 'grid-template-columns': 'repeat(2, minmax(0, 1fr))', 'align-items': 'start' });
        expect(mediaStyleOf(responsive, '@container main (min-width: 900px)', '.settings')).toEqual({ 'column-count': '2' });
        const order = responsive.rules.map((rule) => {
            return `${rule.media ?? ''}|${rule.selector}`;
        });
        expect(order.indexOf(`${ULTRA}|.queue`)).toBeGreaterThan(order.indexOf('@container main (min-width: 1100px)|.queue'));
        expect(order.indexOf(`${ULTRA}|.settings`)).toBeGreaterThan(order.indexOf('@container main (min-width: 900px)|.settings'));
    });
});
