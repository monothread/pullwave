import { useEffect, useState } from 'react';

// Whether `container` has been scrolled further down than `threshold` pixels.
export function useScrolledDown(container: () => HTMLElement | null, threshold: number | (() => number)): boolean {
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const element = container();
        if (element === null) {
            return undefined;
        }
        const update = (): void => {
            setScrolled(element.scrollTop > (typeof threshold === 'function' ? threshold() : threshold));
        };
        update();
        element.addEventListener('scroll', update, { passive: true });
        return () => {
            element.removeEventListener('scroll', update);
        };
    }, [container, threshold]);

    return scrolled;
}
