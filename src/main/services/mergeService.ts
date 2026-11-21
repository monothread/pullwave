import { mkdir, open, readdir, rm, writeFile } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import {
    MAX_MERGE_ITEMS,
    MIN_MERGE_ITEMS,
    type MergeChooseRejected,
    type MergeChooseResponse,
    type MergeMedia,
    type MergeOutputMode,
    type MergeProbeResponse,
    type MergeRequest,
    type MergeRun,
    type MergeStartResponse,
    type MergeVideoFormat
} from '@shared/merge';
import {
    buildMergeConcatList,
    buildMergeCopyArgs,
    buildMergeReencodeArgs,
    canStreamCopy,
    freePath,
    isMergeOutputMode,
    isMergeVideoFormat,
    mergeMediaOf,
    parseMergeVideoProbe,
    parseProgressSeconds,
    resolveMergeOutputStem
} from './mergeArgs';
import { PROGRESS_INTERVAL_MS, type RunFfmpeg } from './cutService';

export interface MergeServiceDependencies {
    runFfmpeg: () => RunFfmpeg | null;
    chooseFiles: () => Promise<string[] | null>;
    downloadsDir: () => string;
    send: (run: MergeRun) => void;
    tempDir?: () => string;
    platform?: NodeJS.Platform;
    threads?: () => number;
    now?: () => number;
    listDirectory?: (directory: string) => Promise<string[]>;
    makeDirectory?: (directory: string) => Promise<void>;
    reservePath?: (path: string) => Promise<boolean>;
    writeTextFile?: (path: string, content: string) => Promise<void>;
    removeFile?: (path: string) => Promise<void>;
}

function defaultThreads(): number {
    return Math.max(1, cpus().length - 1);
}

function lastLine(output: string): string {
    const lines = output
        .split(/\r|\n/)
        .map((line) => {
            return line.trim();
        })
        .filter((line) => {
            return line.length > 0 && !line.startsWith('size=') && !line.includes('time=');
        });
    return lines.at(-1) ?? '';
}

function isCaseInsensitive(platform: NodeJS.Platform): boolean {
    return platform === 'win32' || platform === 'darwin';
}

function normalizePathKey(path: string, platform: NodeJS.Platform): string {
    return isCaseInsensitive(platform) ? path.toLowerCase() : path;
}

function validPaths(paths: unknown): string[] | null {
    if (!Array.isArray(paths) || paths.length < MIN_MERGE_ITEMS || paths.length > MAX_MERGE_ITEMS) {
        return null;
    }
    const result: string[] = [];
    for (const item of paths) {
        if (typeof item !== 'string' || item.length === 0 || !isAbsolute(item)) {
            return null;
        }
        result.push(item);
    }
    return result;
}

export class MergeService {
    private run: MergeRun | null = null;
    private controller: AbortController | null = null;
    private activeLoop: Promise<void> | null = null;
    private startingPromise: Promise<void> | null = null;
    private starting = false;
    private shuttingDown = false;
    private nextId = 1;

    constructor(private readonly deps: MergeServiceDependencies) {}

    current(): MergeRun | null {
        return this.run;
    }

    hasActiveRun(): boolean {
        return this.run?.status === 'running' || this.activeLoop !== null || this.starting;
    }

    clear(): void {
        if (this.run?.status !== 'running' && !this.starting) {
            this.run = null;
        }
    }

    async probe(path: string, signal?: AbortSignal): Promise<MergeProbeResponse> {
        if (typeof path !== 'string' || path.length === 0 || !isAbsolute(path)) {
            return { ok: false, reason: 'unreadable' };
        }
        const runFfmpeg = this.deps.runFfmpeg();
        if (runFfmpeg === null) {
            return { ok: false, reason: 'no-ffmpeg' };
        }
        const activeSignal = signal ?? new AbortController().signal;
        const outcome = await runFfmpeg({ args: ['-hide_banner', '-nostdin', '-i', path], signal: activeSignal });
        if (activeSignal.aborted) {
            return { ok: false, reason: 'unreadable' };
        }
        if (outcome.code === null) {
            return { ok: false, reason: 'no-ffmpeg' };
        }
        const parsed = parseMergeVideoProbe(outcome.output);
        if (!parsed.ok) {
            return { ok: false, reason: parsed.reason };
        }
        return { ok: true, media: mergeMediaOf(path, parsed.details) };
    }

    async choose(): Promise<MergeChooseResponse> {
        const paths = await this.deps.chooseFiles();
        if (paths === null || paths.length === 0) {
            return { ok: false, reason: 'cancelled' };
        }
        const capped = paths.slice(0, MAX_MERGE_ITEMS);
        const media: MergeMedia[] = [];
        const rejected: MergeChooseRejected[] = [];
        for (const path of capped) {
            const probed = await this.probe(path);
            if (probed.ok) {
                media.push(probed.media);
            } else {
                if (probed.reason === 'no-ffmpeg') {
                    return { ok: false, reason: 'no-ffmpeg' };
                }
                rejected.push({ path, reason: probed.reason });
            }
        }
        if (media.length === 0) {
            return { ok: false, reason: rejected[0]?.reason ?? 'unreadable' };
        }
        return { ok: true, media, rejected };
    }

    async start(request: MergeRequest): Promise<MergeStartResponse> {
        if (this.shuttingDown || this.starting || this.run?.status === 'running') {
            return { ok: false, reason: 'busy' };
        }
        const runFfmpeg = this.deps.runFfmpeg();
        if (runFfmpeg === null) {
            return { ok: false, reason: 'no-ffmpeg' };
        }
        const paths = validPaths(request?.paths);
        if (paths === null || !isMergeVideoFormat(request?.format) || !isMergeOutputMode(request?.outputMode)) {
            return { ok: false, reason: 'invalid' };
        }
        const outputDirectory = this.resolveOutputDirectory(request.outputMode, request.outputDirectory, paths[0]!);
        if (outputDirectory === null) {
            return { ok: false, reason: 'invalid' };
        }
        const controller = new AbortController();
        this.controller = controller;
        this.starting = true;
        let finishStart: (() => void) | null = null;
        this.startingPromise = new Promise<void>((resolve) => {
            finishStart = resolve;
        });
        let launched = false;
        let reservedPath: string | null = null;
        try {
            const probedCache = new Map<string, MergeMedia>();
            const items: MergeMedia[] = [];
            for (const path of paths) {
                if (controller.signal.aborted || this.shuttingDown) {
                    return { ok: false, reason: 'invalid' };
                }
                const cached = probedCache.get(path);
                if (cached !== undefined) {
                    items.push(cached);
                    continue;
                }
                const probed = await this.probe(path, controller.signal);
                if (controller.signal.aborted || this.shuttingDown) {
                    return { ok: false, reason: 'invalid' };
                }
                if (!probed.ok) {
                    return { ok: false, reason: probed.reason };
                }
                probedCache.set(path, probed.media);
                items.push(probed.media);
            }

            try {
                await (this.deps.makeDirectory ?? defaultMakeDirectory)(outputDirectory);
            } catch {
                return { ok: false, reason: 'folder' };
            }
            if (controller.signal.aborted || this.shuttingDown) {
                return { ok: false, reason: 'invalid' };
            }

            const platform = this.deps.platform ?? process.platform;
            const stem = resolveMergeOutputStem(request.outputName, items[0]!.name);
            const outputPath = await this.allocateOutputPath(outputDirectory, stem, request.format, platform);
            if (outputPath === null) {
                return { ok: false, reason: 'folder' };
            }
            reservedPath = outputPath;
            if (controller.signal.aborted || this.shuttingDown) {
                await this.removeQuietly(reservedPath);
                reservedPath = null;
                return { ok: false, reason: 'invalid' };
            }

            const totalDurationSeconds = items.reduce((sum, item) => {
                return sum + item.durationSeconds;
            }, 0);
            const useCopy = canStreamCopy(items, request.format);
            const run: MergeRun = {
                id: this.nextId,
                format: request.format,
                outputMode: request.outputMode,
                outputDirectory,
                outputName: basename(outputPath),
                inputCount: items.length,
                totalDurationSeconds,
                method: useCopy ? 'copy' : 'reencode',
                status: 'running',
                percent: 0,
                outputPath: null,
                error: null
            };
            this.nextId += 1;
            this.run = run;
            this.publish();
            const begun = structuredClone(run);
            launched = true;
            reservedPath = null;
            const loop = this.executeMerge(run, items, outputPath, useCopy, controller, runFfmpeg).finally(() => {
                if (this.activeLoop === loop) {
                    this.activeLoop = null;
                }
            });
            this.activeLoop = loop;
            return { ok: true, run: begun };
        } finally {
            if (reservedPath !== null) {
                await this.removeQuietly(reservedPath);
            }
            if (!launched && this.controller === controller) {
                this.controller = null;
            }
            this.starting = false;
            this.startingPromise = null;
            if (finishStart !== null) {
                (finishStart as () => void)();
            }
        }
    }

    cancel(): void {
        this.controller?.abort();
    }

    async shutdown(): Promise<void> {
        this.shuttingDown = true;
        this.cancel();
        if (this.startingPromise !== null) {
            await this.startingPromise.catch(() => {
                return undefined;
            });
        }
        if (this.activeLoop !== null) {
            await this.activeLoop.catch(() => {
                return undefined;
            });
        }
    }

    private resolveOutputDirectory(mode: MergeOutputMode, customDir: string | undefined, firstPath: string): string | null {
        if (mode === 'source') {
            return dirname(firstPath);
        }
        if (mode === 'downloads') {
            const root = this.deps.downloadsDir();
            return root.length > 0 && isAbsolute(root) ? root : null;
        }
        return typeof customDir === 'string' && customDir.length > 0 && isAbsolute(customDir) ? customDir : null;
    }

    private publish(): void {
        if (this.run !== null) {
            try {
                this.deps.send(structuredClone(this.run));
            } catch {
                return undefined;
            }
        }
    }

    private async allocateOutputPath(
        directory: string,
        stem: string,
        format: MergeVideoFormat,
        platform: NodeJS.Platform
    ): Promise<string | null> {
        const reserve = this.deps.reservePath ?? defaultReservePath;
        const existing = await (this.deps.listDirectory ?? defaultListDirectory)(directory).catch(() => {
            return [];
        });
        const taken = new Set(
            existing.map((entry) => {
                return normalizePathKey(entry, platform);
            })
        );
        const base = join(directory, `${stem}.${format}`);
        for (let attempt = 0; attempt < 500; attempt += 1) {
            const candidate = freePath(base, (check) => {
                return taken.has(normalizePathKey(check, platform));
            });
            taken.add(normalizePathKey(candidate, platform));
            try {
                const reserved = await reserve(candidate);
                if (reserved) {
                    return candidate;
                }
            } catch {
                return null;
            }
        }
        return null;
    }

    private async executeMerge(
        run: MergeRun,
        items: readonly MergeMedia[],
        outputPath: string,
        tryCopyFirst: boolean,
        controller: AbortController,
        runFfmpeg: RunFfmpeg
    ): Promise<void> {
        let listPath: string | null = null;
        try {
            if (tryCopyFirst) {
                const tempRoot = (this.deps.tempDir ?? tmpdir)();
                listPath = join(tempRoot, `pullwave-merge-${run.id}-${Date.now()}.concat.txt`);
                await (this.deps.writeTextFile ?? defaultWriteTextFile)(
                    listPath,
                    buildMergeConcatList(
                        items.map((item) => {
                            return item.path;
                        })
                    )
                );
                const copyOutcome = await this.runWithProgress(
                    run,
                    buildMergeCopyArgs({ listPath, output: outputPath, format: run.format }),
                    controller.signal,
                    runFfmpeg
                );
                await this.removeQuietly(listPath);
                listPath = null;
                if (controller.signal.aborted) {
                    run.status = 'cancelled';
                    run.percent = 0;
                    await this.removeQuietly(outputPath);
                    return;
                }
                if (copyOutcome.code === 0) {
                    run.status = 'done';
                    run.percent = 100;
                    run.outputPath = outputPath;
                    return;
                }
                run.method = 'reencode';
                run.percent = 0;
                this.publish();
            }

            const threads = (this.deps.threads ?? defaultThreads)();
            const reencodeOutcome = await this.runWithProgress(
                run,
                buildMergeReencodeArgs({ items, output: outputPath, format: run.format, threads }),
                controller.signal,
                runFfmpeg
            );
            if (controller.signal.aborted) {
                run.status = 'cancelled';
                run.percent = 0;
                await this.removeQuietly(outputPath);
                return;
            }
            if (reencodeOutcome.code === 0) {
                run.status = 'done';
                run.percent = 100;
                run.outputPath = outputPath;
                return;
            }
            run.status = 'error';
            run.error =
                lastLine(reencodeOutcome.output) ||
                (reencodeOutcome.code === null ? 'ffmpeg could not be started' : `ffmpeg ended with code ${reencodeOutcome.code}`);
            await this.removeQuietly(outputPath);
        } catch {
            if (controller.signal.aborted) {
                run.status = 'cancelled';
                run.percent = 0;
            } else {
                run.status = 'error';
                run.error = run.error ?? 'Merge failed unexpectedly.';
            }
            await this.removeQuietly(outputPath);
        } finally {
            if (listPath !== null) {
                await this.removeQuietly(listPath);
            }
            this.publish();
            if (this.controller === controller) {
                this.controller = null;
            }
        }
    }

    private runWithProgress(run: MergeRun, args: string[], signal: AbortSignal, runFfmpeg: RunFfmpeg) {
        const now = this.deps.now ?? Date.now;
        let lastSent = 0;
        return runFfmpeg({
            args,
            signal,
            onOutput: (chunk) => {
                if (run.totalDurationSeconds <= 0) {
                    return;
                }
                const seconds = parseProgressSeconds(chunk);
                if (seconds === null) {
                    return;
                }
                const percent = Math.min(99, Math.max(0, Math.floor((seconds / run.totalDurationSeconds) * 100)));
                const moment = now();
                if (percent !== run.percent && moment - lastSent >= PROGRESS_INTERVAL_MS) {
                    run.percent = percent;
                    lastSent = moment;
                    this.publish();
                }
            }
        });
    }

    private async removeQuietly(path: string): Promise<void> {
        await (this.deps.removeFile ?? defaultRemoveFile)(path).catch(() => {
            return undefined;
        });
    }
}

async function defaultMakeDirectory(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true });
}

async function defaultListDirectory(directory: string): Promise<string[]> {
    return (await readdir(directory)).map((name) => {
        return join(directory, name);
    });
}

async function defaultReservePath(path: string): Promise<boolean> {
    try {
        const handle = await open(path, 'wx');
        await handle.close();
        return true;
    } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
        if (code === 'EEXIST') {
            return false;
        }
        throw error;
    }
}

async function defaultWriteTextFile(path: string, content: string): Promise<void> {
    await writeFile(path, content, 'utf-8');
}

async function defaultRemoveFile(path: string): Promise<void> {
    await rm(path, { force: true });
}
