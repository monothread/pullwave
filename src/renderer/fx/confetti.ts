import confetti from 'canvas-confetti';

// The confetti of a finished download, in the colours of the theme (read from its variables, so every theme throws its own).

const FALLBACK_COLORS = ['#00e5ff', '#ff2bd6', '#ffd400', '#39ff88'];
const COLOR_VARIABLES = ['--cyan', '--magenta', '--yellow', '--green'] as const;

export interface ConfettiOrigin {
    // Where it starts, from 0 to 1 of the width and the height of the window.
    x: number;
    y: number;
}

export function themeColors(): string[] {
    const style = getComputedStyle(document.documentElement);
    return COLOR_VARIABLES.map((variable, index) => {
        const value = style.getPropertyValue(variable).trim();
        return value === '' ? (FALLBACK_COLORS[index] ?? '#ffffff') : value;
    });
}

export const TOP_RIGHT: ConfettiOrigin = { x: 0.92, y: 0.12 };

// Throws one burst; the animation runs on a canvas of its own that canvas-confetti puts over the window and removes when it is over.
export function burstConfetti(origin: ConfettiOrigin = TOP_RIGHT): void {
    void confetti({
        particleCount: 70,
        spread: 75,
        startVelocity: 38,
        gravity: 1.1,
        ticks: 150,
        scalar: 0.9,
        origin,
        colors: themeColors(),
        disableForReducedMotion: false,
        zIndex: 200
    });
}
