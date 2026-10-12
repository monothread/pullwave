import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { MangaServerStatus } from '@shared/manga';
import type { ToolState } from '@shared/tools';
import { findFreePort } from './suwayomiServer';

// FlareSolverr (MIT) runs in Docker, so nothing it needs (a browser, a virtual screen) is installed on the machine of the user. The version
// is pinned: a new one is a change of this constant.
export const FLARESOLVERR_VERSION = 'v3.5.2';
export const FLARESOLVERR_IMAGE_NAME = 'ghcr.io/flaresolverr/flaresolverr';
export const FLARESOLVERR_IMAGE = `${FLARESOLVERR_IMAGE_NAME}:${FLARESOLVERR_VERSION}`;
export const FLARESOLVERR_CONTAINER_LABEL = 'pullwave.helper=flaresolverr';
export const FLARESOLVERR_CONTAINER_PORT = 8191;
export const FLARESOLVERR_START_TIMEOUT_MS = 90_000;
export const FLARESOLVERR_POLL_INTERVAL_MS = 500;
export const FLARESOLVERR_STOP_SECONDS = 3;
const OUTPUT_LINES = 20;

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

// Runs `docker <args>`; `onLine` gets every line of the output as it comes. Never rejects: a docker that is not there ends with code null.
export type DockerRunner = (args: string[], onLine?: (line: string) => void) => Promise<DockerResult>;

export function createDockerRunner(spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess = nodeSpawn): DockerRunner {
    return (args, onLine) => {
        return new Promise<DockerResult>((resolve) => {
            let stdout = '';
            let stderr = '';
            let settled = false;
            const finish = (code: number | null): void => {
                if (!settled) {
                    settled = true;
                    resolve({ code, stdout, stderr });
                }
            };
            const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
            const read = (chunk: Buffer, into: 'out' | 'err'): void => {
                const text = chunk.toString('utf-8');
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
            child.once('error', () => {
                finish(null);
            });
            child.once('close', (code) => {
                finish(code);
            });
        });
    };
}

export interface FlareSolverrDockerDependencies {
    docker?: DockerRunner;
    fetchImpl?: typeof fetch;
    findFreePort?: () => Promise<number>;
    onState?: (state: ToolState) => void;
    // A name that tells this app's container from another one (the process id is enough).
    containerName?: string;
    // The version of the image to run, when it is not the one the app ships with (an update the user made).
    version?: string;
    startTimeoutMs?: number;
    pollIntervalMs?: number;
    // Whether a process of this machine is alive (the owner of a container is told by the process id in its name).
    isProcessAlive?: (pid: number) => boolean;
}

// The process id a container of the app carries in its name (`pullwave-flaresolverr-<pid>`), or null when it has none.
export function ownerPid(containerName: string): number | null {
    const match = /-(\d+)$/.exec(containerName.trim());
    return match === null ? null : Number(match[1]);
}

export function defaultIsProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // Not allowed to signal it means it is there, owned by another user.
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

// Runs FlareSolverr, the program that opens a page in a real browser to get past the check of Cloudflare, as a Docker container: its image
// is pulled when the app opens, and the container listens on a port of its own on this machine only and is removed when it stops.
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

    constructor(private readonly deps: FlareSolverrDockerDependencies = {}) {
        this.docker = deps.docker ?? createDockerRunner();
        this.versionTag = deps.version ?? FLARESOLVERR_VERSION;
        this.current = { ...this.current, version: this.versionTag };
    }

    // The version of the image that is run, and the image.
    get version(): string {
        return this.versionTag;
    }

    private get image(): string {
        return `${FLARESOLVERR_IMAGE_NAME}:${this.versionTag}`;
    }

    // Runs another version of FlareSolverr: its image is pulled, the container that runs (it uses the old image) is stopped, so the next use
    // starts the new one, and the old image is removed. When the new one cannot be pulled the old one stays in use.
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

    // Why it cannot be used, when it cannot.
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

    // Checks that Docker answers and pulls the image if it is not there (done when the app opens, and again by hand after a failure).
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
        const finished = new Set<string>();
        const pulled = await this.docker(['pull', this.image], (line) => {
            const match = /^([0-9a-f]{12}): (.+)$/.exec(line);
            if (match === null) {
                return;
            }
            layers.add(match[1]!);
            if (/Pull complete|Already exists/.test(match[2]!)) {
                finished.add(match[1]!);
            }
            this.update({ bytesDone: finished.size, bytesTotal: layers.size, percent: Math.floor((finished.size / layers.size) * 100) });
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

    // Stops the container and removes the image; the helper is then as if it was never installed.
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
        this.address = null;
        this.currentStatus = 'stopped';
        if (id !== null) {
            // The container was started with --rm: it goes away when it stops.
            await this.docker(['stop', '--time', String(FLARESOLVERR_STOP_SECONDS), id]);
        }
    }

    // Removes containers an earlier run of the app left behind (it was killed before it could stop them). The container of another copy of the
    // app that is running (its process is alive) is not touched, and neither is the one this app runs.
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
