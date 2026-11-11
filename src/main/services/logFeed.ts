import type { LogWriter, OutputStream } from './logHub';
import { createLineSplitter } from './ytdlpRunner';

export interface LogFeed {
    // A piece of what the program wrote; the lines it completes go to the log.
    push: (chunk: string) => void;
    // Writes what is left of a line without its end (the program ended).
    flush: () => void;
}

// The line of statistics ffmpeg rewrites while it works (`frame=  120 fps= 30 ...` or `size=  1024kB time=00:00:05.00 ...`).
const FFMPEG_STATS = /^\s*(?:frame|size)=/;

export function isFfmpegStatsLine(line: string): boolean {
    return FFMPEG_STATS.test(line);
}

function isNeverProgress(): boolean {
    return false;
}

// Turns the output of a program into lines of its log; the lines `isProgress` recognizes are written as progress (held back so they do
// not fill the log).
export function createLogFeed(writer: LogWriter, stream: OutputStream, isProgress: (line: string) => boolean = isNeverProgress): LogFeed {
    return createLineSplitter((line) => {
        if (isProgress(line)) {
            writer.progress(stream, line);
            return;
        }
        writer.line(stream, line);
    });
}
