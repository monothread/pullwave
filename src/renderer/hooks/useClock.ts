import { useEffect, useState } from 'react';

// How often the clock is read: often enough that the minute shown is never more than a few seconds late.
export const CLOCK_TICK_MS = 5000;

// The time now, read again every few seconds while the component is on the screen.
export function useClock(): Date {
    const [now, setNow] = useState(() => {
        return new Date();
    });
    useEffect(() => {
        const timer = setInterval(() => {
            setNow(new Date());
        }, CLOCK_TICK_MS);
        return () => {
            clearInterval(timer);
        };
    }, []);
    return now;
}
