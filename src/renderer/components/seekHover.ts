export interface SeekHover {
    // The moment of the video under the mouse, in seconds.
    time: number;
    // How far along the timeline the mouse is, from 0 (the start) to 1 (the end). It is a part of the bar and not a number of pixels, so it means
    // the same whatever magnification the interface has (the pixels the mouse is measured in are not the ones the page is laid out in).
    fraction: number;
}

// What is under the mouse on the timeline: null when the length of the video is not known or the timeline has no width.
export function seekHover(clientX: number, bar: { left: number; width: number }, duration: number): SeekHover | null {
    if (duration <= 0 || bar.width <= 0) {
        return null;
    }
    const fraction = Math.min(1, Math.max(0, (clientX - bar.left) / bar.width));
    return { time: fraction * duration, fraction };
}
