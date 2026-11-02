import { cutTimesOf, findSpeech, loudnessOf, pcmSeconds, piecesOf, SPEECH_SAMPLE_RATE, SPEECH_WINDOW_SECONDS, type SpeechPiece, type SpeechSpan } from '@main/services/speechSegmenter';
import { pcmOf, silence, tone } from '../../helpers/speechPcm';

const WINDOW_BYTES = SPEECH_SAMPLE_RATE * SPEECH_WINDOW_SECONDS * 2;

function rounded(spans: readonly SpeechSpan[]): SpeechSpan[] {
    return spans.map((span) => {
        return { start: Number(span.start.toFixed(3)), end: Number(span.end.toFixed(3)) };
    });
}

function roundedPieces(pieces: readonly SpeechPiece[]): SpeechPiece[] {
    return pieces.map((piece) => {
        return { from: Number(piece.from.toFixed(3)), to: Number(piece.to.toFixed(3)), start: Number(piece.start.toFixed(3)), end: Number(piece.end.toFixed(3)) };
    });
}

// PCM where every sample has the same value.
function constantPcm(windows: number, value: number): Uint8Array {
    const pcm = new Uint8Array(windows * WINDOW_BYTES);
    const view = new DataView(pcm.buffer);
    for (let offset = 0; offset < pcm.byteLength; offset += 2) {
        view.setInt16(offset, value, true);
    }
    return pcm;
}

describe('speechSegmenter', () => {
    it('reads the audio as mono PCM at 16 kHz in windows of 50 ms', () => {
        expect([SPEECH_SAMPLE_RATE, SPEECH_WINDOW_SECONDS]).toEqual([16_000, 0.05]);
    });

    describe('loudnessOf', () => {
        it('gives -120 dB for each window of silence', () => {
            expect(loudnessOf(constantPcm(3, 0))).toEqual([-120, -120, -120]);
        });

        it('gives the RMS of each window in dB of the full scale', () => {
            const loudness = loudnessOf(constantPcm(2, 16384));
            expect(loudness.map((level) => {
                return Number(level.toFixed(2));
            })).toEqual([-6.02, -6.02]);
        });

        it('gives the quietest sound a window can have just above -120 dB', () => {
            const pcm = constantPcm(1, 0);
            pcm[0] = 1;
            // One sample of 1 among the 800 of the window.
            expect(loudnessOf(pcm)).toEqual([10 * Math.log10((1 / 32768) ** 2 / 800)]);
        });

        it('leaves out a last window that is not whole', () => {
            expect(loudnessOf(constantPcm(2, 100).subarray(0, WINDOW_BYTES * 2 - 2))).toHaveLength(1);
        });

        it('reads a part of a larger buffer from where it starts', () => {
            const whole = new Uint8Array(WINDOW_BYTES * 2);
            whole.set(constantPcm(1, 16384), WINDOW_BYTES);
            expect(loudnessOf(whole.subarray(WINDOW_BYTES)).map((level) => {
                return Number(level.toFixed(2));
            })).toEqual([-6.02]);
        });

        it('gives nothing for no audio', () => {
            expect(loudnessOf(new Uint8Array(0))).toEqual([]);
        });
    });

    describe('findSpeech', () => {
        function speechOf(...stretches: Parameters<typeof pcmOf>[0]): SpeechSpan[] {
            return rounded(findSpeech(loudnessOf(pcmOf(stretches))));
        }

        it('finds each line between the pauses', () => {
            expect(speechOf(silence(1), tone(2), silence(1), tone(2), silence(1))).toEqual([
                { start: 1, end: 3 },
                { start: 4, end: 6 }
            ]);
        });

        it('finds a line at the very start and one that goes to the end', () => {
            expect(speechOf(tone(2), silence(1), tone(2))).toEqual([
                { start: 0, end: 2 },
                { start: 3, end: 5 }
            ]);
        });

        it('finds nothing in silence or in no audio', () => {
            expect(speechOf(silence(3))).toEqual([]);
            expect(findSpeech([])).toEqual([]);
        });

        it('takes music quieter than -38 dB under the voice for a pause', () => {
            expect(speechOf(tone(1, 0.005), tone(2), tone(1, 0.005), tone(2), tone(1, 0.005))).toEqual([
                { start: 1, end: 3 },
                { start: 4, end: 6 }
            ]);
        });

        it('leaves out a sound too short to be speech (under 0.25 s)', () => {
            expect(speechOf(silence(1), tone(0.2), silence(1), tone(2), silence(1))).toEqual([{ start: 2.2, end: 4.2 }]);
        });

        it('keeps a sound of 0.25 s, joined to its neighbour', () => {
            expect(speechOf(silence(1), tone(0.25), silence(0.3), tone(2), silence(1))).toEqual([{ start: 1, end: 3.55 }]);
        });

        it('does not cut where the quiet is shorter than a pause (0.2 s)', () => {
            expect(speechOf(silence(1), tone(1.5), silence(0.15), tone(1.5), silence(1))).toEqual([{ start: 1, end: 4.15 }]);
        });

        it('joins a piece shorter than 1.2 s to the one after it, when the pause between them is shorter than 0.6 s', () => {
            expect(speechOf(silence(1), tone(0.5), silence(0.3), tone(2), silence(1))).toEqual([{ start: 1, end: 3.8 }]);
        });

        it('joins a piece shorter than 1.2 s to the one before it', () => {
            expect(speechOf(silence(1), tone(2), silence(0.3), tone(0.5), silence(1))).toEqual([{ start: 1, end: 3.8 }]);
        });

        it('does not join a short piece when the pause around it is 0.6 s or more', () => {
            expect(speechOf(silence(1), tone(0.5), silence(0.6), tone(2), silence(1))).toEqual([
                { start: 1, end: 1.5 },
                { start: 2.1, end: 4.1 }
            ]);
        });

        it('does not join two pieces of 1.2 s or more, however short the pause between them', () => {
            expect(speechOf(silence(1), tone(1.2), silence(0.2), tone(1.2), silence(1))).toEqual([
                { start: 1, end: 2.2 },
                { start: 2.4, end: 3.6 }
            ]);
        });

        it('cuts a piece longer than 6 s at its quietest window', () => {
            expect(speechOf(silence(0.5), tone(3), tone(0.1, 0.01), tone(4), silence(0.5))).toEqual([
                { start: 0.5, end: 3.5 },
                { start: 3.5, end: 7.6 }
            ]);
        });

        it('keeps a piece of exactly 6 s whole', () => {
            expect(speechOf(silence(1), tone(6), silence(1))).toEqual([{ start: 1, end: 7 }]);
        });

        it('cuts a piece of steady sound in the middle, and each half again until none is longer than 6 s', () => {
            expect(speechOf(tone(14))).toEqual([
                { start: 0, end: 3.5 },
                { start: 3.5, end: 7 },
                { start: 7, end: 10.5 },
                { start: 10.5, end: 14 }
            ]);
        });

        it('never cuts a long piece closer than 1.5 s to its ends', () => {
            expect(speechOf(tone(0.5, 0.02), tone(6.5), silence(1))).toEqual([
                { start: 0, end: 3.5 },
                { start: 3.5, end: 7 }
            ]);
        });
    });

    describe('piecesOf', () => {
        it('cuts in the middle of each pause, from the start to the end of the audio, with no gap', () => {
            expect(roundedPieces(piecesOf([{ start: 1, end: 3 }, { start: 4, end: 6 }], 7))).toEqual([
                { from: 0, to: 3.5, start: 0.75, end: 3 },
                { from: 3.5, to: 7, start: 3.75, end: 6 }
            ]);
        });

        it('starts each subtitle a quarter of a second before its line', () => {
            expect(roundedPieces(piecesOf([{ start: 2, end: 3 }], 4))).toEqual([{ from: 0, to: 4, start: 1.75, end: 3 }]);
        });

        it('never starts a subtitle before the start of the audio', () => {
            expect(roundedPieces(piecesOf([{ start: 0.1, end: 3 }], 4))).toEqual([{ from: 0, to: 4, start: 0, end: 3 }]);
        });

        it('never starts a subtitle before the end of the line before it', () => {
            expect(roundedPieces(piecesOf([{ start: 1, end: 3 }, { start: 3.2, end: 5 }], 6))).toEqual([
                { from: 0, to: 3.1, start: 0.75, end: 3 },
                { from: 3.1, to: 6, start: 3, end: 5 }
            ]);
        });

        it('takes the last piece to the end of its line when the line ends after the length that was measured', () => {
            expect(roundedPieces(piecesOf([{ start: 1, end: 5 }], 4.98))).toEqual([{ from: 0, to: 5, start: 0.75, end: 5 }]);
        });

        it('gives no piece when there is no line', () => {
            expect(piecesOf([], 10)).toEqual([]);
        });
    });

    describe('cutTimesOf', () => {
        it('cuts where each piece but the first starts', () => {
            const pieces = piecesOf([{ start: 1, end: 3 }, { start: 4, end: 6 }, { start: 8, end: 9 }], 10);
            expect(cutTimesOf(pieces)).toEqual([3.5, 7]);
        });

        it('does not cut a single piece, nor no piece', () => {
            expect(cutTimesOf(piecesOf([{ start: 1, end: 3 }], 4))).toEqual([]);
            expect(cutTimesOf([])).toEqual([]);
        });
    });

    describe('pcmSeconds', () => {
        it('gives how long the audio lasts from the size of its PCM', () => {
            expect(pcmSeconds(pcmOf([silence(2.5)]))).toBe(2.5);
            expect(pcmSeconds(new Uint8Array(0))).toBe(0);
        });
    });
});
