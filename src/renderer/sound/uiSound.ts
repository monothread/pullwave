// The short sounds of the navigation, made by the Web Audio of the window (no files): a soft tick when the focus moves, a brighter one when
// something is pressed, a falling one to go back and a rising chord when a menu opens.

export type UiSound = 'move' | 'select' | 'back' | 'open';

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

function playStep(audio: AudioContext, step: ToneStep): void {
    const begin = audio.currentTime + step.start;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(step.frequency, begin);
    gain.gain.setValueAtTime(0, begin);
    gain.gain.linearRampToValueAtTime(UI_SOUND_VOLUME, begin + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, begin + step.duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(begin);
    oscillator.stop(begin + step.duration + 0.02);
}

// Plays a sound of the navigation; nothing happens where the window has no audio.
export function playUiSound(sound: UiSound): void {
    const audio = audioContext();
    if (audio === null) {
        return;
    }
    UI_SOUND_TONES[sound].forEach((step) => {
        playStep(audio, step);
    });
}
