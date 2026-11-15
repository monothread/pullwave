import { animate } from 'motion';
import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
    value: number;
    seconds?: number;
}

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
