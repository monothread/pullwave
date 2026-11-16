import { type RefObject, useEffect } from 'react';
import { bringBackReadingSpot, readingSpotOf, type ReadingSpot } from '../components/readingSpot';

export const READING_SPOT_KEEP_MS = 2000;
const RELEASE_EVENTS = ['wheel', 'touchstart', 'mousedown'] as const;

interface Reading {
    spot: ReadingSpot | null;
    width: number;
    fullscreen: Element | null;
    keptUntil: number;
}

function widthOf(element: HTMLElement): number {
    return element.getBoundingClientRect().width;
}

export function useReadingSpotKeeper(area: () => HTMLElement, flow: RefObject<HTMLElement | null>, enabled: boolean): void {
    useEffect(() => {
        const element = flow.current;
        if (!enabled || element === null || typeof ResizeObserver === 'undefined') {
            return undefined;
        }
        const scroller = area();
        const reading: Reading = { spot: null, width: 0, fullscreen: document.fullscreenElement, keptUntil: 0 };
        const keeping = (): boolean => {
            return Date.now() < reading.keptUntil;
        };
        const note = (): void => {
            reading.spot = readingSpotOf(scroller, element);
            reading.width = widthOf(element);
        };
        const onScroll = (): void => {
            if (!keeping() && widthOf(element) === reading.width) {
                note();
            }
        };
        const onResize = (): void => {
            if (document.fullscreenElement !== reading.fullscreen || (reading.spot !== null && widthOf(element) !== reading.width)) {
                reading.fullscreen = document.fullscreenElement;
                reading.keptUntil = Date.now() + READING_SPOT_KEEP_MS;
            }
            if (keeping() && reading.spot !== null) {
                bringBackReadingSpot(scroller, element, reading.spot);
                reading.width = widthOf(element);
                return;
            }
            note();
        };
        const release = (): void => {
            reading.keptUntil = 0;
        };
        note();
        const observer = new ResizeObserver(onResize);
        observer.observe(element);
        scroller.addEventListener('scroll', onScroll, { passive: true });
        RELEASE_EVENTS.forEach((name) => {
            window.addEventListener(name, release, { passive: true });
        });
        return () => {
            observer.disconnect();
            scroller.removeEventListener('scroll', onScroll);
            RELEASE_EVENTS.forEach((name) => {
                window.removeEventListener(name, release);
            });
        };
    }, [area, flow, enabled]);
}
