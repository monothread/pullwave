// @vitest-environment jsdom
import { easeInOut, noop, SCROLL_MAX_MS, SCROLL_MIN_MS, scrollDuration, scrollToTopSmoothly } from '@renderer/hooks/smoothScroll';

describe('easeInOut', () => {
    it('goes from 0 to 1, passing the middle at the middle', () => {
        expect(easeInOut(0)).toBe(0);
        expect(easeInOut(0.5)).toBe(0.5);
        expect(easeInOut(1)).toBe(1);
    });

    it('is slow at the ends and quick in the middle', () => {
        expect(easeInOut(0.1)).toBeLessThan(0.1);
        expect(easeInOut(0.9)).toBeGreaterThan(0.9);
        expect(easeInOut(0.6) - easeInOut(0.4)).toBeGreaterThan(0.2);
    });
});

describe('scrollDuration', () => {
    it('is never shorter than the minimum or longer than the maximum', () => {
        expect(scrollDuration(10, 800)).toBe(SCROLL_MIN_MS + (10 / 800) * 220);
        expect(scrollDuration(0, 800)).toBe(SCROLL_MIN_MS);
        expect(scrollDuration(1_000_000, 800)).toBe(SCROLL_MAX_MS);
    });

    it('grows with the way to go', () => {
        expect(scrollDuration(2400, 800)).toBeGreaterThan(scrollDuration(800, 800));
    });

    it('uses the minimum where the screen has no height', () => {
        expect(scrollDuration(5000, 0)).toBe(SCROLL_MIN_MS);
    });
});

describe('scrollToTopSmoothly', () => {
    let frames: Array<(time: number) => void>;

    beforeEach(() => {
        frames = [];
        vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
            frames.push(callback);
            return frames.length;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => {
            frames[id - 1] = noop;
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function area(top: number): HTMLElement {
        const element = document.createElement('div');
        Object.defineProperty(element, 'clientHeight', { value: 800, configurable: true });
        element.scrollTop = top;
        return element;
    }

    function run(time: number): void {
        frames.splice(0).forEach((frame) => {
            frame(time);
        });
    }

    it('does nothing when it is at the top already', () => {
        const element = area(0);
        const stop = scrollToTopSmoothly(element);
        expect(frames).toHaveLength(0);
        expect(stop).toBe(noop);
        expect(stop()).toBeUndefined();
    });

    it('moves a little at every frame until it is at the top, in the time it takes', () => {
        const element = area(2400);
        const duration = scrollDuration(2400, 800);
        scrollToTopSmoothly(element);
        run(100);
        expect(element.scrollTop).toBe(2400);
        run(100 + duration / 2);
        expect(element.scrollTop).toBe(1200);
        run(100 + duration - 1);
        expect(element.scrollTop).toBeGreaterThan(0);
        run(100 + duration);
        expect(element.scrollTop).toBe(0);
        expect(
            frames.every((frame) => {
                return frame === noop;
            })
        ).toBe(true);
    });

    it.each(['wheel', 'touchstart', 'mousedown', 'keydown'])('stops when the user takes over with a %s', (name) => {
        const element = area(2400);
        scrollToTopSmoothly(element);
        run(0);
        run(200);
        const stoppedAt = element.scrollTop;
        element.dispatchEvent(new Event(name));
        run(400);
        run(5000);
        expect(element.scrollTop).toBe(stoppedAt);
    });

    it('can be stopped by the function it gives, and stops listening', () => {
        const element = area(2400);
        const remove = vi.spyOn(element, 'removeEventListener');
        const stop = scrollToTopSmoothly(element);
        run(0);
        run(200);
        const stoppedAt = element.scrollTop;
        stop();
        run(5000);
        expect(element.scrollTop).toBe(stoppedAt);
        expect(remove.mock.calls.map((call) => { return call[0]; })).toEqual(['wheel', 'touchstart', 'mousedown', 'keydown']);
    });

    it('stops listening once it has arrived', () => {
        const element = area(500);
        const remove = vi.spyOn(element, 'removeEventListener');
        scrollToTopSmoothly(element);
        run(0);
        run(10_000);
        expect(element.scrollTop).toBe(0);
        expect(remove).toHaveBeenCalledTimes(4);
    });

    it('goes up to a place that is not the top, and stops there', () => {
        const element = area(2400);
        scrollToTopSmoothly(element, 600);
        run(0);
        run(scrollDuration(1800, 800) / 2);
        expect(element.scrollTop).toBe(1500);
        run(10_000);
        expect(element.scrollTop).toBe(600);
        expect(
            frames.every((frame) => {
                return frame === noop;
            })
        ).toBe(true);
    });

    it('does nothing when it is at that place already, or above it', () => {
        const element = area(600);
        expect(scrollToTopSmoothly(element, 600)).toBe(noop);
        expect(scrollToTopSmoothly(element, 900)).toBe(noop);
        expect(frames).toHaveLength(0);
        expect(element.scrollTop).toBe(600);
    });

    it('takes the time by the way to the place, not by the way to the top', () => {
        const element = area(1000);
        scrollToTopSmoothly(element, 800);
        run(0);
        expect(scrollDuration(200, 800)).toBeLessThan(scrollDuration(1000, 800));
        run(scrollDuration(200, 800));
        expect(element.scrollTop).toBe(800);
    });
});

