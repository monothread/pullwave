import { useEffect, useRef, useState } from 'react';
import { usePerformanceMode } from './usePerformanceMode';

export const SMOOTH_MS = 280;
const SETTLED = 0.05;

export function useSmoothPercent(target: number): number {
    const performanceMode = usePerformanceMode();
    const [shown, setShown] = useState(target);
    const [wasPerformanceMode, setWasPerformanceMode] = useState(performanceMode);
    if (wasPerformanceMode !== performanceMode) {
        setWasPerformanceMode(performanceMode);
        if (wasPerformanceMode) {
            setShown(target);
        }
    }
    const current = useRef(target);

    useEffect(() => {
        if (performanceMode) {
            current.current = target;
            return undefined;
        }
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
    }, [target, performanceMode]);

    return performanceMode ? target : shown;
}
