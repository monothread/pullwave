// How far the pointer is from the middle of the carousel, from -1 (left or top edge) to 1 (right or bottom edge): the cover and the text
// of the slide move a little against it, which gives the slide depth.
export interface Parallax {
    x: number;
    y: number;
}

export function parallaxOf(clientX: number, clientY: number, box: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): Parallax {
    if (box.width <= 0 || box.height <= 0) {
        return { x: 0, y: 0 };
    }
    const x = ((clientX - box.left) / box.width - 0.5) * 2;
    const y = ((clientY - box.top) / box.height - 0.5) * 2;
    return { x: Math.min(1, Math.max(-1, x)), y: Math.min(1, Math.max(-1, y)) };
}
