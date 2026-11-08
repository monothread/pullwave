// @vitest-environment jsdom
import { lastRevealPoint, rememberPoint, revealTheme, THEME_REVEAL_CLASS, trackPointerForReveal } from '@renderer/fx/themeReveal';

type Starter = (update: () => void) => { finished: Promise<unknown> };

function setStarter(start: Starter | undefined): void {
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start, writable: true });
}

beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 });
});

afterEach(() => {
    Reflect.deleteProperty(document, 'startViewTransition');
    document.documentElement.removeAttribute('style');
    document.documentElement.className = '';
});

describe('rememberPoint', () => {
    it('keeps the place of a press as a share of the window', () => {
        rememberPoint(250, 125);
        expect(lastRevealPoint()).toEqual({ x: 0.25, y: 0.25 });
    });

    it('keeps a press outside the window inside it', () => {
        rememberPoint(-50, 9000);
        expect(lastRevealPoint()).toEqual({ x: 0, y: 1 });
    });
});

describe('trackPointerForReveal', () => {
    it('remembers the place of every press until it is stopped', () => {
        const stop = trackPointerForReveal();
        document.dispatchEvent(new MouseEvent('pointerdown', { clientX: 500, clientY: 250 }));
        expect(lastRevealPoint()).toEqual({ x: 0.5, y: 0.5 });
        stop();
        document.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 50 }));
        expect(lastRevealPoint()).toEqual({ x: 0.5, y: 0.5 });
    });
});

describe('revealTheme', () => {
    it('just runs the change where the browser has no view transitions', () => {
        setStarter(undefined);
        const update = vi.fn();
        revealTheme(update);
        expect(update).toHaveBeenCalledTimes(1);
        expect(document.documentElement.classList.contains(THEME_REVEAL_CLASS)).toBe(false);
    });

    it('opens a circle from the last press, runs the change inside the transition and cleans up when it is over', async () => {
        rememberPoint(300, 100);
        let finish: () => void = () => { return undefined; };
        const finished = new Promise<void>((resolve) => { finish = resolve; });
        const update = vi.fn();
        const start = vi.fn((callback: () => void) => {
            callback();
            return { finished };
        });
        setStarter(start);
        revealTheme(update);
        const root = document.documentElement;
        expect(start).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledTimes(1);
        expect(root.classList.contains(THEME_REVEAL_CLASS)).toBe(true);
        expect(root.style.getPropertyValue('--reveal-x')).toBe('30.0%');
        expect(root.style.getPropertyValue('--reveal-y')).toBe('20.0%');
        finish();
        await finished;
        await Promise.resolve();
        expect(root.classList.contains(THEME_REVEAL_CLASS)).toBe(false);
    });
});
