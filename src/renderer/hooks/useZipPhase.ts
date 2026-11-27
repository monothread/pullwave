import { useEffect, useState } from 'react';
import { usePerformanceMode } from './usePerformanceMode';

export type ZipPhase = 'parts' | 'split' | 'zip' | 'settle' | 'joined';

export const ZIP_SPLIT_MS = 420;
export const ZIP_CLOSE_MS = 1000;
export const ZIP_SETTLE_MS = 350;

const NEXT: Partial<Record<ZipPhase, readonly [ZipPhase, number]>> = {
    split: ['zip', ZIP_SPLIT_MS],
    zip: ['settle', ZIP_CLOSE_MS],
    settle: ['joined', ZIP_SETTLE_MS]
};

interface ZipState {
    joined: boolean;
    phase: ZipPhase;
}

export function useZipPhase(joined: boolean): ZipPhase {
    const performanceMode = usePerformanceMode();
    const [state, setState] = useState<ZipState>({ joined, phase: joined ? 'joined' : 'parts' });
    if (state.joined !== joined) {
        setState({ joined, phase: joined ? (performanceMode ? 'joined' : 'split') : 'parts' });
    } else if (performanceMode && joined && state.phase !== 'joined') {
        setState({ joined: true, phase: 'joined' });
    }
    const phase = performanceMode ? (joined ? 'joined' : 'parts') : state.phase;

    useEffect(() => {
        if (performanceMode) {
            return undefined;
        }
        const next = NEXT[phase];
        if (next === undefined) {
            return undefined;
        }
        const [nextPhase, delay] = next;
        const timer = setTimeout(() => {
            setState((previous) => {
                return previous.phase === phase ? { ...previous, phase: nextPhase } : previous;
            });
        }, delay);
        return () => {
            clearTimeout(timer);
        };
    }, [phase, performanceMode]);

    return phase;
}
