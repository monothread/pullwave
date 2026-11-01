import { create } from 'zustand';

// Choices of the interface that are not settings of the app: they are kept in the storage of the window (the main process never sees them).
export const SOUNDS_STORAGE_KEY = 'pullwave-ui-sounds';
// Whether the player goes on to the next episode by itself when one ends (see AutoNextPanel).
export const AUTO_NEXT_STORAGE_KEY = 'pullwave-player-auto-next';

export interface UiPrefsState {
    // The short sounds of the navigation (moving the focus, pressing).
    sounds: boolean;
    toggleSounds: () => void;
    // The next episode starts by itself at the end of one (on by default).
    autoNext: boolean;
    toggleAutoNext: () => void;
}

// A choice that is on unless it was turned off.
function readSwitch(key: string): boolean {
    try {
        return window.localStorage.getItem(key) !== 'off';
    } catch {
        return true;
    }
}

function writeSwitch(key: string, on: boolean): void {
    try {
        window.localStorage.setItem(key, on ? 'on' : 'off');
    } catch {
        // Storage can be unavailable: the choice then lasts until the window closes.
    }
}

export function readSoundsPref(): boolean {
    return readSwitch(SOUNDS_STORAGE_KEY);
}

export function readAutoNextPref(): boolean {
    return readSwitch(AUTO_NEXT_STORAGE_KEY);
}

export const useUiPrefsStore = create<UiPrefsState>((set, get) => {
    return {
        sounds: readSoundsPref(),
        toggleSounds: () => {
            const next = !get().sounds;
            writeSwitch(SOUNDS_STORAGE_KEY, next);
            set({ sounds: next });
        },
        autoNext: readAutoNextPref(),
        toggleAutoNext: () => {
            const next = !get().autoNext;
            writeSwitch(AUTO_NEXT_STORAGE_KEY, next);
            set({ autoNext: next });
        }
    };
});
