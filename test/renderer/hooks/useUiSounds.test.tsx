// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { MOVE_SOUND_GAP_MS, POINTER_FOCUS_MS, useUiSounds } from '@renderer/hooks/useUiSounds';
import { useUiPrefsStore } from '@renderer/store/uiPrefsStore';

const playUiSound = vi.fn();
vi.mock('@renderer/sound/uiSound', () => {
    return {
        playUiSound: (sound: string) => {
            playUiSound(sound);
        },
        setUiSoundVolume: vi.fn()
    };
});

function Screen() {
    useUiSounds();
    return (
        <div className="app">
            <button type="button">PRESS</button>
            <span data-testid="text">TEXT</span>
            <input aria-label="field" />
            <input type="checkbox" className="switch" aria-label="switch" />
        </div>
    );
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 1, 12, 0, 0));
    playUiSound.mockClear();
    useUiPrefsStore.setState({ sounds: true });
});

afterEach(() => {
    vi.useRealTimers();
});

function button(): HTMLElement {
    return document.querySelector('button') as HTMLElement;
}

describe('useUiSounds', () => {
    it('waits a little after a press of the mouse, and between two moves', () => {
        expect(POINTER_FOCUS_MS).toBe(400);
        expect(MOVE_SOUND_GAP_MS).toBe(60);
    });

    it('ticks when the focus moves to a control with the keyboard', () => {
        render(<Screen />);
        fireEvent.focusIn(button());
        expect(playUiSound.mock.calls).toEqual([['move']]);
    });

    it('does not tick for a field, nor twice for two moves close together', () => {
        render(<Screen />);
        fireEvent.focusIn(document.querySelector('input') as HTMLElement);
        expect(playUiSound).not.toHaveBeenCalled();
        fireEvent.focusIn(button());
        vi.setSystemTime(Date.now() + MOVE_SOUND_GAP_MS - 1);
        fireEvent.focusIn(button());
        expect(playUiSound.mock.calls).toEqual([['move']]);
        vi.setSystemTime(Date.now() + 1);
        fireEvent.focusIn(button());
        expect(playUiSound.mock.calls).toEqual([['move'], ['move']]);
    });

    it('does not tick for the focus that follows a press of the mouse, only presses', () => {
        render(<Screen />);
        fireEvent.pointerDown(button());
        fireEvent.focusIn(button());
        fireEvent.click(button());
        expect(playUiSound.mock.calls).toEqual([['select']]);
        vi.setSystemTime(Date.now() + POINTER_FOCUS_MS);
        fireEvent.focusIn(button());
        expect(playUiSound.mock.calls).toEqual([['select'], ['move']]);
    });

    it('presses only for what can be pressed', () => {
        render(<Screen />);
        fireEvent.click(document.querySelector('[data-testid="text"]') as HTMLElement);
        expect(playUiSound).not.toHaveBeenCalled();
    });

    it('goes back with Esc and with the back button of the mouse', () => {
        render(<Screen />);
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.mouseUp(window, { button: 3 });
        fireEvent.mouseUp(window, { button: 0 });
        fireEvent.keyDown(document, { key: 'Enter' });
        expect(playUiSound.mock.calls).toEqual([['back'], ['back']]);
    });

    it('plays the sound of a switch when one is changed, and not for other fields', () => {
        render(<Screen />);
        fireEvent.click(document.querySelector('input.switch') as HTMLElement);
        expect(playUiSound.mock.calls).toEqual([['toggle']]);
        playUiSound.mockClear();
        fireEvent.change(document.querySelector('input[aria-label="field"]') as HTMLElement, { target: { value: 'abc' } });
        expect(playUiSound).not.toHaveBeenCalled();
    });

    it('is quiet for a switch while the sounds are off', () => {
        useUiPrefsStore.setState({ sounds: false });
        render(<Screen />);
        fireEvent.click(document.querySelector('input.switch') as HTMLElement);
        expect(playUiSound).not.toHaveBeenCalled();
    });

    it('is quiet while the sounds are off', () => {
        useUiPrefsStore.setState({ sounds: false });
        render(<Screen />);
        fireEvent.focusIn(button());
        fireEvent.click(button());
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(playUiSound).not.toHaveBeenCalled();
    });

    it('stops listening when the app goes away', () => {
        const { unmount } = render(<Screen />);
        unmount();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(playUiSound).not.toHaveBeenCalled();
    });
});
