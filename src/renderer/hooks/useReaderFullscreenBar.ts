import { useEffect, useState, type RefObject } from 'react';

export const READER_BAR_HIDE_MS = 5000;
export const READER_BAR_HOVER_MIN_PX = 64;

function hoverZoneHeight(bar: HTMLElement | null): number {
    return Math.max(bar?.getBoundingClientRect().height ?? 0, READER_BAR_HOVER_MIN_PX);
}

function pointerOverBar(event: MouseEvent, area: HTMLElement, bar: HTMLElement | null): boolean {
    if (bar !== null && event.target instanceof Node && bar.contains(event.target)) {
        return true;
    }
    const top = area.getBoundingClientRect().top;
    return event.clientY >= top && event.clientY - top <= hoverZoneHeight(bar);
}

export function useReaderFullscreenBar(area: () => HTMLElement, bar: RefObject<HTMLElement | null>, active: boolean, pinned: boolean): boolean {
    const [hidden, setHidden] = useState(false);
    const [hovering, setHovering] = useState(false);
    const [wasActive, setWasActive] = useState(active);
    const [wasPinned, setWasPinned] = useState(pinned);

    if (wasActive !== active) {
        setWasActive(active);
        setHidden(false);
        setHovering(false);
    }

    if (wasPinned !== pinned) {
        setWasPinned(pinned);
        if (pinned) {
            setHidden(false);
        }
    }

    useEffect(() => {
        if (!active) {
            return undefined;
        }
        const areaElement = area();
        const barElement = bar.current;

        const onAreaMouseMove = (event: MouseEvent): void => {
            const over = pointerOverBar(event, areaElement, bar.current);
            setHovering(over);
            if (over) {
                setHidden(false);
            }
        };

        const onAreaMouseLeave = (): void => {
            setHovering(false);
        };

        const onBarMouseEnter = (): void => {
            setHovering(true);
            setHidden(false);
        };

        const onBarMouseLeave = (): void => {
            setHovering(false);
        };

        areaElement.addEventListener('mousemove', onAreaMouseMove);
        areaElement.addEventListener('mouseleave', onAreaMouseLeave);
        if (barElement !== null) {
            barElement.addEventListener('mouseenter', onBarMouseEnter);
            barElement.addEventListener('mouseleave', onBarMouseLeave);
        }

        return () => {
            areaElement.removeEventListener('mousemove', onAreaMouseMove);
            areaElement.removeEventListener('mouseleave', onAreaMouseLeave);
            if (barElement !== null) {
                barElement.removeEventListener('mouseenter', onBarMouseEnter);
                barElement.removeEventListener('mouseleave', onBarMouseLeave);
            }
        };
    }, [active, area, bar]);

    useEffect(() => {
        if (!active || pinned || hovering || hidden) {
            return undefined;
        }
        const timer = setTimeout(() => {
            setHidden(true);
        }, READER_BAR_HIDE_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [active, pinned, hovering, hidden]);

    return active && !pinned && !hovering && hidden;
}
