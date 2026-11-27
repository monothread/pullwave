import { isPerformanceModeActive } from '../theme/performanceMode';

export const THEME_REVEAL_CLASS = 'vt-theme';

interface ViewTransitionLike {
    finished: Promise<unknown>;
}

type StartViewTransition = (update: () => void) => ViewTransitionLike;

let lastPoint = { x: 0.5, y: 0.5 };

export function rememberPoint(clientX: number, clientY: number): void {
    const width = window.innerWidth > 0 ? window.innerWidth : 1;
    const height = window.innerHeight > 0 ? window.innerHeight : 1;
    lastPoint = { x: Math.min(1, Math.max(0, clientX / width)), y: Math.min(1, Math.max(0, clientY / height)) };
}

export function lastRevealPoint(): { x: number; y: number } {
    return lastPoint;
}

export function trackPointerForReveal(): () => void {
    const onPointerDown = (event: PointerEvent): void => {
        rememberPoint(event.clientX, event.clientY);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
        document.removeEventListener('pointerdown', onPointerDown, true);
    };
}

function starter(): StartViewTransition | null {
    const start = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition;
    return typeof start === 'function' ? start.bind(document) : null;
}

export function revealTheme(update: () => void): void {
    const start = isPerformanceModeActive() ? null : starter();
    if (start === null) {
        update();
        return;
    }
    const root = document.documentElement;
    root.style.setProperty('--reveal-x', `${(lastPoint.x * 100).toFixed(1)}%`);
    root.style.setProperty('--reveal-y', `${(lastPoint.y * 100).toFixed(1)}%`);
    root.classList.add(THEME_REVEAL_CLASS);
    void start(update).finished.finally(() => {
        root.classList.remove(THEME_REVEAL_CLASS);
    });
}
