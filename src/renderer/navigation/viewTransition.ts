import { flushSync } from 'react-dom';
import { isPerformanceModeActive } from '../theme/performanceMode';

export const TRANSITION_CLASS = 'vt-active';
export const FLYING_COVER_CLASS = 'vt-cover';

interface ViewTransitionLike {
    finished: Promise<unknown>;
}

type StartViewTransition = (update: () => void) => ViewTransitionLike;

function starter(): StartViewTransition | null {
    const start = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition;
    return typeof start === 'function' ? start.bind(document) : null;
}

export function canAnimatePages(): boolean {
    return !isPerformanceModeActive() && starter() !== null;
}

export function withViewTransition(update: () => void, cover: HTMLElement | null = null): void {
    const start = isPerformanceModeActive() ? null : starter();
    if (start === null) {
        update();
        return;
    }
    const root = document.documentElement;
    root.classList.add(TRANSITION_CLASS);
    cover?.classList.add(FLYING_COVER_CLASS);
    const transition = start(() => {
        cover?.classList.remove(FLYING_COVER_CLASS);
        flushSync(update);
    });
    void transition.finished.finally(() => {
        root.classList.remove(TRANSITION_CLASS);
    });
}
