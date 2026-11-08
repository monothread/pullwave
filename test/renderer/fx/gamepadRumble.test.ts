// @vitest-environment jsdom
import { RUMBLE_DONE, RUMBLE_EDGE, rumbleGamepads } from '@renderer/fx/gamepadRumble';

afterEach(() => {
    Reflect.deleteProperty(navigator, 'getGamepads');
});

describe('rumbleGamepads', () => {
    it('has a longer buzz for a finished download than for the end of a list', () => {
        expect(RUMBLE_DONE).toEqual({ durationMs: 220, strong: 0.5, weak: 0.8 });
        expect(RUMBLE_EDGE).toEqual({ durationMs: 70, strong: 0.2, weak: 0.4 });
    });

    it('does nothing where the browser cannot list gamepads', () => {
        expect(() => {
            rumbleGamepads(RUMBLE_DONE);
        }).not.toThrow();
    });

    it('plays a dual rumble with the exact values on every gamepad that can vibrate, and skips the others', () => {
        const playEffect = vi.fn(() => { return Promise.resolve(); });
        Object.defineProperty(navigator, 'getGamepads', {
            configurable: true,
            value: () => { return [null, { vibrationActuator: { playEffect } }, { vibrationActuator: null }, {}]; }
        });
        rumbleGamepads(RUMBLE_DONE);
        expect(playEffect.mock.calls).toEqual([['dual-rumble', { duration: 220, strongMagnitude: 0.5, weakMagnitude: 0.8 }]]);
    });

    it('swallows a gamepad that refuses to vibrate', async () => {
        const playEffect = vi.fn(() => { return Promise.reject(new Error('no')); });
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => { return [{ vibrationActuator: { playEffect } }]; } });
        expect(() => {
            rumbleGamepads(RUMBLE_EDGE);
        }).not.toThrow();
        await Promise.resolve();
        expect(playEffect.mock.calls).toEqual([['dual-rumble', { duration: 70, strongMagnitude: 0.2, weakMagnitude: 0.4 }]]);
    });
});
