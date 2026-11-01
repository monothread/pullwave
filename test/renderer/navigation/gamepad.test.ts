import { GAMEPAD_BUTTON, STICK_THRESHOLD, heldInputs, intentsOf, type GamepadSnapshot } from '@renderer/navigation/gamepad';

const BUTTON_COUNT = 17;

// A gamepad of the standard layout with the given buttons held and the left stick at the given position.
function pad(pressed: number[] = [], axes: number[] = [0, 0, 0, 0]): GamepadSnapshot {
    return {
        buttons: Array.from({ length: BUTTON_COUNT }, (_, index) => {
            return { pressed: pressed.includes(index) };
        }),
        axes
    };
}

describe('the gamepad constants', () => {
    it('uses the buttons of the standard layout', () => {
        expect(GAMEPAD_BUTTON).toEqual({ a: 0, b: 1, leftBumper: 4, rightBumper: 5, up: 12, down: 13, left: 14, right: 15 });
    });

    it('counts the stick as pushed past 0.6', () => {
        expect(STICK_THRESHOLD).toBe(0.6);
    });
});

describe('heldInputs', () => {
    it('is empty when nothing is held', () => {
        expect([...heldInputs(pad())]).toEqual([]);
    });

    it.each([
        [GAMEPAD_BUTTON.a, 'a'],
        [GAMEPAD_BUTTON.b, 'b'],
        [GAMEPAD_BUTTON.leftBumper, 'leftBumper'],
        [GAMEPAD_BUTTON.rightBumper, 'rightBumper'],
        [GAMEPAD_BUTTON.up, 'up'],
        [GAMEPAD_BUTTON.down, 'down'],
        [GAMEPAD_BUTTON.left, 'left'],
        [GAMEPAD_BUTTON.right, 'right']
    ])('reads button %i as %s', (index, name) => {
        expect([...heldInputs(pad([index]))]).toEqual([name]);
    });

    it('ignores the buttons it does not listen to', () => {
        expect([...heldInputs(pad([2, 3, 6, 7, 8, 9, 10, 11, 16]))]).toEqual([]);
    });

    it.each([
        [[-0.6, 0], ['left']],
        [[0.6, 0], ['right']],
        [[0, -0.6], ['up']],
        [[0, 0.6], ['down']],
        [[-0.9, -0.9], ['left', 'up']],
        [[0.9, 0.9], ['right', 'down']]
    ])('reads the stick at %j as %j', (axes, expected) => {
        expect([...heldInputs(pad([], axes))]).toEqual(expected);
    });

    it('ignores a stick pushed less than the threshold', () => {
        expect([...heldInputs(pad([], [0.59, -0.59]))]).toEqual([]);
    });

    it('reads a gamepad with no axes and fewer buttons', () => {
        expect([...heldInputs({ buttons: [{ pressed: true }], axes: [] })]).toEqual(['a']);
    });

    it('joins the stick and the buttons', () => {
        expect([...heldInputs(pad([GAMEPAD_BUTTON.a, GAMEPAD_BUTTON.down], [0.8, 0]))].sort()).toEqual(['a', 'down', 'right']);
    });
});

describe('intentsOf', () => {
    it('asks for nothing when nothing changed', () => {
        expect(intentsOf(new Set(), new Set())).toEqual([]);
    });

    it.each([
        ['up', { kind: 'move', direction: 'up' }],
        ['down', { kind: 'move', direction: 'down' }],
        ['left', { kind: 'move', direction: 'left' }],
        ['right', { kind: 'move', direction: 'right' }],
        ['a', { kind: 'activate' }],
        ['b', { kind: 'back' }],
        ['leftBumper', { kind: 'previous-section' }],
        ['rightBumper', { kind: 'next-section' }]
    ])('turns a press of %s into %j', (input, intent) => {
        expect(intentsOf(new Set(), new Set([input]))).toEqual([intent]);
    });

    it('does not ask again for an input that is still held', () => {
        expect(intentsOf(new Set(['a', 'down']), new Set(['a', 'down']))).toEqual([]);
    });

    it('asks only for the inputs that were just pressed', () => {
        expect(intentsOf(new Set(['a']), new Set(['a', 'b']))).toEqual([{ kind: 'back' }]);
    });

    it('asks for nothing when an input is let go', () => {
        expect(intentsOf(new Set(['a']), new Set())).toEqual([]);
    });

    it('lists several presses in a fixed order', () => {
        expect(intentsOf(new Set(), new Set(['rightBumper', 'a', 'up']))).toEqual([{ kind: 'move', direction: 'up' }, { kind: 'activate' }, { kind: 'next-section' }]);
    });

    it('ignores names it does not know', () => {
        expect(intentsOf(new Set(), new Set(['start']))).toEqual([]);
    });
});
