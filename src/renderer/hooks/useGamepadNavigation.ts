import { RUMBLE_EDGE, rumbleGamepads } from '../fx/gamepadRumble';
import { useEffect, useRef } from 'react';
import { heldInputs, intentsOf, type GamepadIntent, type GamepadSnapshot, type HeldInputs } from '../navigation/gamepad';
import { arrowsAreOwned, firstFocusTarget, isNavigable, moveFocus, scopeOf } from '../navigation/spatialNavigation';
import { MOUSE_BACK_BUTTON } from './useMouseNavigation';

export interface GamepadSections {
    previous: () => void;
    next: () => void;
}

const KEY_BY_DIRECTION = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } as const;

function pressKey(key: string): void {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function goBack(): void {
    const active = document.activeElement;
    const dialog = active instanceof HTMLElement ? scopeOf(active) : null;
    if (dialog !== null && dialog.getAttribute('role') === 'dialog' && !arrowsAreOwned()) {
        pressKey('Escape');
        return;
    }
    window.dispatchEvent(new MouseEvent('mouseup', { button: MOUSE_BACK_BUTTON, bubbles: true, cancelable: true }));
}

function move(direction: keyof typeof KEY_BY_DIRECTION): void {
    if (arrowsAreOwned()) {
        pressKey(KEY_BY_DIRECTION[direction]);
        return;
    }
    const active = document.activeElement;
    if (isNavigable(active) && scopeOf(active) !== null) {
        if (!moveFocus(active, direction)) {
            rumbleGamepads(RUMBLE_EDGE);
        }
        return;
    }
    firstFocusTarget()?.focus();
}

function activate(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
        active.click();
        return;
    }
    firstFocusTarget()?.focus();
}

export function runIntent(intent: GamepadIntent, sections: GamepadSections): void {
    switch (intent.kind) {
        case 'move': {
            move(intent.direction);
            return;
        }
        case 'activate': {
            activate();
            return;
        }
        case 'back': {
            goBack();
            return;
        }
        case 'previous-section': {
            sections.previous();
            return;
        }
        case 'next-section': {
            sections.next();
            return;
        }
    }
}

function connectedGamepads(): GamepadSnapshot[] {
    if (typeof navigator.getGamepads !== 'function') {
        return [];
    }
    return navigator.getGamepads().filter((gamepad): gamepad is Gamepad => {
        return gamepad !== null;
    });
}

function readHeld(): Set<string> {
    const held = new Set<string>();
    connectedGamepads().forEach((gamepad) => {
        heldInputs(gamepad).forEach((input) => {
            held.add(input);
        });
    });
    return held;
}

export function useGamepadNavigation(sections: GamepadSections): void {
    const sectionsRef = useRef(sections);
    useEffect(() => {
        sectionsRef.current = sections;
    }, [sections]);

    useEffect(() => {
        let frame: number | null = null;
        let previous: HeldInputs = new Set<string>();
        const poll = (): void => {
            const current = readHeld();
            intentsOf(previous, current).forEach((intent) => {
                runIntent(intent, sectionsRef.current);
            });
            previous = current;
            frame = connectedGamepads().length > 0 ? window.requestAnimationFrame(poll) : null;
        };
        const start = (): void => {
            if (frame === null) {
                frame = window.requestAnimationFrame(poll);
            }
        };
        window.addEventListener('gamepadconnected', start);
        if (connectedGamepads().length > 0) {
            start();
        }
        return () => {
            window.removeEventListener('gamepadconnected', start);
            if (frame !== null) {
                window.cancelAnimationFrame(frame);
            }
        };
    }, []);
}
