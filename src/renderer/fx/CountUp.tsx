import { animate } from 'motion';
import { useEffect, useRef, useState } from 'react';
import { usePerformanceMode } from '../hooks/usePerformanceMode';

interface CountUpProps {
    value: number;
    seconds?: number;
}

export function CountUp({ value, seconds = 0.9 }: CountUpProps) {
    const performanceMode = usePerformanceMode();
    const [shown, setShown] = useState(() => {
        return performanceMode ? value : 0;
    });
    if (performanceMode && shown !== value) {
        setShown(value);
    }
    const from = useRef(performanceMode ? value : 0);
    useEffect(() => {
        if (performanceMode || from.current === value) {
            from.current = value;
            return undefined;
        }
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
    }, [value, seconds, performanceMode]);
    return <span className="count-up">{performanceMode ? value : shown}</span>;
}
