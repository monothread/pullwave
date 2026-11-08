import { useEffect } from 'react';

// The controls that send a ripple from the point where they are pressed.
export const RIPPLE_SELECTOR = '.btn, .topbar__button, .player__button, .spotlight__arrow';
export const RIPPLE_CLASS = 'is-rippling';
// A little longer than the animation of the ripple (bp-ripple).
export const RIPPLE_MS = 650;

// A press on a control starts a ripple at the point of the press: its place is given to the style sheet as --rx and --ry.
export function startRipple(control: HTMLElement, clientX: number, clientY: number): void {
    const box = control.getBoundingClientRect();
    control.style.setProperty('--rx', `${String(Math.round(clientX - box.left))}px`);
    control.style.setProperty('--ry', `${String(Math.round(clientY - box.top))}px`);
    control.classList.remove(RIPPLE_CLASS);
    // Reading the layout makes the browser see the class gone, so adding it again starts the animation again.
    void control.offsetWidth;
    control.classList.add(RIPPLE_CLASS);
    window.setTimeout(() => {
        control.classList.remove(RIPPLE_CLASS);
    }, RIPPLE_MS);
}

export function useButtonRipple(): void {
    useEffect(() => {
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
    }, []);
}
