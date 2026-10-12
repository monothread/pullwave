import { useEffect, useState, type RefObject } from 'react';

interface Edges {
    top: number;
    height: number;
}

// How far through the content the scroll is, from 0 (its top is at the top of the scrolling area) to 1 (its end is at the bottom of it).
// Content that fits in the area is read as soon as it is in view (1), and content with no size yet is at the start (0).
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

// The fraction of the content scrolled (see scrollFraction), kept up to date while `active`: it follows the scrolling, the size of the window
// and the size of the content (the pictures change it as they load).
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
