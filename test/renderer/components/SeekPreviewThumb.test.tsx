// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { SeekPreviewThumb } from '@renderer/components/SeekPreviewThumb';

let drawImage: ReturnType<typeof vi.fn>;
let getContext: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    drawImage = vi.fn();
    getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
        return { drawImage } as unknown as CanvasRenderingContext2D;
    });
});

afterEach(() => {
    getContext.mockRestore();
});

function frame(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

describe('SeekPreviewThumb', () => {
    it('is a canvas of the preview, hidden from screen readers (the time beside it says where the mouse is)', () => {
        render(<SeekPreviewThumb frame={frame(160, 90)} />);
        const thumb = screen.getByTestId('player-thumb');
        expect(thumb.tagName).toBe('CANVAS');
        expect(thumb).toHaveClass('player__thumb');
        expect(thumb).toHaveAttribute('aria-hidden', 'true');
    });

    it('copies the frame into it, at the size of the frame', () => {
        const shown = frame(160, 90);
        render(<SeekPreviewThumb frame={shown} />);
        const thumb = screen.getByTestId('player-thumb') as HTMLCanvasElement;
        expect(thumb).not.toBe(shown);
        expect(thumb.width).toBe(160);
        expect(thumb.height).toBe(90);
        expect(getContext).toHaveBeenCalledWith('2d');
        expect(drawImage).toHaveBeenCalledTimes(1);
        expect(drawImage).toHaveBeenCalledWith(shown, 0, 0);
    });

    it('copies the next frame when it changes, in the same canvas', () => {
        const first = frame(160, 90);
        const second = frame(160, 120);
        const { rerender } = render(<SeekPreviewThumb frame={first} />);
        const thumb = screen.getByTestId('player-thumb') as HTMLCanvasElement;
        rerender(<SeekPreviewThumb frame={second} />);
        expect(screen.getByTestId('player-thumb')).toBe(thumb);
        expect(thumb.height).toBe(120);
        expect(drawImage).toHaveBeenCalledTimes(2);
        expect(drawImage).toHaveBeenLastCalledWith(second, 0, 0);
    });

    it('draws nothing again when the same frame is shown again', () => {
        const shown = frame(160, 90);
        const { rerender } = render(<SeekPreviewThumb frame={shown} />);
        rerender(<SeekPreviewThumb frame={shown} />);
        expect(drawImage).toHaveBeenCalledTimes(1);
    });

    it('draws nothing when the canvas cannot be drawn on', () => {
        getContext.mockImplementation(() => {
            return null;
        });
        render(<SeekPreviewThumb frame={frame(160, 90)} />);
        const thumb = screen.getByTestId('player-thumb') as HTMLCanvasElement;
        expect(thumb.width).toBe(160);
        expect(drawImage).not.toHaveBeenCalled();
    });
});
