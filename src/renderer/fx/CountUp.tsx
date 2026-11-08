import { animate } from 'motion';
import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
    value: number;
    // How long the count lasts, in seconds.
    seconds?: number;
}

// A number that counts up from where it was to its new value (from 0 the first time it is shown).
export function CountUp({ value, seconds = 0.9 }: CountUpProps) {
    const [shown, setShown] = useState(0);
    const from = useRef(0);
    useEffect(() => {
        const controls = animate(from.current, value, {
            duration: seconds,
            ease: 'easeOut',
            onUpdate: (latest) => {
                from.current = latest;
                setShown(Math.round(latest));
            }
        });
        return () => {
            controls.stop();
        };
    }, [value, seconds]);
    return <span className="count-up">{shown}</span>;
}
