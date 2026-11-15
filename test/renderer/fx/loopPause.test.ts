// @vitest-environment jsdom
import { isWindowMinimized, OFFSCREEN_ATTRIBUTE, setWindowMinimized, settleLoops, watchNewAnimations } from '@renderer/fx/loopPause';

interface FakeAnimation {
    effect: { getTiming: () => { iterations: number }; target: Element | null } | null;
    playState: AnimationPlayState;
    pause: ReturnType<typeof vi.fn>;
    play: ReturnType<typeof vi.fn>;
}

function animation(target: Element | null, iterations: number, playState: AnimationPlayState = 'running'): FakeAnimation {
    const fake: FakeAnimation = {
        effect: {
            getTiming: () => {
                return { iterations };
            },
            target
        },
        playState,
        pause: vi.fn(() => {
            fake.playState = 'paused';
        }),
        play: vi.fn(() => {
            fake.playState = 'running';
        })
    };
    return fake;
}

function install(animations: FakeAnimation[]): void {
    const of = (root: Element): FakeAnimation[] => {
        return animations.filter((item) => {
            const target = item.effect?.target ?? null;
            return target !== null && root.contains(target);
        });
    };
    Object.defineProperty(document, 'getAnimations', {
        configurable: true,
        value: () => {
            return animations;
        }
    });
    Object.defineProperty(Element.prototype, 'getAnimations', {
        configurable: true,
        value(this: Element, options?: { subtree?: boolean }) {
            expect(options).toEqual({ subtree: true });
            return of(this);
        }
    });
}

let list: HTMLElement;
let onScreen: HTMLElement;
let offScreen: HTMLElement;
let inside: HTMLElement;

beforeEach(() => {
    setWindowMinimized(false);
    document.body.innerHTML = '<main id="list"><article id="on"></article><article id="off"><span id="inside"></span></article></main>';
    list = document.getElementById('list') as HTMLElement;
    onScreen = document.getElementById('on') as HTMLElement;
    offScreen = document.getElementById('off') as HTMLElement;
    inside = document.getElementById('inside') as HTMLElement;
});

afterEach(() => {
    setWindowMinimized(false);
    Reflect.deleteProperty(document, 'getAnimations');
    Reflect.deleteProperty(Element.prototype, 'getAnimations');
});

describe('loopPause', () => {
    it('uses the attribute the cards out of sight are marked with', () => {
        expect(OFFSCREEN_ATTRIBUTE).toBe('data-offscreen');
    });

    it('pauses the looping animations of a card out of sight, also those inside it, and leaves the ones in sight running', () => {
        const visible = animation(onScreen, Infinity);
        const hidden = animation(offScreen, Infinity);
        const nested = animation(inside, Infinity);
        install([visible, hidden, nested]);
        offScreen.setAttribute(OFFSCREEN_ATTRIBUTE, '');
        settleLoops(list);
        expect(hidden.pause).toHaveBeenCalledTimes(1);
        expect(nested.pause).toHaveBeenCalledTimes(1);
        expect(visible.pause).not.toHaveBeenCalled();
        expect([visible.playState, hidden.playState, nested.playState]).toEqual(['running', 'paused', 'paused']);
    });

    it('never pauses an animation that plays a number of times: it ends as it would have (a stamp, a flash, a countdown)', () => {
        const once = animation(offScreen, 1);
        const thrice = animation(offScreen, 3);
        install([once, thrice]);
        offScreen.setAttribute(OFFSCREEN_ATTRIBUTE, '');
        settleLoops(offScreen);
        setWindowMinimized(true);
        expect(once.pause).not.toHaveBeenCalled();
        expect(thrice.pause).not.toHaveBeenCalled();
    });

    it('plays again, when the card comes back into sight, only the animations it paused', () => {
        const mine = animation(offScreen, Infinity);
        const pausedElsewhere = animation(offScreen, Infinity, 'paused');
        install([mine, pausedElsewhere]);
        offScreen.setAttribute(OFFSCREEN_ATTRIBUTE, '');
        settleLoops(offScreen);
        offScreen.removeAttribute(OFFSCREEN_ATTRIBUTE);
        settleLoops(offScreen);
        expect(mine.play).toHaveBeenCalledTimes(1);
        expect(mine.playState).toBe('running');
        expect(pausedElsewhere.pause).not.toHaveBeenCalled();
        expect(pausedElsewhere.play).not.toHaveBeenCalled();
        expect(pausedElsewhere.playState).toBe('paused');
    });

    it('does nothing more when it is asked again with nothing changed', () => {
        const hidden = animation(offScreen, Infinity);
        const visible = animation(onScreen, Infinity);
        install([hidden, visible]);
        offScreen.setAttribute(OFFSCREEN_ATTRIBUTE, '');
        settleLoops(list);
        settleLoops(list);
        expect(hidden.pause).toHaveBeenCalledTimes(1);
        expect(visible.play).not.toHaveBeenCalled();
    });

    it('pauses every looping animation of the page while the window is minimized and plays them again when it comes back', () => {
        const visible = animation(onScreen, Infinity);
        const once = animation(onScreen, 1);
        const outside = animation(document.body, Infinity);
        install([visible, once, outside]);
        setWindowMinimized(true);
        expect(isWindowMinimized()).toBe(true);
        expect(visible.pause).toHaveBeenCalledTimes(1);
        expect(outside.pause).toHaveBeenCalledTimes(1);
        expect(once.pause).not.toHaveBeenCalled();
        setWindowMinimized(false);
        expect(isWindowMinimized()).toBe(false);
        expect(visible.play).toHaveBeenCalledTimes(1);
        expect(outside.play).toHaveBeenCalledTimes(1);
        expect([visible.playState, outside.playState]).toEqual(['running', 'running']);
    });

    it('keeps the animations of a card out of sight waiting when the window comes back', () => {
        const hidden = animation(offScreen, Infinity);
        const visible = animation(onScreen, Infinity);
        install([hidden, visible]);
        offScreen.setAttribute(OFFSCREEN_ATTRIBUTE, '');
        setWindowMinimized(true);
        setWindowMinimized(false);
        expect(hidden.play).not.toHaveBeenCalled();
        expect(hidden.playState).toBe('paused');
        expect(visible.playState).toBe('running');
    });

    it('pauses, while the window is minimized, the animations of a card that started them meanwhile', () => {
        install([]);
        setWindowMinimized(true);
        const started = animation(onScreen, Infinity);
        install([started]);
        settleLoops(onScreen);
        expect(started.pause).toHaveBeenCalledTimes(1);
    });

    it('leaves running a looping animation that is on no element while the window is shown, and one with no effect at all', () => {
        const free = animation(null, Infinity);
        const empty: FakeAnimation = { ...animation(null, Infinity), effect: null };
        install([free, empty]);
        settleLoops(document);
        expect(free.pause).not.toHaveBeenCalled();
        expect(empty.pause).not.toHaveBeenCalled();
        setWindowMinimized(true);
        expect(free.pause).toHaveBeenCalledTimes(1);
        expect(empty.pause).not.toHaveBeenCalled();
    });

    it('does nothing where the page cannot list its animations', () => {
        expect(() => {
            settleLoops(list);
            setWindowMinimized(true);
        }).not.toThrow();
    });

    describe('the animations that start', () => {
        function start(target: EventTarget): void {
            target.dispatchEvent(new Event('animationstart', { bubbles: true }));
        }

        it('pauses as it starts a looping animation of a card out of sight, and leaves the ones in sight', () => {
            const stop = watchNewAnimations();
            const hidden = animation(offScreen, Infinity);
            const visible = animation(onScreen, Infinity);
            install([hidden, visible]);
            offScreen.setAttribute(OFFSCREEN_ATTRIBUTE, '');
            start(offScreen);
            start(onScreen);
            expect(hidden.pause).toHaveBeenCalledTimes(1);
            expect(visible.pause).not.toHaveBeenCalled();
            stop();
        });

        it('pauses as it starts any looping animation while the window is minimized', () => {
            const stop = watchNewAnimations();
            install([]);
            setWindowMinimized(true);
            const started = animation(onScreen, Infinity);
            install([started]);
            start(onScreen);
            expect(started.pause).toHaveBeenCalledTimes(1);
            stop();
        });

        it('pauses the whole page as one animation starts while minimized, so siblings still in their delay keep their offsets', () => {
            const stop = watchNewAnimations();
            install([]);
            setWindowMinimized(true);
            const first = animation(onScreen, Infinity);
            const second = animation(offScreen, Infinity);
            const third = animation(inside, Infinity);
            install([first, second, third]);
            start(onScreen);
            expect([first.pause, second.pause, third.pause].map((pause) => {
                return pause.mock.calls.length;
            })).toEqual([1, 1, 1]);
            stop();
        });

        it('pauses the whole card as one of its animations starts out of sight, and nothing outside it', () => {
            const stop = watchNewAnimations();
            const outside = animation(onScreen, Infinity);
            const started = animation(offScreen, Infinity);
            const waiting = animation(inside, Infinity);
            install([outside, started, waiting]);
            offScreen.setAttribute(OFFSCREEN_ATTRIBUTE, '');
            start(inside);
            expect(started.pause).toHaveBeenCalledTimes(1);
            expect(waiting.pause).toHaveBeenCalledTimes(1);
            expect(outside.pause).not.toHaveBeenCalled();
            stop();
        });

        it('does nothing for an animation that starts in sight while the window is shown', () => {
            const stop = watchNewAnimations();
            const visible = animation(onScreen, Infinity);
            install([visible]);
            start(onScreen);
            expect(visible.pause).not.toHaveBeenCalled();
            stop();
        });

        it('stops watching when it is told to', () => {
            const stop = watchNewAnimations();
            stop();
            const hidden = animation(offScreen, Infinity);
            install([hidden]);
            offScreen.setAttribute(OFFSCREEN_ATTRIBUTE, '');
            start(offScreen);
            expect(hidden.pause).not.toHaveBeenCalled();
        });

        it('ignores an animation that starts on something that is not an element', () => {
            const stop = watchNewAnimations();
            setWindowMinimized(true);
            const settle = vi.fn(() => {
                return [];
            });
            install([]);
            Object.defineProperty(document, 'getAnimations', { configurable: true, value: settle });
            settle.mockClear();
            start(document);
            expect(settle).not.toHaveBeenCalled();
            stop();
        });
    });
});
