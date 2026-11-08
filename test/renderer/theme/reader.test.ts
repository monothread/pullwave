import { readStylesheet, styleOf } from '../../helpers/cssRules';

const cyberpunk = readStylesheet('cyberpunk.css');
const shell = readStylesheet('bp-shell.css');

describe('the room above the page', () => {
    it('is a variable of the page: 16 pixels, and 18 in the shell of the console', () => {
        expect(styleOf(cyberpunk, '.app__main')).toMatchObject({ '--main-pad-top': '16px', padding: 'var(--main-pad-top) 4px 24px' });
        expect(styleOf(shell, '.app > .app__main')).toMatchObject({ '--main-pad-top': '18px', 'padding-top': 'var(--main-pad-top)' });
    });
});

describe('the bar of the reader', () => {
    it('reaches up over the whole room above the page, whatever it is, so nothing of the pages shows above it', () => {
        expect(styleOf(cyberpunk, '.reader__bar')).toMatchObject({
            position: 'sticky',
            top: 'calc(-1 * var(--main-pad-top, 16px))',
            'margin-top': 'calc(-1 * var(--main-pad-top, 16px))',
            padding: '22px 0 8px',
            background: 'var(--bg)'
        });
    });
});

describe('a page of the reader whose picture is on its way', () => {
    it('takes no room, whatever the scale: its rule is stronger than the ones of the scales', () => {
        expect(styleOf(cyberpunk, '.reader__img.reader__img--pending')).toEqual({
            position: 'absolute',
            top: '0',
            left: '0',
            width: '1px',
            height: '1px',
            'max-width': '1px',
            'max-height': '1px',
            overflow: 'hidden',
            opacity: '0',
            'pointer-events': 'none'
        });
        expect(styleOf(cyberpunk, '.reader__img--pending')).toEqual({});
    });

    it('waits inside the slot of its page, which is the box of the page while it is on its way and leaves no box once it arrived', () => {
        expect(styleOf(cyberpunk, '.reader__slot')).toEqual({ display: 'contents' });
        expect(styleOf(cyberpunk, '.reader__slot--pending')).toEqual({ position: 'relative', display: 'block', width: '100%' });
    });

    it('waits inside the pages, which hold it in their box', () => {
        expect(styleOf(cyberpunk, '.reader__stage')).toMatchObject({ position: 'relative' });
        expect(styleOf(cyberpunk, '.reader__scroll')).toMatchObject({ position: 'relative' });
    });
});

describe('the reader in fullscreen', () => {
    it('puts the background of the theme behind the pages of the area in fullscreen', () => {
        expect(styleOf(cyberpunk, '.app__main:fullscreen')).toEqual({ background: 'var(--bg)' });
    });
});

describe('two pages side by side in the reader', () => {
    it('lays the pair out as a row as wide as the stage, the pages in the middle and four pixels apart', () => {
        expect(styleOf(cyberpunk, '.reader__spread')).toEqual({ display: 'flex', 'align-items': 'center', 'justify-content': 'center', gap: '4px', width: '100%' });
    });

    it('reverses the row when the reading goes from the right, so the first page is on the right', () => {
        expect(styleOf(cyberpunk, ".reader__spread[data-direction='rtl']")).toEqual({ 'flex-direction': 'row-reverse' });
    });

    it('lets the pages of a pair shrink to half of the row, and their blocks of loading too', () => {
        expect(styleOf(cyberpunk, '.reader__spread--pair .reader__img')).toEqual({ 'min-width': '0' });
        expect(styleOf(cyberpunk, '.reader__spread--pair .reader__slot--pending')).toEqual({ flex: '1 1 0', width: 'auto', 'min-width': '0' });
    });

    it('gives each page of a pair half of the row, less its half of the gap, in the scale that fits the width, the height and the screen', () => {
        expect(styleOf(cyberpunk, '.reader__stage--width .reader__spread--pair .reader__img')).toEqual({ width: 'calc(50% - 2px)', 'max-width': 'none' });
        expect(styleOf(cyberpunk, '.reader__stage--height .reader__spread--pair .reader__img')).toEqual({ 'max-width': 'calc(50% - 2px)' });
        expect(styleOf(cyberpunk, '.reader__stage--screen .reader__spread--pair .reader__img')).toEqual({ 'max-width': 'calc(50% - 2px)' });
    });

    it('has no rule for the page that is alone: it is like the page of the single page mode', () => {
        const rules = cyberpunk.rules.filter((rule) => {
            return rule.selector.includes('reader__spread--single');
        });
        expect(rules).toEqual([]);
    });

    it('has rules stronger than the ones of the scales, and after them', () => {
        const order = cyberpunk.rules.map((rule) => {
            return rule.selector;
        });
        expect(order.indexOf('.reader__stage--width .reader__spread--pair .reader__img')).toBeGreaterThan(order.indexOf('.reader__stage--width .reader__img'));
        expect(order.indexOf('.reader__stage--height .reader__spread--pair .reader__img')).toBeGreaterThan(order.indexOf('.reader__stage--height .reader__img'));
    });
});
