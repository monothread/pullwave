import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { findFreePort, HEALTH_QUERY, SuwayomiServer, SuwayomiServerError, type SuwayomiServerDependencies, type SuwayomiServerStatus } from '@main/services/tools/suwayomiServer';
import { suwayomiSpec } from '@main/services/tools/suwayomiRelease';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';

const SPEC = suwayomiSpec('linux', 'x64')!;
const PORT = 45678;

class FakeServerProcess extends EventEmitter {
    pid = 4242;
    stdout = new PassThrough();
    stderr = new PassThrough();
    kill = vi.fn(() => {
        this.emit('exit', 0);
        return true;
    });
}

interface Launch {
    command: string;
    args: string[];
    options: SpawnOptions;
}

function setup(overrides: Partial<SuwayomiServerDependencies> & { answers?: Array<Response | Error> } = {}) {
    const dir = makeTempDir();
    const installDirectory = join(dir, 'install');
    const dataDirectory = join(dir, 'data');
    const launches: Launch[] = [];
    const processes: FakeServerProcess[] = [];
    const statuses: SuwayomiServerStatus[] = [];
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const answers = [...(overrides.answers ?? [new Response('{"data":{"aboutServer":{"version":"v1"}}}', { status: 200 })])];
    const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        const next = answers.length > 1 ? answers.shift()! : answers[0]!;
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next.clone());
    }) as unknown as typeof fetch;
    const killGroup = vi.spyOn(process, 'kill').mockImplementation(() => {
        processes[processes.length - 1]?.kill();
        return true;
    });
    const server = new SuwayomiServer({
        spec: SPEC,
        installDirectory,
        dataDirectory,
        platform: 'linux',
        spawn: (command, args, options) => {
            launches.push({ command, args, options });
            const child = new FakeServerProcess();
            processes.push(child);
            return child as unknown as ChildProcess;
        },
        fetchImpl,
        findFreePort: () => {
            return Promise.resolve(PORT);
        },
        environment: { HOME: '/home/me', LANG: 'en_US.UTF-8', SECRET_TOKEN: 'do-not-pass', PATH: '/usr/bin' },
        startTimeoutMs: 200,
        pollIntervalMs: 5,
        stopGraceMs: 50,
        onStatus: (status) => {
            statuses.push(status);
        },
        ...overrides
    });
    return { server, dir, installDirectory, dataDirectory, launches, processes, statuses, requests, fetchImpl, killGroup };
}

afterEach(() => {
    vi.restoreAllMocks();
    cleanTempDirs();
});

describe('SuwayomiServer', () => {
    it('starts the program with the data folder, waits until it answers and gives its address', async () => {
        const { server, launches, installDirectory, dataDirectory, statuses, requests } = setup();
        expect(server.status).toBe('stopped');
        expect(server.baseUrl).toBeNull();
        const address = await server.ensureRunning();
        expect(address).toBe(`http://127.0.0.1:${PORT}`);
        expect(server.status).toBe('running');
        expect(server.baseUrl).toBe(address);
        expect(launches).toHaveLength(1);
        expect(launches[0]?.command).toBe(join(installDirectory, 'jre', 'bin', 'java'));
        expect(launches[0]?.args).toEqual([`-Dsuwayomi.tachidesk.config.server.rootDir=${dataDirectory}`, '-jar', join(installDirectory, 'bin', 'Suwayomi-Server.jar')]);
        expect(launches[0]?.options).toMatchObject({ cwd: dataDirectory, windowsHide: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        expect(statuses).toEqual(['starting', 'running']);
        expect(requests[0]?.url).toBe(`${address}/api/graphql`);
        expect(requests[0]?.init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: HEALTH_QUERY }) });
    });

    it('passes on only what the program needs of the environment, and the library that keeps the JVM from aborting', async () => {
        const { server, launches, installDirectory } = setup();
        await server.ensureRunning();
        expect(launches[0]?.options.env).toEqual({ HOME: '/home/me', LANG: 'en_US.UTF-8', LD_PRELOAD: join(installDirectory, 'bin', 'catch_abort.so') });
    });

    it('uses the Windows names and no process group on Windows', async () => {
        const { server, launches, installDirectory } = setup({
            platform: 'win32',
            environment: { SystemRoot: 'C:\\Windows', TEMP: 'C:\\Temp', SECRET: 'x', Path: 'C:\\x' }
        });
        await server.ensureRunning();
        expect(launches[0]?.command).toBe(join(installDirectory, 'jre', 'bin', 'java.exe'));
        expect(launches[0]?.options).toMatchObject({ detached: false });
        expect(launches[0]?.options.env).toEqual({ SystemRoot: 'C:\\Windows', TEMP: 'C:\\Temp' });
    });

    it('writes its settings into server.conf, keeping what the server wrote there', async () => {
        const { server, dataDirectory } = setup();
        const { mkdirSync } = await import('node:fs');
        mkdirSync(dataDirectory, { recursive: true });
        writeFileSync(join(dataDirectory, 'server.conf'), 'server.port = 4567\nserver.extensionStores = ["https://a.example/i.json"]\n');
        await server.ensureRunning();
        expect(readFileSync(join(dataDirectory, 'server.conf'), 'utf-8')).toBe(
            [
                `server.port = ${PORT}`,
                'server.extensionStores = ["https://a.example/i.json"]',
                'server.ip = "127.0.0.1"',
                'server.webUIEnabled = false',
                'server.initialOpenInBrowserEnabled = false',
                'server.systemTrayEnabled = false',
                'server.debugLogsEnabled = false',
                'server.flareSolverrEnabled = false',
                ''
            ].join('\n')
        );
    });

    it('points the server at the FlareSolverr of the app, and turns the bypass on', async () => {
        const helperUrl = vi.fn(() => {
            return Promise.resolve('http://127.0.0.1:8191');
        });
        const { server, dataDirectory } = setup({ helperUrl });
        await server.ensureRunning();
        expect(helperUrl).toHaveBeenCalledTimes(1);
        const conf = readFileSync(join(dataDirectory, 'server.conf'), 'utf-8');
        expect(conf).toContain('server.flareSolverrEnabled = true');
        expect(conf).toContain('server.flareSolverrUrl = "http://127.0.0.1:8191"');
        expect(conf).toContain('server.flareSolverrAsResponseFallback = true');
    });

    it('starts the server with the bypass off when there is no FlareSolverr, or it could not be started', async () => {
        const none = setup({ helperUrl: () => {return Promise.resolve(null)} });
        await none.server.ensureRunning();
        expect(readFileSync(join(none.dataDirectory, 'server.conf'), 'utf-8')).toContain('server.flareSolverrEnabled = false');
        const failing = setup({ helperUrl: () => {return Promise.reject(new Error('FlareSolverr did not become ready in time'))} });
        await failing.server.ensureRunning();
        const conf = readFileSync(join(failing.dataDirectory, 'server.conf'), 'utf-8');
        expect(conf).toContain('server.flareSolverrEnabled = false');
        expect(conf).not.toContain('flareSolverrUrl');
        expect(conf).not.toContain('flareSolverrAsResponseFallback');
        expect(failing.server.status).toBe('running');
    });

    it('turns the bypass off again when the program that gets past Cloudflare is gone', async () => {
        const { server, dataDirectory } = setup({ helperUrl: () => {return Promise.resolve('http://127.0.0.1:8191')} });
        await server.ensureRunning();
        await server.stop();
        const again = new SuwayomiServer({
            spec: SPEC,
            installDirectory: '/x',
            dataDirectory,
            platform: 'linux',
            spawn: () => {
                return new FakeServerProcess() as unknown as ChildProcess;
            },
            fetchImpl: (() => {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }) as unknown as typeof fetch,
            findFreePort: () => {
                return Promise.resolve(PORT);
            }
        });
        await again.ensureRunning();
        expect(readFileSync(join(dataDirectory, 'server.conf'), 'utf-8')).toContain('server.flareSolverrEnabled = false');
    });

    it('creates the data folder and the settings file when there are none', async () => {
        const { server, dataDirectory } = setup();
        await server.ensureRunning();
        expect(existsSync(join(dataDirectory, 'server.conf'))).toBe(true);
    });

    it('keeps trying while the server is not listening yet', async () => {
        const { server, requests } = setup({
            answers: [new Error('ECONNREFUSED'), new Response('x', { status: 503 }), new Response('{"data":{}}', { status: 200 })]
        });
        await server.ensureRunning();
        expect(requests).toHaveLength(3);
        expect(server.status).toBe('running');
    });

    it('shares one start between callers that ask together and does not start again once running', async () => {
        const { server, launches } = setup();
        const [first, second] = await Promise.all([server.ensureRunning(), server.ensureRunning()]);
        expect(first).toBe(second);
        await server.ensureRunning();
        expect(launches).toHaveLength(1);
    });

    it('fails with the last lines of output when the program ends before it is ready', async () => {
        const { server, processes, statuses } = setup({ answers: [new Error('ECONNREFUSED')] });
        const start = server.ensureRunning();
        await vi.waitFor(() => {
            expect(processes).toHaveLength(1);
        });
        processes[0]?.stderr.write('Error: could not open the database\n');
        await new Promise((resolve) => {
            setTimeout(resolve, 20);
        });
        processes[0]?.emit('exit', 1);
        await expect(start).rejects.toBeInstanceOf(SuwayomiServerError);
        await expect(start).rejects.toThrow('The server ended with code 1');
        expect(server.status).toBe('error');
        expect(server.error).toContain('The server ended with code 1');
        expect(server.error).toContain('Error: could not open the database');
        expect(statuses).toEqual(['starting', 'error']);
        expect(server.baseUrl).toBeNull();
    });

    it('fails and ends the program when it does not answer in time', async () => {
        const { server, processes } = setup({ answers: [new Error('ECONNREFUSED')], startTimeoutMs: 40 });
        await expect(server.ensureRunning()).rejects.toThrow('The server did not become ready in time');
        expect(server.status).toBe('error');
        expect(processes[0]?.kill).toHaveBeenCalled();
    });

    it('fails when the program cannot be started at all', async () => {
        const { server } = setup({
            spawn: () => {
                const child = new FakeServerProcess();
                queueMicrotask(() => {
                    child.emit('error', new Error('spawn java ENOENT'));
                });
                return child as unknown as ChildProcess;
            },
            answers: [new Error('ECONNREFUSED')]
        });
        await expect(server.ensureRunning()).rejects.toThrow('spawn java ENOENT');
        expect(server.status).toBe('error');
    });

    it('can start again after a failure', async () => {
        const { server } = setup({ answers: [new Error('ECONNREFUSED')], startTimeoutMs: 30 });
        await expect(server.ensureRunning()).rejects.toThrow();
        expect(server.status).toBe('error');
        const retry = new SuwayomiServer({
            spec: SPEC,
            installDirectory: '/x',
            dataDirectory: join(makeTempDir(), 'data'),
            platform: 'linux',
            spawn: () => {
                return new FakeServerProcess() as unknown as ChildProcess;
            },
            fetchImpl: (() => {
                return Promise.resolve(new Response('{}', { status: 200 }));
            }) as unknown as typeof fetch,
            findFreePort: () => {
                return Promise.resolve(PORT);
            }
        });
        await expect(retry.ensureRunning()).resolves.toBe(`http://127.0.0.1:${PORT}`);
    });

    it('stops the program and starts a new one on the next request', async () => {
        const { server, processes, launches, statuses } = setup();
        await server.ensureRunning();
        await server.stop();
        expect(processes[0]?.kill).toHaveBeenCalled();
        expect(server.status).toBe('stopped');
        expect(server.baseUrl).toBeNull();
        await server.ensureRunning();
        expect(launches).toHaveLength(2);
        expect(statuses).toEqual(['starting', 'running', 'stopped', 'starting', 'running']);
    });

    it('ends the program by force when it does not end in time', async () => {
        const { server, processes, killGroup } = setup();
        await server.ensureRunning();
        const stubborn = processes[0]!;
        killGroup.mockImplementation(() => {
            return true;
        });
        stubborn.kill = vi.fn(() => {
            return true;
        });
        await server.stop();
        const signals = killGroup.mock.calls.map((call) => {
            return [call[0], call[1]];
        });
        expect(signals).toEqual([
            [-4242, 'SIGTERM'],
            [-4242, 'SIGKILL']
        ]);
        expect(server.status).toBe('stopped');
    });

    it('does nothing when it is stopped and was never started', async () => {
        const { server, statuses, killGroup } = setup();
        await server.stop();
        expect(statuses).toEqual([]);
        expect(killGroup).not.toHaveBeenCalled();
    });

    it('notices when the program dies by itself and starts it again when asked', async () => {
        const { server, processes, launches, statuses } = setup();
        await server.ensureRunning();
        processes[0]?.emit('exit', 137);
        expect(server.status).toBe('stopped');
        expect(server.baseUrl).toBeNull();
        await server.ensureRunning();
        expect(launches).toHaveLength(2);
        expect(statuses).toEqual(['starting', 'running', 'stopped', 'starting', 'running']);
    });
});

describe('findFreePort', () => {
    it('gives a port above the well-known ones that can be listened on', async () => {
        const port = await findFreePort();
        expect(Number.isInteger(port)).toBe(true);
        expect(port).toBeGreaterThan(1023);
        expect(port).toBeLessThan(65536);
    });
});
