// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react';
import type { Mock } from 'vitest';
import { runIntent, useGamepadNavigation, type GamepadSections } from '@renderer/hooks/useGamepadNavigation';
import { GAMEPAD_BUTTON } from '@renderer/navigation/gamepad';

const BUTTON_COUNT = 17;
const scrollIntoView = vi.fn();
let frames: FrameRequestCallback[] = [];
let pads: Array<Gamepad | null> = [];
const requestFrame = vi.fn((callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
});
const cancelFrame = vi.fn();
const originalRequest = window.requestAnimationFrame;
const originalCancel = window.cancelAnimationFrame;

function gamepad(pressed: number[] = [], axes: number[] = [0, 0]): Gamepad {
    return {
        buttons: Array.from({ length: BUTTON_COUNT }, (_, index) => {
            return { pressed: pressed.includes(index), touched: false, value: pressed.includes(index) ? 1 : 0 };
        }),
        axes
    } as unknown as Gamepad;
}

// Runs the frame the hook asked for, with the gamepads as they are now.
function nextFrame(): void {
    const callback = frames.shift();
    act(() => {
        callback?.(0);
    });
}

function hold(pressed: number[], axes: number[] = [0, 0]): void {
    pads = [gamepad(pressed, axes)];
    nextFrame();
}

function place(element: HTMLElement, left: number, top: number): void {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        x: left,
        y: top,
        left,
        top,
        width: 80,
        height: 30,
        right: left + 80,
        bottom: top + 30,
        toJSON: () => {
            return {};
        }
    });
}

interface SectionsMock extends GamepadSections {
    previous: Mock<() => void>;
    next: Mock<() => void>;
}

function sectionsMock(): SectionsMock {
    return { previous: vi.fn<() => void>(), next: vi.fn<() => void>() };
}

function Screen({ sections, dialog = false, player = false, onDialogKey = vi.fn(), onClickA = vi.fn() }: { sections: GamepadSections; dialog?: boolean; player?: boolean; onDialogKey?: (key: string) => void; onClickA?: () => void }) {
    useGamepadNavigation(sections);
    return (
        <div className="app">
            <nav className="tabs tabs--main">
                <button type="button" data-spot="first">
                    FIRST
                </button>
                <button type="button" data-spot="current" aria-current="page">
                    CURRENT
                </button>
            </nav>
            <button type="button" data-spot="A" onClick={onClickA}>
                A
            </button>
            <button type="button" data-spot="B">
                B
            </button>
            {dialog && (
                <div
                    role="dialog"
                    aria-modal="true"
                    onKeyDown={(event) => {
                        onDialogKey(event.key);
                    }}
                >
                    <button type="button" data-spot="in-dialog">
                        OK
                    </button>
                </div>
            )}
            {player && <div className="player" />}
        </div>
    );
}

function spot(label: string): HTMLElement {
    return document.querySelector<HTMLElement>(`[data-spot="${label}"]`) as HTMLElement;
}

function placeGrid(): void {
    place(spot('first'), 0, 0);
    place(spot('current'), 100, 0);
    place(spot('A'), 0, 100);
    place(spot('B'), 100, 100);
}

beforeEach(() => {
    frames = [];
    pads = [];
    requestFrame.mockClear();
    cancelFrame.mockClear();
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.requestAnimationFrame = requestFrame;
    window.cancelAnimationFrame = cancelFrame;
    Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: () => {
            return pads;
        }
    });
});

afterEach(() => {
    window.requestAnimationFrame = originalRequest;
    window.cancelAnimationFrame = originalCancel;
    Reflect.deleteProperty(navigator, 'getGamepads');
    vi.restoreAllMocks();
});

describe('useGamepadNavigation: when it reads the gamepads', () => {
    it('does not read anything while no gamepad is connected', () => {
        pads = [null];
        render(<Screen sections={sectionsMock()} />);
        expect(requestFrame).not.toHaveBeenCalled();
    });

    it('starts reading when a gamepad is connected', () => {
        render(<Screen sections={sectionsMock()} />);
        expect(requestFrame).not.toHaveBeenCalled();
        pads = [gamepad()];
        fireEvent(window, new Event('gamepadconnected'));
        expect(requestFrame).toHaveBeenCalledTimes(1);
        // A second event while it reads does not start a second loop.
        fireEvent(window, new Event('gamepadconnected'));
        expect(requestFrame).toHaveBeenCalledTimes(1);
    });

    it('starts at once when a gamepad is already connected', () => {
        pads = [gamepad()];
        render(<Screen sections={sectionsMock()} />);
        expect(requestFrame).toHaveBeenCalledTimes(1);
    });

    it('keeps reading while a gamepad is connected and stops when the last one goes', () => {
        pads = [gamepad()];
        render(<Screen sections={sectionsMock()} />);
        nextFrame();
        expect(requestFrame).toHaveBeenCalledTimes(2);
        pads = [];
        nextFrame();
        expect(requestFrame).toHaveBeenCalledTimes(2);
        expect(frames).toEqual([]);
    });

    it('does not read anything where the browser has no gamepads', () => {
        Reflect.deleteProperty(navigator, 'getGamepads');
        render(<Screen sections={sectionsMock()} />);
        fireEvent(window, new Event('gamepadconnected'));
        nextFrame();
        expect(requestFrame).toHaveBeenCalledTimes(1);
        expect(frames).toEqual([]);
    });

    it('stops reading and listening when the app goes away', () => {
        pads = [gamepad()];
        const removeSpy = vi.spyOn(window, 'removeEventListener');
        const { unmount } = render(<Screen sections={sectionsMock()} />);
        unmount();
        expect(cancelFrame).toHaveBeenCalledTimes(1);
        expect(cancelFrame).toHaveBeenCalledWith(1);
        expect(
            removeSpy.mock.calls.filter(([type]) => {
                return type === 'gamepadconnected';
            })
        ).toHaveLength(1);
    });

    it('does not cancel a frame when it was not reading', () => {
        const { unmount } = render(<Screen sections={sectionsMock()} />);
        unmount();
        expect(cancelFrame).not.toHaveBeenCalled();
    });
});

describe('useGamepadNavigation: what the presses do', () => {
    it('moves the focus with the directional pad, once per press', () => {
        pads = [gamepad()];
        render(<Screen sections={sectionsMock()} />);
        placeGrid();
        spot('A').focus();
        hold([GAMEPAD_BUTTON.right]);
        expect(document.activeElement).toBe(spot('B'));
        // Still held: it does not move again.
        hold([GAMEPAD_BUTTON.right]);
        expect(document.activeElement).toBe(spot('B'));
        hold([]);
        hold([GAMEPAD_BUTTON.up]);
        expect(document.activeElement).toBe(spot('current'));
        hold([GAMEPAD_BUTTON.left]);
        expect(document.activeElement).toBe(spot('first'));
        hold([GAMEPAD_BUTTON.down]);
        expect(document.activeElement).toBe(spot('A'));
    });

    it('moves the focus with the left stick', () => {
        pads = [gamepad()];
        render(<Screen sections={sectionsMock()} />);
        placeGrid();
        spot('A').focus();
        hold([], [0.9, 0]);
        expect(document.activeElement).toBe(spot('B'));
    });

    it('gives the focus to the active section when nothing has it', () => {
        pads = [gamepad()];
        render(<Screen sections={sectionsMock()} />);
        placeGrid();
        hold([GAMEPAD_BUTTON.down]);
        expect(document.activeElement).toBe(spot('current'));
    });

    it('presses the focused control with A', () => {
        pads = [gamepad()];
        const onClickA = vi.fn();
        render(<Screen sections={sectionsMock()} onClickA={onClickA} />);
        spot('A').focus();
        hold([GAMEPAD_BUTTON.a]);
        expect(onClickA).toHaveBeenCalledTimes(1);
    });

    it('gives the focus to the active section with A when nothing has it', () => {
        pads = [gamepad()];
        const onClickA = vi.fn();
        render(<Screen sections={sectionsMock()} onClickA={onClickA} />);
        hold([GAMEPAD_BUTTON.a]);
        expect(onClickA).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(spot('current'));
    });

    it('closes an open window with B, as Esc does', () => {
        pads = [gamepad()];
        const onDialogKey = vi.fn();
        const onMouseUp = vi.fn();
        window.addEventListener('mouseup', onMouseUp);
        render(<Screen sections={sectionsMock()} dialog onDialogKey={onDialogKey} />);
        spot('in-dialog').focus();
        hold([GAMEPAD_BUTTON.b]);
        expect(onDialogKey).toHaveBeenCalledTimes(1);
        expect(onDialogKey).toHaveBeenCalledWith('Escape');
        expect(onMouseUp).not.toHaveBeenCalled();
        window.removeEventListener('mouseup', onMouseUp);
    });

    it('goes back with B as the back button of the mouse does', () => {
        pads = [gamepad()];
        const buttons: number[] = [];
        const onMouseUp = (event: MouseEvent): void => {
            buttons.push(event.button);
        };
        window.addEventListener('mouseup', onMouseUp);
        render(<Screen sections={sectionsMock()} />);
        spot('A').focus();
        hold([GAMEPAD_BUTTON.b]);
        expect(buttons).toEqual([3]);
        window.removeEventListener('mouseup', onMouseUp);
    });

    it('closes the player with B through the back button of the mouse, not Esc', () => {
        pads = [gamepad()];
        const buttons: number[] = [];
        const onMouseUp = (event: MouseEvent): void => {
            buttons.push(event.button);
        };
        window.addEventListener('mouseup', onMouseUp);
        render(<Screen sections={sectionsMock()} player />);
        hold([GAMEPAD_BUTTON.b]);
        expect(buttons).toEqual([3]);
        window.removeEventListener('mouseup', onMouseUp);
    });

    it('sends the arrows to the player while it is open', () => {
        pads = [gamepad()];
        const keys: string[] = [];
        const onKeyDown = (event: KeyboardEvent): void => {
            keys.push(event.key);
        };
        window.addEventListener('keydown', onKeyDown);
        render(<Screen sections={sectionsMock()} player />);
        placeGrid();
        spot('A').focus();
        hold([GAMEPAD_BUTTON.right]);
        hold([GAMEPAD_BUTTON.left]);
        hold([GAMEPAD_BUTTON.up]);
        hold([GAMEPAD_BUTTON.down]);
        expect(keys).toEqual(['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']);
        expect(document.activeElement).toBe(spot('A'));
        window.removeEventListener('keydown', onKeyDown);
    });

    it('changes the section with the bumpers, using the latest callbacks', () => {
        pads = [gamepad()];
        const first = sectionsMock();
        const { rerender } = render(<Screen sections={first} />);
        hold([GAMEPAD_BUTTON.rightBumper]);
        expect(first.next).toHaveBeenCalledTimes(1);
        expect(first.previous).not.toHaveBeenCalled();
        const second = sectionsMock();
        rerender(<Screen sections={second} />);
        hold([GAMEPAD_BUTTON.leftBumper]);
        expect(second.previous).toHaveBeenCalledTimes(1);
        expect(first.previous).not.toHaveBeenCalled();
    });

    it('joins what is held on every connected gamepad', () => {
        pads = [gamepad()];
        const sections = sectionsMock();
        render(<Screen sections={sections} />);
        pads = [gamepad([GAMEPAD_BUTTON.leftBumper]), null, gamepad([GAMEPAD_BUTTON.rightBumper])];
        nextFrame();
        expect(sections.previous).toHaveBeenCalledTimes(1);
        expect(sections.next).toHaveBeenCalledTimes(1);
    });
});

describe('runIntent', () => {
    it('calls the section callbacks for the bumpers', () => {
        const sections = sectionsMock();
        runIntent({ kind: 'previous-section' }, sections);
        runIntent({ kind: 'next-section' }, sections);
        expect(sections.previous).toHaveBeenCalledTimes(1);
        expect(sections.next).toHaveBeenCalledTimes(1);
    });

    it('does nothing for a move when there is no app and nothing to focus', () => {
        const sections = sectionsMock();
        runIntent({ kind: 'move', direction: 'down' }, sections);
        expect(document.activeElement).toBe(document.body);
        expect(sections.previous).not.toHaveBeenCalled();
        expect(sections.next).not.toHaveBeenCalled();
    });
});
