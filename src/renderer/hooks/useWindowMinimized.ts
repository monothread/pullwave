import { useEffect } from 'react';
import { setWindowMinimized, watchNewAnimations } from '../fx/loopPause';

// The mark of the page while its window is minimized: nothing styles it; it tells what the page knows (the end to end test reads it).
export const MINIMIZED_ATTRIBUTE = 'data-window-minimized';

// While the window is minimized the looping animations of the page wait (see loopPause.ts), and the page is marked: the main process tells
// it, as the page itself is not told on Linux. The animations that start meanwhile, or on a card out of sight, wait as they start.
export function useWindowMinimized(): void {
    useEffect(() => {
        const root = document.documentElement;
        const stopWatching = watchNewAnimations();
        const unsubscribe = window.api.onWindowMinimized((minimized) => {
            root.toggleAttribute(MINIMIZED_ATTRIBUTE, minimized);
            setWindowMinimized(minimized);
        });
        return () => {
            unsubscribe();
            stopWatching();
            root.removeAttribute(MINIMIZED_ATTRIBUTE);
            setWindowMinimized(false);
        };
    }, []);
}
