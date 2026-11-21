import { mkdir, open, readdir, rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import {
    MAX_CONVERT_ITEMS,
    type ConvertAudioFormat,
    type ConvertChooseRejected,
    type ConvertChooseResponse,
    type ConvertItemState,
    type ConvertMedia,
    type ConvertOutputMode,
    type ConvertProbeResponse,
    type ConvertRequest,
    type ConvertRun,
    type ConvertStartResponse
} from '@shared/convert';
import {
    buildConvertArgs,
    convertMediaOf,
    freePath,
    isConvertAudioFormat,
    isConvertOutputMode,
    parseProgressSeconds,
    parseVideoAudioProbe,
    safeName,
    type ConvertCommand
} from './convertArgs';
import { PROGRESS_INTERVAL_MS, type RunFfmpeg } from './cutService';

export interface ConvertServiceDependencies {
    runFfmpeg: () => RunFfmpeg | null;
    chooseFiles: () => Promise<string[] | null>;
    downloadsDir: () => string;
    send: (run: ConvertRun) => void;
    platform?: NodeJS.Platform;
    threads?: () => number;
    now?: () => number;
    listDirectory?: (directory: string) => Promise<string[]>;
    makeDirectory?: (directory: string) => Promise<void>;
    reservePath?: (path: string) => Promise<boolean>;
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

function uniquePaths(paths: unknown, platform: NodeJS.Platform): string[] | null {
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_CONVERT_ITEMS) {
        return null;
    }
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of paths) {
        if (typeof item !== 'string' || item.length === 0 || !isAbsolute(item)) {
            return null;
        }
        const key = normalizePathKey(item, platform);
        if (!seen.has(key)) {
            seen.add(key);
            result.push(item);
        }
    }
    return result.length > 0 ? result : null;
}

export class ConvertService {
    private run: ConvertRun | null = null;
    private controller: AbortController | null = null;
    private activeLoop: Promise<void> | null = null;
    private starting = false;
    private nextId = 1;

    constructor(private readonly deps: ConvertServiceDependencies) {}

    current(): ConvertRun | null {
        return this.run;
    }

    hasActiveRun(): boolean {
        return this.run?.status === 'running' || this.activeLoop !== null;
    }

    clear(): void {
        if (this.run?.status !== 'running' && !this.starting) {
            this.run = null;
        }
    }

    async probe(path: string, signal?: AbortSignal): Promise<ConvertProbeResponse> {
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
        const parsed = parseVideoAudioProbe(outcome.output);
        if (!parsed.ok) {
            return { ok: false, reason: parsed.reason };
        }
        return { ok: true, media: convertMediaOf(path, parsed.durationSeconds) };
    }

    async choose(): Promise<ConvertChooseResponse> {
        const paths = await this.deps.chooseFiles();
        if (paths === null || paths.length === 0) {
            return { ok: false, reason: 'cancelled' };
        }
        const capped = paths.slice(0, MAX_CONVERT_ITEMS);
        const media: ConvertMedia[] = [];
        const rejected: ConvertChooseRejected[] = [];
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

    async start(request: ConvertRequest): Promise<ConvertStartResponse> {
        if (this.starting || this.run?.status === 'running') {
            return { ok: false, reason: 'busy' };
        }
        const runFfmpeg = this.deps.runFfmpeg();
        if (runFfmpeg === null) {
            return { ok: false, reason: 'no-ffmpeg' };
        }
        const platform = this.deps.platform ?? process.platform;
        const paths = uniquePaths(request?.paths, platform);
        if (paths === null || !isConvertAudioFormat(request?.format) || !isConvertOutputMode(request?.outputMode)) {
            return { ok: false, reason: 'invalid' };
        }
        const outputDirectory = this.resolveOutputDirectory(request.outputMode, request.outputDirectory);
        if (request.outputMode !== 'source' && outputDirectory === null) {
            return { ok: false, reason: 'invalid' };
        }
        this.starting = true;
        try {
            if (outputDirectory !== null) {
                try {
                    await (this.deps.makeDirectory ?? defaultMakeDirectory)(outputDirectory);
                } catch {
                    return { ok: false, reason: 'folder' };
                }
            }
            const controller = new AbortController();
            this.controller = controller;
            const run: ConvertRun = {
                id: this.nextId,
                format: request.format,
                outputMode: request.outputMode,
                outputDirectory,
                status: 'running',
                items: paths.map((path): ConvertItemState => {
                    return { path, name: basename(path), status: 'waiting', percent: 0, outputPath: null, error: null };
                })
            };
            this.nextId += 1;
            this.run = run;
            this.publish();
            const begun = structuredClone(run);
            const loop = this.convertAll(request.format, outputDirectory, controller, runFfmpeg, platform).finally(() => {
                if (this.activeLoop === loop) {
                    this.activeLoop = null;
                }
            });
            this.activeLoop = loop;
            return { ok: true, run: begun };
        } finally {
            this.starting = false;
        }
    }

    cancel(): void {
        this.controller?.abort();
    }

    async shutdown(): Promise<void> {
        this.cancel();
        if (this.activeLoop !== null) {
            await this.activeLoop.catch(() => {
                return undefined;
            });
        }
    }

    private resolveOutputDirectory(mode: ConvertOutputMode, customDir: string | undefined): string | null {
        if (mode === 'source') {
            return null;
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

    private async takenIn(directory: string, cache: Map<string, Set<string>>, platform: NodeJS.Platform): Promise<Set<string>> {
        const dirKey = normalizePathKey(directory, platform);
        const cached = cache.get(dirKey);
        if (cached !== undefined) {
            return cached;
        }
        try {
            const existing = await (this.deps.listDirectory ?? defaultListDirectory)(directory);
            const set = new Set(
                existing.map((entry) => {
                    return normalizePathKey(entry, platform);
                })
            );
            cache.set(dirKey, set);
            return set;
        } catch {
            return new Set<string>();
        }
    }

    private async allocateOutputPath(
        directory: string,
        stem: string,
        format: ConvertAudioFormat,
        taken: Set<string>,
        platform: NodeJS.Platform
    ): Promise<string | null> {
        const reserve = this.deps.reservePath ?? defaultReservePath;
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

    private async convertAll(
        format: ConvertAudioFormat,
        sharedDir: string | null,
        controller: AbortController,
        runFfmpeg: RunFfmpeg,
        platform: NodeJS.Platform
    ): Promise<void> {
        const run = this.run;
        if (run === null) {
            return;
        }
        try {
            const threads = (this.deps.threads ?? defaultThreads)();
            const takenCache = new Map<string, Set<string>>();
            for (const item of run.items) {
                if (controller.signal.aborted) {
                    item.status = 'cancelled';
                    continue;
                }
                const probed = await this.probe(item.path, controller.signal);
                if (controller.signal.aborted) {
                    item.status = 'cancelled';
                    continue;
                }
                if (!probed.ok) {
                    item.status = 'error';
                    item.error = probed.reason;
                    this.publish();
                    continue;
                }
                const targetDir = sharedDir ?? dirname(item.path);
                if (sharedDir === null) {
                    try {
                        await (this.deps.makeDirectory ?? defaultMakeDirectory)(targetDir);
                    } catch {
                        item.status = 'error';
                        item.error = 'folder';
                        this.publish();
                        continue;
                    }
                }
                if (controller.signal.aborted) {
                    item.status = 'cancelled';
                    continue;
                }
                const taken = await this.takenIn(targetDir, takenCache, platform);
                const stem = safeName(probed.media.name);
                const output = await this.allocateOutputPath(targetDir, stem, format, taken, platform);
                if (output === null) {
                    item.status = 'error';
                    item.error = 'folder';
                    this.publish();
                    continue;
                }
                if (controller.signal.aborted) {
                    item.status = 'cancelled';
                    await this.removeQuietly(output);
                    continue;
                }
                item.status = 'converting';
                this.publish();
                await this.convertOne(item, probed.media.durationSeconds, { input: item.path, output, format, threads }, controller.signal, runFfmpeg);
                this.publish();
            }
        } catch {
            for (const item of run.items) {
                if (item.status === 'waiting' || item.status === 'converting') {
                    item.status = 'error';
                    item.error = item.error ?? 'Conversion failed unexpectedly.';
                }
            }
        } finally {
            run.status = controller.signal.aborted ? 'cancelled' : 'done';
            this.publish();
            if (this.controller === controller) {
                this.controller = null;
            }
        }
    }

    private async convertOne(
        item: ConvertItemState,
        durationSeconds: number,
        command: ConvertCommand,
        signal: AbortSignal,
        runFfmpeg: RunFfmpeg
    ): Promise<void> {
        const now = this.deps.now ?? Date.now;
        let lastSent = 0;
        const outcome = await runFfmpeg({
            args: buildConvertArgs(command),
            signal,
            onOutput: (chunk) => {
                if (durationSeconds <= 0) {
                    return;
                }
                const seconds = parseProgressSeconds(chunk);
                if (seconds === null) {
                    return;
                }
                const percent = Math.min(99, Math.max(0, Math.floor((seconds / durationSeconds) * 100)));
                const moment = now();
                if (percent !== item.percent && moment - lastSent >= PROGRESS_INTERVAL_MS) {
                    item.percent = percent;
                    lastSent = moment;
                    this.publish();
                }
            }
        });
        if (signal.aborted) {
            item.status = 'cancelled';
            item.percent = 0;
            await this.removeQuietly(command.output);
            return;
        }
        if (outcome.code === 0) {
            item.status = 'done';
            item.percent = 100;
            item.outputPath = command.output;
            return;
        }
        item.status = 'error';
        item.error = lastLine(outcome.output) || (outcome.code === null ? 'ffmpeg could not be started' : `ffmpeg ended with code ${outcome.code}`);
        await this.removeQuietly(command.output);
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

async function defaultRemoveFile(path: string): Promise<void> {
    await rm(path, { force: true });
}
