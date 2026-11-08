import { useEffect, useRef } from 'react';

// How long the scroll takes to reach its speed when it starts, for the reader (the scroll then eases in instead of jumping to its pace).
export const AUTO_SCROLL_RAMP_MS = 600;

// The share of the speed `elapsed` milliseconds after the start: it grows slowly at first and then faster (a squared curve), from 0 to 1.
export function rampFactor(elapsed: number, rampMs: number): number {
    if (rampMs <= 0) {
        return 1;
    }
    const share = Math.min(1, Math.max(0, elapsed / rampMs));
    return share * share;
}

// Scrolls `container` down by itself at `speed` pixels per second while `active`, and calls `onEnd` when it reaches the bottom. When `onEnd`
// answers true the scroll goes on waiting at the bottom (the content may grow, or be replaced), otherwise it stops. With `rampMs` it eases in
// over that time when it starts.
export function useAutoScroll(container: () => HTMLElement | null, active: boolean, speed: number, onEnd: () => boolean | void, rampMs = 0): void {
    const containerRef = useRef(container);
    const endRef = useRef(onEnd);

    useEffect(() => {
        containerRef.current = container;
        endRef.current = onEnd;
    }, [container, onEnd]);

    useEffect(() => {
        if (!active) {
            return undefined;
        }
        let frame = 0;
        let last: number | null = null;
        let started: number | null = null;
        // The browser scrolls whole pixels: what is left of the step is kept for the next frame.
        let carried = 0;
        const step = (now: number): void => {
            const element = containerRef.current();
            if (element !== null && last !== null) {
                carried += (speed * rampFactor(now - (started ?? now), rampMs) * (now - last)) / 1000;
                const whole = Math.floor(carried);
                if (whole > 0) {
                    carried -= whole;
                    element.scrollTop += whole;
                }
                if (element.scrollTop + element.clientHeight >= element.scrollHeight - 1 && endRef.current() !== true) {
                    return;
                }
            }
            started ??= now;
            last = now;
            frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => {
            cancelAnimationFrame(frame);
        };
    }, [active, speed, rampMs]);
}
