import type { LogLine } from '@shared/logs';
import { filterLogLines, formatLogText, formatLogTime, LOG_FILTERS, mergeLogLines } from '@renderer/components/logView';

const ESC = String.fromCharCode(27);
// 14:03:09.042 in the clock of the machine running the tests.
const AT = new Date(2026, 10, 11, 14, 3, 9, 42).getTime();

function line(id: number, text: string, stream: LogLine['stream'] = 'stdout'): LogLine {
    return { id, at: AT, stream, text };
}

describe('LOG_FILTERS', () => {
    it('lists everything, the warnings and the errors, in that order', () => {
        expect(LOG_FILTERS).toEqual(['all', 'warnings', 'errors']);
    });
});

describe('mergeLogLines', () => {
    it('adds the lines that come after the last one known, in order', () => {
        expect(mergeLogLines([line(1, 'a'), line(2, 'b')], [line(3, 'c'), line(4, 'd')])).toEqual([line(1, 'a'), line(2, 'b'), line(3, 'c'), line(4, 'd')]);
    });

    it('leaves out the lines that are already there', () => {
        expect(mergeLogLines([line(1, 'a'), line(2, 'b')], [line(2, 'b'), line(3, 'c')])).toEqual([line(1, 'a'), line(2, 'b'), line(3, 'c')]);
    });

    it('gives a copy of the lines when nothing new comes', () => {
        const current = [line(1, 'a')];
        const merged = mergeLogLines(current, [line(1, 'a')]);
        expect(merged).toEqual([line(1, 'a')]);
        expect(merged).not.toBe(current);
        expect(mergeLogLines([], [])).toEqual([]);
    });

    it('takes every line when there were none', () => {
        expect(mergeLogLines([], [line(5, 'e'), line(6, 'f')])).toEqual([line(5, 'e'), line(6, 'f')]);
    });

    it('drops the oldest lines past the limit', () => {
        expect(mergeLogLines([line(1, 'a'), line(2, 'b')], [line(3, 'c'), line(4, 'd')], 3)).toEqual([line(2, 'b'), line(3, 'c'), line(4, 'd')]);
    });

    it('keeps 2000 lines by default', () => {
        const many = Array.from({ length: 2001 }, (_value, index) => {
            return line(index + 1, String(index));
        });
        const merged = mergeLogLines([], many);
        expect(merged).toHaveLength(2000);
        expect(merged[0]).toEqual(line(2, '1'));
    });
});

describe('filterLogLines', () => {
    const LINES = [line(1, 'yt-dlp -v', 'command'), line(2, 'WARNING: slow'), line(3, `${ESC}[31mERROR:${ESC}[0m Broken`), line(4, '[download] 10%'), line(5, 'exited with code 1', 'event')];

    it('keeps every line with no filter and no search', () => {
        expect(filterLogLines(LINES, 'all', '')).toEqual(LINES);
    });

    it('keeps the warnings and the errors', () => {
        expect(filterLogLines(LINES, 'warnings', '')).toEqual([LINES[1], LINES[2], LINES[4]]);
    });

    it('keeps the errors only', () => {
        expect(filterLogLines(LINES, 'errors', '')).toEqual([LINES[2], LINES[4]]);
    });

    it('searches the text in any case, without the codes of the terminal and the spaces around the search', () => {
        expect(filterLogLines(LINES, 'all', '  error: broken ')).toEqual([LINES[2]]);
        expect(filterLogLines(LINES, 'all', '31m')).toEqual([]);
    });

    it('searches within the lines the filter keeps', () => {
        expect(filterLogLines(LINES, 'errors', 'slow')).toEqual([]);
        expect(filterLogLines(LINES, 'warnings', 'slow')).toEqual([LINES[1]]);
    });
});

describe('formatLogTime', () => {
    it('gives the hours, minutes, seconds and milliseconds of the clock of the machine', () => {
        expect(formatLogTime(AT)).toBe('14:03:09.042');
        expect(formatLogTime(new Date(2026, 0, 1, 0, 0, 0, 0).getTime())).toBe('00:00:00.000');
    });
});

describe('formatLogText', () => {
    it('gives one line of text per line, with its time and stream, without the codes of the terminal', () => {
        expect(formatLogText([line(1, 'yt-dlp -v', 'command'), line(2, `${ESC}[31mERROR:${ESC}[0m x`, 'stderr')])).toBe('14:03:09.042 [command] yt-dlp -v\n14:03:09.042 [stderr] ERROR: x');
    });

    it('gives an empty text for no lines', () => {
        expect(formatLogText([])).toBe('');
    });
});
