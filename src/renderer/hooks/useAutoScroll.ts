import { useEffect, useRef } from 'react';

export const AUTO_SCROLL_RAMP_MS = 600;

export function rampFactor(elapsed: number, rampMs: number): number {
    if (rampMs <= 0) {
        return 1;
    }
    const share = Math.min(1, Math.max(0, elapsed / rampMs));
    return share * share;
}

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
