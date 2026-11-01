// @vitest-environment jsdom
import { FLYING_COVER_CLASS, TRANSITION_CLASS, canAnimatePages, withViewTransition } from '@renderer/navigation/viewTransition';

type Start = (update: () => void) => { finished: Promise<unknown> };

let finish: () => void = () => {
    return undefined;
};
let reduceMotion = false;

function installStart(): ReturnType<typeof vi.fn<Start>> {
    const start = vi.fn<Start>((update) => {
        update();
        return {
            finished: new Promise((resolve) => {
                finish = () => {
                    resolve(undefined);
                };
            })
        };
    });
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
    return start;
}

beforeEach(() => {
    reduceMotion = false;
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => {
            return { matches: query === '(prefers-reduced-motion: reduce)' && reduceMotion };
        }
    });
});

afterEach(() => {
    Reflect.deleteProperty(document, 'startViewTransition');
    document.documentElement.classList.remove(TRANSITION_CLASS);
});

describe('the names of the classes', () => {
    it('marks <html> while a change is animated, and the cover that flies', () => {
        expect(TRANSITION_CLASS).toBe('vt-active');
        expect(FLYING_COVER_CLASS).toBe('vt-cover');
    });
});

describe('canAnimatePages', () => {
    it('is false where the window has no View Transitions', () => {
        expect(canAnimatePages()).toBe(false);
    });

    it('is true where it has them', () => {
        installStart();
        expect(canAnimatePages()).toBe(true);
    });

    it('is true also when the system asks for less motion: the animations are always on (D-130)', () => {
        installStart();
        reduceMotion = true;
        expect(canAnimatePages()).toBe(true);
    });
});

describe('withViewTransition', () => {
    it('just runs the change where the window has no View Transitions', () => {
        const update = vi.fn();
        withViewTransition(update);
        expect(update).toHaveBeenCalledTimes(1);
        expect(document.documentElement).not.toHaveClass(TRANSITION_CLASS);
    });

    it('animates the change also when the system asks for less motion (D-130)', () => {
        const start = installStart();
        reduceMotion = true;
        const update = vi.fn();
        withViewTransition(update);
        expect(update).toHaveBeenCalledTimes(1);
        expect(start).toHaveBeenCalledTimes(1);
    });

    it('runs the change inside a transition, marks <html> until it ends and gives the cover its name only for the old page', async () => {
        const start = installStart();
        const cover = document.createElement('span');
        const seen: Array<{ marked: boolean; flying: boolean }> = [];
        const update = vi.fn(() => {
            seen.push({ marked: document.documentElement.classList.contains(TRANSITION_CLASS), flying: cover.classList.contains(FLYING_COVER_CLASS) });
        });
        withViewTransition(update, cover);
        expect(start).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledTimes(1);
        // The new page is drawn without the name of the cover: only the cover of the next page has it.
        expect(seen).toEqual([{ marked: true, flying: false }]);
        expect(document.documentElement).toHaveClass(TRANSITION_CLASS);
        finish();
        await Promise.resolve();
        await Promise.resolve();
        expect(document.documentElement).not.toHaveClass(TRANSITION_CLASS);
    });

    it('marks the cover before the transition starts', () => {
        let flyingAtStart = false;
        const cover = document.createElement('span');
        Object.defineProperty(document, 'startViewTransition', {
            configurable: true,
            value: (update: () => void) => {
                flyingAtStart = cover.classList.contains(FLYING_COVER_CLASS);
                update();
                return { finished: Promise.resolve() };
            }
        });
        withViewTransition(vi.fn(), cover);
        expect(flyingAtStart).toBe(true);
        expect(cover).not.toHaveClass(FLYING_COVER_CLASS);
    });
});
