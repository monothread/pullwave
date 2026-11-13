import type { FormatPart } from '@shared/types';
import { CombinedProgress, type PartProgress } from '@main/services/combinedProgress';

const VIDEO: FormatPart = { formatId: '137', expectedBytes: 900 };
const AUDIO: FormatPart = { formatId: '140', expectedBytes: 100 };

function part(formatId: string, percent: number, partBytes: number | null = null): PartProgress {
    return { formatId, percent, partBytes };
}

describe('CombinedProgress', () => {
    it('counts each part for its expected size', () => {
        const whole = new CombinedProgress([VIDEO, AUDIO]);
        expect(whole.percentOf(part('137', 0))).toBe(0);
        expect(whole.percentOf(part('137', 50))).toBe(45);
        expect(whole.percentOf(part('137', 100))).toBe(90);
        expect(whole.percentOf(part('140', 50))).toBe(95);
        expect(whole.percentOf(part('140', 100))).toBe(100);
    });

    it('does not fall back to nothing when the second part starts', () => {
        const whole = new CombinedProgress([VIDEO, AUDIO]);
        expect(whole.percentOf(part('137', 100))).toBe(90);
        expect(whole.percentOf(part('140', 0))).toBe(90);
    });

    it('takes the parts before the one being downloaded as done, even when they were never reported (already on disk)', () => {
        const whole = new CombinedProgress([VIDEO, AUDIO]);
        expect(whole.percentOf(part('140', 0))).toBe(90);
    });

    it('takes the size yt-dlp gives for the part being downloaded over the one it expected', () => {
        const whole = new CombinedProgress([{ formatId: '137', expectedBytes: 500 }, AUDIO]);
        expect(whole.percentOf(part('137', 50))).toBeCloseTo((250 / 600) * 100, 10);
        expect(whole.percentOf(part('137', 50, 900))).toBe(45);
    });

    it('gives each part the same share while the size of one of them is not known', () => {
        const whole = new CombinedProgress([VIDEO, { formatId: '140', expectedBytes: null }]);
        expect(whole.percentOf(part('137', 50))).toBe(25);
        expect(whole.percentOf(part('137', 100))).toBe(50);
        expect(whole.percentOf(part('140', 50))).toBe(75);
    });

    it('counts the parts for their sizes as soon as the unknown size is given by yt-dlp', () => {
        const whole = new CombinedProgress([VIDEO, { formatId: '140', expectedBytes: null }]);
        expect(whole.percentOf(part('137', 100))).toBe(50);
        expect(whole.percentOf(part('140', 80, 100))).toBe(98);
    });

    it('never goes down, even when the sizes it counts with change or a part reports less', () => {
        const whole = new CombinedProgress([{ formatId: '137', expectedBytes: null }, { formatId: '140', expectedBytes: 900 }]);
        // Same share each while the size of the video is not known: 80% of the video is 40% of the whole.
        expect(whole.percentOf(part('137', 80))).toBe(40);
        // Once its size is known (small next to the audio), 80% of it would be 8% of the whole: the bar stays where it was.
        expect(whole.percentOf(part('137', 80, 100))).toBe(40);
        expect(whole.percentOf(part('137', 30, 100))).toBe(40);
        expect(whole.percentOf(part('140', 50, 900))).toBeCloseTo(55, 10);
        const sized = new CombinedProgress([VIDEO, AUDIO]);
        expect(sized.percentOf(part('137', 80))).toBe(72);
        expect(sized.percentOf(part('137', 80, 300))).toBe(72);
    });

    it('keeps the percentage of a part that is not one of the video as it is, and does not count it', () => {
        const whole = new CombinedProgress([VIDEO, AUDIO]);
        expect(whole.percentOf(part('', 33))).toBe(33);
        expect(whole.percentOf(part('18', 70))).toBe(70);
        expect(whole.percentOf(part('137', 10))).toBe(9);
    });

    it('holds a part between nothing and all of it, whatever yt-dlp reports', () => {
        const whole = new CombinedProgress([VIDEO, AUDIO]);
        expect(whole.percentOf(part('137', -5))).toBe(0);
        expect(whole.percentOf(part('137', 140))).toBe(90);
    });

    it('ignores a size of the part that is not above zero', () => {
        const whole = new CombinedProgress([VIDEO, AUDIO]);
        expect(whole.percentOf(part('137', 50, 0))).toBe(45);
        expect(whole.percentOf(part('137', 50, -10))).toBe(45);
    });

    it('counts any number of parts, in their order', () => {
        const whole = new CombinedProgress([
            { formatId: 'v', expectedBytes: 600 },
            { formatId: 'a1', expectedBytes: 200 },
            { formatId: 'a2', expectedBytes: 200 }
        ]);
        expect(whole.percentOf(part('v', 50))).toBe(30);
        expect(whole.percentOf(part('a1', 50))).toBe(70);
        expect(whole.percentOf(part('a2', 50))).toBe(90);
        expect(whole.percentOf(part('a2', 100))).toBe(100);
    });

    it('does not change the parts it was given', () => {
        const parts: FormatPart[] = [{ ...VIDEO }, { formatId: '140', expectedBytes: null }];
        const whole = new CombinedProgress(parts);
        whole.percentOf(part('140', 50, 100));
        expect(parts).toEqual([VIDEO, { formatId: '140', expectedBytes: null }]);
    });
});
