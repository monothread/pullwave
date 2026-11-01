import { useEffect } from 'react';
import { useBackdropStore } from '../store/backdropStore';

// The screen of one anime or manga puts its cover behind the whole screen while it is open, as the page of a game on a console does.
export function useDetailBackdrop(url: string | null): void {
    const show = useBackdropStore((state) => {
        return state.show;
    });
    const clear = useBackdropStore((state) => {
        return state.clear;
    });
    useEffect(() => {
        if (url === null) {
            return undefined;
        }
        show(url);
        return () => {
            clear();
        };
    }, [url, show, clear]);
}
