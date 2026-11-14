import { keyframesOf, readStylesheet, styleOf } from '../../helpers/cssRules';

const cyberpunk = readStylesheet('cyberpunk.css');
const consoleLayer = readStylesheet('console.css');

describe('the lens of a search that found nothing (D-197)', () => {
    it('lays the lens over the words, quiet and centred, as the empty screens are', () => {
        expect(styleOf(cyberpunk, '.not-found')).toMatchObject({ display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: '14px', padding: '32px 0', color: 'var(--muted)', 'text-align': 'center', 'letter-spacing': '2px' });
        expect(styleOf(cyberpunk, '.not-found__stage')).toEqual({ position: 'relative', width: '168px', height: '92px' });
    });

    it('sweeps the rows twice, shakes "no" once it stopped, and then floats for as long as it is shown', () => {
        expect(styleOf(cyberpunk, '.not-found__lens').animation).toBe('not-found-sweep 1.3s ease-in-out forwards, not-found-shake 0.5s ease-in-out 1.3s, not-found-float 3s ease-in-out 2.4s infinite');
        ['not-found-sweep', 'not-found-sweep-small', 'not-found-shake', 'not-found-float'].forEach((name) => {
            expect(keyframesOf(cyberpunk, name), name).toBeDefined();
        });
    });

    it('pops the red cross in the lens with a ring of red leaving it, then lets it breathe', () => {
        expect(styleOf(cyberpunk, '.not-found__cross')).toMatchObject({
            stroke: 'var(--red)',
            transform: 'scale(0)',
            animation: 'not-found-pop 0.45s cubic-bezier(0.34, 1.8, 0.5, 1) 1.75s forwards, not-found-breathe 1.6s ease-in-out 2.4s infinite'
        });
        expect(styleOf(cyberpunk, '.not-found__burst')).toMatchObject({ border: '2px solid var(--red)', opacity: '0', animation: 'not-found-burst 0.7s ease-out 1.8s' });
        expect(keyframesOf(cyberpunk, 'not-found-pop')?.body.replace(/\s+/g, ' ').trim()).toBe('to { transform: scale(1); }');
    });

    it('brings the words in as a broken signal once the cross is there, and fades the rows it found nothing in', () => {
        expect(styleOf(cyberpunk, '.not-found__text')).toEqual({ position: 'relative', margin: '0', opacity: '0', animation: 'not-found-text 0.6s steps(6, end) 1.9s forwards' });
        expect(keyframesOf(cyberpunk, 'not-found-text')?.body).toContain('text-shadow: -6px 0 var(--magenta), 6px 0 var(--cyan)');
        expect(styleOf(cyberpunk, '.not-found__rows span').animation).toBe('not-found-rows 0.45s steps(3, end) 1.75s forwards');
    });

    it('draws a smaller lens beside the words in a window, and only the lens shaking no in a dropdown', () => {
        expect(styleOf(cyberpunk, '.not-found--small')).toMatchObject({ 'flex-direction': 'row', padding: '16px 0' });
        expect(styleOf(cyberpunk, '.not-found--small .not-found__lens')).toMatchObject({ width: '32px', height: '32px', 'animation-name': 'not-found-sweep-small, not-found-shake, not-found-float' });
        expect(styleOf(cyberpunk, '.not-found--tiny .not-found__rows')).toEqual({ display: 'none' });
        expect(styleOf(cyberpunk, '.not-found--tiny .not-found__burst')).toEqual({ display: 'none' });
        expect(styleOf(cyberpunk, '.not-found--tiny .not-found__lens').animation).toBe('not-found-shake 0.5s ease-in-out 0.1s, not-found-float 3s ease-in-out 1s infinite');
        expect(styleOf(cyberpunk, '.logs__screen > .not-found')).toEqual({ margin: 'auto' });
    });

    it('makes the lens and the cross glow in the neon themes only', () => {
        expect(styleOf(cyberpunk, '.not-found')['--not-found-lens-glow']).toBe('drop-shadow(0 0 4px var(--cyan)) drop-shadow(0 0 10px color-mix(in srgb, var(--cyan) 60%, transparent))');
        expect(styleOf(cyberpunk, '.not-found__lens svg').filter).toBe('var(--not-found-lens-glow)');
        expect(styleOf(consoleLayer, ":root[data-theme-style='flat'] .not-found")).toEqual({ '--not-found-lens-glow': 'none', '--not-found-cross-glow': 'none' });
    });

    it('keeps the ring of the empty screens away from it, and has no version for reduced motion', () => {
        expect(cyberpunk.rules.some((rule) => { return rule.selector.includes('.not-found') && rule.selector.includes('.empty'); })).toBe(false);
        [cyberpunk, consoleLayer].forEach((sheet) => {
            expect(sheet.rules.some((rule) => { return rule.media?.includes('prefers-reduced-motion') === true && rule.selector.includes('not-found'); })).toBe(false);
        });
    });
});
