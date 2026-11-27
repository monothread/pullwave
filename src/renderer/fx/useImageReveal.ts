import { useState, type SyntheticEvent } from 'react';
import { usePerformanceMode } from '../hooks/usePerformanceMode';

export const LOADING_CLASS = 'cover--loading';

export interface ImageReveal {
    className: (base: string) => string;
    onLoad: (event: SyntheticEvent<HTMLImageElement>) => void;
}

export function useImageReveal(): ImageReveal {
    const performanceMode = usePerformanceMode();
    const [loaded, setLoaded] = useState(false);
    if (performanceMode) {
        return {
            className: (base) => {
                return base;
            },
            onLoad: () => {
                return undefined;
            }
        };
    }
    return {
        className: (base) => {
            return loaded ? base : `${base} ${LOADING_CLASS}`;
        },
        onLoad: () => {
            setLoaded(true);
        }
    };
}
