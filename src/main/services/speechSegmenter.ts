// Where the speech of an episode is, from the loudness of its audio in the band of the voice: the audio is cut at the pauses between the
// lines, so each piece can be transcribed on its own by a model that gives no times (gpt-transcribe) and the times of the lines come from the
// cuts. The numbers were measured on a whole episode against its official subtitle (D-138): 97% of the lines got a piece at the right time
// and 99% of the pieces fell on speech.

// The audio is read as mono 16-bit PCM at this rate, after a band-pass to the voice (see decodeSpeechAudio), in windows of this many seconds.
export const SPEECH_SAMPLE_RATE = 16_000;
export const SPEECH_WINDOW_SECONDS = 0.05;
const BYTES_PER_SAMPLE = 2;
const SILENCE_DB = -120;

// A window quieter than this (in dB of its RMS) is a pause; music under the voice stays above the silence that a cut needs, which is why the
// loudness of the band of the voice is looked at and not the peaks (ffmpeg's silencedetect found almost no pause with music).
const PAUSE_DB = -38;
// How long the quiet has to last to be a pause between two lines, and how long a sound has to last to be speech.
const MIN_PAUSE_SECONDS = 0.2;
const MIN_SPEECH_SECONDS = 0.25;
// A piece shorter than this loses the context the model needs ("普通は" alone came back as "ツアー"): it is joined to its neighbour when the
// pause between them is shorter than JOIN_GAP_SECONDS.
const MIN_PIECE_SECONDS = 1.2;
const JOIN_GAP_SECONDS = 0.6;
// A longer piece is a subtitle too long to read: it is cut at its quietest window, at least SPLIT_MARGIN_SECONDS from its ends.
const MAX_PIECE_SECONDS = 6;
const SPLIT_MARGIN_SECONDS = 1.5;
// Subtitles start a little before the voice (the official ones a quarter of a second before, measured).
const LEAD_SECONDS = 0.25;

// Where a line is said, in seconds from the start of the audio.
export interface SpeechSpan {
    start: number;
    end: number;
}

// A piece of the audio as it is sent (from `from` to `to`: the pieces follow each other with no gap, so nothing that is said is left out) and
// the times of its subtitle (`start` to `end`: where its speech is, starting a little before it).
export interface SpeechPiece {
    from: number;
    to: number;
    start: number;
    end: number;
}

// The loudness of each window of the audio, in dB of its RMS (full scale is 0 dB).
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

// The runs of windows that are not pauses, as [first window, window after the last), keeping the ones long enough to be speech.
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

// Joins a run that is too short to its neighbour, when the pause between them is short.
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

// The window where a run that is too long is cut: the quietest one away from its ends.
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

// Cuts a run that is too long in two at its quietest window, and each half again until none is too long.
function splitLongRun(loudness: readonly number[], start: number, end: number): Array<[number, number]> {
    if ((end - start) * SPEECH_WINDOW_SECONDS <= MAX_PIECE_SECONDS) {
        return [[start, end]];
    }
    const cut = quietestWindow(loudness, start, end);
    return [...splitLongRun(loudness, start, cut), ...splitLongRun(loudness, cut, end)];
}

// Where the lines are said in the audio, from its loudness: the sounds between pauses, the short ones joined to their neighbours and the
// long ones cut.
export function findSpeech(loudness: readonly number[]): SpeechSpan[] {
    return joinShortRuns(soundRuns(loudness))
        .flatMap(([start, end]) => {
            return splitLongRun(loudness, start, end);
        })
        .map(([start, end]) => {
            return { start: start * SPEECH_WINDOW_SECONDS, end: end * SPEECH_WINDOW_SECONDS };
        });
}

// The pieces the audio is cut in, one for each line: each one goes from the middle of the pause before its line to the middle of the pause
// after it (the first from the start of the audio, the last to its end). Its subtitle starts a little before the line, never before the end
// of the line before it.
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

// The times where ffmpeg cuts the audio so that it gives the pieces, in order: where each piece but the first starts.
export function cutTimesOf(pieces: readonly SpeechPiece[]): number[] {
    return pieces.slice(1).map((piece) => {
        return piece.from;
    });
}

// How long the audio lasts, from the size of its PCM.
export function pcmSeconds(pcm: Uint8Array): number {
    return pcm.byteLength / BYTES_PER_SAMPLE / SPEECH_SAMPLE_RATE;
}
