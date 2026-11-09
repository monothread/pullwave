// @vitest-environment jsdom
import { clamp, SEEK_STEP_SECONDS, shortcutOf, skipFlashOf, VOLUME_STEP } from '@renderer/components/playerShortcuts';

function press(key: string, init: KeyboardEventInit = {}, target?: HTMLElement): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, ...init });
    if (target !== undefined) {
        Object.defineProperty(event, 'target', { value: target });
    }
    return event;
}

describe('the steps', () => {
    it('are five seconds to seek and five hundredths to change the volume', () => {
        expect(SEEK_STEP_SECONDS).toBe(5);
        expect(VOLUME_STEP).toBe(0.05);
    });
});

describe('clamp', () => {
    it('keeps a value between the limits', () => {
        expect(clamp(5, 0, 10)).toBe(5);
        expect(clamp(-1, 0, 10)).toBe(0);
        expect(clamp(11, 0, 10)).toBe(10);
    });
});

describe('shortcutOf', () => {
    it.each([
        [' ', 'toggle-play'],
        ['ArrowRight', 'seek-forward'],
        ['ArrowLeft', 'seek-backward'],
        ['ArrowUp', 'volume-up'],
        ['ArrowDown', 'volume-down']
    ])('knows the key %j', (key, shortcut) => {
        expect(shortcutOf(press(key))).toBe(shortcut);
    });

    it('is null for another key', () => {
        expect(shortcutOf(press('a'))).toBeNull();
    });

    it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }])('is null with a modifier (%j)', (init) => {
        expect(shortcutOf(press('ArrowRight', init))).toBeNull();
    });

    it('leaves the keys to a field, but not to the slider of the timeline', () => {
        expect(shortcutOf(press('ArrowRight', {}, document.createElement('input')))).toBeNull();
        const seek = document.createElement('input');
        seek.className = 'player__seek';
        expect(shortcutOf(press('ArrowRight', {}, seek))).toBe('seek-forward');
    });

    it('leaves the space to a button of the panel of the next episode (PLAY NOW, CANCEL), which it presses, and not the other keys', () => {
        const panel = document.createElement('div');
        panel.className = 'player__auto-next';
        const button = document.createElement('button');
        panel.appendChild(button);
        expect(shortcutOf(press(' ', {}, button))).toBeNull();
        expect(shortcutOf(press('ArrowRight', {}, button))).toBe('seek-forward');
        expect(shortcutOf(press('ArrowUp', {}, button))).toBe('volume-up');
        expect(shortcutOf(press(' ', {}, document.createElement('button')))).toBe('toggle-play');
    });

    it('leaves the space to a button of the window of the subtitles, which it presses, and not the other keys', () => {
        const window = document.createElement('div');
        window.className = 'modal player__manager';
        const button = document.createElement('button');
        window.appendChild(button);
        expect(shortcutOf(press(' ', {}, button))).toBeNull();
        expect(shortcutOf(press('ArrowRight', {}, button))).toBe('seek-forward');
        expect(shortcutOf(press('ArrowDown', {}, button))).toBe('volume-down');
        expect(shortcutOf(press(' ', {}, document.createElement('button')))).toBe('toggle-play');
    });

    it('leaves the space to a button of the settings, but not to another button', () => {
        const settings = document.createElement('div');
        settings.className = 'player__settings';
        const inside = document.createElement('button');
        settings.appendChild(inside);
        expect(shortcutOf(press(' ', {}, inside))).toBeNull();
        expect(shortcutOf(press(' ', {}, document.createElement('button')))).toBe('toggle-play');
        expect(shortcutOf(press('ArrowRight', {}, inside))).toBe('seek-forward');
    });
});

describe('skipFlashOf', () => {
    it('says which way a seek went', () => {
        expect(skipFlashOf('seek-forward')).toEqual({ direction: 'forward' });
        expect(skipFlashOf('seek-backward')).toEqual({ direction: 'backward' });
    });

    it.each(['toggle-play', 'volume-up', 'volume-down'] as const)('has no flash for %s', (shortcut) => {
        expect(skipFlashOf(shortcut)).toBeNull();
    });
});
