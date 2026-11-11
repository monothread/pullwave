import { execFile, type ExecFileException } from 'node:child_process';
import { processLogs, type LogWriter } from './logHub';
import { createLogFeed, isFfmpegStatsLine } from './logFeed';

// What ffmpeg wrote on one of its outputs, line by line, to its log.
function writeOutput(log: LogWriter, stream: 'stdout' | 'stderr', text: string): void {
    const feed = createLogFeed(log, stream, isFfmpegStatsLine);
    feed.push(text);
    feed.flush();
}

// A writer of one run of ffmpeg in the log of ffmpeg.
export function openFfmpegLog(): LogWriter {
    return processLogs.open('ffmpeg');
}

// How the run ended, in the log: a program that could not be started (its code is a text, such as ENOENT) or the code it ended with.
function writeEnd(log: LogWriter, error: ExecFileException | null): void {
    if (error === null) {
        log.exit(0);
        return;
    }
    if (typeof error.code === 'string') {
        log.failure(`could not start: ${error.message}`);
        return;
    }
    log.exit(error.code ?? null, error.signal ?? null);
}

// Runs ffmpeg for a short job whose output is not read (copying a recording into a file, joining parts); true when it ended well. The
// command and what it wrote go to the log of ffmpeg.
export function runFfmpegQuietly(binary: string, args: string[], log: LogWriter = openFfmpegLog()): Promise<boolean> {
    log.command(binary, args);
    return new Promise((resolve) => {
        execFile(binary, args, { windowsHide: true }, (error, stdout, stderr) => {
            writeOutput(log, 'stdout', stdout);
            writeOutput(log, 'stderr', stderr);
            writeEnd(log, error);
            resolve(error === null);
        });
    });
}
