import { useCallback, useEffect, useState } from 'react';
import type { LogLine, LogSource } from '@shared/logs';
import { mergeLogLines } from '../components/logView';

interface LogLines {
    lines: LogLine[];
    loaded: boolean;
    clear: () => Promise<void>;
}

interface LogState {
    source: LogSource;
    lines: LogLine[];
    loaded: boolean;
}

function emptyState(source: LogSource): LogState {
    return { source, lines: [], loaded: false };
}

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
