import { animate } from 'motion';
import { playUiSound } from '../sound/uiSound';
import { useUiPrefsStore } from '../store/uiPrefsStore';
import { useFxStore } from './fxStore';

// The cover of an anime or a manga that is added to the library flies to the library in the menu.
export const FLY_MS = 0.75;
export const NAV_PULSE_CLASS = 'tab--pulse';

export type LibrarySection = 'anime' | 'manga';

const COVER_SELECTOR = '.detail__art img.cover, .detail__art .cover, .series.detail img.cover, .manga__head img.cover';

export function findCover(root: ParentNode = document): HTMLElement | null {
    return root.querySelector<HTMLElement>(COVER_SELECTOR);
}

export function findNavButton(section: LibrarySection, root: ParentNode = document): HTMLElement | null {
    return root.querySelector<HTMLElement>(`.sidenav [data-section-id="${section}"]`);
}

// The movement of the flight, from the box of the cover to the box of the menu item (a point at its middle).
export function flightOf(from: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, to: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): { x: number; y: number; scale: number } {
    const targetSize = Math.min(to.width, to.height) * 0.5;
    return {
        x: to.left + to.width / 2 - (from.left + from.width / 2),
        y: to.top + to.height / 2 - (from.top + from.height / 2),
        scale: from.width > 0 ? Math.max(0.05, targetSize / from.width) : 0.1
    };
}

function playAddSound(): void {
    if (useUiPrefsStore.getState().sounds) {
        playUiSound('add');
    }
}

function pulse(button: HTMLElement): void {
    button.classList.add(NAV_PULSE_CLASS);
    window.setTimeout(() => {
        button.classList.remove(NAV_PULSE_CLASS);
    }, 900);
}

// Sends a copy of the cover to the item of the menu and makes the item pulse when it gets there. Without a cover on the screen (or
// without the menu) there is nothing to fly, and only the sound plays.
export function flyCoverToLibrary(section: LibrarySection, cover: HTMLElement | null = findCover()): void {
    playAddSound();
    useFxStore.getState().dance();
    const target = findNavButton(section);
    if (cover === null || target === null) {
        return;
    }
    const from = cover.getBoundingClientRect();
    const flight = flightOf(from, target.getBoundingClientRect());
    const ghost = cover.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('id');
    ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, {
        position: 'fixed',
        left: `${String(from.left)}px`,
        top: `${String(from.top)}px`,
        width: `${String(from.width)}px`,
        height: `${String(from.height)}px`,
        margin: '0',
        zIndex: '300',
        pointerEvents: 'none',
        transformOrigin: 'center center'
    });
    document.body.appendChild(ghost);
    void animate(
        ghost,
        { x: [0, flight.x * 0.4, flight.x], y: [0, -60, flight.y], scale: [1, 1.12, flight.scale], opacity: [1, 1, 0.2], rotate: [0, -8, 14] },
        { duration: FLY_MS, ease: 'easeInOut' }
    ).then(() => {
        ghost.remove();
        pulse(target);
    });
}
