import { useEffect, useRef, useState, type RefObject } from 'react';
import { endZoneProgress, startZoneProgress, ZONE_ARM_BELOW, ZONE_DWELL_MS, ZONE_FULL } from '../components/chapterZones';

export interface ChapterZonesOptions {
    // The area that scrolls, and the bar that stays on top of it.
    area: () => HTMLElement | null;
    bar: () => HTMLElement | null;
    startZone: RefObject<HTMLElement | null>;
    endZone: RefObject<HTMLElement | null>;
    // Whether the zones are there to be scrolled through (the scroll modes, with the chapter on the screen).
    enabled: boolean;
    // Whether going through a zone switches the chapter by itself (the setting), and whether there is a chapter on the other side.
    automatic: boolean;
    hasPrevious: boolean;
    hasNext: boolean;
    onPrevious: () => void;
    onNext: () => void;
    dwellMs?: number;
}

export interface ChapterZonesState {
    start: number;
    end: number;
}

const IDLE: ChapterZonesState = { start: 0, end: 0 };

// How much of each zone is in view, kept up to date as the area scrolls, and the switch of chapter when a zone stays all in view for a
// moment (only for a zone that was out of view first, and once for each chapter).
export function useChapterZones(options: ChapterZonesOptions): ChapterZonesState {
    const { area, bar, startZone, endZone, enabled, automatic, hasPrevious, hasNext, onPrevious, onNext, dwellMs = ZONE_DWELL_MS } = options;
    const [state, setState] = useState<ChapterZonesState>({ start: 0, end: 0 });
    const latest = useRef({ automatic, hasPrevious, hasNext, onPrevious, onNext });
    useEffect(() => {
        latest.current = { automatic, hasPrevious, hasNext, onPrevious, onNext };
    }, [automatic, hasPrevious, hasNext, onPrevious, onNext]);

    useEffect(() => {
        const scrolling = area();
        if (!enabled || scrolling === null) {
            return undefined;
        }
        const armed = { start: false, end: false };
        const timers: { start: number | null; end: number | null } = { start: null, end: null };
        let fired = false;
        let frame = 0;

        const clear = (edge: 'start' | 'end'): void => {
            if (timers[edge] !== null) {
                window.clearTimeout(timers[edge] as number);
                timers[edge] = null;
            }
        };
        const watch = (edge: 'start' | 'end', progress: number, can: boolean): void => {
            if (progress <= ZONE_ARM_BELOW) {
                armed[edge] = true;
            }
            if (!latest.current.automatic || !can || !armed[edge] || fired || progress < ZONE_FULL) {
                clear(edge);
                return;
            }
            if (timers[edge] === null) {
                timers[edge] = window.setTimeout(() => {
                    timers[edge] = null;
                    if (fired) {
                        return;
                    }
                    fired = true;
                    if (edge === 'start') {
                        latest.current.onPrevious();
                    } else {
                        latest.current.onNext();
                    }
                }, dwellMs);
            }
        };
        const update = (): void => {
            frame = 0;
            const areaBox = scrolling.getBoundingClientRect();
            const start = startZone.current;
            const end = endZone.current;
            const visibleTop = bar()?.getBoundingClientRect().bottom ?? areaBox.top;
            const startProgress = start === null ? 0 : startZoneProgress(start.getBoundingClientRect(), visibleTop);
            const endProgress = end === null ? 0 : endZoneProgress(end.getBoundingClientRect(), areaBox.bottom);
            setState((current) => {
                const near = (first: number, second: number): boolean => {
                    return Math.abs(first - second) < 0.005;
                };
                return near(current.start, startProgress) && near(current.end, endProgress) ? current : { start: startProgress, end: endProgress };
            });
            watch('start', startProgress, latest.current.hasPrevious);
            watch('end', endProgress, latest.current.hasNext);
        };
        const schedule = (): void => {
            if (frame === 0) {
                frame = requestAnimationFrame(update);
            }
        };
        update();
        scrolling.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
        [startZone.current, endZone.current].forEach((element) => {
            if (element !== null) {
                observer?.observe(element);
            }
        });
        return () => {
            scrolling.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            observer?.disconnect();
            if (frame !== 0) {
                cancelAnimationFrame(frame);
            }
            clear('start');
            clear('end');
        };
    }, [area, bar, startZone, endZone, enabled, dwellMs]);

    return enabled ? state : IDLE;
}
