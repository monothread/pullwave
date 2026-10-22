import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { DownloadError, DownloadInfo, LiveStreamInfo, PostProcessEvent, ProgressInfo } from '@shared/types';
import { mapDownloadError, mapSpawnError } from './errorMapper';
import { killProcessTree, type GroupKill, type TaskkillSpawn } from './processTree';
import { isWaitLine, parseFileLine, parseInfoLine, parsePostProcessLine, parseProgressLine, parseStreamLine, POSTPROCESS_PREFIX } from './progressParser';

// After yt-dlp exits its pipes may still be held open by a process it started (an ffmpeg left behind), which would keep
// the download "running" forever: the result is given anyway once this time has passed.
export const EXIT_GRACE_MS = 1500;
// A process that was asked to end and is still there after this time is killed.
export const KILL_ESCALATION_MS = 3000;
// A live recording that was asked to stop (Ctrl+C) and has not finished after this time is ended and its file salvaged.
export const STOP_ESCALATION_MS = 10000;

export type SpawnFn = (command: string, args: string[], env?: NodeJS.ProcessEnv) => ChildProcessWithoutNullStreams;

export type RunResult =
    | { status: 'done'; filePath: string | null }
    | { status: 'error'; error: DownloadError }
    | { status: 'cancelled' }
    // Ended on purpose by killing the process (Windows has no way to ask yt-dlp to finish): the caller salvages the file.
    | { status: 'stopped' };

export interface RunHandle {
    result: Promise<RunResult>;
    cancel: () => void;
    // Ends a live recording keeping what it has: Ctrl+C (SIGINT) where that exists; on Windows the process tree is
    // killed and the result is `stopped`, so the partial file can be salvaged.
    stop: () => void;
}

export interface RunOptions {
    binary: string;
    args: string[];
    onProgress: (progress: ProgressInfo) => void;
    onInfo?: (info: DownloadInfo) => void;
    // Where the stream about to be downloaded can be fetched from (printed right after the info).
    onStream?: (stream: LiveStreamInfo) => void;
    // yt-dlp is waiting for a scheduled live stream to start.
    onWaiting?: () => void;
    // A post-processor (the ffmpeg steps after the download: conversion, merge, metadata...) started or finished.
    onPostProcess?: (event: PostProcessEvent) => void;
    env?: NodeJS.ProcessEnv;
    spawnFn?: SpawnFn;
    platform?: NodeJS.Platform;
    taskkill?: TaskkillSpawn;
    killGroup?: GroupKill;
}

export function defaultSpawn(command: string, args: string[], env?: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
    // Outside Windows it leads a process group of its own, so cancelling reaches the ffmpeg it starts too.
    return spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true, detached: process.platform !== 'win32' });
}

export function createLineSplitter(onLine: (line: string) => void): { push: (chunk: string) => void; flush: () => void } {
    let buffer = '';
    return {
        push: (chunk: string): void => {
            buffer += chunk;
            // A bare carriage return is also a line end: yt-dlp rewrites its "remaining time" counter with it.
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

// The post-process progress lines are not errors: they must not end up in the text shown for a failed download.
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
    let cancelled = false;
    let stopped = false;
    let filePath: string | null = null;
    let stderr = '';

    const stdoutSplitter = createLineSplitter((line) => {
        const progress = parseProgressLine(line);
        if (progress) {
            options.onProgress(progress);
            return;
        }
        const info = parseInfoLine(line);
        if (info) {
            options.onInfo?.(info);
            return;
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
        const postProcess = parsePostProcessLine(line);
        if (postProcess) {
            options.onPostProcess?.(postProcess);
            return;
        }
        filePath = parseFileLine(line) ?? filePath;
    });

    // In quiet mode (which `--print` implies) yt-dlp writes the post-process progress lines to stderr, not stdout.
    const stderrSplitter = createLineSplitter((line) => {
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
    // SIGTERM first; whatever is still alive afterwards is killed. Not tied to the timers, so it also runs after the result.
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
            resolve({ status: 'error', error: mapDownloadError(withoutPostProcessLines(stderr), code) });
        };
        child.once('error', (error: NodeJS.ErrnoException) => {
            settled = true;
            timers.forEach(clearTimeout);
            timers.clear();
            resolve({ status: 'error', error: mapSpawnError(error) });
        });
        child.once('exit', (code: number | null) => {
            if (settled) {
                return;
            }
            later(() => {
                // The pipes are still open: something yt-dlp started is still running. End it and give the result.
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
            // yt-dlp did not finish on its own: end the whole tree and let the caller salvage what was recorded.
            later(() => {
                stopped = true;
                terminateTree();
            }, STOP_ESCALATION_MS);
        }
    };
}
