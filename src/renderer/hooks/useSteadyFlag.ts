import { useEffect, useState } from 'react';

// A yes/no that comes from something that flickers, made steady: it becomes true only after `active` has been true without a break for
// `showAfterMs`, and false only after it has been false for `hideAfterMs`. A thing that comes and goes in less than that is never seen.
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
