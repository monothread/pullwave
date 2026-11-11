import { IPC } from '@shared/constants';
import { isLogSource, type LogBatch, type LogLine, type LogSource } from '@shared/logs';
import { MAX_LOG_LINES, type LogHub } from '../services/logHub';
import type { IpcMainLike } from './registerHandlers';

// The new lines are sent to the window together, at most this often: a program that writes many lines does not flood it.
export const LOG_BATCH_MS = 150;

export interface LogHandlerDependencies {
    hub: Pick<LogHub, 'snapshot' | 'clear' | 'onLine'>;
    send: (channel: string, batch: LogBatch) => void;
    batchMs?: number;
}

export interface LogWatchers {
    // Stops sending lines of every program (the page of the window was loaded again: what watched them is gone).
    stopAll: () => void;
}

// The window of the logs: it reads what a program's log holds, empties it, and, while it is open, gets the new lines of the programs it
// shows. Nothing is sent for a program no window watches.
export function registerLogHandlers(ipcMain: IpcMainLike, deps: LogHandlerDependencies): LogWatchers {
    const watched = new Set<LogSource>();
    const pending = new Map<LogSource, LogLine[]>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = (): void => {
        timer = null;
        pending.forEach((lines, source) => {
            deps.send(IPC.eventLogLines, { source, lines });
        });
        pending.clear();
    };

    const queue = (source: LogSource, line: LogLine): void => {
        const lines = pending.get(source) ?? [];
        lines.push(line);
        // A window that does not take the lines (it hangs) holds no more of them than the log itself.
        if (lines.length > MAX_LOG_LINES) {
            lines.splice(0, lines.length - MAX_LOG_LINES);
        }
        pending.set(source, lines);
        timer ??= setTimeout(flush, deps.batchMs ?? LOG_BATCH_MS);
    };

    deps.hub.onLine((source, line) => {
        if (watched.has(source)) {
            queue(source, line);
        }
    });

    ipcMain.handle(IPC.logsSnapshot, (_event, source): LogLine[] => {
        return isLogSource(source) ? deps.hub.snapshot(source) : [];
    });
    ipcMain.handle(IPC.logsClear, (_event, source): void => {
        if (isLogSource(source)) {
            deps.hub.clear(source);
            pending.delete(source);
        }
    });
    ipcMain.handle(IPC.logsWatch, (_event, source): void => {
        if (isLogSource(source)) {
            watched.add(source);
        }
    });
    ipcMain.handle(IPC.logsUnwatch, (_event, source): void => {
        if (isLogSource(source)) {
            watched.delete(source);
            pending.delete(source);
        }
    });

    return {
        stopAll: (): void => {
            watched.clear();
            pending.clear();
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
        }
    };
}
