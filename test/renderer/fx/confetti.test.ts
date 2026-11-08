// @vitest-environment jsdom
const { confettiMock } = vi.hoisted(() => {
    return { confettiMock: vi.fn<(options: unknown) => Promise<null>>(() => { return Promise.resolve(null); }) };
});
vi.mock('canvas-confetti', () => {
    return { default: confettiMock };
});

import { burstConfetti, themeColors, TOP_RIGHT } from '@renderer/fx/confetti';

afterEach(() => {
    confettiMock.mockClear();
    document.documentElement.removeAttribute('style');
});

describe('themeColors', () => {
    it('falls back to the neon colours when the theme gives none', () => {
        expect(themeColors()).toEqual(['#00e5ff', '#ff2bd6', '#ffd400', '#39ff88']);
    });

    it('reads the four colours from the variables of the theme', () => {
        const style = document.documentElement.style;
        style.setProperty('--cyan', '#111111');
        style.setProperty('--magenta', '#222222');
        style.setProperty('--yellow', '#333333');
        style.setProperty('--green', '#444444');
        expect(themeColors()).toEqual(['#111111', '#222222', '#333333', '#444444']);
    });
});

describe('burstConfetti', () => {
    it('throws one burst from the top right with the colours of the theme, over everything and even when the system asks for less motion', () => {
        burstConfetti();
        expect(confettiMock.mock.calls).toEqual([
            [
                {
                    particleCount: 70,
                    spread: 75,
                    startVelocity: 38,
                    gravity: 1.1,
                    ticks: 150,
                    scalar: 0.9,
                    origin: TOP_RIGHT,
                    colors: ['#00e5ff', '#ff2bd6', '#ffd400', '#39ff88'],
                    disableForReducedMotion: false,
                    zIndex: 200
                }
            ]
        ]);
    });

    it('throws it from the place it is given', () => {
        burstConfetti({ x: 0.5, y: 0.4 });
        expect(confettiMock.mock.calls[0]?.[0]).toMatchObject({ origin: { x: 0.5, y: 0.4 } });
    });
});
