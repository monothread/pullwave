// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useChapterZones, type ChapterZonesOptions } from '@renderer/hooks/useChapterZones';

interface Scene {
    area: HTMLElement;
    bar: HTMLElement;
    startZone: HTMLElement;
    endZone: HTMLElement;
    // How far the content is scrolled: moves the zones the way the real scroll does.
    scrollTo: (top: number) => void;
    // Puts the scroll somewhere without telling anyone (how the page is when the zones start to be watched).
    place: (top: number) => void;
}

// An area 700 tall at the top of the window, with a bar 90 tall on it; the zone of the start is 400 tall above the pages, and the one of the end
// is 400 tall below pages that are 2000 tall. With no scroll the start zone is at 90 and the end zone at 2490 (below the area).
function makeScene(): Scene {
    const area = document.createElement('div');
    const bar = document.createElement('div');
    const startZone = document.createElement('div');
    const endZone = document.createElement('div');
    let scrolled = 0;
    const box = (top: number, height: number): DOMRect => {
        return { top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => { return {}; } } as DOMRect;
    };
    area.getBoundingClientRect = () => {
        return box(0, 700);
    };
    bar.getBoundingClientRect = () => {
        return box(0, 90);
    };
    startZone.getBoundingClientRect = () => {
        return box(90 - scrolled, 400);
    };
    endZone.getBoundingClientRect = () => {
        return box(90 + 400 + 2000 - scrolled, 400);
    };
    return {
        area,
        bar,
        startZone,
        endZone,
        place: (top) => {
            scrolled = top;
        },
        scrollTo: (top) => {
            scrolled = top;
            act(() => {
                area.dispatchEvent(new Event('scroll'));
            });
            flushFrames();
        }
    };
}

let frames: Array<() => void> = [];

function flushFrames(): void {
    act(() => {
        frames.splice(0).forEach((callback) => {
            callback();
        });
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
        frames.push(callback);
        return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        frames[id - 1] = () => {
            return undefined;
        };
    });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function setup(patch: Partial<ChapterZonesOptions> = {}, initialScroll = 0) {
    const scene = makeScene();
    scene.place(initialScroll);
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const startZone = createRef<HTMLElement>();
    const endZone = createRef<HTMLElement>();
    (startZone as { current: HTMLElement | null }).current = scene.startZone;
    (endZone as { current: HTMLElement | null }).current = scene.endZone;
    // The functions are the same at every render, as the ones of the reader are.
    const area = (): HTMLElement => {
        return scene.area;
    };
    const bar = (): HTMLElement => {
        return scene.bar;
    };
    const hook = renderHook(
        (options: Partial<ChapterZonesOptions>) => {
            return useChapterZones({
                area,
                bar,
                startZone,
                endZone,
                enabled: true,
                automatic: true,
                hasPrevious: true,
                hasNext: true,
                onPrevious,
                onNext,
                ...options
            });
        },
        { initialProps: patch }
    );
    flushFrames();
    return { ...scene, ...hook, onPrevious, onNext };
}

// The scroll that puts the end zone all in view (the area ends at 700): zone top at 700 - 400.
const END_ALL_IN_VIEW = 2490 - 300;
// The scroll that puts the start zone all in view under the bar (its top at the bottom of the bar).
const START_ALL_IN_VIEW = 0;
// A scroll in the middle of the pages.
const MIDDLE = 900;

describe('useChapterZones how much of each zone is in view', () => {
    it('is none of them while the pages are in view', () => {
        const { result, scrollTo } = setup();
        scrollTo(MIDDLE);
        expect(result.current).toEqual({ start: 0, end: 0 });
    });

    it('follows the scroll through the zone at the end', () => {
        const { result, scrollTo } = setup();
        scrollTo(2490 - 700 + 200);
        expect(result.current.end).toBeCloseTo(0.5, 5);
        scrollTo(2490 - 700 + 100);
        expect(result.current.end).toBeCloseTo(0.25, 5);
        scrollTo(END_ALL_IN_VIEW + 100);
        expect(result.current.end).toBe(1);
        expect(result.current.start).toBe(0);
    });

    it('follows the scroll through the zone at the start', () => {
        const { result, scrollTo } = setup();
        scrollTo(MIDDLE);
        scrollTo(300);
        expect(result.current.start).toBeCloseTo(0.25, 5);
        scrollTo(START_ALL_IN_VIEW);
        expect(result.current.start).toBe(1);
    });

    it('is none while the zones are not on', () => {
        const { result, scrollTo } = setup({ enabled: false });
        scrollTo(END_ALL_IN_VIEW);
        expect(result.current).toEqual({ start: 0, end: 0 });
    });

    it('listens to the window, the zones and the area, and stops when it is removed', () => {
        const observe = vi.fn();
        const disconnect = vi.fn();
        class FakeObserver {
            observe = observe;
            disconnect = disconnect;
        }
        vi.stubGlobal('ResizeObserver', FakeObserver);
        const removeWindow = vi.spyOn(window, 'removeEventListener');
        const scene = makeScene();
        const removeArea = vi.spyOn(scene.area, 'removeEventListener');
        const startZone = { current: scene.startZone };
        const endZone = { current: scene.endZone };
        const area = (): HTMLElement => {
            return scene.area;
        };
        const bar = (): HTMLElement => {
            return scene.bar;
        };
        const { unmount } = renderHook(() => {
            return useChapterZones({ area, bar, startZone, endZone, enabled: true, automatic: true, hasPrevious: true, hasNext: true, onPrevious: vi.fn(), onNext: vi.fn() });
        });
        expect(observe).toHaveBeenCalledWith(scene.startZone);
        expect(observe).toHaveBeenCalledWith(scene.endZone);
        unmount();
        expect(disconnect).toHaveBeenCalled();
        expect(removeArea).toHaveBeenCalledWith('scroll', expect.any(Function));
        expect(removeWindow).toHaveBeenCalledWith('resize', expect.any(Function));
    });
});

describe('useChapterZones the switch of chapter', () => {
    it('goes to the next chapter when the zone at the end stays all in view for a moment', () => {
        const { onNext, onPrevious, scrollTo } = setup();
        scrollTo(MIDDLE);
        scrollTo(END_ALL_IN_VIEW);
        vi.advanceTimersByTime(499);
        expect(onNext).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onNext).toHaveBeenCalledTimes(1);
        expect(onPrevious).not.toHaveBeenCalled();
    });

    it('goes to the previous chapter when the zone at the start stays all in view for a moment', () => {
        const { onNext, onPrevious, scrollTo } = setup();
        scrollTo(MIDDLE);
        scrollTo(START_ALL_IN_VIEW);
        vi.advanceTimersByTime(500);
        expect(onPrevious).toHaveBeenCalledTimes(1);
        expect(onNext).not.toHaveBeenCalled();
    });

    it('does nothing when the user scrolls back before the moment is over', () => {
        const { onNext, scrollTo } = setup();
        scrollTo(MIDDLE);
        scrollTo(END_ALL_IN_VIEW);
        vi.advanceTimersByTime(300);
        scrollTo(END_ALL_IN_VIEW - 200);
        vi.advanceTimersByTime(2000);
        expect(onNext).not.toHaveBeenCalled();
    });

    it('waits the whole moment again when the zone is all in view again', () => {
        const { onNext, scrollTo } = setup();
        scrollTo(MIDDLE);
        scrollTo(END_ALL_IN_VIEW);
        vi.advanceTimersByTime(300);
        scrollTo(END_ALL_IN_VIEW - 200);
        scrollTo(END_ALL_IN_VIEW);
        vi.advanceTimersByTime(400);
        expect(onNext).not.toHaveBeenCalled();
        vi.advanceTimersByTime(100);
        expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('switches once, however long the user stays', () => {
        const { onNext, scrollTo } = setup();
        scrollTo(MIDDLE);
        scrollTo(END_ALL_IN_VIEW);
        vi.advanceTimersByTime(5000);
        scrollTo(END_ALL_IN_VIEW + 50);
        vi.advanceTimersByTime(5000);
        expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('does not switch when the zone was in view from the start, until it was out of view', () => {
        const { onNext, scrollTo } = setup({}, END_ALL_IN_VIEW);
        vi.advanceTimersByTime(2000);
        expect(onNext).not.toHaveBeenCalled();
        scrollTo(MIDDLE);
        scrollTo(END_ALL_IN_VIEW);
        vi.advanceTimersByTime(500);
        expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('does not switch when the setting says it is not automatic', () => {
        const { onNext, onPrevious, scrollTo } = setup({ automatic: false });
        scrollTo(MIDDLE);
        scrollTo(END_ALL_IN_VIEW);
        vi.advanceTimersByTime(2000);
        scrollTo(MIDDLE);
        scrollTo(START_ALL_IN_VIEW);
        vi.advanceTimersByTime(2000);
        expect(onNext).not.toHaveBeenCalled();
        expect(onPrevious).not.toHaveBeenCalled();
    });

    it('does not switch to a chapter that is not there', () => {
        const { onNext, onPrevious, scrollTo } = setup({ hasNext: false, hasPrevious: false });
        scrollTo(MIDDLE);
        scrollTo(END_ALL_IN_VIEW);
        vi.advanceTimersByTime(2000);
        scrollTo(MIDDLE);
        scrollTo(START_ALL_IN_VIEW);
        vi.advanceTimersByTime(2000);
        expect(onNext).not.toHaveBeenCalled();
        expect(onPrevious).not.toHaveBeenCalled();
    });

    it('uses the moment it is given', () => {
        const { onNext, scrollTo } = setup({ dwellMs: 1200 });
        scrollTo(MIDDLE);
        scrollTo(END_ALL_IN_VIEW);
        vi.advanceTimersByTime(1199);
        expect(onNext).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('does nothing while the zones are not on, and forgets a switch that was waiting when they go off', () => {
        const { onNext, scrollTo, rerender } = setup();
        scrollTo(MIDDLE);
        scrollTo(END_ALL_IN_VIEW);
        vi.advanceTimersByTime(300);
        rerender({ enabled: false });
        vi.advanceTimersByTime(2000);
        expect(onNext).not.toHaveBeenCalled();
    });

    it('uses the functions it has now, not the ones it started with', () => {
        const { onNext, scrollTo, rerender } = setup();
        const later = vi.fn();
        scrollTo(MIDDLE);
        scrollTo(END_ALL_IN_VIEW);
        rerender({ onNext: later });
        vi.advanceTimersByTime(500);
        expect(later).toHaveBeenCalledTimes(1);
        expect(onNext).not.toHaveBeenCalled();
    });

    it('switches again for the next chapter, once the zones were off and on', () => {
        const { onNext, scrollTo, rerender } = setup();
        scrollTo(MIDDLE);
        scrollTo(END_ALL_IN_VIEW);
        vi.advanceTimersByTime(500);
        expect(onNext).toHaveBeenCalledTimes(1);
        rerender({ enabled: false });
        rerender({ enabled: true });
        flushFrames();
        scrollTo(MIDDLE);
        scrollTo(END_ALL_IN_VIEW);
        vi.advanceTimersByTime(500);
        expect(onNext).toHaveBeenCalledTimes(2);
    });
});
