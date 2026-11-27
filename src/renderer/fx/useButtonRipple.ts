import { useEffect } from 'react';

export const RIPPLE_SELECTOR = '.btn, .topbar__button, .player__button, .spotlight__arrow';
export const RIPPLE_CLASS = 'is-rippling';
export const RIPPLE_MS = 650;

export function startRipple(control: HTMLElement, clientX: number, clientY: number): void {
    const box = control.getBoundingClientRect();
    control.style.setProperty('--rx', `${String(Math.round(clientX - box.left))}px`);
    control.style.setProperty('--ry', `${String(Math.round(clientY - box.top))}px`);
    control.classList.remove(RIPPLE_CLASS);
    void control.offsetWidth;
    control.classList.add(RIPPLE_CLASS);
    window.setTimeout(() => {
        control.classList.remove(RIPPLE_CLASS);
    }, RIPPLE_MS);
}

export function useButtonRipple(enabled = true): void {
    useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        const onPointerDown = (event: PointerEvent): void => {
            if (!(event.target instanceof Element)) {
                return;
            }
            const control = event.target.closest<HTMLElement>(RIPPLE_SELECTOR);
            if (control === null || (control instanceof HTMLButtonElement && control.disabled)) {
                return;
            }
            startRipple(control, event.clientX, event.clientY);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
        };
    }, [enabled]);
}
