import type { AniDownloadProgress, AniRunResult } from '@shared/anime';
import {
    isDownloadFailedLine,
    isSearchMoreLine,
    mapAniError,
    mapAniSpawnError,
    parseDestinationLine,
    parseMenuLine,
    parseProgressLine,
    stripAnsi
} from './aniOutputParser';
import { commandLine } from './errorDetails';
import { killProcessTree, type GroupKill } from './processTree';
import { createLineSplitter, defaultSpawn, EXIT_GRACE_MS, KILL_ESCALATION_MS, type SpawnFn } from './ytdlpRunner';

export interface MenuChoice {
    prompt: string;
    choice: string;
}

export interface AniRunOutcome {
    exitCode: number | null;
    // Everything ani-cli and the tools it started wrote, without terminal control codes.
    output: string;
    menuChoices: MenuChoice[];
    // The file yt-dlp reported as the target of the download.
    destination: string | null;
    // The search read the pages it was asked for and the source has one more (see aniSearchPages.ts); it is not part of `output`.
    moreResults: boolean;
    // The stand-in of ffmpeg said the download of the episode failed (see pullwave-run.sh), whatever the exit code of ani-cli.
    downloadFailed: boolean;
}

export interface AniRunOptions {
    binary: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    onProgress?: (progress: AniDownloadProgress) => void;
    onDestination?: (path: string) => void;
    spawnFn?: SpawnFn;
    platform?: NodeJS.Platform;
    killGroup?: GroupKill;
}

export interface AniRunHandle {
    result: Promise<AniRunResult<AniRunOutcome>>;
    cancel: () => void;
}

// Runs `busybox sh ani-cli ...`. It only reads what the process says; what a non-zero exit code means depends on the
// command (listing choices ends with ani-cli failing on purpose), so that is left to the caller.
export function runAniCli(options: AniRunOptions): AniRunHandle {
    const spawnFn = options.spawnFn ?? defaultSpawn;
    const platform = options.platform ?? process.platform;
    const child = spawnFn(options.binary, options.args, options.env);
    const menuChoices: MenuChoice[] = [];
    let output = '';
    let destination: string | null = null;
    let moreResults = false;
    let downloadFailed = false;
    let cancelled = false;
    let settled = false;
    let escalation: ReturnType<typeof setTimeout> | null = null;
    let exitGrace: ReturnType<typeof setTimeout> | null = null;

    const handleLine = (line: string): void => {
        const menu = parseMenuLine(line);
        if (menu) {
            menuChoices.push({ prompt: menu.prompt, choice: menu.choice });
            return;
        }
        if (isSearchMoreLine(line)) {
            moreResults = true;
            return;
        }
        if (isDownloadFailedLine(line)) {
            downloadFailed = true;
            return;
        }
        const clean = stripAnsi(line);
        // Progress lines are far too many to keep: they would only make the text kept for an error grow.
        const progress = parseProgressLine(clean);
        if (progress) {
            options.onProgress?.(progress);
            return;
        }
        // ani-cli clears the line with a carriage return before each message, which leaves blank lines behind.
        if (clean.trim().length === 0) {
            return;
        }
        output += `${clean}\n`;
        const path = parseDestinationLine(clean);
        if (path !== null) {
            destination = path;
            options.onDestination?.(path);
        }
    };

    const stdoutSplitter = createLineSplitter(handleLine);
    const stderrSplitter = createLineSplitter(handleLine);
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', stdoutSplitter.push);
    child.stderr.on('data', stderrSplitter.push);

    const result = new Promise<AniRunResult<AniRunOutcome>>((resolve) => {
        const settle = (outcome: AniRunResult<AniRunOutcome>): void => {
            if (settled) {
                return;
            }
            settled = true;
            [escalation, exitGrace].forEach((timer) => {
                if (timer !== null) {
                    clearTimeout(timer);
                }
            });
            resolve(outcome);
        };
        child.once('error', (error: NodeJS.ErrnoException) => {
            settle({ status: 'error', error: mapAniSpawnError(error, { operation: 'Running ani-cli', command: commandLine(options.binary, options.args) }) });
        });
        const finish = (code: number | null): void => {
            stdoutSplitter.flush();
            stderrSplitter.flush();
            if (cancelled) {
                settle({ status: 'cancelled' });
                return;
            }
            settle({ status: 'done', value: { exitCode: code, output, menuChoices, destination, moreResults, downloadFailed } });
        };
        child.once('exit', (code: number | null) => {
            // The pipes may stay open if something ani-cli started is still running: end it and give the result anyway.
            exitGrace = setTimeout(() => {
                if (settled) {
                    return;
                }
                killProcessTree(child, platform, undefined, 'SIGKILL', options.killGroup);
                child.stdout.destroy();
                child.stderr.destroy();
                finish(code);
            }, EXIT_GRACE_MS);
        });
        child.once('close', finish);
    });

    return {
        result,
        cancel: (): void => {
            if (settled || cancelled) {
                return;
            }
            cancelled = true;
            killProcessTree(child, platform, undefined, 'SIGTERM', options.killGroup);
            // Whatever is still alive after the grace period (yt-dlp, ffmpeg) is killed.
            escalation = setTimeout(() => {
                killProcessTree(child, platform, undefined, 'SIGKILL', options.killGroup);
            }, KILL_ESCALATION_MS);
        }
    };
}

// For a run that is expected to succeed (a download): a non-zero exit, or a download the stand-in of ffmpeg said failed, becomes the error
// ani-cli or yt-dlp reported (with no words of its own, a failed download of the network: it is tried again).
export function asDownloadResult(outcome: AniRunOutcome): AniRunResult<AniRunOutcome> {
    if (outcome.exitCode === 0 && !outcome.downloadFailed) {
        return { status: 'done', value: outcome };
    }
    const error = mapAniError(outcome.output, outcome.exitCode, { operation: 'Downloading an episode with ani-cli' });
    if (outcome.downloadFailed && error.code === 'UNKNOWN') {
        return { status: 'error', error: { ...error, code: 'NETWORK', raw: outcome.output.trim().length > 0 ? error.raw : 'The download of the episode failed.' } };
    }
    return { status: 'error', error };
}
