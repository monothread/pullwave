import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { MangaServerStatus } from '@shared/manga';
import type { ToolState } from '@shared/tools';
import { processLogs, type LogWriter } from '../logHub';
import { createLogFeed } from '../logFeed';
import { findFreePort } from './suwayomiServer';

export const FLARESOLVERR_VERSION = 'v3.5.2';
export const FLARESOLVERR_IMAGE_NAME = 'ghcr.io/flaresolverr/flaresolverr';
export const FLARESOLVERR_IMAGE = `${FLARESOLVERR_IMAGE_NAME}:${FLARESOLVERR_VERSION}`;
export const FLARESOLVERR_CONTAINER_LABEL = 'pullwave.helper=flaresolverr';
export const FLARESOLVERR_CONTAINER_PORT = 8191;
export const FLARESOLVERR_START_TIMEOUT_MS = 90_000;
export const FLARESOLVERR_POLL_INTERVAL_MS = 500;
export const FLARESOLVERR_STOP_SECONDS = 3;
const OUTPUT_LINES = 20;

const LAYER_DOWNLOADED = /Download complete|Verifying Checksum|Extracting/;
const LAYER_IN_PLACE = /Pull complete|Already exists/;

export function pullPercent(before: number, layers: number, downloaded: number, finished: number): number {
    if (layers === 0) {
        return before;
    }
    return Math.max(before, Math.floor(((downloaded + finished) / (layers * 2)) * 100));
}

export class FlareSolverrDockerError extends Error {
    constructor(
        readonly code: 'NO_DOCKER' | 'PULL_FAILED' | 'START_FAILED',
        message: string
    ) {
        super(message);
    }
}

export interface DockerResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

export type DockerRunner = (args: string[], onLine?: (line: string) => void) => Promise<DockerResult>;

type DockerSpawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export type ContainerLogFollower = (containerId: string) => () => void;

function openFlareSolverrLog(): LogWriter {
    return processLogs.open('flaresolverr');
}

export function createDockerRunner(spawn: DockerSpawn = nodeSpawn, openLog: () => LogWriter = openFlareSolverrLog): DockerRunner {
    return (args, onLine) => {
        return new Promise<DockerResult>((resolve) => {
            const log = openLog();
            log.command('docker', args);
            const feeds = { out: createLogFeed(log, 'stdout'), err: createLogFeed(log, 'stderr') };
            let stdout = '';
            let stderr = '';
            let settled = false;
            const finish = (code: number | null, failure: string | null = null): void => {
                if (!settled) {
                    settled = true;
                    feeds.out.flush();
                    feeds.err.flush();
                    if (failure === null) {
                        log.exit(code);
                    } else {
                        log.failure(failure);
                    }
                    resolve({ code, stdout, stderr });
                }
            };
            const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
            const read = (chunk: Buffer, into: 'out' | 'err'): void => {
                const text = chunk.toString('utf-8');
                feeds[into].push(text);
                if (into === 'out') {
                    stdout += text;
                } else {
                    stderr += text;
                }
                text.split(/\r?\n/).forEach((line) => {
                    if (line.length > 0) {
                        onLine?.(line);
                    }
                });
            };
            child.stdout?.on('data', (chunk: Buffer) => {
                read(chunk, 'out');
            });
            child.stderr?.on('data', (chunk: Buffer) => {
                read(chunk, 'err');
            });
            child.once('error', (error) => {
                finish(null, `could not start: ${error.message}`);
            });
            child.once('close', (code) => {
                finish(code);
            });
        });
    };
}

export function createContainerLogFollower(spawn: DockerSpawn = nodeSpawn, openLog: () => LogWriter = openFlareSolverrLog): ContainerLogFollower {
    return (containerId) => {
        const log = openLog();
        const args = ['logs', '--follow', containerId];
        log.command('docker', args);
        const stdout = createLogFeed(log, 'stdout');
        const stderr = createLogFeed(log, 'stderr');
        const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        let stoppedByApp = false;
        child.stdout?.on('data', (chunk: Buffer) => {
            stdout.push(chunk.toString('utf-8'));
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            stderr.push(chunk.toString('utf-8'));
        });
        child.once('error', (error) => {
            log.failure(`could not start: ${error.message}`);
        });
        child.once('close', (code, signal) => {
            stdout.flush();
            stderr.flush();
            if (stoppedByApp) {
                log.stopped();
            } else {
                log.exit(code, signal);
            }
        });
        return (): void => {
            stoppedByApp = true;
            child.kill();
        };
    };
}

export interface FlareSolverrDockerDependencies {
    docker?: DockerRunner;
    fetchImpl?: typeof fetch;
    findFreePort?: () => Promise<number>;
    onState?: (state: ToolState) => void;
    containerName?: string;
    version?: string;
    startTimeoutMs?: number;
    pollIntervalMs?: number;
    isProcessAlive?: (pid: number) => boolean;
    followLogs?: ContainerLogFollower;
}

export function ownerPid(containerName: string): number | null {
    const match = /-(\d+)$/.exec(containerName.trim());
    return match === null ? null : Number(match[1]);
}

export function defaultIsProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function lastLines(text: string): string {
    return text
        .split(/\r?\n/)
        .filter((line) => {
            return line.length > 0;
        })
        .slice(-OUTPUT_LINES)
        .join('\n');
}

export class FlareSolverrDocker {
    private readonly docker: DockerRunner;
    private versionTag: string;
    private current: ToolState = {
        id: 'flaresolverr',
        status: 'missing',
        version: FLARESOLVERR_VERSION,
        bytesDone: 0,
        bytesTotal: 0,
        percent: 0,
        error: null
    };
    private currentStatus: MangaServerStatus = 'stopped';
    private address: string | null = null;
    private starting: Promise<string> | null = null;
    private preparing: Promise<ToolState> | null = null;
    private lastError: string | null = null;
    private problem: 'no-docker' | 'start-failed' | null = null;
    private containerId: string | null = null;
    private readonly followLogs: ContainerLogFollower;
    private stopFollowing: (() => void) | null = null;

    constructor(private readonly deps: FlareSolverrDockerDependencies = {}) {
        this.docker = deps.docker ?? createDockerRunner();
        this.followLogs = deps.followLogs ?? createContainerLogFollower();
        this.versionTag = deps.version ?? FLARESOLVERR_VERSION;
        this.current = { ...this.current, version: this.versionTag };
    }

    get version(): string {
        return this.versionTag;
    }

    private get image(): string {
        return `${FLARESOLVERR_IMAGE_NAME}:${this.versionTag}`;
    }

    async switchTo(version: string): Promise<ToolState> {
        const previousVersion = this.versionTag;
        const previousImage = this.image;
        const wasReady = this.current.status === 'ready';
        this.versionTag = version;
        this.update({ status: 'missing', version, percent: 0, bytesDone: 0, bytesTotal: 0, error: null });
        const state = await this.prepare();
        if (state.status !== 'ready') {
            this.versionTag = previousVersion;
            this.problem = null;
            this.update({ status: wasReady ? 'ready' : 'missing', version: previousVersion, percent: wasReady ? 100 : 0, error: state.error });
            return this.current;
        }
        await this.stop();
        await this.docker(['rmi', previousImage]);
        return this.current;
    }

    get state(): ToolState {
        return this.current;
    }

    get status(): MangaServerStatus {
        return this.currentStatus;
    }

    get baseUrl(): string | null {
        return this.currentStatus === 'running' ? this.address : null;
    }

    get error(): string | null {
        return this.lastError;
    }

    get failure(): { code: 'no-docker' | 'start-failed'; message: string } | null {
        return this.problem === null ? null : { code: this.problem, message: this.lastError ?? '' };
    }

    get isReady(): boolean {
        return this.current.status === 'ready';
    }

    private update(patch: Partial<ToolState>): void {
        this.current = { ...this.current, ...patch };
        this.deps.onState?.(this.current);
    }

    prepare(): Promise<ToolState> {
        this.preparing ??= this.runPrepare().finally(() => {
            this.preparing = null;
        });
        return this.preparing;
    }

    private async runPrepare(): Promise<ToolState> {
        this.problem = null;
        this.lastError = null;
        const version = await this.docker(['version', '--format', '{{.Server.Version}}']);
        if (version.code !== 0) {
            this.problem = 'no-docker';
            this.lastError = lastLines(version.stderr) || 'Docker is not installed or is not running';
            this.update({ status: 'error', error: { code: 'DOCKER_MISSING', message: this.lastError } });
            return this.current;
        }
        const present = await this.docker(['image', 'inspect', '--format', '{{.Id}}', this.image]);
        if (present.code === 0) {
            this.update({ status: 'ready', percent: 100, error: null });
            return this.current;
        }
        this.update({ status: 'downloading', percent: 0, bytesDone: 0, bytesTotal: 0, error: null });
        const layers = new Set<string>();
        const downloaded = new Set<string>();
        const finished = new Set<string>();
        const pulled = await this.docker(['pull', this.image], (line) => {
            const match = /^([0-9a-f]{12}): (.+)$/.exec(line);
            if (match === null) {
                return;
            }
            const layer = match[1]!;
            const step = match[2]!;
            layers.add(layer);
            if (LAYER_DOWNLOADED.test(step)) {
                downloaded.add(layer);
            }
            if (LAYER_IN_PLACE.test(step)) {
                downloaded.add(layer);
                finished.add(layer);
            }
            this.update({ bytesDone: finished.size, bytesTotal: layers.size, percent: pullPercent(this.current.percent, layers.size, downloaded.size, finished.size) });
        });
        if (pulled.code !== 0) {
            this.problem = 'start-failed';
            this.lastError = lastLines(pulled.stderr || pulled.stdout) || 'The image of FlareSolverr could not be pulled';
            this.update({ status: 'error', error: { code: 'DOWNLOAD_FAILED', message: this.lastError } });
            return this.current;
        }
        this.update({ status: 'ready', percent: 100, error: null });
        return this.current;
    }

    async remove(): Promise<void> {
        await this.stop();
        await this.docker(['rmi', this.image]);
        this.problem = null;
        this.lastError = null;
        this.currentStatus = 'stopped';
        this.update({ status: 'missing', percent: 0, bytesDone: 0, bytesTotal: 0, error: null });
    }

    ensureRunning(): Promise<string> {
        if (this.currentStatus === 'running' && this.address !== null) {
            return Promise.resolve(this.address);
        }
        this.starting ??= this.start().finally(() => {
            this.starting = null;
        });
        return this.starting;
    }

    async stop(): Promise<void> {
        const id = this.containerId;
        this.containerId = null;
        this.stopFollowing?.();
        this.stopFollowing = null;
        this.address = null;
        this.currentStatus = 'stopped';
        if (id !== null) {
            await this.docker(['stop', '-t', String(FLARESOLVERR_STOP_SECONDS), id]);
        }
    }

    async removeOrphans(): Promise<void> {
        const listed = await this.docker(['ps', '--all', '--filter', `label=${FLARESOLVERR_CONTAINER_LABEL}`, '--format', '{{.ID}} {{.Names}}']);
        if (listed.code !== 0) {
            return;
        }
        const alive = this.deps.isProcessAlive ?? defaultIsProcessAlive;
        const ids = listed.stdout
            .split('\n')
            .map((line) => {
                return line.trim().split(/\s+/);
            })
            .filter(([id, name]) => {
                if (id === undefined || id.length === 0 || id === this.containerId) {
                    return false;
                }
                const pid = name === undefined ? null : ownerPid(name);
                return pid === null || pid === process.pid || !alive(pid);
            })
            .map(([id]) => {
                return id as string;
            });
        if (ids.length > 0) {
            await this.docker(['rm', '--force', ...ids]);
        }
    }

    private async start(): Promise<string> {
        this.currentStatus = 'starting';
        this.lastError = null;
        this.problem = null;
        try {
            if (!this.isReady) {
                const state = await this.prepare();
                if (state.status !== 'ready') {
                    throw new FlareSolverrDockerError(this.problem === 'no-docker' ? 'NO_DOCKER' : 'PULL_FAILED', this.lastError ?? 'FlareSolverr is not ready');
                }
            }
            await this.removeOrphans();
            const port = await (this.deps.findFreePort ?? findFreePort)();
            const run = await this.docker([
                'run',
                '--detach',
                '--rm',
                '--label',
                FLARESOLVERR_CONTAINER_LABEL,
                '--name',
                this.deps.containerName ?? `pullwave-flaresolverr-${process.pid}`,
                '--publish',
                `127.0.0.1:${port}:${FLARESOLVERR_CONTAINER_PORT}`,
                '--env',
                'LOG_LEVEL=info',
                this.image
            ]);
            if (run.code !== 0) {
                throw new FlareSolverrDockerError('START_FAILED', lastLines(run.stderr) || 'The container of FlareSolverr did not start');
            }
            this.containerId = run.stdout.trim();
            this.stopFollowing = this.followLogs(this.containerId);
            const address = `http://127.0.0.1:${port}`;
            await this.waitUntilReady(address);
            this.address = address;
            this.currentStatus = 'running';
            return address;
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            const logs = this.containerId === null ? null : await this.docker(['logs', '--tail', String(OUTPUT_LINES), this.containerId]);
            this.lastError = logs === null ? detail : `${detail}\n${lastLines(`${logs.stdout}\n${logs.stderr}`)}`;
            this.problem ??= 'start-failed';
            await this.stop();
            this.currentStatus = 'error';
            throw error instanceof FlareSolverrDockerError ? error : new FlareSolverrDockerError('START_FAILED', detail);
        }
    }

    private async waitUntilReady(address: string): Promise<void> {
        const fetchImpl = this.deps.fetchImpl ?? fetch;
        const deadline = Date.now() + (this.deps.startTimeoutMs ?? FLARESOLVERR_START_TIMEOUT_MS);
        while (Date.now() < deadline) {
            try {
                const response = await fetchImpl(`${address}/`, { signal: AbortSignal.timeout(3000) });
                if (response.ok) {
                    return;
                }
            } catch {
                // Not listening yet.
            }
            await sleep(this.deps.pollIntervalMs ?? FLARESOLVERR_POLL_INTERVAL_MS);
        }
        throw new FlareSolverrDockerError('START_FAILED', 'FlareSolverr did not become ready in time');
    }
}
