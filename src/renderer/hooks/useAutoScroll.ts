import { useEffect, useRef } from 'react';

// Scrolls `container` down by itself at `speed` pixels per second while `active`, and calls `onEnd` when it reaches the bottom. When `onEnd`
// answers true the scroll goes on waiting at the bottom (the content may grow, or be replaced), otherwise it stops.
export function useAutoScroll(container: () => HTMLElement | null, active: boolean, speed: number, onEnd: () => boolean | void): void {
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
        // The browser scrolls whole pixels: what is left of the step is kept for the next frame.
        let carried = 0;
        const step = (now: number): void => {
            const element = containerRef.current();
            if (element !== null && last !== null) {
                carried += (speed * (now - last)) / 1000;
                const whole = Math.floor(carried);
                if (whole > 0) {
                    carried -= whole;
                    element.scrollTop += whole;
                }
                if (element.scrollTop + element.clientHeight >= element.scrollHeight - 1 && endRef.current() !== true) {
                    return;
                }
            }
            last = now;
            frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => {
            cancelAnimationFrame(frame);
        };
    }, [active, speed]);
}
