import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { isNavigable } from '../navigation/spatialNavigation';

// A soft halo that slides from the control that had the focus to the one that has it now, as the cursor of a console (the ring of each
// control stays: the halo only trails it). It does not take the mouse and is hidden from the screen readers.
export interface HaloBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export const HALO_PADDING = 6;

export function haloBox(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): HaloBox {
    return {
        x: rect.left - HALO_PADDING,
        y: rect.top - HALO_PADDING,
        width: rect.width + HALO_PADDING * 2,
        height: rect.height + HALO_PADDING * 2
    };
}

function focusedBox(): HaloBox | null {
    const active = document.activeElement;
    if (!isNavigable(active) || !active.matches(':focus-visible')) {
        return null;
    }
    return haloBox(active.getBoundingClientRect());
}

export function FocusHalo() {
    const [box, setBox] = useState<HaloBox | null>(null);

    useEffect(() => {
        let frame = 0;
        const update = (): void => {
            window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(() => {
                setBox(focusedBox());
            });
        };
        document.addEventListener('focusin', update);
        document.addEventListener('focusout', update);
        document.addEventListener('keydown', update, true);
        document.addEventListener('pointerdown', update, true);
        window.addEventListener('scroll', update, true);
        window.addEventListener('resize', update);
        return () => {
            window.cancelAnimationFrame(frame);
            document.removeEventListener('focusin', update);
            document.removeEventListener('focusout', update);
            document.removeEventListener('keydown', update, true);
            document.removeEventListener('pointerdown', update, true);
            window.removeEventListener('scroll', update, true);
            window.removeEventListener('resize', update);
        };
    }, []);

    return (
        <motion.div
            className="focus-halo"
            aria-hidden="true"
            data-visible={box !== null}
            initial={false}
            animate={box === null ? { opacity: 0 } : { opacity: 1, x: box.x, y: box.y, width: box.width, height: box.height }}
            transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.7 }}
        />
    );
}
