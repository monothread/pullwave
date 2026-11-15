import { execFile, type ExecFileException } from 'node:child_process';
import { processLogs, type LogWriter } from './logHub';
import { createLogFeed, isFfmpegStatsLine } from './logFeed';

function writeOutput(log: LogWriter, stream: 'stdout' | 'stderr', text: string): void {
    const feed = createLogFeed(log, stream, isFfmpegStatsLine);
    feed.push(text);
    feed.flush();
}

export function openFfmpegLog(): LogWriter {
    return processLogs.open('ffmpeg');
}

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
