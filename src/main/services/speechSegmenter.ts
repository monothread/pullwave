export const SPEECH_SAMPLE_RATE = 16_000;
export const SPEECH_WINDOW_SECONDS = 0.05;
const BYTES_PER_SAMPLE = 2;
const SILENCE_DB = -120;

const PAUSE_DB = -38;
const MIN_PAUSE_SECONDS = 0.2;
const MIN_SPEECH_SECONDS = 0.25;
const MIN_PIECE_SECONDS = 1.2;
const JOIN_GAP_SECONDS = 0.6;
const MAX_PIECE_SECONDS = 6;
const SPLIT_MARGIN_SECONDS = 1.5;
const LEAD_SECONDS = 0.25;

export interface SpeechSpan {
    start: number;
    end: number;
}

export interface SpeechPiece {
    from: number;
    to: number;
    start: number;
    end: number;
}

export function loudnessOf(pcm: Uint8Array): number[] {
    const samples = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const windowSamples = Math.round(SPEECH_SAMPLE_RATE * SPEECH_WINDOW_SECONDS);
    const windowBytes = windowSamples * BYTES_PER_SAMPLE;
    const loudness: number[] = [];
    for (let offset = 0; offset + windowBytes <= pcm.byteLength; offset += windowBytes) {
        let sum = 0;
        for (let index = 0; index < windowSamples; index += 1) {
            const sample = samples.getInt16(offset + index * BYTES_PER_SAMPLE, true) / 32768;
            sum += sample * sample;
        }
        loudness.push(sum === 0 ? SILENCE_DB : 10 * Math.log10(sum / windowSamples));
    }
    return loudness;
}

function soundRuns(loudness: readonly number[]): Array<[number, number]> {
    const minPause = Math.round(MIN_PAUSE_SECONDS / SPEECH_WINDOW_SECONDS);
    const minSpeech = Math.round(MIN_SPEECH_SECONDS / SPEECH_WINDOW_SECONDS);
    const runs: Array<[number, number]> = [];
    let start: number | null = null;
    let quiet = 0;
    const close = (end: number): void => {
        if (start !== null && end - start >= minSpeech) {
            runs.push([start, end]);
        }
        start = null;
    };
    loudness.forEach((level, index) => {
        if (level >= PAUSE_DB) {
            start ??= index;
            quiet = 0;
            return;
        }
        quiet += 1;
        if (quiet === minPause) {
            close(index - minPause + 1);
        }
    });
    if (quiet < minPause) {
        close(loudness.length - quiet);
    }
    return runs;
}

function joinShortRuns(runs: ReadonlyArray<[number, number]>): Array<[number, number]> {
    const minPiece = Math.round(MIN_PIECE_SECONDS / SPEECH_WINDOW_SECONDS);
    const joinGap = Math.round(JOIN_GAP_SECONDS / SPEECH_WINDOW_SECONDS);
    const joined: Array<[number, number]> = [];
    for (const [start, end] of runs) {
        const last = joined[joined.length - 1];
        const isShort = last !== undefined && (last[1] - last[0] < minPiece || end - start < minPiece);
        if (last !== undefined && start - last[1] < joinGap && isShort) {
            last[1] = end;
        } else {
            joined.push([start, end]);
        }
    }
    return joined;
}

function quietestWindow(loudness: readonly number[], start: number, end: number): number {
    const margin = Math.round(SPLIT_MARGIN_SECONDS / SPEECH_WINDOW_SECONDS);
    let quietest = start + Math.floor((end - start) / 2);
    for (let index = start + margin; index < end - margin; index += 1) {
        if ((loudness[index] as number) < (loudness[quietest] as number)) {
            quietest = index;
        }
    }
    return quietest;
}

function splitLongRun(loudness: readonly number[], start: number, end: number): Array<[number, number]> {
    if ((end - start) * SPEECH_WINDOW_SECONDS <= MAX_PIECE_SECONDS) {
        return [[start, end]];
    }
    const cut = quietestWindow(loudness, start, end);
    return [...splitLongRun(loudness, start, cut), ...splitLongRun(loudness, cut, end)];
}

export function findSpeech(loudness: readonly number[]): SpeechSpan[] {
    return joinShortRuns(soundRuns(loudness))
        .flatMap(([start, end]) => {
            return splitLongRun(loudness, start, end);
        })
        .map(([start, end]) => {
            return { start: start * SPEECH_WINDOW_SECONDS, end: end * SPEECH_WINDOW_SECONDS };
        });
}

export function piecesOf(speech: readonly SpeechSpan[], duration: number): SpeechPiece[] {
    return speech.map((span, index) => {
        const previous = speech[index - 1];
        const next = speech[index + 1];
        return {
            from: previous === undefined ? 0 : (previous.end + span.start) / 2,
            to: next === undefined ? Math.max(duration, span.end) : (span.end + next.start) / 2,
            start: Math.max(previous?.end ?? 0, span.start - LEAD_SECONDS),
            end: span.end
        };
    });
}

export function cutTimesOf(pieces: readonly SpeechPiece[]): number[] {
    return pieces.slice(1).map((piece) => {
        return piece.from;
    });
}

export function pcmSeconds(pcm: Uint8Array): number {
    return pcm.byteLength / BYTES_PER_SAMPLE / SPEECH_SAMPLE_RATE;
}
