// The short sounds of the navigation, made by the Web Audio of the window (no files): a soft tick when the focus moves, a brighter one when
// something is pressed, a falling one to go back and a rising chord when a menu opens.

export type UiSound = 'move' | 'select' | 'back' | 'open';

// The sounds of what happens (not of the navigation): a download that ends, an error, a switch, something put in the library.
export type EventSound = 'done' | 'error' | 'toggle' | 'add' | 'page';

export interface ToneStep {
    // Hertz, and when it starts and how long it lasts, in seconds.
    frequency: number;
    start: number;
    duration: number;
}

// How loud the sounds are, from 0 to 1.
export const UI_SOUND_VOLUME = 0.06;

export const UI_SOUND_TONES: Readonly<Record<UiSound, readonly ToneStep[]>> = {
    move: [{ frequency: 880, start: 0, duration: 0.05 }],
    select: [
        { frequency: 1046.5, start: 0, duration: 0.06 },
        { frequency: 1568, start: 0.05, duration: 0.08 }
    ],
    back: [
        { frequency: 659.3, start: 0, duration: 0.06 },
        { frequency: 440, start: 0.05, duration: 0.08 }
    ],
    open: [
        { frequency: 523.3, start: 0, duration: 0.07 },
        { frequency: 659.3, start: 0.05, duration: 0.07 },
        { frequency: 784, start: 0.1, duration: 0.1 }
    ]
};

export const UI_EVENT_TONES: Readonly<Record<EventSound, readonly ToneStep[]>> = {
    done: [
        { frequency: 523.3, start: 0, duration: 0.08 },
        { frequency: 659.3, start: 0.07, duration: 0.08 },
        { frequency: 784, start: 0.14, duration: 0.08 },
        { frequency: 1046.5, start: 0.21, duration: 0.18 }
    ],
    error: [
        { frequency: 330, start: 0, duration: 0.12 },
        { frequency: 247, start: 0.1, duration: 0.2 }
    ],
    toggle: [{ frequency: 740, start: 0, duration: 0.05 }, { frequency: 988, start: 0.04, duration: 0.06 }],
    // A page turned in the reader: a short, soft note.
    page: [{ frequency: 523.3, start: 0, duration: 0.04 }],
    add: [
        { frequency: 784, start: 0, duration: 0.06 },
        { frequency: 988, start: 0.05, duration: 0.06 },
        { frequency: 1318.5, start: 0.1, duration: 0.12 }
    ]
};

// The wave of the notes in each style of theme: soft in the flat ones, a chiptune square (quieter, it is a harsher wave) in the neon ones.
export const FLAT_WAVE: OscillatorType = 'triangle';
export const NEON_WAVE: OscillatorType = 'square';
export const NEON_GAIN_SHARE = 0.55;

// How loud the sounds are as a share of UI_SOUND_VOLUME, from 0 to 1 (the choice of the user).
let masterVolume = 1;

export function setUiSoundVolume(volume: number): void {
    masterVolume = Math.min(1, Math.max(0, volume));
}

type AudioContextConstructor = new () => AudioContext;

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
    if (context !== null) {
        return context;
    }
    const Constructor = (window as Window & { AudioContext?: AudioContextConstructor }).AudioContext;
    if (Constructor === undefined) {
        return null;
    }
    context = new Constructor();
    return context;
}

function isNeon(): boolean {
    return document.documentElement.dataset.themeStyle === 'neon';
}

function playStep(audio: AudioContext, step: ToneStep): void {
    const begin = audio.currentTime + step.start;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const loudness = UI_SOUND_VOLUME * masterVolume * (isNeon() ? NEON_GAIN_SHARE : 1);
    oscillator.type = isNeon() ? NEON_WAVE : FLAT_WAVE;
    oscillator.frequency.setValueAtTime(step.frequency, begin);
    gain.gain.setValueAtTime(0, begin);
    gain.gain.linearRampToValueAtTime(loudness, begin + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, begin + step.duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(begin);
    oscillator.stop(begin + step.duration + 0.02);
}

// Plays a sound of the navigation; nothing happens where the window has no audio.
export function playUiSound(sound: UiSound | EventSound): void {
    if (masterVolume === 0) {
        return;
    }
    const audio = audioContext();
    if (audio === null) {
        return;
    }
    const tones: Readonly<Record<string, readonly ToneStep[]>> = { ...UI_SOUND_TONES, ...UI_EVENT_TONES };
    tones[sound]?.forEach((step) => {
        playStep(audio, step);
    });
}
