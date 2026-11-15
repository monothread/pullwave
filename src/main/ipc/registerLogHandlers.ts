import { IPC } from '@shared/constants';
import { isLogSource, type LogBatch, type LogLine, type LogSource } from '@shared/logs';
import { MAX_LOG_LINES, type LogHub } from '../services/logHub';
import type { IpcMainLike } from './registerHandlers';

export const LOG_BATCH_MS = 150;

export interface LogHandlerDependencies {
    hub: Pick<LogHub, 'snapshot' | 'clear' | 'onLine'>;
    send: (channel: string, batch: LogBatch) => void;
    batchMs?: number;
}

export interface LogWatchers {
    stopAll: () => void;
}

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
