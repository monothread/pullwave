import type { MessageKey } from '@shared/i18n';
import type { CutSegment } from '@shared/cut';

// A part as it is typed: the two times are text until they are checked.
export interface SegmentRow {
    id: number;
    start: string;
    end: string;
}

// The slack that is allowed past the end of the file (the length ffmpeg reads is rounded).
export const END_TOLERANCE_SECONDS = 0.5;

const SECONDS = /^\d+(?:\.\d+)?$/;
const MINUTES = /^(\d+):([0-5]?\d(?:\.\d+)?)$/;
const HOURS = /^(\d+):([0-5]?\d):([0-5]?\d(?:\.\d+)?)$/;

// "90", "1:30", "1:02:03" and "1:30.5" are times, in seconds; anything else (blank, negative, "1:75") is not.
export function parseClock(text: string): number | null {
    const value = text.trim().replace(',', '.');
    if (SECONDS.test(value)) {
        return Number(value);
    }
    const minutes = MINUTES.exec(value);
    if (minutes) {
        return Number(minutes[1]) * 60 + Number(minutes[2]);
    }
    const hours = HOURS.exec(value);
    return hours ? Number(hours[1]) * 3600 + Number(hours[2]) * 60 + Number(hours[3]) : null;
}

// 74 seconds is "1:14" and 3725 is "1:02:05"; a fraction is kept to the thousandth ("1:14.5").
export function formatClock(totalSeconds: number): string {
    const rounded = Math.round(totalSeconds * 1000) / 1000;
    const whole = Math.floor(rounded);
    const fraction = rounded - whole > 0 ? `.${String(Math.round((rounded - whole) * 1000)).padStart(3, '0').replace(/0+$/, '')}` : '';
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const seconds = String(whole % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}${fraction}` : `${minutes}:${seconds}${fraction}`;
}

export type SegmentProblem = 'cut.problem.start' | 'cut.problem.end' | 'cut.problem.order' | 'cut.problem.beyond';

export interface CheckedRow {
    segment: CutSegment | null;
    problem: SegmentProblem | null;
}

// Reads a part: its two times, in order, inside the file. A blank row has no problem to show before the user types in it, but it is not
// a part either (`segment` is null for it and for a row with a problem).
export function checkRow(row: SegmentRow, durationSeconds: number): CheckedRow {
    const start = parseClock(row.start);
    const end = parseClock(row.end);
    if (start === null) {
        return { segment: null, problem: row.start.trim() === '' && row.end.trim() === '' ? null : 'cut.problem.start' };
    }
    if (end === null) {
        return { segment: null, problem: 'cut.problem.end' };
    }
    if (end <= start) {
        return { segment: null, problem: 'cut.problem.order' };
    }
    if (end > durationSeconds + END_TOLERANCE_SECONDS) {
        return { segment: null, problem: 'cut.problem.beyond' };
    }
    return { segment: { start, end: Math.min(end, durationSeconds) }, problem: null };
}

// What can be cut: every row must be a part (a blank row is left out, a row with a problem stops the cut) and there must be one at least.
export function segmentsToCut(rows: readonly SegmentRow[], durationSeconds: number): CutSegment[] | null {
    const checked = rows.map((row) => {
        return checkRow(row, durationSeconds);
    });
    const segments = checked.flatMap((entry) => {
        return entry.segment === null ? [] : [entry.segment];
    });
    const stopped = checked.some((entry) => {
        return entry.problem !== null;
    });
    return stopped || segments.length === 0 ? null : segments;
}

export function problemKey(problem: SegmentProblem): MessageKey {
    return problem;
}
