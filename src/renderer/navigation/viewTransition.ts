import { flushSync } from 'react-dom';

// The pages slide from one to the other, and the cover that was clicked flies to its place on the next page, with the View Transitions of
// Chromium (always, whatever the system says about motion: D-130). Where they do not exist, the page just changes.

// The class on <html> while a change of page is animated: the theme gives the page and the covers their names for the animation only then.
export const TRANSITION_CLASS = 'vt-active';
// The class of the cover that was clicked, which flies to the next page.
export const FLYING_COVER_CLASS = 'vt-cover';

interface ViewTransitionLike {
    finished: Promise<unknown>;
}

type StartViewTransition = (update: () => void) => ViewTransitionLike;

function starter(): StartViewTransition | null {
    const start = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition;
    return typeof start === 'function' ? start.bind(document) : null;
}

// Whether a change of page can be animated here and now.
export function canAnimatePages(): boolean {
    return starter() !== null;
}

// Runs `update` (a change of page) inside an animated transition when it can; `cover` is the art of the tile that was clicked.
export function withViewTransition(update: () => void, cover: HTMLElement | null = null): void {
    const start = starter();
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
