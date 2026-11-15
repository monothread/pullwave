import type { LogWriter, OutputStream } from './logHub';
import { createLineSplitter } from './ytdlpRunner';

export interface LogFeed {
    push: (chunk: string) => void;
    flush: () => void;
}

const FFMPEG_STATS = /^\s*(?:frame|size)=/;

export function isFfmpegStatsLine(line: string): boolean {
    return FFMPEG_STATS.test(line);
}

function isNeverProgress(): boolean {
    return false;
}

export function createLogFeed(writer: LogWriter, stream: OutputStream, isProgress: (line: string) => boolean = isNeverProgress): LogFeed {
    return createLineSplitter((line) => {
        if (isProgress(line)) {
            writer.progress(stream, line);
            return;
        }
        writer.line(stream, line);
    });
}
