import { SPEED_SAMPLES, formatSpeed, graphPoints, parseSpeed, pushSample } from '@renderer/downloads/speed';

describe('parseSpeed', () => {
    it.each([
        ['512B/s', 512],
        ['1.5KiB/s', 1536],
        ['1.50MiB/s', 1.5 * 1024 ** 2],
        ['2GiB/s', 2 * 1024 ** 3],
        ['3kB/s', 3000],
        ['3.2MB/s', 3.2e6],
        ['1GB/s', 1e9],
        [' 4,5 MiB / s ', 4.5 * 1024 ** 2]
    ])('reads %j', (text, bytes) => {
        expect(parseSpeed(text)).toBeCloseTo(bytes, 3);
    });

    it.each(['', 'Unknown', 'N/A', '1.5MiB', 'fast/s', '1.2.3MiB/s'])('is null for %j', (text) => {
        expect(parseSpeed(text)).toBeNull();
    });

    it('is null for nothing', () => {
        expect(parseSpeed(null)).toBeNull();
        expect(parseSpeed(undefined)).toBeNull();
    });
});

describe('formatSpeed', () => {
    it.each([
        [0, '0 B/s'],
        [900, '900 B/s'],
        [1536, '1.5 KiB/s'],
        [1.5 * 1024 ** 2, '1.5 MiB/s'],
        [3 * 1024 ** 3, '3.0 GiB/s'],
        [5 * 1024 ** 4, '5120.0 GiB/s']
    ])('writes %d as %s', (bytes, text) => {
        expect(formatSpeed(bytes)).toBe(text);
    });
});

describe('pushSample', () => {
    it('keeps a minute of readings', () => {
        expect(SPEED_SAMPLES).toBe(60);
    });

    it('adds the reading at the end and drops the oldest ones past the limit', () => {
        expect(pushSample([1, 2], 3)).toEqual([1, 2, 3]);
        expect(pushSample([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
    });

    it('does not change the list it was given', () => {
        const list = [1];
        pushSample(list, 2);
        expect(list).toEqual([1]);
    });
});

describe('graphPoints', () => {
    it('is empty with no reading', () => {
        expect(graphPoints([], 300, 80)).toBe('');
    });

    it('puts a single reading at the right end, at the top', () => {
        expect(graphPoints([5], 300, 80)).toBe('300.0,0.0');
    });

    it('spreads the readings over the width, the highest at the top', () => {
        expect(graphPoints([0, 50, 100], 300, 80)).toBe('0.0,80.0 150.0,40.0 300.0,0.0');
    });

    it('keeps a line of zeros at the bottom', () => {
        expect(graphPoints([0, 0], 100, 40)).toBe('0.0,40.0 100.0,40.0');
    });
});
