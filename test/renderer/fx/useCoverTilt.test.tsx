// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { applyTilt, MAX_TILT_DEGREES, tiltOf, TILT_SELECTOR, useCoverTilt } from '@renderer/fx/useCoverTilt';

const BOX = { left: 100, top: 100, width: 200, height: 300 };

describe('tiltOf', () => {
    it('does not lean a tile when the pointer is at its middle', () => {
        expect(tiltOf(200, 250, BOX)).toEqual({ x: '0.00deg', y: '0.00deg', glareX: '50.0%', glareY: '50.0%' });
    });

    it('leans the right side away for a pointer on the right and the top away for one above', () => {
        expect(tiltOf(300, 100, BOX)).toEqual({ x: `${String(MAX_TILT_DEGREES.toFixed(2))}deg`, y: `${String(MAX_TILT_DEGREES.toFixed(2))}deg`, glareX: '100.0%', glareY: '0.0%' });
    });

    it('leans the other way for a pointer on the left and below', () => {
        expect(tiltOf(100, 400, BOX)).toEqual({ x: `-${String(MAX_TILT_DEGREES.toFixed(2))}deg`, y: `-${String(MAX_TILT_DEGREES.toFixed(2))}deg`, glareX: '0.0%', glareY: '100.0%' });
    });

    it('never leans past the maximum for a pointer outside the tile', () => {
        expect(tiltOf(9000, -9000, BOX)).toEqual(tiltOf(300, 100, BOX));
    });

    it('treats a box with no size as its middle', () => {
        expect(tiltOf(5, 5, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: '0.00deg', y: '0.00deg', glareX: '50.0%', glareY: '50.0%' });
    });
});

describe('applyTilt', () => {
    it('writes the four variables of the tile and puts them back to rest with null', () => {
        const card = document.createElement('div');
        applyTilt(card, { x: '3deg', y: '-4deg', glareX: '10%', glareY: '90%' });
        expect([card.style.getPropertyValue('--tilt-x'), card.style.getPropertyValue('--tilt-y'), card.style.getPropertyValue('--glare-x'), card.style.getPropertyValue('--glare-y')]).toEqual(['3deg', '-4deg', '10%', '90%']);
        applyTilt(card, null);
        expect([card.style.getPropertyValue('--tilt-x'), card.style.getPropertyValue('--tilt-y'), card.style.getPropertyValue('--glare-x'), card.style.getPropertyValue('--glare-y')]).toEqual(['0deg', '0deg', '50%', '50%']);
    });
});

function Screen() {
    useCoverTilt();
    return (
        <div>
            <div className="cover-grid">
                <div className="cover-card" data-testid="one">
                    <span className="cover" data-testid="cover-one" />
                </div>
                <div className="cover-card" data-testid="two" />
            </div>
            <p data-testid="outside">OUT</p>
        </div>
    );
}

function move(target: Element, clientX: number, clientY: number): void {
    target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX, clientY }));
}

describe('useCoverTilt', () => {
    let frames: FrameRequestCallback[] = [];

    beforeEach(() => {
        frames = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            frames.push(callback);
            return frames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { return undefined; });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function runFrame(): void {
        frames.shift()?.(0);
    }

    it('leans the tile under the pointer on the next frame', () => {
        expect(TILT_SELECTOR).toBe('.cover-grid > .cover-card');
        const { getByTestId } = render(<Screen />);
        const card = getByTestId('one');
        card.getBoundingClientRect = () => { return { ...BOX, right: 300, bottom: 400, x: 100, y: 100, toJSON: () => { return {}; } } as DOMRect; };
        move(getByTestId('cover-one'), 300, 100);
        expect(card.style.getPropertyValue('--tilt-x')).toBe('');
        runFrame();
        expect(card.style.getPropertyValue('--tilt-x')).toBe('9.00deg');
        expect(card.style.getPropertyValue('--tilt-y')).toBe('9.00deg');
        expect(card.style.getPropertyValue('--glare-x')).toBe('100.0%');
        expect(card.style.getPropertyValue('--glare-y')).toBe('0.0%');
    });

    it('asks for one frame at a time, however many moves come before it', () => {
        const { getByTestId } = render(<Screen />);
        move(getByTestId('one'), 1, 1);
        move(getByTestId('one'), 2, 2);
        move(getByTestId('one'), 3, 3);
        expect(frames).toHaveLength(1);
    });

    it('puts a tile at rest when the pointer goes to another tile or leaves the grid', () => {
        const { getByTestId } = render(<Screen />);
        const first = getByTestId('one');
        move(first, 150, 150);
        runFrame();
        expect(first.style.getPropertyValue('--glare-x')).not.toBe('');
        move(getByTestId('two'), 150, 150);
        expect(first.style.getPropertyValue('--tilt-x')).toBe('0deg');
        expect(first.style.getPropertyValue('--glare-x')).toBe('50%');
        runFrame();
        move(getByTestId('outside'), 1, 1);
        expect(getByTestId('two').style.getPropertyValue('--tilt-x')).toBe('0deg');
        expect(frames).toHaveLength(0);
    });

    it('puts the tile at rest when the pointer leaves the window', () => {
        const { getByTestId } = render(<Screen />);
        move(getByTestId('one'), 150, 150);
        runFrame();
        document.documentElement.dispatchEvent(new MouseEvent('pointerleave'));
        expect(getByTestId('one').style.getPropertyValue('--tilt-y')).toBe('0deg');
    });

    it('does nothing for a move outside the tiles, and stops listening when it goes away', () => {
        const { getByTestId, unmount } = render(<Screen />);
        move(getByTestId('outside'), 1, 1);
        expect(frames).toHaveLength(0);
        const card = getByTestId('one');
        unmount();
        document.body.appendChild(card);
        move(card, 1, 1);
        expect(frames).toHaveLength(0);
    });
});
