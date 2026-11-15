import { exitEventText, LOG_LINE_LIMIT, STOPPED_BY_APP_EVENT, type LogLine, type LogSource, type LogStream } from '@shared/logs';
import { commandLine } from './errorDetails';
import { redactArgs, redactText } from './logRedaction';

export const MAX_LOG_LINES = LOG_LINE_LIMIT;
export const MAX_LINE_LENGTH = 2000;
export const TRUNCATED_MARK = '…';
export const PROGRESS_LOG_INTERVAL_MS = 5000;

export type OutputStream = Extract<LogStream, 'stdout' | 'stderr'>;

export interface LogWriter {
    command: (program: string, args: readonly string[]) => void;
    line: (stream: OutputStream, text: string) => void;
    progress: (stream: OutputStream, text: string) => void;
    exit: (code: number | null, signal?: NodeJS.Signals | null) => void;
    failure: (message: string) => void;
    stopped: () => void;
}

export type LogListener = (source: LogSource, line: LogLine) => void;

export interface LogHubOptions {
    maxLines?: number;
    maxLineLength?: number;
    progressIntervalMs?: number;
    now?: () => number;
}

interface HeldProgress {
    stream: OutputStream;
    text: string;
}

export class LogHub {
    private readonly buffers = new Map<LogSource, LogLine[]>();
    private readonly listeners = new Set<LogListener>();
    private nextId = 1;

    constructor(private readonly options: LogHubOptions = {}) {}

    private get maxLines(): number {
        return this.options.maxLines ?? MAX_LOG_LINES;
    }

    private get maxLineLength(): number {
        return this.options.maxLineLength ?? MAX_LINE_LENGTH;
    }

    private now(): number {
        return (this.options.now ?? Date.now)();
    }

    private truncate(text: string): string {
        return text.length > this.maxLineLength ? `${text.slice(0, this.maxLineLength)}${TRUNCATED_MARK}` : text;
    }

    private clean(text: string): string {
        return this.truncate(redactText(text.length > this.maxLineLength * 2 ? text.slice(0, this.maxLineLength * 2) : text));
    }

    private append(source: LogSource, stream: LogStream, text: string): void {
        const line: LogLine = { id: this.nextId, at: this.now(), stream, text };
        this.nextId += 1;
        const buffer = this.buffers.get(source) ?? [];
        buffer.push(line);
        if (buffer.length > this.maxLines) {
            buffer.splice(0, buffer.length - this.maxLines);
        }
        this.buffers.set(source, buffer);
        this.listeners.forEach((listener) => {
            listener(source, line);
        });
    }

    write(source: LogSource, stream: LogStream, text: string): void {
        this.append(source, stream, this.clean(text));
    }

    open(source: LogSource): LogWriter {
        let lastProgressAt: number | null = null;
        let held: HeldProgress | null = null;
        const releaseHeld = (): void => {
            if (held !== null) {
                this.write(source, held.stream, held.text);
                held = null;
            }
        };
        return {
            command: (program, args): void => {
                this.append(source, 'command', this.truncate(commandLine(program, redactArgs(args))));
            },
            line: (stream, text): void => {
                if (text.trim().length > 0) {
                    this.write(source, stream, text);
                }
            },
            progress: (stream, text): void => {
                if (text.trim().length === 0) {
                    return;
                }
                const now = this.now();
                if (lastProgressAt !== null && now - lastProgressAt < (this.options.progressIntervalMs ?? PROGRESS_LOG_INTERVAL_MS)) {
                    held = { stream, text };
                    return;
                }
                lastProgressAt = now;
                held = null;
                this.write(source, stream, text);
            },
            exit: (code, signal): void => {
                releaseHeld();
                this.write(source, 'event', exitEventText(code, signal ?? null));
            },
            failure: (message): void => {
                releaseHeld();
                this.write(source, 'event', message);
            },
            stopped: (): void => {
                releaseHeld();
                this.write(source, 'event', STOPPED_BY_APP_EVENT);
            }
        };
    }

    snapshot(source: LogSource): LogLine[] {
        return [...(this.buffers.get(source) ?? [])];
    }

    clear(source: LogSource): void {
        this.buffers.delete(source);
    }

    onLine(listener: LogListener): () => void {
        this.listeners.add(listener);
        return (): void => {
            this.listeners.delete(listener);
        };
    }
}

export const processLogs = new LogHub();
