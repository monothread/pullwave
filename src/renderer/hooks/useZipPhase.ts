import { useEffect, useState } from 'react';

// The moments of the joining of the bars of a download that came in parts (the video and the audio): the bars apart, the bars stretching
// to the whole width while their names and percentages go, the zipper closing them into one from the start to the end, the box shrinking to
// the one bar, and the one bar.
export type ZipPhase = 'parts' | 'split' | 'zip' | 'settle' | 'joined';

// How long each moment lasts (the CSS of the zipper takes the same times).
export const ZIP_SPLIT_MS = 420;
export const ZIP_CLOSE_MS = 1000;
export const ZIP_SETTLE_MS = 350;

// The moment that follows each moment of the joining, and when.
const NEXT: Partial<Record<ZipPhase, readonly [ZipPhase, number]>> = {
    split: ['zip', ZIP_SPLIT_MS],
    zip: ['settle', ZIP_CLOSE_MS],
    settle: ['joined', ZIP_SETTLE_MS]
};

interface ZipState {
    joined: boolean;
    phase: ZipPhase;
}

// Where the bars of a download in parts are: apart while it downloads; once it is joined (the steps after the download started, or it
// ended), the zipper closes them, a moment after the other; a download that was already joined when it was first shown is one bar at once.
// A download that goes back to downloading (tried again) has its bars apart again.
export function useZipPhase(joined: boolean): ZipPhase {
    const [state, setState] = useState<ZipState>({ joined, phase: joined ? 'joined' : 'parts' });
    if (state.joined !== joined) {
        setState({ joined, phase: joined ? 'split' : 'parts' });
    }
    const phase = state.phase;

    useEffect(() => {
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
    }, [phase]);

    return phase;
}
