// @vitest-environment jsdom
import { isScrollRestoring, restoreScroll, SCROLL_RESTORE_STABLE_FRAMES, SCROLL_RESTORE_TIMEOUT_MS } from '@renderer/hooks/scrollRestoration';

describe('restoreScroll', () => {
    let counter: number;
    let pending: Map<number, (time: number) => void>;
    let area: HTMLElement;
    let height: number;

    beforeEach(() => {
        counter = 0;
        pending = new Map();
        height = 3000;
        vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
            counter += 1;
            pending.set(counter, callback);
            return counter;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => {
            pending.delete(id);
        });
        area = document.createElement('div');
        Object.defineProperty(area, 'clientHeight', { value: 800, configurable: true });
        Object.defineProperty(area, 'scrollHeight', {
            get: () => {
                return height;
            },
            configurable: true
        });
    });

    afterEach(() => {
        restoreScroll(area, 0);
        vi.unstubAllGlobals();
    });

    function run(time: number): void {
        const due = [...pending.values()];
        pending.clear();
        due.forEach((frame) => {
            frame(time);
        });
    }

    it('does nothing for the top, where a page opens anyway', () => {
        restoreScroll(area, 0);
        expect(pending.size).toBe(0);
        expect(isScrollRestoring()).toBe(false);
    });

    it('scrolls to the position as soon as the page is tall enough and keeps it for a few frames', () => {
        restoreScroll(area, 1200);
        expect(isScrollRestoring()).toBe(true);
        expect(area.scrollTop).toBe(0);
        for (let frame = 1; frame < SCROLL_RESTORE_STABLE_FRAMES; frame += 1) {
            run(frame * 16);
            expect(area.scrollTop).toBe(1200);
            expect(isScrollRestoring()).toBe(true);
        }
        run(SCROLL_RESTORE_STABLE_FRAMES * 16);
        expect(isScrollRestoring()).toBe(false);
        expect(pending.size).toBe(0);
    });

    it('waits for the content to load before scrolling', () => {
        height = 900;
        restoreScroll(area, 1200);
        run(16);
        run(32);
        expect(area.scrollTop).toBe(0);
        expect(isScrollRestoring()).toBe(true);
        height = 3000;
        run(48);
        expect(area.scrollTop).toBe(1200);
    });

    it('puts the position back when the page being left reset it meanwhile', () => {
        restoreScroll(area, 1200);
        run(16);
        run(32);
        area.scrollTop = 0;
        run(48);
        expect(area.scrollTop).toBe(1200);
        expect(isScrollRestoring()).toBe(true);
    });

    it('gives up when the page never gets tall enough', () => {
        height = 900;
        restoreScroll(area, 1200);
        run(0);
        run(SCROLL_RESTORE_TIMEOUT_MS - 1);
        expect(isScrollRestoring()).toBe(true);
        run(SCROLL_RESTORE_TIMEOUT_MS);
        expect(isScrollRestoring()).toBe(false);
        expect(area.scrollTop).toBe(0);
        expect(pending.size).toBe(0);
    });

    it.each(['wheel', 'touchstart', 'mousedown', 'keydown'])('stops where it is when the viewer takes over with %s', (name) => {
        restoreScroll(area, 1200);
        run(16);
        area.scrollTop = 300;
        area.dispatchEvent(new Event(name));
        expect(isScrollRestoring()).toBe(false);
        run(32);
        expect(area.scrollTop).toBe(300);
        expect(pending.size).toBe(0);
    });

    it('replaces a restoration that is still going on', () => {
        restoreScroll(area, 1200);
        restoreScroll(area, 500);
        run(16);
        expect(area.scrollTop).toBe(500);
    });

    it('ends a restoration that is going on when the next one is for the top', () => {
        restoreScroll(area, 1200);
        restoreScroll(area, 0);
        expect(isScrollRestoring()).toBe(false);
        run(16);
        expect(area.scrollTop).toBe(0);
    });
});
