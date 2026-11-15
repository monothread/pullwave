import type { Direction } from './spatialNavigation';

export type GamepadIntent = { kind: 'move'; direction: Direction } | { kind: 'activate' } | { kind: 'back' } | { kind: 'previous-section' } | { kind: 'next-section' };

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

export const STICK_THRESHOLD = 0.6;

export interface GamepadSnapshot {
    buttons: ReadonlyArray<{ pressed: boolean }>;
    axes: readonly number[];
}

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

export function heldInputs(gamepad: GamepadSnapshot): Set<string> {
    const held = new Set<string>(stickInputs(gamepad));
    Object.entries(GAMEPAD_BUTTON).forEach(([name, index]) => {
        if (isPressed(gamepad, index)) {
            held.add(name);
        }
    });
    return held;
}

export function intentsOf(previous: HeldInputs, current: HeldInputs): GamepadIntent[] {
    return INTENT_BY_INPUT.filter(([input]) => {
        return current.has(input) && !previous.has(input);
    }).map(([, intent]) => {
        return intent;
    });
}
