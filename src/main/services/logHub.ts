import { exitEventText, LOG_LINE_LIMIT, type LogLine, type LogSource, type LogStream } from '@shared/logs';
import { commandLine } from './errorDetails';
import { redactArgs, redactText } from './logRedaction';

export const MAX_LOG_LINES = LOG_LINE_LIMIT;
// The most characters of a line that are kept; a longer one is cut and ends with TRUNCATED_MARK.
export const MAX_LINE_LENGTH = 2000;
export const TRUNCATED_MARK = '…';
// A run writes at most one progress line in this time: progress comes several times a second and would push everything else out.
export const PROGRESS_LOG_INTERVAL_MS = 5000;

export type OutputStream = Extract<LogStream, 'stdout' | 'stderr'>;

// What one run of a program writes to the log of the program.
export interface LogWriter {
    // The command that was started.
    command: (program: string, args: readonly string[]) => void;
    // A line the program wrote (a blank one is left out).
    line: (stream: OutputStream, text: string) => void;
    // A line of progress: kept at most once in PROGRESS_LOG_INTERVAL_MS (the last one held back is kept when the run ends); a blank one is
    // left out.
    progress: (stream: OutputStream, text: string) => void;
    // The program ended, with its code or the signal that ended it.
    exit: (code: number | null, signal?: NodeJS.Signals | null) => void;
    // The program could not be started, or the app gave up on it.
    failure: (message: string) => void;
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

// The output of the programs the app runs, kept in memory only and never written to the disk: a buffer of the last lines of each program,
// with the secrets hidden. It is for a quick look while something goes wrong, and it is gone when the app closes.
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

    // Long lines are cut before the secrets are looked for (so a huge line costs little) and again after, to the length that is kept.
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

    // Writes one line to the log of a program; the secrets are hidden and a long line is cut.
    write(source: LogSource, stream: LogStream, text: string): void {
        this.append(source, stream, this.clean(text));
    }

    // A writer for one run of a program: the progress it writes is held back on its own, apart from the other runs.
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
            // The secrets are hidden argument by argument: looked for again in the whole line, a header would hide the arguments after it.
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
            }
        };
    }

    // The lines a program's log holds, oldest first (a copy: the buffer goes on changing).
    snapshot(source: LogSource): LogLine[] {
        return [...(this.buffers.get(source) ?? [])];
    }

    clear(source: LogSource): void {
        this.buffers.delete(source);
    }

    // Called with every line written from now on; the function returned stops it.
    onLine(listener: LogListener): () => void {
        this.listeners.add(listener);
        return (): void => {
            this.listeners.delete(listener);
        };
    }
}

// The logs of the app: the programs write here by default, and the window of the logs reads from here.
export const processLogs = new LogHub();
