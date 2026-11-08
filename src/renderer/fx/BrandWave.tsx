import { useEffect, useRef, useState } from 'react';
import { isLogoFlurry } from './konami';
import { useActivityLevel } from './useActivityLevel';
import { useFxStore } from './fxStore';

// The bars beside the name of the app, which rise and fall like a sound wave.
export const BRAND_WAVE_BARS = 5;
// How long the wave dances after something finished.
export const DANCE_MS = 1400;

// The wave of the name follows what the app is doing: it lies almost flat when nothing goes on, rises with the downloads, dances when
// something finishes or when the name is clicked, and runs through every colour in the secret mode.
export function BrandWave() {
    const level = useActivityLevel();
    const dances = useFxStore((state) => {
        return state.dances;
    });
    const rainbow = useFxStore((state) => {
        return state.rainbow;
    });
    // The dance lasts a little after each new one; `settled` is the last one that was over by then.
    const [settled, setSettled] = useState(0);
    useEffect(() => {
        if (dances === 0) {
            return undefined;
        }
        const timer = window.setTimeout(() => {
            setSettled(dances);
        }, DANCE_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, [dances]);
    const dancing = dances !== settled;
    const classes = ['brand__wave', `brand__wave--${level}`, dancing ? 'brand__wave--dance' : '', rainbow ? 'brand__wave--rainbow' : ''].filter(Boolean).join(' ');
    return (
        <span className={classes} aria-hidden="true" data-activity={level}>
            {Array.from({ length: BRAND_WAVE_BARS }, (_, index) => {
                return <span key={index} className="brand__bar" />;
            })}
        </span>
    );
}

// The clicks on the name: five close ones make the wave dance.
export function useLogoClicks(): () => void {
    const times = useRef<number[]>([]);
    return () => {
        const now = Date.now();
        times.current = [...times.current.filter((time) => {
            return now - time < 5000;
        }), now];
        if (isLogoFlurry(times.current, now)) {
            times.current = [];
            useFxStore.getState().dance();
        }
    };
}
