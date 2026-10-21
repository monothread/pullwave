// How long a page that is still loading is given to become tall enough, and how many frames the position has to hold for it to be done
// (the page being left can still be on the screen in the first frames).
export const SCROLL_RESTORE_TIMEOUT_MS = 2000;
export const SCROLL_RESTORE_STABLE_FRAMES = 5;
const POSITION_TOLERANCE = 1;
const INTERRUPTIONS = ['wheel', 'touchstart', 'mousedown', 'keydown'] as const;

let restoring = false;

// Whether a scroll position is being put back: whatever sends a page to the top when it opens has to leave it alone meanwhile.
export function isScrollRestoring(): boolean {
    return restoring;
}

let stopRestoring: () => void = () => {
    return undefined;
};

// Scrolls the element to `target` once the page has the height for it, trying again while the content loads. It gives up after a while
// and stops where it is when the viewer takes over (wheel, touch, click or key). Does nothing for the top, where a page opens anyway.
export function restoreScroll(element: HTMLElement, target: number): void {
    stopRestoring();
    if (target <= 0) {
        return;
    }
    restoring = true;
    let frame = 0;
    let started: number | null = null;
    let stableFrames = 0;
    const finish = (): void => {
        cancelAnimationFrame(frame);
        INTERRUPTIONS.forEach((name) => {
            element.removeEventListener(name, finish);
        });
        restoring = false;
        stopRestoring = () => {
            return undefined;
        };
    };
    const step = (now: number): void => {
        started ??= now;
        if (element.scrollHeight - element.clientHeight >= target) {
            element.scrollTop = target;
            stableFrames = Math.abs(element.scrollTop - target) <= POSITION_TOLERANCE ? stableFrames + 1 : 0;
        } else {
            stableFrames = 0;
        }
        if (stableFrames >= SCROLL_RESTORE_STABLE_FRAMES || now - started >= SCROLL_RESTORE_TIMEOUT_MS) {
            finish();
        } else {
            frame = requestAnimationFrame(step);
        }
    };
    INTERRUPTIONS.forEach((name) => {
        element.addEventListener(name, finish, { passive: true });
    });
    stopRestoring = finish;
    frame = requestAnimationFrame(step);
}
