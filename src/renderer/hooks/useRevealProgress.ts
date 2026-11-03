import { useEffect, useState } from 'react';

export const REVEAL_MILLISECONDS = 1100;

function easeOutCubic(time: number): number {
    return 1 - Math.pow(1 - time, 3);
}

// Goes from 0 to 1 (slowing down at the end) when `active` turns on, and goes back to 0 when it turns off. It is what makes the numbers
// count up while the drawing grows.
export function useRevealProgress(active: boolean): number {
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        if (!active) {
            return undefined;
        }
        let frame = 0;
        let startedAt: number | null = null;
        const step = (now: number): void => {
            startedAt ??= now;
            const time = Math.min(1, (now - startedAt) / REVEAL_MILLISECONDS);
            setProgress(easeOutCubic(time));
            if (time < 1) {
                frame = requestAnimationFrame(step);
            }
        };
        frame = requestAnimationFrame(step);
        return () => {
            cancelAnimationFrame(frame);
            setProgress(0);
        };
    }, [active]);

    return progress;
}
