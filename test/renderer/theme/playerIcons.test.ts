import { readStylesheet, styleOf } from '../../helpers/cssRules';

const cyberpunk = readStylesheet('cyberpunk.css');

describe('the icons of the buttons of the player', () => {
    it('make every button with a picture as wide as the others, with no padding and no spacing of the letters', () => {
        expect(styleOf(cyberpunk, '.player__button:has(> .player__icon)')).toEqual({ width: '44px', padding: '0', 'letter-spacing': '0' });
    });

    it('stand on the middle of the line, with no extra height', () => {
        expect(styleOf(cyberpunk, '.player__icon')).toEqual({ display: 'inline-block', 'line-height': '1', 'vertical-align': 'middle' });
    });

    it.each([
        ['.player__icon--play', '1.5em'],
        ['.player__icon--pause', '1.15em'],
        ['.player__icon--volume', '1em'],
        ['.player__icon--mute', '1em'],
        ['.player__icon--settings', '1.5em'],
        ['.player__icon--fullscreen', '1.65em']
    ])('scale %s to %s of the button, the height of the loudspeaker', (selector, size) => {
        expect(styleOf(cyberpunk, selector)).toEqual({ 'font-size': size });
    });
});

describe('the switch of the next episode and its panel', () => {
    it('draws the switch at the size of the other controls, in the color of the theme', () => {
        expect(styleOf(cyberpunk, '.player__switch')).toEqual({ width: '18px', height: '18px', margin: '0', 'accent-color': 'var(--cyan)', cursor: 'pointer' });
    });

    it('puts the panel over the video, in a corner above the bar, lit as the zone between two chapters', () => {
        expect(styleOf(cyberpunk, '.player__stage')).toMatchObject({ position: 'relative' });
        expect(styleOf(cyberpunk, '.player__auto-next')).toEqual({
            position: 'absolute',
            right: '24px',
            bottom: '72px',
            'z-index': '4',
            display: 'flex',
            'flex-direction': 'column',
            'align-items': 'stretch',
            gap: '8px',
            width: 'min(360px, calc(100% - 48px))',
            padding: '16px 18px',
            background: 'color-mix(in srgb, var(--panel, var(--bg)) 92%, transparent)',
            border: '1px solid var(--cyan)',
            'box-shadow': 'var(--glow)',
            'backdrop-filter': 'blur(6px)'
        });
        expect(styleOf(cyberpunk, '.player__auto-next-title')).toEqual({ overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' });
        expect(styleOf(cyberpunk, '.player__auto-next-actions')).toEqual({ display: 'flex', gap: '8px', 'justify-content': 'flex-end' });
    });
});
