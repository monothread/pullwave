import { useEffect } from 'react';

// The tiles of the libraries lean toward the pointer, with a light that follows it.
export const TILT_SELECTOR = '.cover-grid > .cover-card';
// The most a tile leans, in degrees.
export const MAX_TILT_DEGREES = 9;

export interface TiltValues {
    x: string;
    y: string;
    glareX: string;
    glareY: string;
}

// How a tile leans for a pointer at a place of its box: a pointer to the right leans the right side away, one above leans the top away.
export function tiltOf(clientX: number, clientY: number, box: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): TiltValues {
    const across = box.width > 0 ? (clientX - box.left) / box.width : 0.5;
    const down = box.height > 0 ? (clientY - box.top) / box.height : 0.5;
    const clampedAcross = Math.min(1, Math.max(0, across));
    const clampedDown = Math.min(1, Math.max(0, down));
    return {
        x: `${(((0.5 - clampedDown) * 2 * MAX_TILT_DEGREES) || 0).toFixed(2)}deg`,
        y: `${(((clampedAcross - 0.5) * 2 * MAX_TILT_DEGREES) || 0).toFixed(2)}deg`,
        glareX: `${(clampedAcross * 100).toFixed(1)}%`,
        glareY: `${(clampedDown * 100).toFixed(1)}%`
    };
}

export function applyTilt(card: HTMLElement, values: TiltValues | null): void {
    const properties: ReadonlyArray<[string, string]> = [
        ['--tilt-x', values?.x ?? '0deg'],
        ['--tilt-y', values?.y ?? '0deg'],
        ['--glare-x', values?.glareX ?? '50%'],
        ['--glare-y', values?.glareY ?? '50%']
    ];
    properties.forEach(([name, value]) => {
        card.style.setProperty(name, value);
    });
}

export function useCoverTilt(): void {
    useEffect(() => {
        let frame = 0;
        let current: HTMLElement | null = null;
        const onPointerMove = (event: PointerEvent): void => {
            const card = event.target instanceof Element ? event.target.closest<HTMLElement>(TILT_SELECTOR) : null;
            if (current !== null && current !== card) {
                applyTilt(current, null);
            }
            current = card;
            if (card === null || frame !== 0) {
                return;
            }
            const { clientX, clientY } = event;
            frame = window.requestAnimationFrame(() => {
                frame = 0;
                applyTilt(card, tiltOf(clientX, clientY, card.getBoundingClientRect()));
            });
        };
        const onPointerLeave = (): void => {
            if (current !== null) {
                applyTilt(current, null);
                current = null;
            }
        };
        document.addEventListener('pointermove', onPointerMove);
        document.documentElement.addEventListener('pointerleave', onPointerLeave);
        return () => {
            window.cancelAnimationFrame(frame);
            document.removeEventListener('pointermove', onPointerMove);
            document.documentElement.removeEventListener('pointerleave', onPointerLeave);
        };
    }, []);
}
