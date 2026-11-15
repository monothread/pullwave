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

const SEEK_SLIDER_CLASS = 'player__seek';

const BUTTON_PANELS_SELECTOR = '.player__settings, .player__manager, .player__auto-next';

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

export interface SkipFlashDirection {
    direction: 'forward' | 'backward';
}

export function skipFlashOf(shortcut: PlayerShortcut): SkipFlashDirection | null {
    if (shortcut === 'seek-forward') {
        return { direction: 'forward' };
    }
    return shortcut === 'seek-backward' ? { direction: 'backward' } : null;
}
