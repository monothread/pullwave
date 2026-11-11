import { LOG_LINE_LIMIT, type LogLine } from '@shared/logs';
import { logLevelOf, stripAnsiCodes } from './logHighlight';

// Which lines the window shows: all of them, only the warnings and the errors, or only the errors.
export type LogFilter = 'all' | 'warnings' | 'errors';

export const LOG_FILTERS: readonly LogFilter[] = ['all', 'warnings', 'errors'];

// The lines that come after the last one known are added (a line already there, sent again, is not); the oldest go past the limit.
export function mergeLogLines(current: readonly LogLine[], incoming: readonly LogLine[], limit: number = LOG_LINE_LIMIT): LogLine[] {
    const lastId = current.at(-1)?.id ?? 0;
    const added = incoming.filter((line) => {
        return line.id > lastId;
    });
    if (added.length === 0) {
        return [...current];
    }
    const merged = [...current, ...added];
    return merged.length > limit ? merged.slice(merged.length - limit) : merged;
}

function passesFilter(line: LogLine, filter: LogFilter): boolean {
    if (filter === 'all') {
        return true;
    }
    const level = logLevelOf(line);
    return level === 'error' || (filter === 'warnings' && level === 'warning');
}

// The lines that pass the filter and have the text searched (any case; the codes of the terminal are not part of the text).
export function filterLogLines(lines: readonly LogLine[], filter: LogFilter, query: string): LogLine[] {
    const needle = query.trim().toLowerCase();
    return lines.filter((line) => {
        return passesFilter(line, filter) && (needle.length === 0 || stripAnsiCodes(line.text).toLowerCase().includes(needle));
    });
}

function twoDigits(value: number): string {
    return String(value).padStart(2, '0');
}

// The time of a line, as the clock of the machine shows it, to the millisecond (`14:03:09.042`).
export function formatLogTime(at: number): string {
    const date = new Date(at);
    return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

// The lines as plain text to copy: the time, where the line came from and its text without the codes of the terminal.
export function formatLogText(lines: readonly LogLine[]): string {
    return lines
        .map((line) => {
            return `${formatLogTime(line.at)} [${line.stream}] ${stripAnsiCodes(line.text)}`;
        })
        .join('\n');
}
