import { parallaxOf } from '@renderer/spotlight/parallax';

const BOX = { left: 100, top: 50, width: 400, height: 200 };

describe('parallaxOf', () => {
    it('is zero at the middle of the carousel', () => {
        expect(parallaxOf(300, 150, BOX)).toEqual({ x: 0, y: 0 });
    });

    it('is -1 at the left and top edges and 1 at the right and bottom ones', () => {
        expect(parallaxOf(100, 50, BOX)).toEqual({ x: -1, y: -1 });
        expect(parallaxOf(500, 250, BOX)).toEqual({ x: 1, y: 1 });
    });

    it('goes in between for a pointer between the middle and an edge', () => {
        expect(parallaxOf(400, 100, BOX)).toEqual({ x: 0.5, y: -0.5 });
    });

    it('never goes past 1 for a pointer outside the box', () => {
        expect(parallaxOf(9_000, -9_000, BOX)).toEqual({ x: 1, y: -1 });
    });

    it('is zero for a box with no size', () => {
        expect(parallaxOf(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
    });
});
