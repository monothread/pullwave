import { useEffect } from 'react';
import { useBackdropStore } from '../store/backdropStore';

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
