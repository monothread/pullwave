export const SCROLL_RESTORE_TIMEOUT_MS = 2000;
export const SCROLL_RESTORE_STABLE_FRAMES = 5;
const POSITION_TOLERANCE = 1;
const INTERRUPTIONS = ['wheel', 'touchstart', 'mousedown', 'keydown'] as const;

let restoring = false;

export function isScrollRestoring(): boolean {
    return restoring;
}

let stopRestoring: () => void = () => {
    return undefined;
};

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
