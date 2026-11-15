import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ErrorDetails } from '@shared/errorDetails';
import type { DownloadError, DownloadInfo, FormatPart, LiveStreamInfo, PostProcessEvent, ProgressInfo } from '@shared/types';
import { commandLine } from './errorDetails';
import { mapDownloadError, mapSpawnError } from './errorMapper';
import { processLogs, type LogWriter } from './logHub';
import { killProcessTree, type GroupKill, type TaskkillSpawn } from './processTree';
import {
    isWaitLine,
    parseFileLine,
    parseFormatPartsLine,
    parseInfoLine,
    parsePostProcessLine,
    parseProgressLine,
    parseStreamLine,
    parseThumbnailLine,
    POSTPROCESS_PREFIX,
    STREAM_PREFIX
} from './progressParser';

export const EXIT_GRACE_MS = 1500;
export const KILL_ESCALATION_MS = 3000;
export const STOP_ESCALATION_MS = 10000;

export type SpawnFn = (command: string, args: string[], env?: NodeJS.ProcessEnv) => ChildProcessWithoutNullStreams;

export type RunResult =
    | { status: 'done'; filePath: string | null }
    | { status: 'error'; error: DownloadError }
    | { status: 'cancelled' }
    | { status: 'stopped' };

export interface RunHandle {
    result: Promise<RunResult>;
    cancel: () => void;
    stop: () => void;
}

export interface RunOptions {
    binary: string;
    args: string[];
    onProgress: (progress: ProgressInfo) => void;
    onInfo?: (info: DownloadInfo) => void;
    onStream?: (stream: LiveStreamInfo) => void;
    onParts?: (parts: FormatPart[]) => void;
    onThumbnail?: (address: string) => void;
    onWaiting?: () => void;
    onPostProcess?: (event: PostProcessEvent) => void;
    env?: NodeJS.ProcessEnv;
    spawnFn?: SpawnFn;
    platform?: NodeJS.Platform;
    taskkill?: TaskkillSpawn;
    killGroup?: GroupKill;
    log?: LogWriter;
}

export function defaultSpawn(command: string, args: string[], env?: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
    return spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true, detached: process.platform !== 'win32' });
}

export function createLineSplitter(onLine: (line: string) => void): { push: (chunk: string) => void; flush: () => void } {
    let buffer = '';
    return {
        push: (chunk: string): void => {
            buffer += chunk;
            const lines = buffer.split(/\r\n|\r|\n/);
            buffer = lines.pop() ?? '';
            lines.forEach(onLine);
        },
        flush: (): void => {
            if (buffer.length > 0) {
                onLine(buffer);
            }
            buffer = '';
        }
    };
}

function withoutPostProcessLines(stderr: string): string {
    return stderr
        .split(/(?<=\n)/)
        .filter((line) => {
            return !line.startsWith(POSTPROCESS_PREFIX);
        })
        .join('');
}

export function runYtdlp(options: RunOptions): RunHandle {
    const spawnFn = options.spawnFn ?? defaultSpawn;
    const child = spawnFn(options.binary, options.args, options.env);
    const platform = options.platform ?? process.platform;
    const known: Partial<ErrorDetails> = { operation: 'Running yt-dlp', command: commandLine(options.binary, options.args) };
    const log = options.log ?? processLogs.open('yt-dlp');
    log.command(options.binary, options.args);
    let cancelled = false;
    let exitSignal: NodeJS.Signals | null = null;
    let stopped = false;
    let filePath: string | null = null;
    let stderr = '';

    const stdoutSplitter = createLineSplitter((line) => {
        const progress = parseProgressLine(line);
        if (progress) {
            log.progress('stdout', line);
            options.onProgress(progress);
            return;
        }
        log.line('stdout', line);
        const info = parseInfoLine(line);
        if (info) {
            options.onInfo?.(info);
            return;
        }
        if (line.startsWith(STREAM_PREFIX)) {
            options.onParts?.(parseFormatPartsLine(line) ?? []);
        }
        const stream = parseStreamLine(line);
        if (stream) {
            options.onStream?.(stream);
            return;
        }
        if (isWaitLine(line)) {
            options.onWaiting?.();
            return;
        }
        const thumbnail = parseThumbnailLine(line);
        if (thumbnail !== null) {
            options.onThumbnail?.(thumbnail);
            return;
        }
        const postProcess = parsePostProcessLine(line);
        if (postProcess) {
            options.onPostProcess?.(postProcess);
            return;
        }
        filePath = parseFileLine(line) ?? filePath;
    });

    const stderrSplitter = createLineSplitter((line) => {
        log.line('stderr', line);
        const postProcess = parsePostProcessLine(line);
        if (postProcess) {
            options.onPostProcess?.(postProcess);
        }
    });

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', stdoutSplitter.push);
    child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
        stderrSplitter.push(chunk);
    });

    let settled = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (action: () => void, milliseconds: number): void => {
        timers.add(setTimeout(action, milliseconds));
    };
    const killTree = (signal: NodeJS.Signals): void => {
        killProcessTree(child, platform, options.taskkill, signal, options.killGroup);
    };
    const terminateTree = (): void => {
        killTree('SIGTERM');
        setTimeout(() => {
            killTree('SIGKILL');
        }, KILL_ESCALATION_MS).unref();
    };

    const result = new Promise<RunResult>((resolve) => {
        const settle = (code: number | null): void => {
            if (settled) {
                return;
            }
            settled = true;
            timers.forEach(clearTimeout);
            timers.clear();
            stdoutSplitter.flush();
            stderrSplitter.flush();
            log.exit(code, exitSignal);
            if (cancelled) {
                resolve({ status: 'cancelled' });
                return;
            }
            if (stopped) {
                resolve({ status: 'stopped' });
                return;
            }
            if (code === 0) {
                resolve({ status: 'done', filePath });
                return;
            }
            resolve({ status: 'error', error: mapDownloadError(withoutPostProcessLines(stderr), code, known) });
        };
        child.once('error', (error: NodeJS.ErrnoException) => {
            settled = true;
            timers.forEach(clearTimeout);
            timers.clear();
            log.failure(`could not start: ${error.message}`);
            resolve({ status: 'error', error: mapSpawnError(error, known) });
        });
        child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
            exitSignal = signal;
            if (settled) {
                return;
            }
            later(() => {
                terminateTree();
                child.stdout.destroy();
                child.stderr.destroy();
                settle(code);
            }, EXIT_GRACE_MS);
        });
        child.once('close', settle);
    });

    return {
        result,
        cancel: (): void => {
            if (settled) {
                return;
            }
            cancelled = true;
            killTree('SIGTERM');
            later(() => {
                killTree('SIGKILL');
            }, KILL_ESCALATION_MS);
        },
        stop: (): void => {
            if (settled) {
                return;
            }
            if (platform === 'win32') {
                stopped = true;
                killTree('SIGTERM');
                return;
            }
            child.kill('SIGINT');
            later(() => {
                stopped = true;
                terminateTree();
            }, STOP_ESCALATION_MS);
        }
    };
}
