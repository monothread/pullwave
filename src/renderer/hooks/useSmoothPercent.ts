import { useEffect, useRef, useState } from 'react';

// How long the bar takes to cover most of the way to a new value (an exponential approach: it starts fast and settles gently).
export const SMOOTH_MS = 280;
// Closer than this to the target, the bar is there.
const SETTLED = 0.05;

function prefersReducedMotion(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// A percentage that glides to the value it is given instead of jumping to it, frame by frame (a download reports a page at a time, so its
// bar would otherwise grow in steps). It starts at the value it first gets, and goes straight back down when the value goes down (a new
// try); with reduced motion it jumps.
export function useSmoothPercent(target: number): number {
    const [shown, setShown] = useState(target);
    const current = useRef(target);

    useEffect(() => {
        if (target <= current.current || prefersReducedMotion()) {
            current.current = target;
            setShown(target);
            return undefined;
        }
        let frame = 0;
        let last: number | null = null;
        const step = (now: number): void => {
            const elapsed = last === null ? 16 : now - last;
            last = now;
            const next = current.current + (target - current.current) * (1 - Math.exp(-elapsed / SMOOTH_MS));
            current.current = target - next < SETTLED ? target : next;
            setShown(current.current);
            if (current.current < target) {
                frame = requestAnimationFrame(step);
            }
        };
        frame = requestAnimationFrame(step);
        return () => {
            cancelAnimationFrame(frame);
        };
    }, [target]);

    return shown;
}
