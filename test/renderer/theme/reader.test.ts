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
