// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { READING_SPOT_KEEP_MS, useReadingSpotKeeper } from '@renderer/hooks/useReadingSpotKeeper';
import { installFakeFullscreen, type FakeFullscreen } from '../../helpers/fakeFullscreen';

const AREA_HEIGHT = 1000;
const PAGE_COUNT = 4;
const PAGE_RATIO = 1.5;

interface Scene {
    area: HTMLElement;
    flow: HTMLElement;
    setWidth: (width: number) => void;
    scrollTo: (top: number) => void;
}

function rect(top: number, width: number, height: number): DOMRect {
    return { top, bottom: top + height, height, left: 0, right: width, width, x: 0, y: top, toJSON: () => { return {}; } };
}

function makeScene(): Scene {
    let width = 1000;
    let scrolled = 0;
    const area = document.createElement('main');
    Object.defineProperty(area, 'clientHeight', { configurable: true, value: AREA_HEIGHT });
    Object.defineProperty(area, 'scrollTop', {
        configurable: true,
        get: () => {
            return scrolled;
        },
        set: (value: number) => {
            scrolled = value;
        }
    });
    area.getBoundingClientRect = (): DOMRect => {
        return rect(0, 1920, AREA_HEIGHT);
    };
    const flow = document.createElement('div');
    flow.getBoundingClientRect = (): DOMRect => {
        return rect(-scrolled, width, width * PAGE_RATIO * PAGE_COUNT);
    };
    for (let index = 0; index < PAGE_COUNT; index += 1) {
        const page = document.createElement('img');
        page.dataset['page'] = String(index);
        page.getBoundingClientRect = (): DOMRect => {
            const height = width * PAGE_RATIO;
            return rect(index * height - scrolled, width, height);
        };
        flow.appendChild(page);
    }
    area.appendChild(flow);
    document.body.appendChild(area);
    return {
        area,
        flow,
        setWidth: (next: number) => {
            width = next;
        },
        scrollTo: (top: number) => {
            scrolled = top;
            area.dispatchEvent(new Event('scroll'));
        }
    };
}

let observers: { callback: ResizeObserverCallback; observed: Element[]; disconnect: ReturnType<typeof vi.fn> }[];
let fake: FakeFullscreen;
let scene: Scene;

class FakeResizeObserver {
    observed: Element[] = [];
    disconnect = vi.fn();

    constructor(public callback: ResizeObserverCallback) {
        observers.push(this);
    }

    observe(element: Element): void {
        this.observed.push(element);
    }
}

function resize(): void {
    observers.forEach((observer) => {
        observer.callback([], {} as ResizeObserver);
    });
}

function setup(enabled = true, flowElement: HTMLElement | null = scene.flow) {
    const area = vi.fn((): HTMLElement => {
        return scene.area;
    });
    const flow = { current: flowElement };
    const hook = renderHook(
        ({ on }: { on: boolean }) => {
            useReadingSpotKeeper(area, flow, on);
        },
        { initialProps: { on: enabled } }
    );
    return { ...hook, area };
}

function enterFullscreen(): void {
    void scene.area.requestFullscreen();
}

beforeEach(() => {
    vi.useFakeTimers();
    observers = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    fake = installFakeFullscreen();
    scene = makeScene();
});

afterEach(() => {
    fake.restore();
    scene.area.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('useReadingSpotKeeper', () => {
    it('keeps the spot for two seconds after the fullscreen changes', () => {
        expect(READING_SPOT_KEEP_MS).toBe(2000);
    });

    it('watches the size of the pages and the scroll of the area', () => {
        const addArea = vi.spyOn(scene.area, 'addEventListener');
        const addWindow = vi.spyOn(window, 'addEventListener');
        const { area } = setup();
        expect(area).toHaveBeenCalledTimes(1);
        expect(observers).toHaveLength(1);
        expect(observers[0]!.observed).toEqual([scene.flow]);
        expect(addArea).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
        expect(addWindow.mock.calls.map((call) => { return [call[0], call[2]]; })).toEqual([
            ['wheel', { passive: true }],
            ['touchstart', { passive: true }],
            ['mousedown', { passive: true }]
        ]);
    });

    it('brings back the page and the spot in it when the pages grow on going into fullscreen', () => {
        setup();
        scene.scrollTo(1750);
        enterFullscreen();
        scene.setWidth(1200);
        resize();
        expect(scene.area.scrollTop).toBe(2200);
    });

    it('brings back the spot read in fullscreen when the pages shrink on leaving it', () => {
        setup();
        enterFullscreen();
        scene.setWidth(1200);
        resize();
        vi.advanceTimersByTime(READING_SPOT_KEEP_MS);
        scene.scrollTo(3550);
        fake.end();
        scene.setWidth(1000);
        resize();
        expect(scene.area.scrollTop).toBe(2875);
    });

    it('brings it back on every change of size while it is kept, as the window grows in steps', () => {
        setup();
        scene.scrollTo(1750);
        enterFullscreen();
        scene.setWidth(1100);
        resize();
        expect(scene.area.scrollTop).toBe(1975);
        vi.advanceTimersByTime(READING_SPOT_KEEP_MS - 1);
        scene.setWidth(1200);
        resize();
        expect(scene.area.scrollTop).toBe(2200);
    });

    it('stops keeping it once the time is over, and then only reads the new spot', () => {
        setup();
        scene.scrollTo(1750);
        enterFullscreen();
        scene.setWidth(1200);
        resize();
        vi.advanceTimersByTime(READING_SPOT_KEEP_MS);
        scene.setWidth(1100);
        resize();
        expect(scene.area.scrollTop).toBe(2200);
    });

    it('leaves the scroll alone when the size changes without a change of fullscreen, and keeps the spot read at the new size', () => {
        setup();
        scene.scrollTo(1750);
        scene.setWidth(800);
        resize();
        expect(scene.area.scrollTop).toBe(1750);
        enterFullscreen();
        scene.setWidth(1600);
        resize();
        expect(scene.area.scrollTop).toBe(4000);
    });

    it('does not read the scroll while the spot is kept', () => {
        setup();
        scene.scrollTo(1750);
        enterFullscreen();
        scene.setWidth(1200);
        resize();
        scene.scrollTo(100);
        scene.setWidth(1300);
        resize();
        expect(scene.area.scrollTop).toBe(2425);
    });

    it('does not read a scroll that comes after the pages changed size and before the change is seen', () => {
        setup();
        scene.scrollTo(1750);
        scene.setWidth(1200);
        scene.scrollTo(400);
        enterFullscreen();
        resize();
        expect(scene.area.scrollTop).toBe(2200);
    });

    it.each(['wheel', 'touchstart', 'mousedown'])('lets go of the spot when the user moves the pages with %s', (name) => {
        setup();
        scene.scrollTo(1750);
        enterFullscreen();
        scene.setWidth(1200);
        resize();
        window.dispatchEvent(new Event(name));
        scene.scrollTo(500);
        resize();
        expect(scene.area.scrollTop).toBe(500);
        scene.setWidth(1300);
        resize();
        expect(scene.area.scrollTop).toBe(500);
    });

    it('leaves the scroll alone when no page is in the middle', () => {
        setup();
        scene.scrollTo(6000);
        enterFullscreen();
        scene.setWidth(1200);
        resize();
        expect(scene.area.scrollTop).toBe(6000);
    });

    it('does nothing while it is off', () => {
        const { area } = setup(false);
        expect(observers).toEqual([]);
        expect(area).not.toHaveBeenCalled();
        scene.scrollTo(1750);
        enterFullscreen();
        scene.setWidth(1200);
        expect(scene.area.scrollTop).toBe(1750);
    });

    it('does nothing when there are no pages on the screen', () => {
        const { area } = setup(true, null);
        expect(observers).toEqual([]);
        expect(area).not.toHaveBeenCalled();
    });

    it('does nothing where the size of the pages cannot be watched', () => {
        vi.stubGlobal('ResizeObserver', undefined);
        const addArea = vi.spyOn(scene.area, 'addEventListener');
        const { area } = setup();
        expect(area).not.toHaveBeenCalled();
        expect(addArea).not.toHaveBeenCalled();
    });

    it('starts watching when it is turned on and stops when it is turned off', () => {
        const { rerender } = setup(false);
        rerender({ on: true });
        expect(observers).toHaveLength(1);
        rerender({ on: false });
        expect(observers[0]!.disconnect).toHaveBeenCalledTimes(1);
    });

    it('stops watching and listening when it is removed', () => {
        const addArea = vi.spyOn(scene.area, 'addEventListener');
        const removeArea = vi.spyOn(scene.area, 'removeEventListener');
        const addWindow = vi.spyOn(window, 'addEventListener');
        const removeWindow = vi.spyOn(window, 'removeEventListener');
        const { unmount } = setup();
        unmount();
        expect(observers[0]!.disconnect).toHaveBeenCalledTimes(1);
        expect(removeArea.mock.calls).toEqual([['scroll', addArea.mock.calls[0]![1]]]);
        const release = addWindow.mock.calls[0]![1];
        expect(removeWindow.mock.calls).toEqual([
            ['wheel', release],
            ['touchstart', release],
            ['mousedown', release]
        ]);
    });
});
