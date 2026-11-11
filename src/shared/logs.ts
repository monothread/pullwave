// The programs whose output can be read in the window of the logs: each one has a buffer of its own, kept in memory only.
export const LOG_SOURCES = ['yt-dlp', 'ani-cli', 'ffmpeg', 'suwayomi', 'flaresolverr'] as const;

export type LogSource = (typeof LOG_SOURCES)[number];

// The most lines a program's log keeps, in the app and in the window that shows it: the oldest go when a new one comes.
export const LOG_LINE_LIMIT = 2000;

// Where a line came from: what the program wrote on each of its outputs, the command the app ran, or something the app noticed about the
// process (it ended, it could not be started).
export type LogStream = 'stdout' | 'stderr' | 'command' | 'event';

export interface LogLine {
    // Grows by one with every line of every program, so the window can tell the lines apart and in order.
    id: number;
    // When it was written (milliseconds since 1970).
    at: number;
    stream: LogStream;
    text: string;
}

// The lines written to a program's log since the last batch sent to the window.
export interface LogBatch {
    source: LogSource;
    lines: LogLine[];
}

export interface LogsApi {
    // What the buffer of a program holds now, oldest first.
    snapshot: (source: LogSource) => Promise<LogLine[]>;
    // Empties the buffer of a program.
    clear: (source: LogSource) => Promise<void>;
    // Starts sending the new lines of a program to the window; the function returned stops it.
    watch: (source: LogSource, listener: (lines: LogLine[]) => void) => () => void;
}

// How the line that tells how a program ended begins when a signal ended it.
export const SIGNAL_EVENT_PREFIX = 'ended by signal';

// The line written to a log when the app ended a program on purpose (following the output of a container that was stopped), instead of the
// code it ended with: the code says nothing then (143 from the SIGTERM of the app) and would read as a failure.
export const STOPPED_BY_APP_EVENT = 'stopped by the app';

// The line written to a log when a program ends: the signal that ended it, or its exit code.
export function exitEventText(code: number | null, signal: string | null): string {
    if (signal !== null) {
        return `${SIGNAL_EVENT_PREFIX} ${signal}`;
    }
    return code === null ? 'ended without an exit code' : `exited with code ${String(code)}`;
}

export function isLogSource(value: unknown): value is LogSource {
    return LOG_SOURCES.some((source) => {
        return source === value;
    });
}
