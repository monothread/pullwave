import { checkRow, formatClock, parseClock, problemKey, segmentsToCut, type SegmentRow } from '@renderer/components/cutText';

function row(start: string, end: string, id = 1): SegmentRow {
    return { id, start, end };
}

describe('parseClock', () => {
    it.each([
        ['0', 0],
        ['90', 90],
        ['4.5', 4.5],
        ['0:10', 10],
        ['1:34', 94],
        ['1:34.5', 94.5],
        ['1:34,5', 94.5],
        ['90:00', 5400],
        ['1:02:03', 3723],
        ['1:2:3', 3723],
        ['0:00:10.25', 10.25],
        ['  2:30  ', 150]
    ])('reads "%s" as %s seconds', (text, seconds) => {
        expect(parseClock(text)).toBe(seconds);
    });

    it.each([[''], ['  '], ['abc'], ['-5'], ['1:75'], ['1:60'], ['1:60:00'], ['1:02:75'], ['1::2'], [':30'], ['1:'], ['1.2.3'], ['1:2:3:4'], ['1e3'], ['0x10']])('does not read "%s"', (text) => {
        expect(parseClock(text)).toBeNull();
    });
});

describe('formatClock', () => {
    it.each([
        [0, '0:00'],
        [9, '0:09'],
        [74, '1:14'],
        [600, '10:00'],
        [3599, '59:59'],
        [3600, '1:00:00'],
        [3725, '1:02:05'],
        [94.5, '1:34.5'],
        [0.25, '0:00.25'],
        [10.001, '0:10.001'],
        [59.9996, '1:00']
    ])('writes %s seconds as %s', (seconds, text) => {
        expect(formatClock(seconds)).toBe(text);
    });

    it('is read back by parseClock', () => {
        [0, 10, 94.5, 3725, 7200.125].forEach((seconds) => {
            expect(parseClock(formatClock(seconds))).toBe(seconds);
        });
    });
});

describe('checkRow', () => {
    it('reads a part inside the file', () => {
        expect(checkRow(row('0:10', '0:14'), 150)).toEqual({ segment: { start: 10, end: 14 }, problem: null });
        expect(checkRow(row('1:34', '1:43'), 150)).toEqual({ segment: { start: 94, end: 103 }, problem: null });
    });

    it('accepts a part that ends at the end of the file, or half a second after it (the length is rounded), and cuts it at the end', () => {
        expect(checkRow(row('2:00', '2:30'), 150)).toEqual({ segment: { start: 120, end: 150 }, problem: null });
        expect(checkRow(row('2:00', '2:30.5'), 150)).toEqual({ segment: { start: 120, end: 150 }, problem: null });
    });

    it('says nothing about a row that is blank: it is not a part, and not a mistake', () => {
        expect(checkRow(row('', ''), 150)).toEqual({ segment: null, problem: null });
        expect(checkRow(row('  ', ' '), 150)).toEqual({ segment: null, problem: null });
    });

    it('says the start is not a time, also when only the end is written', () => {
        expect(checkRow(row('abc', '0:10'), 150)).toEqual({ segment: null, problem: 'cut.problem.start' });
        expect(checkRow(row('', '0:10'), 150)).toEqual({ segment: null, problem: 'cut.problem.start' });
        expect(checkRow(row('0:10', ''), 150)).toEqual({ segment: null, problem: 'cut.problem.end' });
    });

    it('says the end is not a time', () => {
        expect(checkRow(row('0:10', 'x'), 150)).toEqual({ segment: null, problem: 'cut.problem.end' });
    });

    it('says the end has to be after the start', () => {
        expect(checkRow(row('0:10', '0:10'), 150)).toEqual({ segment: null, problem: 'cut.problem.order' });
        expect(checkRow(row('0:20', '0:10'), 150)).toEqual({ segment: null, problem: 'cut.problem.order' });
    });

    it('says the end is after the end of the file', () => {
        expect(checkRow(row('0:10', '2:31'), 150)).toEqual({ segment: null, problem: 'cut.problem.beyond' });
    });

    it('says the start is after the end of the file by the order or the end, never by a part that begins past it', () => {
        expect(checkRow(row('5:00', '6:00'), 150)).toEqual({ segment: null, problem: 'cut.problem.beyond' });
    });
});

describe('problemKey', () => {
    it.each(['cut.problem.start', 'cut.problem.end', 'cut.problem.order', 'cut.problem.beyond'] as const)('is the text %s', (problem) => {
        expect(problemKey(problem)).toBe(problem);
    });
});

describe('segmentsToCut', () => {
    it('gives the parts in the order they were written', () => {
        expect(segmentsToCut([row('1:34', '1:43', 1), row('0:10', '0:14', 2)], 150)).toEqual([
            { start: 94, end: 103 },
            { start: 10, end: 14 }
        ]);
    });

    it('leaves a blank row out', () => {
        expect(segmentsToCut([row('', '', 1), row('0:10', '0:14', 2), row('', '', 3)], 150)).toEqual([{ start: 10, end: 14 }]);
    });

    it('allows parts that overlap', () => {
        expect(segmentsToCut([row('0:10', '0:20', 1), row('0:15', '0:25', 2)], 150)).toEqual([
            { start: 10, end: 20 },
            { start: 15, end: 25 }
        ]);
    });

    it('is nothing when there is no part', () => {
        expect(segmentsToCut([], 150)).toBeNull();
        expect(segmentsToCut([row('', '')], 150)).toBeNull();
    });

    it('is nothing while any row has a mistake, even if the others are good', () => {
        expect(segmentsToCut([row('0:10', '0:14', 1), row('0:30', '0:20', 2)], 150)).toBeNull();
        expect(segmentsToCut([row('0:10', '0:14', 1), row('0:30', '', 2)], 150)).toBeNull();
    });
});
