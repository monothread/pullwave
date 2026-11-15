import { useState, type SyntheticEvent } from 'react';

export const LOADING_CLASS = 'cover--loading';

export interface ImageReveal {
    className: (base: string) => string;
    onLoad: (event: SyntheticEvent<HTMLImageElement>) => void;
}

export function useImageReveal(): ImageReveal {
    const [loaded, setLoaded] = useState(false);
    return {
        className: (base) => {
            return loaded ? base : `${base} ${LOADING_CLASS}`;
        },
        onLoad: () => {
            setLoaded(true);
        }
    };
}
