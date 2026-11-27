import { useEffect, useState } from 'react';
import { usePerformanceMode } from './usePerformanceMode';

export const REVEAL_MILLISECONDS = 1100;

function easeOutCubic(time: number): number {
    return 1 - Math.pow(1 - time, 3);
}

interface RevealState {
    progress: number;
    settled: boolean;
}

export function useRevealProgress(active: boolean): number {
    const performanceMode = usePerformanceMode();
    const [state, setState] = useState<RevealState>(() => {
        return active && performanceMode ? { progress: 1, settled: true } : { progress: 0, settled: false };
    });

    if (!active && (state.progress !== 0 || state.settled)) {
        setState({ progress: 0, settled: false });
    } else if (active && performanceMode && (!state.settled || state.progress !== 1)) {
        setState({ progress: 1, settled: true });
    }

    useEffect(() => {
        if (!active || performanceMode || state.settled) {
            return undefined;
        }
        let frame = 0;
        let startedAt: number | null = null;
        const step = (now: number): void => {
            frame = 0;
            startedAt ??= now;
            const time = Math.min(1, (now - startedAt) / REVEAL_MILLISECONDS);
            setState({ progress: easeOutCubic(time), settled: time >= 1 });
            if (time < 1) {
                frame = requestAnimationFrame(step);
            }
        };
        frame = requestAnimationFrame(step);
        return () => {
            if (frame !== 0) {
                cancelAnimationFrame(frame);
            }
        };
    }, [active, performanceMode, state.settled]);

    if (!active) {
        return 0;
    }
    return performanceMode ? 1 : state.progress;
}
