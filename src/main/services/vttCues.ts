// The cues of a WebVTT text, so a language model can translate what is said and the times stay as they were.

export interface VttCue {
    // The identifier line some cues have before the times; null when it has none.
    id: string | null;
    // The line with the times and the settings ("00:00:01.000 --> 00:00:03.000 align:start").
    timing: string;
    // What is said, with its line breaks.
    text: string;
}

export interface ParsedVtt {
    // Everything before the first cue (the WEBVTT line, styles): kept as it was.
    preamble: string;
    cues: VttCue[];
}

const TIMING_ARROW = '-->';

function cueOf(block: string[]): VttCue | null {
    const timingIndex = block.findIndex((line) => {
        return line.includes(TIMING_ARROW);
    });
    if (timingIndex === -1 || timingIndex > 1) {
        return null;
    }
    return {
        id: timingIndex === 1 ? (block[0] as string) : null,
        timing: block[timingIndex] as string,
        text: block.slice(timingIndex + 1).join('\n')
    };
}

// Splits the text in cues. The blocks before the first cue go to the preamble; the notes between cues are dropped.
export function parseVtt(vtt: string): ParsedVtt {
    const blocks = vtt
        .replace(/^\u{FEFF}/u, '')
        .replace(/\r\n?/g, '\n')
        .split(/\n[ \t]*\n/)
        .map((block) => {
            return block.split('\n').filter((line) => {
                return line.trim().length > 0;
            });
        })
        .filter((block) => {
            return block.length > 0;
        });
    const preamble: string[] = [];
    const cues: VttCue[] = [];
    blocks.forEach((block) => {
        const cue = cueOf(block);
        if (cue !== null) {
            cues.push(cue);
        } else if (cues.length === 0) {
            preamble.push(block.join('\n'));
        }
    });
    return { preamble: preamble.join('\n\n'), cues };
}

export function serializeVtt(parsed: ParsedVtt): string {
    const blocks = parsed.cues.map((cue) => {
        return [...(cue.id === null ? [] : [cue.id]), cue.timing, cue.text].join('\n');
    });
    const header = parsed.preamble.length > 0 ? parsed.preamble : 'WEBVTT';
    return `${[header, ...blocks].join('\n\n')}\n`;
}

const TIMESTAMP = /(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})/g;

function pad(value: number, length: number): string {
    return String(value).padStart(length, '0');
}

// A time in seconds as WebVTT writes it ("00:01:02.500").
export function formatVttTime(seconds: number): string {
    const total = Math.round(seconds * 1000);
    const wholeSeconds = Math.floor(total / 1000);
    return `${pad(Math.floor(wholeSeconds / 3600), 2)}:${pad(Math.floor(wholeSeconds / 60) % 60, 2)}:${pad(wholeSeconds % 60, 2)}.${pad(total % 1000, 3)}`;
}

// The timing line with every time moved later by some seconds ("01:02.500" has no hours; the result always has them).
export function shiftTiming(timing: string, seconds: number): string {
    return timing.replace(TIMESTAMP, (_match, hours: string | undefined, minutes: string, secs: string, millis: string) => {
        return formatVttTime((Number(hours ?? 0) * 60 + Number(minutes)) * 60 + Number(secs) + Number(millis) / 1000 + seconds);
    });
}

// The cues moved later by some seconds, without identifiers (the ones of different parts would repeat).
export function shiftCues(cues: readonly VttCue[], seconds: number): VttCue[] {
    return cues.map((cue) => {
        return { id: null, timing: shiftTiming(cue.timing, seconds), text: cue.text };
    });
}
