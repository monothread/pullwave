import confetti from 'canvas-confetti';

const FALLBACK_COLORS = ['#00e5ff', '#ff2bd6', '#ffd400', '#39ff88'];
const COLOR_VARIABLES = ['--cyan', '--magenta', '--yellow', '--green'] as const;

export interface ConfettiOrigin {
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
