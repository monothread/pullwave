import { bestLevelIndex, lowestLevelIndex } from '@renderer/components/streamLevel';

describe('bestLevelIndex', () => {
    it('gives null when the master lists no quality', () => {
        expect(bestLevelIndex([])).toBeNull();
    });

    it('gives the only quality there is', () => {
        expect(bestLevelIndex([{ height: 720, bitrate: 3_000_000 }])).toBe(0);
    });

    it('gives the tallest picture wherever it is in the list', () => {
        const levels = [
            { height: 360, bitrate: 900_000 },
            { height: 1080, bitrate: 5_300_000 },
            { height: 480, bitrate: 1_500_000 },
            { height: 720, bitrate: 3_000_000 }
        ];
        expect(bestLevelIndex(levels)).toBe(1);
        expect(bestLevelIndex([...levels].reverse())).toBe(2);
        expect(bestLevelIndex(levels.slice(2))).toBe(1);
    });

    it('takes the one with the highest bitrate among pictures of the same height', () => {
        expect(
            bestLevelIndex([
                { height: 1080, bitrate: 4_000_000 },
                { height: 1080, bitrate: 6_000_000 },
                { height: 720, bitrate: 9_000_000 }
            ])
        ).toBe(1);
    });

    it('keeps the first one when two have the same height and bitrate', () => {
        expect(
            bestLevelIndex([
                { height: 1080, bitrate: 5_000_000 },
                { height: 1080, bitrate: 5_000_000 }
            ])
        ).toBe(0);
    });

    it('prefers a taller picture even with a lower bitrate', () => {
        expect(
            bestLevelIndex([
                { height: 720, bitrate: 8_000_000 },
                { height: 1080, bitrate: 2_000_000 }
            ])
        ).toBe(1);
    });

    it('does not change the list it is given', () => {
        const levels = [
            { height: 360, bitrate: 1 },
            { height: 720, bitrate: 2 }
        ];
        bestLevelIndex(levels);
        expect(levels).toEqual([
            { height: 360, bitrate: 1 },
            { height: 720, bitrate: 2 }
        ]);
    });
});

describe('lowestLevelIndex', () => {
    it('gives null when the master lists no quality', () => {
        expect(lowestLevelIndex([])).toBeNull();
    });

    it('gives the only quality there is', () => {
        expect(lowestLevelIndex([{ height: 720, bitrate: 3_000_000 }])).toBe(0);
    });

    it('gives the shortest picture wherever it is in the list', () => {
        const levels = [
            { height: 720, bitrate: 3_000_000 },
            { height: 1080, bitrate: 5_300_000 },
            { height: 360, bitrate: 900_000 },
            { height: 480, bitrate: 1_500_000 }
        ];
        expect(lowestLevelIndex(levels)).toBe(2);
        expect(lowestLevelIndex([...levels].reverse())).toBe(1);
        expect(lowestLevelIndex(levels.slice(3))).toBe(0);
    });

    it('takes the one with the lowest bitrate among pictures of the same height', () => {
        expect(
            lowestLevelIndex([
                { height: 360, bitrate: 1_200_000 },
                { height: 360, bitrate: 800_000 },
                { height: 480, bitrate: 500_000 }
            ])
        ).toBe(1);
    });

    it('keeps the first one when two have the same height and bitrate', () => {
        expect(
            lowestLevelIndex([
                { height: 360, bitrate: 900_000 },
                { height: 360, bitrate: 900_000 }
            ])
        ).toBe(0);
    });

    it('prefers a shorter picture even with a higher bitrate', () => {
        expect(
            lowestLevelIndex([
                { height: 720, bitrate: 1_000_000 },
                { height: 360, bitrate: 4_000_000 }
            ])
        ).toBe(1);
    });
});
