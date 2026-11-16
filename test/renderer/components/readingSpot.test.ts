// @vitest-environment jsdom
import { bringBackReadingSpot, readingSpotOf } from '@renderer/components/readingSpot';

interface Box {
    top: number;
    height: number;
}

function placed<T extends HTMLElement>(element: T, box: Box): T {
    element.getBoundingClientRect = (): DOMRect => {
        return { top: box.top, bottom: box.top + box.height, height: box.height, left: 0, right: 100, width: 100, x: 0, y: box.top, toJSON: () => { return {}; } };
    };
    return element;
}

function makeArea(top: number, height: number, scrollTop = 0): HTMLElement {
    const area = placed(document.createElement('div'), { top, height });
    Object.defineProperty(area, 'clientHeight', { configurable: true, value: height });
    let scrolled = scrollTop;
    Object.defineProperty(area, 'scrollTop', {
        configurable: true,
        get: () => {
            return scrolled;
        },
        set: (value: number) => {
            scrolled = value;
        }
    });
    return area;
}

function makePage(index: number | null, box: Box, tag = 'img'): HTMLElement {
    const page = placed(document.createElement(tag), box);
    if (index !== null) {
        page.dataset['page'] = String(index);
    }
    return page;
}

function makeFlow(pages: HTMLElement[]): HTMLElement {
    const flow = document.createElement('div');
    pages.forEach((page) => {
        flow.appendChild(page);
    });
    return flow;
}

describe('readingSpotOf', () => {
    it('is the page across the middle of the area and how far down it the middle is', () => {
        const area = makeArea(0, 1000);
        const flow = makeFlow([makePage(0, { top: -1200, height: 1000 }), makePage(1, { top: -200, height: 1000 }), makePage(2, { top: 800, height: 1000 })]);
        expect(readingSpotOf(area, flow)).toEqual({ page: 1, share: 0.7 });
    });

    it('measures the middle from where the area starts on the screen', () => {
        const area = makeArea(100, 800);
        const flow = makeFlow([makePage(0, { top: 0, height: 400 }), makePage(1, { top: 400, height: 400 })]);
        expect(readingSpotOf(area, flow)).toEqual({ page: 1, share: 0.25 });
    });

    it('is the page below with a share under zero when the middle falls in the gap between two pages', () => {
        const area = makeArea(0, 1000);
        const flow = makeFlow([makePage(0, { top: -500, height: 900 }), makePage(1, { top: 550, height: 1000 })]);
        expect(readingSpotOf(area, flow)).toEqual({ page: 1, share: -0.05 });
    });

    it('is the next page when the middle is exactly at the bottom of one', () => {
        const area = makeArea(0, 1000);
        const flow = makeFlow([makePage(0, { top: -500, height: 1000 }), makePage(1, { top: 500, height: 1000 })]);
        expect(readingSpotOf(area, flow)).toEqual({ page: 1, share: 0 });
    });

    it('passes over the pages that have no height yet and the pictures that are not pages', () => {
        const area = makeArea(0, 1000);
        const flow = makeFlow([makePage(null, { top: 0, height: 1000 }), makePage(0, { top: 300, height: 0 }, 'div'), makePage(1, { top: 300, height: 500 }, 'div')]);
        expect(readingSpotOf(area, flow)).toEqual({ page: 1, share: 0.4 });
    });

    it('is none when every page is above the middle', () => {
        const area = makeArea(0, 1000);
        const flow = makeFlow([makePage(0, { top: -900, height: 400 }), makePage(1, { top: -500, height: 400 })]);
        expect(readingSpotOf(area, flow)).toBeNull();
    });

    it('is none when there are no pages', () => {
        expect(readingSpotOf(makeArea(0, 1000), makeFlow([]))).toBeNull();
    });
});

describe('bringBackReadingSpot', () => {
    it('scrolls the area so that the spot of the page is in the middle again', () => {
        const area = makeArea(0, 1000, 5000);
        const flow = makeFlow([makePage(0, { top: -600, height: 1000 }), makePage(1, { top: 400, height: 1200 })]);
        bringBackReadingSpot(area, flow, { page: 1, share: 0.75 });
        expect(area.scrollTop).toBe(5000 + 400 + 900 - 500);
    });

    it('scrolls up when the spot is above the middle', () => {
        const area = makeArea(50, 900, 3000);
        const flow = makeFlow([makePage(0, { top: -2000, height: 1000 }), makePage(1, { top: -1000, height: 1000 })]);
        bringBackReadingSpot(area, flow, { page: 0, share: 0.5 });
        expect(area.scrollTop).toBe(3000 - 2000 + 500 - 500);
    });

    it('brings back a spot in the gap above a page', () => {
        const area = makeArea(0, 1000, 2000);
        const flow = makeFlow([makePage(1, { top: 800, height: 1000 })]);
        bringBackReadingSpot(area, flow, { page: 1, share: -0.05 });
        expect(area.scrollTop).toBe(2000 + 800 - 50 - 500);
    });

    it('leaves the area where it is when the page is not there', () => {
        const area = makeArea(0, 1000, 1234);
        const flow = makeFlow([makePage(0, { top: 0, height: 1000 })]);
        bringBackReadingSpot(area, flow, { page: 7, share: 0.5 });
        expect(area.scrollTop).toBe(1234);
    });
});
