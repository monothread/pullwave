import { useEffect, useRef, type RefObject } from 'react';
import { OFFSCREEN_ATTRIBUTE, settleLoops } from '../fx/loopPause';

export { OFFSCREEN_ATTRIBUTE } from '../fx/loopPause';

// How far beyond the visible part of the list a card still counts as in sight: it is animating again before the scroll brings it in. The
// lists scroll inside the main area, not the window, so the margin is a scroll margin (a root margin only widens the window itself).
export const OFFSCREEN_MARGIN = '200px';

// The options of the observer, with the scroll margin of Chromium that the types of the DOM do not list yet.
type CardObserverInit = IntersectionObserverInit & { scrollMargin: string };

let shared: IntersectionObserver | null = null;
// The kind of observer the shared one was made with: it is made again when that changes (the tests stand in for it, one way per test).
let sharedKind: typeof IntersectionObserver | null = null;

// One observer for every card of every list: marks each card out of sight, unmarks it as it comes near, and pauses or plays its looping
// animations (see loopPause.ts).
function observer(): IntersectionObserver | null {
    if (typeof IntersectionObserver === 'undefined') {
        return null;
    }
    if (sharedKind !== IntersectionObserver) {
        shared = null;
        sharedKind = IntersectionObserver;
    }
    const options: CardObserverInit = { rootMargin: OFFSCREEN_MARGIN, scrollMargin: OFFSCREEN_MARGIN };
    shared ??= new IntersectionObserver((entries) => {
        // Every card is marked first and then settled: reading the animations of a card works the styles out, once for all the marks.
        entries.forEach((entry) => {
            entry.target.toggleAttribute(OFFSCREEN_ATTRIBUTE, !entry.isIntersecting);
        });
        entries.forEach((entry) => {
            settleLoops(entry.target);
        });
    }, options);
    return shared;
}

// The looping animations of a card (its bar, its glow, its badge) wait while the card is out of sight. A queue lists up to 60 cards and only
// a few are seen at once: the others animated all the same and kept the window busy at every frame. The animations a card starts while it is
// out of sight wait as they start (see watchNewAnimations).
export function useOffscreenPause<T extends Element>(): RefObject<T | null> {
    const ref = useRef<T | null>(null);
    useEffect(() => {
        const element = ref.current;
        const watcher = observer();
        if (element === null || watcher === null) {
            return undefined;
        }
        watcher.observe(element);
        return () => {
            watcher.unobserve(element);
            element.removeAttribute(OFFSCREEN_ATTRIBUTE);
        };
    }, []);
    return ref;
}
