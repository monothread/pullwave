import { create } from 'zustand';
import { setUiSoundVolume } from '../sound/uiSound';

// Choices of the interface that are not settings of the app: they are kept in the storage of the window (the main process never sees them).
export const SOUNDS_STORAGE_KEY = 'pullwave-ui-sounds';
// How loud the sounds are, from 0 to 1.
export const VOLUME_STORAGE_KEY = 'pullwave-ui-volume';
export const DEFAULT_SOUND_VOLUME = 1;
// Whether the player goes on to the next episode by itself when one ends (see AutoNextPanel).
export const AUTO_NEXT_STORAGE_KEY = 'pullwave-player-auto-next';

export interface UiPrefsState {
    // The short sounds of the navigation (moving the focus, pressing).
    sounds: boolean;
    toggleSounds: () => void;
    // How loud the sounds are, from 0 to 1 (kept in the storage of the window).
    soundVolume: number;
    setSoundVolume: (volume: number) => void;
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

// The volume kept, or the default one when nothing valid was kept.
export function readVolumePref(): number {
    try {
        const stored = Number(window.localStorage.getItem(VOLUME_STORAGE_KEY));
        if (window.localStorage.getItem(VOLUME_STORAGE_KEY) !== null && Number.isFinite(stored)) {
            return Math.min(1, Math.max(0, stored));
        }
    } catch {
        // Storage can be unavailable: the default volume is used.
    }
    return DEFAULT_SOUND_VOLUME;
}

export function readAutoNextPref(): boolean {
    return readSwitch(AUTO_NEXT_STORAGE_KEY);
}

export const useUiPrefsStore = create<UiPrefsState>((set, get) => {
    const initialVolume = readVolumePref();
    setUiSoundVolume(initialVolume);
    return {
        soundVolume: initialVolume,
        setSoundVolume: (volume) => {
            const next = Math.min(1, Math.max(0, volume));
            try {
                window.localStorage.setItem(VOLUME_STORAGE_KEY, String(next));
            } catch {
                // Storage can be unavailable: the choice then lasts until the window closes.
            }
            setUiSoundVolume(next);
            set({ soundVolume: next });
        },
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
