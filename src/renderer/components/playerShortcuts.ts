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

const SETTINGS_PANEL_CLASS = 'player__settings';

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
    return key === ' ' && target instanceof HTMLButtonElement && target.closest(`.${SETTINGS_PANEL_CLASS}`) !== null;
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
