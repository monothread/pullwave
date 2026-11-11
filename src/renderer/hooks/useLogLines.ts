import { useCallback, useEffect, useState } from 'react';
import type { LogLine, LogSource } from '@shared/logs';
import { mergeLogLines } from '../components/logView';

interface LogLines {
    lines: LogLine[];
    // Whether what the log held when the window opened has arrived.
    loaded: boolean;
    // Empties the log of the program (in the app too).
    clear: () => Promise<void>;
}

interface LogState {
    // The program the lines are of: lines of another program (the one shown before) are not shown.
    source: LogSource;
    lines: LogLine[];
    loaded: boolean;
}

function emptyState(source: LogSource): LogState {
    return { source, lines: [], loaded: false };
}

// The lines of a program's log while the window shows it: what it holds, then the new ones as they come. The new lines are watched before
// what it holds is asked, so none is lost in between; the ones that came twice are left out by their id.
export function useLogLines(source: LogSource): LogLines {
    const [state, setState] = useState<LogState>(() => {
        return emptyState(source);
    });
    const current = state.source === source ? state : emptyState(source);

    useEffect(() => {
        let active = true;
        let snapshotArrived = false;
        let early: LogLine[] = [];
        const stop = window.api.logs.watch(source, (batch) => {
            if (!snapshotArrived) {
                early = [...early, ...batch];
                return;
            }
            setState((previous) => {
                const known = previous.source === source ? previous : emptyState(source);
                return { ...known, lines: mergeLogLines(known.lines, batch) };
            });
        });
        void window.api.logs.snapshot(source).then((snapshot) => {
            if (!active) {
                return;
            }
            snapshotArrived = true;
            setState({ source, lines: mergeLogLines(snapshot, early), loaded: true });
            early = [];
        });
        return () => {
            active = false;
            stop();
        };
    }, [source]);

    const clear = useCallback(async (): Promise<void> => {
        await window.api.logs.clear(source);
        setState((previous) => {
            return { source, lines: [], loaded: previous.source === source ? previous.loaded : false };
        });
    }, [source]);

    return { lines: current.lines, loaded: current.loaded, clear };
}
