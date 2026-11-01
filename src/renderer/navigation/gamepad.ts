import type { Direction } from './spatialNavigation';

// What a press of a gamepad asks the interface to do.
export type GamepadIntent = { kind: 'move'; direction: Direction } | { kind: 'activate' } | { kind: 'back' } | { kind: 'previous-section' } | { kind: 'next-section' };

// The buttons of the standard layout (https://w3c.github.io/gamepad/#remapping) the interface listens to.
export const GAMEPAD_BUTTON = {
    a: 0,
    b: 1,
    leftBumper: 4,
    rightBumper: 5,
    up: 12,
    down: 13,
    left: 14,
    right: 15
} as const;

// How far the left stick has to be pushed to count as a press of the directional pad.
export const STICK_THRESHOLD = 0.6;

// The parts of a Gamepad that are read: a real one and a test double both fit.
export interface GamepadSnapshot {
    buttons: ReadonlyArray<{ pressed: boolean }>;
    axes: readonly number[];
}

// The inputs held down at one moment, by name: a press is an input that is held now and was not held before.
export type HeldInputs = ReadonlySet<string>;

const INTENT_BY_INPUT: ReadonlyArray<[string, GamepadIntent]> = [
    ['up', { kind: 'move', direction: 'up' }],
    ['down', { kind: 'move', direction: 'down' }],
    ['left', { kind: 'move', direction: 'left' }],
    ['right', { kind: 'move', direction: 'right' }],
    ['a', { kind: 'activate' }],
    ['b', { kind: 'back' }],
    ['leftBumper', { kind: 'previous-section' }],
    ['rightBumper', { kind: 'next-section' }]
];

function isPressed(gamepad: GamepadSnapshot, index: number): boolean {
    return gamepad.buttons[index]?.pressed === true;
}

// The directions the left stick is pushed to.
function stickInputs(gamepad: GamepadSnapshot): string[] {
    const x = gamepad.axes[0] ?? 0;
    const y = gamepad.axes[1] ?? 0;
    const held: string[] = [];
    if (x <= -STICK_THRESHOLD) {
        held.push('left');
    } else if (x >= STICK_THRESHOLD) {
        held.push('right');
    }
    if (y <= -STICK_THRESHOLD) {
        held.push('up');
    } else if (y >= STICK_THRESHOLD) {
        held.push('down');
    }
    return held;
}

// Everything held on the gamepad now: the buttons the interface listens to and the directions of the stick.
export function heldInputs(gamepad: GamepadSnapshot): Set<string> {
    const held = new Set<string>(stickInputs(gamepad));
    Object.entries(GAMEPAD_BUTTON).forEach(([name, index]) => {
        if (isPressed(gamepad, index)) {
            held.add(name);
        }
    });
    return held;
}

// What the inputs pressed since the last reading ask for, in a fixed order; an input held over from before asks for nothing again.
export function intentsOf(previous: HeldInputs, current: HeldInputs): GamepadIntent[] {
    return INTENT_BY_INPUT.filter(([input]) => {
        return current.has(input) && !previous.has(input);
    }).map(([, intent]) => {
        return intent;
    });
}
