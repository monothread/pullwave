export const LOG_SOURCES = ['yt-dlp', 'ani-cli', 'ffmpeg', 'suwayomi', 'flaresolverr'] as const;

export type LogSource = (typeof LOG_SOURCES)[number];

export const LOG_LINE_LIMIT = 2000;

export type LogStream = 'stdout' | 'stderr' | 'command' | 'event';

export interface LogLine {
    id: number;
    at: number;
    stream: LogStream;
    text: string;
}

export interface LogBatch {
    source: LogSource;
    lines: LogLine[];
}

export interface LogsApi {
    snapshot: (source: LogSource) => Promise<LogLine[]>;
    clear: (source: LogSource) => Promise<void>;
    watch: (source: LogSource, listener: (lines: LogLine[]) => void) => () => void;
}

export const SIGNAL_EVENT_PREFIX = 'ended by signal';

export const STOPPED_BY_APP_EVENT = 'stopped by the app';

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
