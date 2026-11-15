export interface SeekHover {
    time: number;
    fraction: number;
}

export function seekHover(clientX: number, bar: { left: number; width: number }, duration: number): SeekHover | null {
    if (duration <= 0 || bar.width <= 0) {
        return null;
    }
    const fraction = Math.min(1, Math.max(0, (clientX - bar.left) / bar.width));
    return { time: fraction * duration, fraction };
}
