import { exitEventText, SIGNAL_EVENT_PREFIX, STOPPED_BY_APP_EVENT, type LogLine } from '@shared/logs';

// How serious a line is, for its color and for the filter of the window.
export type LogLevel = 'error' | 'warning' | 'info' | 'debug' | 'success' | 'command' | 'plain';

// What a piece of a line is, for its color.
export type LogTokenKind = 'text' | 'level' | 'tag' | 'url' | 'path' | 'time' | 'string' | 'flag' | 'size' | 'redacted';

// The colors a program can ask for with ANSI codes (the bright ones are the same name with `bright-`).
export type AnsiColor = 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white';

export interface AnsiStyle {
    color: `${'' | 'bright-'}${AnsiColor}` | null;
    bold: boolean;
}

export interface LogToken {
    text: string;
    kind: LogTokenKind;
    // The style the program itself gave the piece, or null: a piece the program colored keeps its color and is not looked at for kinds.
    ansi: AnsiStyle | null;
}

const ESC = String.fromCharCode(27);
// A code of the terminal: SGR (`ESC[...m`, the colors) or any other (cursor moves, clearing the line), which are taken out.
const ANSI_SEQUENCE = new RegExp(`${ESC}\\[([0-9;?]*)([A-Za-z])`, 'g');
const ANSI_COLORS: readonly AnsiColor[] = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
const NO_STYLE: AnsiStyle = { color: null, bold: false };

// The kinds a piece of plain text is looked at for, in order: the first one that matches at a place wins.
const TOKEN_PATTERNS: ReadonlyArray<{ kind: Exclude<LogTokenKind, 'text'>; pattern: string }> = [
    { kind: 'redacted', pattern: '\\*\\*\\*' },
    // An address stops at a hidden secret (`?token=***`), so the secret is marked as one.
    { kind: 'url', pattern: '\\b[a-z][a-z0-9+.-]*:\\/\\/[^\\s"\'<>*]+' },
    { kind: 'time', pattern: '\\b\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?Z?|\\b\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?\\b' },
    { kind: 'level', pattern: '\\b(?:ERROR|WARNING|WARN|INFO|DEBUG|TRACE|FATAL|SEVERE|CRITICAL)\\b:?' },
    { kind: 'tag', pattern: '\\[[^\\]\\s][^\\]]{0,48}\\]' },
    { kind: 'string', pattern: '"[^"\\n]{0,400}"' },
    { kind: 'path', pattern: '(?<![\\w:/.~-])(?:[A-Za-z]:\\\\|~?\\/)[^\\s"\'<>]+' },
    { kind: 'flag', pattern: '(?<=^|\\s)--?[A-Za-z][\\w-]*' },
    { kind: 'size', pattern: '\\b\\d+(?:\\.\\d+)?(?:%|\\s?[KMGT]i?B\\b|\\s?B\\b)' }
];
const TOKENS = new RegExp(
    TOKEN_PATTERNS.map(({ pattern }) => {
        return `(${pattern})`;
    }).join('|'),
    'g'
);

const ERROR_LINE = /^\s*(?:ERROR|FATAL|CRITICAL|SEVERE)\b|\b(?:ERROR|FATAL|CRITICAL|SEVERE)\b|^\s*Caused by:|^\s+at [\w$.]+\(|\b\w*(?:Exception|Error):|^Traceback\b|\b(?:failed|failure|denied|refused|unable to|cannot|could not)\b/i;
const WARNING_LINE = /\b(?:WARNING|WARN)\b|\bdeprecated\b/i;
const DEBUG_LINE = /\[debug\]|\b(?:DEBUG|TRACE)\b/;
const INFO_LINE = /\bINFO\b/;

// The text of a line without the codes of the terminal (to copy it, to search it, and to tell how serious it is).
export function stripAnsiCodes(text: string): string {
    return text.replace(ANSI_SEQUENCE, '');
}

// The style after an SGR code: 0 (or nothing) resets, 1 is bold, 22 is not bold, 30-37 and 90-97 are the colors, 39 the default one.
export function applySgr(style: AnsiStyle, parameters: string): AnsiStyle {
    const codes = parameters.length === 0 ? [0] : parameters.split(';').map(Number);
    return codes.reduce<AnsiStyle>((current, code) => {
        if (code === 0) {
            return NO_STYLE;
        }
        if (code === 1) {
            return { ...current, bold: true };
        }
        if (code === 22) {
            return { ...current, bold: false };
        }
        if (code === 39) {
            return { ...current, color: null };
        }
        if (code >= 30 && code <= 37) {
            return { ...current, color: ANSI_COLORS[code - 30] ?? null };
        }
        if (code >= 90 && code <= 97) {
            const color = ANSI_COLORS[code - 90];
            return { ...current, color: color === undefined ? null : `bright-${color}` };
        }
        return current;
    }, style);
}

interface StyledRun {
    text: string;
    style: AnsiStyle;
}

// The line cut where its style changes; the codes that are not colors are dropped.
export function splitAnsiRuns(text: string): StyledRun[] {
    const runs: StyledRun[] = [];
    let style = NO_STYLE;
    let start = 0;
    const push = (end: number): void => {
        if (end > start) {
            runs.push({ text: text.slice(start, end), style });
        }
    };
    for (const match of text.matchAll(ANSI_SEQUENCE)) {
        push(match.index);
        start = match.index + match[0].length;
        if (match[2] === 'm') {
            style = applySgr(style, match[1] ?? '');
        }
    }
    push(text.length);
    return runs;
}

function kindOf(match: RegExpExecArray): Exclude<LogTokenKind, 'text'> {
    const index = TOKEN_PATTERNS.findIndex((_pattern, position) => {
        return match[position + 1] !== undefined;
    });
    return TOKEN_PATTERNS[index]?.kind ?? 'redacted';
}

// The pieces of plain text by kind (an address, a path, a level, a [tag]...); the text between them is `text`.
export function tokenizePlain(text: string): LogToken[] {
    const tokens: LogToken[] = [];
    let start = 0;
    for (const match of text.matchAll(TOKENS)) {
        if (match.index > start) {
            tokens.push({ text: text.slice(start, match.index), kind: 'text', ansi: null });
        }
        tokens.push({ text: match[0], kind: kindOf(match), ansi: null });
        start = match.index + match[0].length;
    }
    if (start < text.length) {
        tokens.push({ text: text.slice(start), kind: 'text', ansi: null });
    }
    return tokens;
}

function hasStyle(style: AnsiStyle): boolean {
    return style.color !== null || style.bold;
}

// The pieces of a line to draw: what the program colored keeps its colors, the rest is colored by kind.
export function highlightLog(text: string): LogToken[] {
    return splitAnsiRuns(text).flatMap((run) => {
        return hasStyle(run.style) ? [{ text: run.text, kind: 'text' as const, ansi: run.style }] : tokenizePlain(run.text);
    });
}

// How serious a line is: the command and how the program ended come from the app; the rest is told by the words of the line.
export function logLevelOf(line: Pick<LogLine, 'stream' | 'text'>): LogLevel {
    if (line.stream === 'command') {
        return 'command';
    }
    if (line.stream === 'event') {
        if (line.text === exitEventText(0, null)) {
            return 'success';
        }
        if (line.text === STOPPED_BY_APP_EVENT) {
            return 'info';
        }
        return line.text.startsWith(SIGNAL_EVENT_PREFIX) ? 'warning' : 'error';
    }
    const text = stripAnsiCodes(line.text);
    if (ERROR_LINE.test(text)) {
        return 'error';
    }
    if (WARNING_LINE.test(text)) {
        return 'warning';
    }
    if (DEBUG_LINE.test(text)) {
        return 'debug';
    }
    return INFO_LINE.test(text) ? 'info' : 'plain';
}
