// Audio made for the tests of the cutting at the pauses: mono 16-bit PCM at 16 kHz, as decodeSpeechAudio gives it.

export const PCM_RATE = 16_000;

// A stretch of the audio: a tone of 1 kHz (well inside the band of the voice) at this amplitude, or silence when it is 0.
export interface PcmStretch {
    seconds: number;
    amplitude: number;
}

export function tone(seconds: number, amplitude = 0.25): PcmStretch {
    return { seconds, amplitude };
}

export function silence(seconds: number): PcmStretch {
    return { seconds, amplitude: 0 };
}

// The PCM of the stretches one after the other.
export function pcmOf(stretches: readonly PcmStretch[]): Uint8Array {
    const total = stretches.reduce((sum, stretch) => {
        return sum + Math.round(stretch.seconds * PCM_RATE);
    }, 0);
    const pcm = new Uint8Array(total * 2);
    const view = new DataView(pcm.buffer);
    let sample = 0;
    for (const stretch of stretches) {
        const count = Math.round(stretch.seconds * PCM_RATE);
        for (let index = 0; index < count; index += 1) {
            const value = Math.round(stretch.amplitude * Math.sin((2 * Math.PI * 1000 * index) / PCM_RATE) * 32767);
            view.setInt16((sample + index) * 2, value, true);
        }
        sample += count;
    }
    return pcm;
}
