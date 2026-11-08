// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react';

const { burstConfettiMock, rumbleMock, playUiSoundMock } = vi.hoisted(() => {
    return { burstConfettiMock: vi.fn(), rumbleMock: vi.fn(), playUiSoundMock: vi.fn() };
});
vi.mock('@renderer/fx/confetti', () => {
    return { burstConfetti: burstConfettiMock };
});
vi.mock('@renderer/fx/gamepadRumble', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@renderer/fx/gamepadRumble')>();
    return { ...actual, rumbleGamepads: rumbleMock };
});
vi.mock('@renderer/sound/uiSound', () => {
    return { playUiSound: playUiSoundMock, setUiSoundVolume: vi.fn() };
});

import { FxLayer } from '@renderer/fx/FxLayer';
import { useFxStore } from '@renderer/fx/fxStore';
import { RUMBLE_DONE } from '@renderer/fx/gamepadRumble';
import { KONAMI_SEQUENCE } from '@renderer/fx/konami';
import { useAppStore } from '@renderer/store/appStore';
import { useUiPrefsStore } from '@renderer/store/uiPrefsStore';

beforeEach(() => {
    burstConfettiMock.mockReset();
    rumbleMock.mockReset();
    playUiSoundMock.mockReset();
    useFxStore.setState({ celebrations: 0, failures: 0, dances: 0, rainbow: false });
    useUiPrefsStore.setState({ sounds: true });
    useAppStore.setState({ toasts: [], notice: null });
});

function typeKonami(target: Window | Element = window): void {
    KONAMI_SEQUENCE.forEach((key) => {
        fireEvent.keyDown(target, { key });
    });
}

describe('FxLayer', () => {
    it('draws nothing of its own, neither at rest nor when something finishes: its effects are sounds, confetti and the rumble', () => {
        const { container } = render(<FxLayer />);
        expect(container.innerHTML).toBe('');
        act(() => {
            useFxStore.getState().celebrate();
        });
        expect(container.innerHTML).toBe('');
    });

    it('does nothing at the start', () => {
        render(<FxLayer />);
        expect(burstConfettiMock).not.toHaveBeenCalled();
        expect(rumbleMock).not.toHaveBeenCalled();
        expect(playUiSoundMock).not.toHaveBeenCalled();
    });

    it('throws confetti, buzzes the gamepad and plays the chord when something finishes', () => {
        render(<FxLayer />);
        act(() => {
            useFxStore.getState().celebrate();
        });
        expect(burstConfettiMock).toHaveBeenCalledTimes(1);
        expect(rumbleMock.mock.calls).toEqual([[RUMBLE_DONE]]);
        expect(playUiSoundMock.mock.calls).toEqual([['done']]);
    });

    it('is quiet but still throws confetti while the sounds are off', () => {
        useUiPrefsStore.setState({ sounds: false });
        render(<FxLayer />);
        act(() => {
            useFxStore.getState().celebrate();
        });
        expect(burstConfettiMock).toHaveBeenCalledTimes(1);
        expect(playUiSoundMock).not.toHaveBeenCalled();
    });

    it('plays the sound of an error, and only while the sounds are on', () => {
        render(<FxLayer />);
        act(() => {
            useFxStore.getState().fail();
        });
        expect(playUiSoundMock.mock.calls).toEqual([['error']]);
        useUiPrefsStore.setState({ sounds: false });
        act(() => {
            useFxStore.getState().fail();
        });
        expect(playUiSoundMock).toHaveBeenCalledTimes(1);
    });

    it('turns the secret mode on with the Konami code, with a notice, a dance and a burst from the middle', () => {
        render(<FxLayer />);
        typeKonami();
        expect(useFxStore.getState().rainbow).toBe(true);
        expect(useFxStore.getState().dances).toBe(1);
        expect(useAppStore.getState().toasts.map((toast) => { return toast.message; })).toEqual(['Rainbow wave unlocked!']);
        expect(burstConfettiMock.mock.calls).toEqual([[{ x: 0.5, y: 0.4 }]]);
    });

    it('turns it off with a second code, without a notice or confetti', () => {
        render(<FxLayer />);
        typeKonami();
        burstConfettiMock.mockClear();
        typeKonami();
        expect(useFxStore.getState().rainbow).toBe(false);
        expect(useAppStore.getState().toasts).toHaveLength(1);
        expect(burstConfettiMock).not.toHaveBeenCalled();
    });

    it('does not take the keys typed in a field for the code', () => {
        const { container } = render(
            <div>
                <input aria-label="field" />
                <FxLayer />
            </div>
        );
        typeKonami(container.querySelector('input') as HTMLInputElement);
        expect(useFxStore.getState().rainbow).toBe(false);
    });

    it('loses the code on a wrong key', () => {
        render(<FxLayer />);
        KONAMI_SEQUENCE.slice(0, 5).forEach((key) => {
            fireEvent.keyDown(window, { key });
        });
        fireEvent.keyDown(window, { key: 'x' });
        KONAMI_SEQUENCE.slice(5).forEach((key) => {
            fireEvent.keyDown(window, { key });
        });
        expect(useFxStore.getState().rainbow).toBe(false);
    });

    it('stops listening when it goes away', () => {
        const { unmount } = render(<FxLayer />);
        unmount();
        typeKonami();
        expect(useFxStore.getState().rainbow).toBe(false);
    });
});
