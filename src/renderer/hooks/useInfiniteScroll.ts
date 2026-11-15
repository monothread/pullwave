import { useEffect, useRef, useState } from 'react';

export function useInfiniteScroll(onReach: () => void, enabled: boolean, version: number): (element: HTMLElement | null) => void {
    const [element, setElement] = useState<HTMLElement | null>(null);
    const reach = useRef(onReach);

    useEffect(() => {
        reach.current = onReach;
    }, [onReach]);

    useEffect(() => {
        if (!enabled || element === null || typeof IntersectionObserver === 'undefined') {
            return undefined;
        }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => {
                return entry.isIntersecting;
            })) {
                reach.current();
            }
        });
        observer.observe(element);
        return () => {
            observer.disconnect();
        };
    }, [element, enabled, version]);

    return setElement;
}
