import { useEffect, useState } from 'react';

export function useSteadyFlag(active: boolean, showAfterMs: number, hideAfterMs: number): boolean {
    const [shown, setShown] = useState(false);
    useEffect(() => {
        if (active === shown) {
            return undefined;
        }
        const timer = window.setTimeout(() => {
            setShown(active);
        }, active ? showAfterMs : hideAfterMs);
        return () => {
            window.clearTimeout(timer);
        };
    }, [active, shown, showAfterMs, hideAfterMs]);
    return shown;
}
