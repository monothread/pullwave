import { seekHover } from '@renderer/components/seekHover';

const BAR = { left: 100, width: 200 };

describe('seekHover', () => {
    it.each([
        [100, 0, 0],
        [150, 0.25, 50],
        [200, 0.5, 100],
        [250, 0.75, 150],
        [300, 1, 200]
    ])('gives the moment and the part of the bar under a mouse at %s on a video of 200 seconds', (clientX, fraction, time) => {
        expect(seekHover(clientX, BAR, 200)).toEqual({ time, fraction });
    });

    it('keeps the mouse inside the timeline', () => {
        expect(seekHover(40, BAR, 200)).toEqual({ time: 0, fraction: 0 });
        expect(seekHover(900, BAR, 200)).toEqual({ time: 200, fraction: 1 });
    });

    it('scales the moment to the length of the video', () => {
        expect(seekHover(200, BAR, 60)).toEqual({ time: 30, fraction: 0.5 });
    });

    it('gives the same part of the bar for the same place on it whatever the size the bar is measured at (a magnified interface)', () => {
        expect(seekHover(100 + 500 * 0.3, { left: 100, width: 500 }, 100)).toEqual({ time: 30, fraction: 0.3 });
        expect(seekHover(600 + 2824 * 0.3, { left: 600, width: 2824 }, 100)?.fraction).toBeCloseTo(0.3, 10);
    });

    it('gives nothing when the length of the video is not known', () => {
        expect(seekHover(150, BAR, 0)).toBeNull();
    });

    it('gives nothing when the timeline has no width', () => {
        expect(seekHover(150, { left: 100, width: 0 }, 200)).toBeNull();
    });
});
