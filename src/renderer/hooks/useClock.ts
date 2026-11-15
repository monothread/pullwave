import { useEffect, useState } from 'react';

export const CLOCK_TICK_MS = 5000;

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
