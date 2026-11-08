export type PlayerShortcut = 'toggle-play' | 'seek-forward' | 'seek-backward' | 'volume-up' | 'volume-down';

export const SEEK_STEP_SECONDS = 5;
export const VOLUME_STEP = 0.05;

const SHORTCUT_BY_KEY: Readonly<Record<string, PlayerShortcut>> = {
    ' ': 'toggle-play',
    ArrowRight: 'seek-forward',
    ArrowLeft: 'seek-backward',
    ArrowUp: 'volume-up',
    ArrowDown: 'volume-down'
};

// The seek slider is the one field that leaves its arrows to the player: its own step is a tenth of a second.
const SEEK_SLIDER_CLASS = 'player__seek';

// The panels over the video whose buttons are pressed with the space bar: the settings and the panel of the next episode.
const BUTTON_PANELS_SELECTOR = '.player__settings, .player__auto-next';

// Whether the focused element already does something with the key: a field is typed or moved in, a button of the settings is pressed with
// the space. Any other button (the player opens with the focus on its close button, a click leaves it on the bar's) gives the space up,
// or the video could never be paused with it.
function ownsKey(target: EventTarget | null, key: string): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    if (target.classList.contains(SEEK_SLIDER_CLASS)) {
        return false;
    }
    if (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) {
        return true;
    }
    return key === ' ' && target instanceof HTMLButtonElement && target.closest(BUTTON_PANELS_SELECTOR) !== null;
}

// The shortcut a key press stands for, or null when it is not one or the focused element keeps it for itself.
export function shortcutOf(event: KeyboardEvent): PlayerShortcut | null {
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
        return null;
    }
    const shortcut = SHORTCUT_BY_KEY[event.key] ?? null;
    if (shortcut === null || ownsKey(event.target, event.key)) {
        return null;
    }
    return shortcut;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

// What the screen shows for a seek by the keys: which way it went (the little "5s ❯❯" that flies over the video).
export interface SkipFlashDirection {
    direction: 'forward' | 'backward';
}

export function skipFlashOf(shortcut: PlayerShortcut): SkipFlashDirection | null {
    if (shortcut === 'seek-forward') {
        return { direction: 'forward' };
    }
    return shortcut === 'seek-backward' ? { direction: 'backward' } : null;
}
