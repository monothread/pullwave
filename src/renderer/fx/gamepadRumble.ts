// A short buzz on the gamepads that can do it (a download that ends, the end of a list). Where the browser cannot vibrate a gamepad, or none
// is connected, nothing happens.

export interface RumbleActuator {
    playEffect: (type: 'dual-rumble', params: { duration: number; strongMagnitude: number; weakMagnitude: number }) => Promise<unknown>;
}

interface RumbleGamepad {
    vibrationActuator?: RumbleActuator | null;
}

export interface Rumble {
    durationMs: number;
    strong: number;
    weak: number;
}

export const RUMBLE_DONE: Rumble = { durationMs: 220, strong: 0.5, weak: 0.8 };
export const RUMBLE_EDGE: Rumble = { durationMs: 70, strong: 0.2, weak: 0.4 };

export function rumbleGamepads(rumble: Rumble): void {
    if (typeof navigator.getGamepads !== 'function') {
        return;
    }
    for (const gamepad of navigator.getGamepads() as ReadonlyArray<RumbleGamepad | null>) {
        gamepad?.vibrationActuator
            ?.playEffect('dual-rumble', { duration: rumble.durationMs, strongMagnitude: rumble.strong, weakMagnitude: rumble.weak })
            .catch(() => {
                // A gamepad that refuses to vibrate is not an error.
            });
    }
}
