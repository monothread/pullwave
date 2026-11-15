import { useEffect } from 'react';
import { setWindowMinimized, watchNewAnimations } from '../fx/loopPause';

export const MINIMIZED_ATTRIBUTE = 'data-window-minimized';

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
