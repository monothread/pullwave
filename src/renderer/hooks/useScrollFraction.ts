import { useEffect, useState, type RefObject } from 'react';

export interface Edges {
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

function pagesPassed(count: number, pageAt: (index: number) => Edges | null, line: number): number | null {
    let low = 0;
    let high = count;
    let lowPage: Edges | null = null;
    while (low < high) {
        const mid = (low + high) >>> 1;
        const page = pageAt(mid);
        if (page === null) {
            return null;
        }
        if (page.top + page.height <= line) {
            low = mid + 1;
        } else {
            high = mid;
            lowPage = page;
        }
    }
    if (low >= count) {
        return count;
    }
    if (lowPage === null || line <= lowPage.top || lowPage.height <= 0) {
        return low;
    }
    return low + (line - lowPage.top) / lowPage.height;
}

function fractionFromPages(count: number, pageAt: (index: number) => Edges | null, area: Edges): number | null {
    if (count <= 0) {
        return 0;
    }
    const first = pageAt(0);
    const last = count === 1 ? first : pageAt(count - 1);
    if (first === null || last === null) {
        return null;
    }
    const span = last.top + last.height - first.top;
    if (span <= 0) {
        return 0;
    }
    if (span <= area.height) {
        return 1;
    }
    const above = pagesPassed(count, pageAt, area.top);
    if (above === null) {
        return null;
    }
    const passedBottom = pagesPassed(count, pageAt, area.top + area.height);
    if (passedBottom === null) {
        return null;
    }
    const below = Math.max(0, count - passedBottom);
    const total = above + below;
    if (total <= 0) {
        return 1;
    }
    return Math.min(1, Math.max(0, above / total));
}

export function pagesScrollFraction(pages: readonly Edges[], area: Edges): number {
    return (
        fractionFromPages(
            pages.length,
            (index) => {
                return pages[index] ?? null;
            },
            area
        ) ?? 0
    );
}

function pageBoxAt(children: HTMLCollection, index: number): Edges | null {
    const child = children[index];
    if (!(child instanceof HTMLElement)) {
        return null;
    }
    const target = child.hasAttribute('data-page') ? child : child.querySelector<HTMLElement>('[data-page]');
    if (target === null) {
        return null;
    }
    const box = target.getBoundingClientRect();
    return { top: box.top, height: box.height };
}

function measurePages(element: HTMLElement, area: Edges): number | null {
    const { children } = element;
    const count = children.length;
    if (count === 0) {
        return null;
    }
    const first = pageBoxAt(children, 0);
    const last = count === 1 ? first : pageBoxAt(children, count - 1);
    if (first === null || last === null || (first.height <= 0 && last.height <= 0)) {
        return null;
    }
    return fractionFromPages(
        count,
        (index) => {
            if (index === 0) {
                return first;
            }
            if (index === count - 1) {
                return last;
            }
            return pageBoxAt(children, index);
        },
        area
    );
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
            const areaEdges: Edges = { top: areaBox.top, height: areaBox.height };
            const byPages = measurePages(element, areaEdges);
            if (byPages !== null) {
                setFraction(byPages);
                return;
            }
            const contentBox = element.getBoundingClientRect();
            setFraction(scrollFraction({ top: contentBox.top, height: contentBox.height }, areaEdges));
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
