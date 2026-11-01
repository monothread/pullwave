import { create } from 'zustand';

// Choices of the interface that are not settings of the app: they are kept in the storage of the window (the main process never sees them).
export const SOUNDS_STORAGE_KEY = 'pullwave-ui-sounds';

export interface UiPrefsState {
    // The short sounds of the navigation (moving the focus, pressing).
    sounds: boolean;
    toggleSounds: () => void;
}

export function readSoundsPref(): boolean {
    try {
        return window.localStorage.getItem(SOUNDS_STORAGE_KEY) !== 'off';
    } catch {
        return true;
    }
}

function writeSoundsPref(on: boolean): void {
    try {
        window.localStorage.setItem(SOUNDS_STORAGE_KEY, on ? 'on' : 'off');
    } catch {
        // Storage can be unavailable: the choice then lasts until the window closes.
    }
}

export const useUiPrefsStore = create<UiPrefsState>((set, get) => {
    return {
        sounds: readSoundsPref(),
        toggleSounds: () => {
            const next = !get().sounds;
            writeSoundsPref(next);
            set({ sounds: next });
        }
    };
});
