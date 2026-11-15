import { useEffect, useRef, useState } from 'react';

export const SMOOTH_MS = 280;
const SETTLED = 0.05;

export function useSmoothPercent(target: number): number {
    const [shown, setShown] = useState(target);
    const current = useRef(target);

    useEffect(() => {
        if (target <= current.current) {
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
