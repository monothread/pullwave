import { RANGE_END_MARGIN, atRangeEnd, mediaTimeOf, outsideRange, rangeLength, timeInRange, type PlaybackRange } from '@renderer/components/playbackRange';

const PART: PlaybackRange = { start: 20, end: 50 };

describe('RANGE_END_MARGIN', () => {
    it('counts the last twentieth of a second as the end', () => {
        expect(RANGE_END_MARGIN).toBe(0.05);
    });
});

describe('rangeLength', () => {
    it.each([
        [{ start: 20, end: 50 }, 30],
        [{ start: 0, end: 0.5 }, 0.5],
        [{ start: 10, end: 10 }, 0],
        [{ start: 10, end: 5 }, 0]
    ])('measures %j as %s', (range, length) => {
        expect(rangeLength(range)).toBe(length);
    });
});

describe('timeInRange', () => {
    it.each([
        [20, 0],
        [35, 15],
        [50, 30],
        [5, 0],
        [90, 30]
    ])('shows the time %s of the media as %s of the part', (time, shown) => {
        expect(timeInRange(time, PART)).toBe(shown);
    });
});

describe('mediaTimeOf', () => {
    it.each([
        [0, 20],
        [12, 32],
        [30, 50],
        [-4, 20],
        [45, 50]
    ])('takes the point %s of the part to the time %s of the media', (point, time) => {
        expect(mediaTimeOf(point, PART)).toBe(time);
    });
});

describe('atRangeEnd', () => {
    it.each([
        [49.9, false],
        [49.96, true],
        [50, true],
        [80, true],
        [20, false]
    ])('says whether %s is at the end of the part: %s', (time, end) => {
        expect(atRangeEnd(time, PART)).toBe(end);
    });
});

describe('outsideRange', () => {
    it.each([
        [0, true],
        [19.94, true],
        [19.96, false],
        [20, false],
        [35, false],
        [49.96, true],
        [60, true]
    ])('says whether %s is outside the part: %s', (time, outside) => {
        expect(outsideRange(time, PART)).toBe(outside);
    });
});
