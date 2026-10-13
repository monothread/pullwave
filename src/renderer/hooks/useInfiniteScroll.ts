import { useEffect, useRef, useState } from 'react';

// Calls `onReach` when the element the returned ref is put on comes into view (the end of a list), as long as `enabled`. Every time the
// list grows (`version` changes) it looks again, since an element that stays in view after the new items come in must ask for more. It also
// looks again when the element itself is another one (the list went away, for the page of a manga, and came back), which changes neither
// `enabled` nor `version`.
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
