import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { MangaServerStatus } from '@shared/manga';
import type { ToolSpec } from '@shared/tools';
import { processLogs, type LogWriter } from '../logHub';
import { createLogFeed } from '../logFeed';
import { killProcessTree } from '../processTree';
import { applyManagedSettings, managedSettings } from './suwayomiConfig';

export const HEALTH_QUERY = '{ aboutServer { version } }';
export const START_TIMEOUT_MS = 120_000;
export const POLL_INTERVAL_MS = 500;
export const STOP_GRACE_MS = 5000;
const SERVER_LOG_LINES = 40;
export const WEBVIEW_LEFTOVER = ['bin', 'kcef'];
export const SERVER_JVM_ARGS = ['-XX:G1PeriodicGCInterval=30000', '-XX:MinHeapFreeRatio=10', '-XX:MaxHeapFreeRatio=30', '-XX:TieredStopAtLevel=1'];
const WINDOWS_SYSTEM_VARIABLES = ['SystemRoot', 'windir', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'PATHEXT', 'COMSPEC'];

export type SuwayomiServerStatus = MangaServerStatus;

export class SuwayomiServerError extends Error {}

export interface SuwayomiServerDependencies {
    spec: ToolSpec;
    installDirectory: string;
    dataDirectory: string;
    platform?: NodeJS.Platform;
    spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
    fetchImpl?: typeof fetch;
    findFreePort?: () => Promise<number>;
    environment?: NodeJS.ProcessEnv;
    startTimeoutMs?: number;
    pollIntervalMs?: number;
    stopGraceMs?: number;
    onStatus?: (status: SuwayomiServerStatus) => void;
    helperUrl?: () => Promise<string | null>;
    openLog?: () => LogWriter;
    removeDirectory?: (path: string) => void;
}

export function findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address !== null ? address.port : 0;
            server.close(() => {
                resolve(port);
            });
        });
    });
}

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function openSuwayomiLog(): LogWriter {
    return processLogs.open('suwayomi');
}

function removeDirectory(path: string): void {
    rmSync(path, { recursive: true, force: true });
}

export class SuwayomiServer {
    private child: ChildProcess | null = null;
    private currentStatus: SuwayomiServerStatus = 'stopped';
    private address: string | null = null;
    private starting: Promise<string> | null = null;
    private lastError: string | null = null;
    private readonly recentOutput: string[] = [];

    constructor(private readonly deps: SuwayomiServerDependencies) {}

    get status(): SuwayomiServerStatus {
        return this.currentStatus;
    }

    get baseUrl(): string | null {
        return this.currentStatus === 'running' ? this.address : null;
    }

    get error(): string | null {
        return this.lastError;
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
        await this.endProcess();
        this.setStatus('stopped');
    }

    private async endProcess(): Promise<void> {
        const child = this.child;
        if (child === null) {
            return;
        }
        this.child = null;
        const exited = new Promise<void>((resolve) => {
            child.once('exit', () => {
                resolve();
            });
        });
        killProcessTree(child, this.deps.platform ?? process.platform);
        const grace = this.deps.stopGraceMs ?? STOP_GRACE_MS;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const gaveUp = new Promise<'late'>((resolve) => {
            timer = setTimeout(() => {
                resolve('late');
            }, grace);
        });
        const ended = exited.then(() => {
            return 'done' as const;
        });
        if ((await Promise.race([ended, gaveUp])) === 'late') {
            killProcessTree(child, this.deps.platform ?? process.platform, undefined, 'SIGKILL');
        }
        clearTimeout(timer);
        this.address = null;
    }

    private async start(): Promise<string> {
        this.setStatus('starting');
        this.lastError = null;
        this.recentOutput.length = 0;
        try {
            const port = await (this.deps.findFreePort ?? findFreePort)();
            this.writeConfig(port, await this.helperAddress());
            const child = this.launch(this.removeWebViewLeftover());
            this.child = child;
            const address = `http://127.0.0.1:${port}`;
            await this.waitUntilReady(child, address);
            this.address = address;
            this.setStatus('running');
            return address;
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.lastError = this.recentOutput.length > 0 ? `${detail}\n${this.recentOutput.join('\n')}` : detail;
            await this.endProcess();
            this.setStatus('error');
            throw new SuwayomiServerError(detail);
        }
    }

    private async helperAddress(): Promise<string | null> {
        try {
            return (await this.deps.helperUrl?.()) ?? null;
        } catch {
            return null;
        }
    }

    private writeConfig(port: number, flareSolverrUrl: string | null): void {
        mkdirSync(this.deps.dataDirectory, { recursive: true });
        const path = join(this.deps.dataDirectory, 'server.conf');
        writeFileSync(path, applyManagedSettings(this.readConfig(path), managedSettings(port, flareSolverrUrl)), 'utf-8');
    }

    private readConfig(path: string): string {
        try {
            return readFileSync(path, 'utf-8');
        } catch {
            return '';
        }
    }

    private removeWebViewLeftover(): string | null {
        const path = join(this.deps.dataDirectory, ...WEBVIEW_LEFTOVER);
        try {
            (this.deps.removeDirectory ?? removeDirectory)(path);
            return null;
        } catch (error) {
            return `could not remove the WebView no longer used (${path}): ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    private launch(cleanupProblem: string | null): ChildProcess {
        const platform = this.deps.platform ?? process.platform;
        const java = join(this.deps.installDirectory, 'jre', 'bin', platform === 'win32' ? 'java.exe' : 'java');
        const jar = join(this.deps.installDirectory, 'bin', 'Suwayomi-Server.jar');
        const args = ['-Djava.net.preferIPv4Stack=true', '--enable-native-access=ALL-UNNAMED', ...SERVER_JVM_ARGS, `-Dsuwayomi.tachidesk.config.server.rootDir=${this.deps.dataDirectory}`, '-jar', jar];
        const spawn = this.deps.spawn ?? nodeSpawn;
        const child = spawn(java, args, {
            cwd: this.deps.dataDirectory,
            env: this.environment(platform),
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            detached: platform !== 'win32'
        });
        const remember = (chunk: Buffer): void => {
            chunk
                .toString('utf-8')
                .split(/\r?\n/)
                .filter((line) => {
                    return line.length > 0;
                })
                .forEach((line) => {
                    this.recentOutput.push(line);
                    if (this.recentOutput.length > SERVER_LOG_LINES) {
                        this.recentOutput.shift();
                    }
                });
        };
        child.stdout?.on('data', remember);
        child.stderr?.on('data', remember);
        this.writeToLog(child, java, args, cleanupProblem);
        child.on('exit', () => {
            if (this.child === child) {
                this.child = null;
                this.address = null;
                if (this.currentStatus === 'running') {
                    this.setStatus('stopped');
                }
            }
        });
        return child;
    }

    private writeToLog(child: ChildProcess, java: string, args: string[], cleanupProblem: string | null): void {
        const log = (this.deps.openLog ?? openSuwayomiLog)();
        if (cleanupProblem !== null) {
            log.failure(cleanupProblem);
        }
        log.command(java, args);
        const stdout = createLogFeed(log, 'stdout');
        const stderr = createLogFeed(log, 'stderr');
        child.stdout?.on('data', (chunk: Buffer) => {
            stdout.push(chunk.toString('utf-8'));
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            stderr.push(chunk.toString('utf-8'));
        });
        child.once('error', (error) => {
            log.failure(`could not start: ${error.message}`);
        });
        child.once('exit', (code, signal) => {
            stdout.flush();
            stderr.flush();
            log.exit(code, signal);
        });
    }

    private environment(platform: NodeJS.Platform): NodeJS.ProcessEnv {
        const source = this.deps.environment ?? process.env;
        const environment: NodeJS.ProcessEnv = {};
        const names = platform === 'win32' ? WINDOWS_SYSTEM_VARIABLES : ['HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TZ'];
        names.forEach((name) => {
            const value = source[name];
            if (value !== undefined) {
                environment[name] = value;
            }
        });
        if (platform !== 'win32') {
            environment['LD_PRELOAD'] = join(this.deps.installDirectory, 'bin', 'catch_abort.so');
        }
        return environment;
    }

    private async waitUntilReady(child: ChildProcess, address: string): Promise<void> {
        const fetchImpl = this.deps.fetchImpl ?? fetch;
        const deadline = Date.now() + (this.deps.startTimeoutMs ?? START_TIMEOUT_MS);
        let exited = false;
        child.once('exit', (code) => {
            exited = true;
            this.lastError = `The server ended with code ${String(code)}`;
        });
        child.once('error', (error) => {
            exited = true;
            this.lastError = error.message;
        });
        while (Date.now() < deadline) {
            if (exited) {
                throw new SuwayomiServerError(this.lastError ?? 'The server ended before it was ready');
            }
            try {
                const response = await fetchImpl(`${address}/api/graphql`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: HEALTH_QUERY }),
                    signal: AbortSignal.timeout(3000)
                });
                if (response.ok) {
                    return;
                }
            } catch {
                // Not listening yet.
            }
            await sleep(this.deps.pollIntervalMs ?? POLL_INTERVAL_MS);
        }
        throw new SuwayomiServerError('The server did not become ready in time');
    }

    private setStatus(status: SuwayomiServerStatus): void {
        if (this.currentStatus !== status) {
            this.currentStatus = status;
            this.deps.onStatus?.(status);
        }
    }
}
