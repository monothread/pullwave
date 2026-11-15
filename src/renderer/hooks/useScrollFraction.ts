import { useEffect, useState, type RefObject } from 'react';

interface Edges {
    top: number;
    height: number;
}

export function scrollFraction(content: Edges, area: Edges): number {
    if (content.height <= 0) {
        return 0;
    }
    const scrollable = content.height - area.height;
    if (scrollable <= 0) {
        return 1;
    }
    return Math.min(1, Math.max(0, (area.top - content.top) / scrollable));
}

export function useScrollFraction(area: () => HTMLElement | null, content: RefObject<HTMLElement | null>, active: boolean): number {
    const [fraction, setFraction] = useState(0);

    useEffect(() => {
        const scrolling = area();
        const element = content.current;
        if (!active || scrolling === null || element === null) {
            return undefined;
        }
        const update = (): void => {
            const areaBox = scrolling.getBoundingClientRect();
            const contentBox = element.getBoundingClientRect();
            setFraction(scrollFraction({ top: contentBox.top, height: contentBox.height }, { top: areaBox.top, height: areaBox.height }));
        };
        update();
        scrolling.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
        observer?.observe(element);
        return () => {
            scrolling.removeEventListener('scroll', update);
            window.removeEventListener('resize', update);
            observer?.disconnect();
        };
    }, [area, content, active]);

    return fraction;
}
