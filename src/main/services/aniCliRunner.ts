import type { AniDownloadProgress, AniPartStart, AniRunResult } from '@shared/anime';
import {
    isDownloadFailedLine,
    isJoinLine,
    isSearchMoreLine,
    mapAniError,
    mapAniSpawnError,
    parseDestinationLine,
    parseMenuLine,
    parsePartLine,
    parseProgressLine,
    stripAnsi
} from './aniOutputParser';
import { commandLine } from './errorDetails';
import { processLogs, type LogWriter, type OutputStream } from './logHub';
import { killProcessTree, type GroupKill } from './processTree';
import { createLineSplitter, defaultSpawn, EXIT_GRACE_MS, KILL_ESCALATION_MS, type SpawnFn } from './ytdlpRunner';

export interface MenuChoice {
    prompt: string;
    choice: string;
}

export interface AniRunOutcome {
    exitCode: number | null;
    output: string;
    menuChoices: MenuChoice[];
    destination: string | null;
    moreResults: boolean;
    downloadFailed: boolean;
}

export interface AniRunOptions {
    binary: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    onProgress?: (progress: AniDownloadProgress) => void;
    onPart?: (part: AniPartStart) => void;
    onJoin?: () => void;
    onDestination?: (path: string) => void;
    spawnFn?: SpawnFn;
    platform?: NodeJS.Platform;
    killGroup?: GroupKill;
    log?: LogWriter;
}

export interface AniRunHandle {
    result: Promise<AniRunResult<AniRunOutcome>>;
    cancel: () => void;
}

export function runAniCli(options: AniRunOptions): AniRunHandle {
    const spawnFn = options.spawnFn ?? defaultSpawn;
    const platform = options.platform ?? process.platform;
    const log = options.log ?? processLogs.open('ani-cli');
    log.command(options.binary, options.args);
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
    let exitSignal: NodeJS.Signals | null = null;

    const writeToLog = (stream: OutputStream, line: string): void => {
        if (parseProgressLine(stripAnsi(line))) {
            log.progress(stream, line);
            return;
        }
        log.line(stream, line);
    };

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
        const part = parsePartLine(line);
        if (part) {
            options.onPart?.(part);
            return;
        }
        if (isJoinLine(line)) {
            options.onJoin?.();
            return;
        }
        const clean = stripAnsi(line);
        const progress = parseProgressLine(clean);
        if (progress) {
            options.onProgress?.(progress);
            return;
        }
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

    const stdoutSplitter = createLineSplitter((line) => {
        writeToLog('stdout', line);
        handleLine(line);
    });
    const stderrSplitter = createLineSplitter((line) => {
        writeToLog('stderr', line);
        handleLine(line);
    });
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
            log.failure(`could not start: ${error.message}`);
            settle({ status: 'error', error: mapAniSpawnError(error, { operation: 'Running ani-cli', command: commandLine(options.binary, options.args) }) });
        });
        const finish = (code: number | null): void => {
            stdoutSplitter.flush();
            stderrSplitter.flush();
            if (!settled) {
                log.exit(code, exitSignal);
            }
            if (cancelled) {
                settle({ status: 'cancelled' });
                return;
            }
            settle({ status: 'done', value: { exitCode: code, output, menuChoices, destination, moreResults, downloadFailed } });
        };
        child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
            exitSignal = signal;
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
            escalation = setTimeout(() => {
                killProcessTree(child, platform, undefined, 'SIGKILL', options.killGroup);
            }, KILL_ESCALATION_MS);
        }
    };
}

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
