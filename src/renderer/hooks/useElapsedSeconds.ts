import { useEffect, useState } from 'react';

// How many whole seconds have passed since `running` became true (zero when it is not), updated every second.
export function useElapsedSeconds(running: boolean): number {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        if (!running) {
            return undefined;
        }
        const started = Date.now();
        const timer = setInterval(() => {
            setElapsed(Math.floor((Date.now() - started) / 1000));
        }, 1000);
        return () => {
            clearInterval(timer);
            setElapsed(0);
        };
    }, [running]);

    return running ? elapsed : 0;
}
