import { useEffect, useRef, type RefObject } from 'react';
import { OFFSCREEN_ATTRIBUTE, settleLoops } from '../fx/loopPause';

export { OFFSCREEN_ATTRIBUTE } from '../fx/loopPause';

export const OFFSCREEN_MARGIN = '200px';

type CardObserverInit = IntersectionObserverInit & { scrollMargin: string };

let shared: IntersectionObserver | null = null;
let sharedKind: typeof IntersectionObserver | null = null;

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
        entries.forEach((entry) => {
            entry.target.toggleAttribute(OFFSCREEN_ATTRIBUTE, !entry.isIntersecting);
        });
        entries.forEach((entry) => {
            settleLoops(entry.target);
        });
    }, options);
    return shared;
}

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
