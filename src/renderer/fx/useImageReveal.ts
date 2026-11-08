import { useState, type SyntheticEvent } from 'react';

// A picture that arrives blurred and comes into focus once it has loaded (the cover of a tile).
export const LOADING_CLASS = 'cover--loading';

export interface ImageReveal {
    // The classes of the picture: the base ones and, until it has loaded, the one that blurs it.
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
