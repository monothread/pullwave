// The time a scroll to the top takes: longer for a longer way, but never abrupt and never slow.
export const SCROLL_MIN_MS = 350;
export const SCROLL_MAX_MS = 900;
const SCROLL_MS_PER_SCREEN = 220;

// Slow at both ends, quick in the middle.
export function easeInOut(progress: number): number {
    return progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

export function scrollDuration(distance: number, screen: number): number {
    const screens = screen > 0 ? distance / screen : 0;
    return Math.min(SCROLL_MAX_MS, Math.max(SCROLL_MIN_MS, SCROLL_MIN_MS + screens * SCROLL_MS_PER_SCREEN));
}

// Does nothing: what stopping a scroll that is not going on is.
export function noop(): void {
    return undefined;
}

const INTERRUPTIONS = ['wheel', 'touchstart', 'mousedown', 'keydown'] as const;

// Scrolls the element to the top with a gliding motion of its own (the one of the browser is cut short on a long way). It stops where it is
// when the user takes over (wheel, touch, click or key). Gives the function that stops it.
export function scrollToTopSmoothly(element: HTMLElement): () => void {
    const from = element.scrollTop;
    if (from <= 0) {
        return noop;
    }
    const duration = scrollDuration(from, element.clientHeight);
    let frame = 0;
    let started: number | null = null;
    const stop = (): void => {
        cancelAnimationFrame(frame);
        INTERRUPTIONS.forEach((name) => {
            element.removeEventListener(name, stop);
        });
    };
    const step = (now: number): void => {
        started ??= now;
        const progress = Math.min(1, (now - started) / duration);
        element.scrollTop = from * (1 - easeInOut(progress));
        if (progress < 1) {
            frame = requestAnimationFrame(step);
        } else {
            stop();
        }
    };
    INTERRUPTIONS.forEach((name) => {
        element.addEventListener(name, stop, { passive: true });
    });
    frame = requestAnimationFrame(step);
    return stop;
}
