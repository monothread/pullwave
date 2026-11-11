import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { ToolState } from '@shared/tools';
import {
    createContainerLogFollower,
    createDockerRunner,
    defaultIsProcessAlive,
    FLARESOLVERR_CONTAINER_LABEL,
    FLARESOLVERR_IMAGE,
    FLARESOLVERR_IMAGE_NAME,
    FLARESOLVERR_VERSION,
    FlareSolverrDocker,
    FlareSolverrDockerError,
    ownerPid
} from '@main/services/tools/flaresolverrDocker';
import { LogHub, processLogs } from '@main/services/logHub';
import { fakeDocker, type FakeDockerOptions } from '../../../helpers/fakeDocker';
import { createFakeLogWriter } from '../../../helpers/fakeLogWriter';

// No test runs the real docker: a helper built without a follower of the logs of its container would start `docker logs --follow`.
const childProcess = vi.hoisted(() => {
    return { spawn: vi.fn() };
});

vi.mock('node:child_process', async (importOriginal) => {
    const original = await importOriginal<typeof import('node:child_process')>();
    return { ...original, spawn: childProcess.spawn };
});

type FakeDockerChild = EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };

function makeDockerChild(): FakeDockerChild {
    const child = new EventEmitter() as FakeDockerChild;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    return child;
}

beforeEach(() => {
    childProcess.spawn.mockReset();
    childProcess.spawn.mockImplementation(() => {
        return makeDockerChild();
    });
});

function settle(): Promise<void> {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
}

const ADDRESS = 'http://127.0.0.1:45900';

function okFetch(): typeof fetch {
    return vi.fn(() => {
        return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;
}

function setup(options: FakeDockerOptions = {}, fetchImpl: typeof fetch = okFetch()) {
    const docker = fakeDocker(options);
    const states: ToolState[] = [];
    const helper = new FlareSolverrDocker({
        docker: docker.runner,
        followLogs: docker.follower,
        fetchImpl,
        findFreePort: () => {
            return Promise.resolve(45900);
        },
        onState: (state) => {
            states.push(state);
        },
        containerName: 'pullwave-test',
        startTimeoutMs: 60,
        pollIntervalMs: 5
    });
    return { helper, docker, states, fetchImpl };
}

describe('FlareSolverrDocker image', () => {
    it('pins the version of the image', () => {
        expect(FLARESOLVERR_VERSION).toBe('v3.5.2');
        expect(FLARESOLVERR_IMAGE).toBe('ghcr.io/flaresolverr/flaresolverr:v3.5.2');
    });

    it('starts as missing, with the pinned version', () => {
        const { helper } = setup();
        expect(helper.state).toEqual({ id: 'flaresolverr', status: 'missing', version: 'v3.5.2', bytesDone: 0, bytesTotal: 0, percent: 0, error: null });
        expect(helper.isReady).toBe(false);
        expect(helper.status).toBe('stopped');
        expect(helper.baseUrl).toBeNull();
        expect(helper.error).toBeNull();
        expect(helper.failure).toBeNull();
    });

    it('is ready at once when the image is there, and pulls nothing', async () => {
        const { helper, docker, states } = setup({ imagePresent: true });
        const state = await helper.prepare();
        expect(state).toEqual({ id: 'flaresolverr', status: 'ready', version: 'v3.5.2', bytesDone: 0, bytesTotal: 0, percent: 100, error: null });
        expect(helper.isReady).toBe(true);
        expect(docker.calls).toEqual([
            ['version', '--format', '{{.Server.Version}}'],
            ['image', 'inspect', '--format', '{{.Id}}', FLARESOLVERR_IMAGE]
        ]);
        expect(states).toEqual([state]);
    });

    it('pulls the image when it is not there, and tells how many layers are done', async () => {
        const { helper, docker, states } = setup({ imagePresent: false });
        const state = await helper.prepare();
        expect(docker.calls.at(-1)).toEqual(['pull', FLARESOLVERR_IMAGE]);
        expect(states.map((item) => {
            return [item.status, item.bytesDone, item.bytesTotal, item.percent];
        })).toEqual([
            ['downloading', 0, 0, 0],
            ['downloading', 0, 1, 0],
            ['downloading', 0, 2, 0],
            ['downloading', 1, 2, 50],
            ['downloading', 2, 2, 100],
            ['ready', 2, 2, 100]
        ]);
        expect(state).toMatchObject({ status: 'ready', percent: 100, error: null });
        expect(helper.failure).toBeNull();
    });

    it('does not pull twice when asked twice at once', async () => {
        const { helper, docker } = setup({ imagePresent: false });
        const [first, second] = await Promise.all([helper.prepare(), helper.prepare()]);
        expect(first).toBe(second);
        expect(
            docker.calls.filter((call) => {
                return call[0] === 'pull';
            })
        ).toHaveLength(1);
    });

    it('says Docker is missing, with what Docker answered, when it does not answer', async () => {
        const { helper, docker, states } = setup({ dockerMissing: true });
        const state = await helper.prepare();
        expect(state).toMatchObject({ status: 'error', error: { code: 'DOCKER_MISSING', message: 'docker: command not found' } });
        expect(helper.failure).toEqual({ code: 'no-docker', message: 'docker: command not found' });
        expect(helper.isReady).toBe(false);
        expect(docker.calls).toEqual([['version', '--format', '{{.Server.Version}}']]);
        expect(states).toHaveLength(1);
    });

    it('says what went wrong when the image cannot be pulled, and tries again next time', async () => {
        const { helper } = setup({ imagePresent: false, pullFails: true });
        const state = await helper.prepare();
        expect(state).toMatchObject({ status: 'error', error: { code: 'DOWNLOAD_FAILED', message: 'Error response from daemon: manifest unknown' } });
        expect(helper.failure).toEqual({ code: 'start-failed', message: 'Error response from daemon: manifest unknown' });
        await helper.prepare();
        expect(helper.failure).toEqual({ code: 'start-failed', message: 'Error response from daemon: manifest unknown' });
    });

    it('clears the problem when it is prepared again and it works', async () => {
        const docker = fakeDocker({ dockerMissing: true });
        let runner = docker.runner;
        const working = fakeDocker({ imagePresent: true });
        const helper = new FlareSolverrDocker({
            docker: (args, onLine) => {
                return runner(args, onLine);
            }
        });
        await helper.prepare();
        expect(helper.failure).not.toBeNull();
        runner = working.runner;
        await helper.prepare();
        expect(helper.failure).toBeNull();
        expect(helper.state).toMatchObject({ status: 'ready', error: null });
    });
});

describe('FlareSolverrDocker container', () => {
    it('runs the container on this machine only, on a port of its own, and answers with its address', async () => {
        const { helper, docker } = setup({ imagePresent: true });
        await helper.prepare();
        await expect(helper.ensureRunning()).resolves.toBe(ADDRESS);
        expect(helper.status).toBe('running');
        expect(helper.baseUrl).toBe(ADDRESS);
        expect(docker.calls).toContainEqual([
            'run',
            '--detach',
            '--rm',
            '--label',
            FLARESOLVERR_CONTAINER_LABEL,
            '--name',
            'pullwave-test',
            '--publish',
            '127.0.0.1:45900:8191',
            '--env',
            'LOG_LEVEL=info',
            FLARESOLVERR_IMAGE
        ]);
    });

    function withContainers(listing: string, alive: number[]) {
        const docker = fakeDocker({ imagePresent: true });
        const calls = docker.calls;
        const helper = new FlareSolverrDocker({
            docker: (args, onLine) => {
                if (args[0] === 'ps') {
                    calls.push(args);
                    return Promise.resolve({ code: 0, stdout: listing, stderr: '' });
                }
                return docker.runner(args, onLine);
            },
            isProcessAlive: (pid) => {
                return alive.includes(pid);
            },
            fetchImpl: okFetch(),
            findFreePort: () => {
                return Promise.resolve(45900);
            }
        });
        return { helper, calls };
    }

    it('removes the containers of runs that are over, before it starts its own', async () => {
        const { helper, calls } = withContainers('old1 pullwave-flaresolverr-4001\nold2 pullwave-flaresolverr-4002\n', []);
        await helper.prepare();
        await helper.ensureRunning();
        const names = calls.map((call) => {
            return call[0];
        });
        expect(calls).toContainEqual(['ps', '--all', '--filter', `label=${FLARESOLVERR_CONTAINER_LABEL}`, '--format', '{{.ID}} {{.Names}}']);
        expect(calls).toContainEqual(['rm', '--force', 'old1', 'old2']);
        expect(names.indexOf('rm')).toBeLessThan(names.indexOf('run'));
    });

    it('leaves alone the container of another copy of the app that is still running', async () => {
        const { helper, calls } = withContainers('mine1 pullwave-flaresolverr-4001\nlive1 pullwave-flaresolverr-4002\n', [4002]);
        await helper.removeOrphans();
        expect(calls).toContainEqual(['rm', '--force', 'mine1']);
        expect(
            calls.some((call) => {
                return call.includes('live1');
            })
        ).toBe(false);
    });

    it('removes nothing when every container belongs to a copy that is running', async () => {
        const { helper, calls } = withContainers('live1 pullwave-flaresolverr-4002\n', [4002]);
        await helper.removeOrphans();
        expect(
            calls.filter((call) => {
                return call[0] === 'rm';
            })
        ).toEqual([]);
    });

    it('removes a container with no process id in its name, and the one left under its own process id', async () => {
        const { helper, calls } = withContainers(`odd1 flaresolverr-old\nself1 pullwave-flaresolverr-${String(process.pid)}\n`, [process.pid]);
        await helper.removeOrphans();
        expect(calls).toContainEqual(['rm', '--force', 'odd1', 'self1']);
    });

    it('ignores empty lines of the list', async () => {
        const { helper, calls } = withContainers('\n  \n', []);
        await helper.removeOrphans();
        expect(
            calls.filter((call) => {
                return call[0] === 'rm';
            })
        ).toEqual([]);
    });

    it('leaves the containers alone when it cannot list them', async () => {
        const docker = fakeDocker({ imagePresent: true });
        const calls = docker.calls;
        const helper = new FlareSolverrDocker({
            docker: (args, onLine) => {
                if (args[0] === 'ps') {
                    calls.push(args);
                    return Promise.resolve({ code: 1, stdout: '', stderr: 'no' });
                }
                return docker.runner(args, onLine);
            }
        });
        await helper.removeOrphans();
        expect(calls.map((call) => {
            return call[0];
        })).toEqual(['ps']);
    });

    it('starts once when asked twice at once', async () => {
        const { helper, docker } = setup({ imagePresent: true });
        await helper.prepare();
        const [first, second] = await Promise.all([helper.ensureRunning(), helper.ensureRunning()]);
        expect([first, second]).toEqual([ADDRESS, ADDRESS]);
        expect(
            docker.calls.filter((call) => {
                return call[0] === 'run';
            })
        ).toHaveLength(1);
        await expect(helper.ensureRunning()).resolves.toBe(ADDRESS);
        expect(
            docker.calls.filter((call) => {
                return call[0] === 'run';
            })
        ).toHaveLength(1);
    });

    it('prepares the image itself when it is started before it was prepared', async () => {
        const { helper, docker } = setup({ imagePresent: false });
        await expect(helper.ensureRunning()).resolves.toBe(ADDRESS);
        expect(docker.calls).toContainEqual(['pull', FLARESOLVERR_IMAGE]);
    });

    it('waits until it answers', async () => {
        let attempts = 0;
        const fetchImpl = vi.fn(() => {
            attempts += 1;
            return attempts < 3 ? Promise.reject(new Error('ECONNREFUSED')) : Promise.resolve(new Response('{}', { status: 200 }));
        }) as unknown as typeof fetch;
        const { helper } = setup({ imagePresent: true }, fetchImpl);
        await helper.prepare();
        await expect(helper.ensureRunning()).resolves.toBe(ADDRESS);
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        expect(fetchImpl).toHaveBeenCalledWith(`${ADDRESS}/`, { signal: expect.any(AbortSignal) });
    });

    it('stops the container it started', async () => {
        const { helper, docker } = setup({ imagePresent: true, containerId: 'abc123' });
        await helper.prepare();
        await helper.ensureRunning();
        await helper.stop();
        expect(docker.calls.at(-1)).toEqual(['stop', '--time', '3', 'abc123']);
        expect(helper.status).toBe('stopped');
        expect(helper.baseUrl).toBeNull();
        await helper.stop();
        expect(
            docker.calls.filter((call) => {
                return call[0] === 'stop';
            })
        ).toHaveLength(1);
    });

    it('removes the container and the image, and is as if it was never installed', async () => {
        const { helper, docker, states } = setup({ imagePresent: true, containerId: 'abc123' });
        await helper.prepare();
        await helper.ensureRunning();
        await helper.remove();
        expect(docker.calls.slice(-2)).toEqual([
            ['stop', '--time', '3', 'abc123'],
            ['rmi', FLARESOLVERR_IMAGE]
        ]);
        expect(helper.status).toBe('stopped');
        expect(helper.baseUrl).toBeNull();
        expect(helper.failure).toBeNull();
        expect(helper.state).toEqual({ id: 'flaresolverr', status: 'missing', version: FLARESOLVERR_VERSION, bytesDone: 0, bytesTotal: 0, percent: 0, error: null });
        expect(states.at(-1)).toEqual(helper.state);
    });

    it('removes the image even when no container was started, and forgets an earlier problem', async () => {
        const { helper, docker } = setup({ dockerMissing: true });
        await helper.prepare();
        expect(helper.failure).not.toBeNull();
        await helper.remove();
        expect(docker.calls.at(-1)).toEqual(['rmi', FLARESOLVERR_IMAGE]);
        expect(helper.failure).toBeNull();
        expect(helper.state.status).toBe('missing');
    });

    it('fails with Docker missing when it is started without Docker', async () => {
        const { helper } = setup({ dockerMissing: true });
        await expect(helper.ensureRunning()).rejects.toMatchObject({ code: 'NO_DOCKER', message: 'docker: command not found' });
        expect(helper.status).toBe('error');
        expect(helper.failure).toEqual({ code: 'no-docker', message: expect.stringContaining('docker: command not found') });
    });

    it('fails when the image cannot be pulled', async () => {
        const { helper } = setup({ imagePresent: false, pullFails: true });
        await expect(helper.ensureRunning()).rejects.toMatchObject({ code: 'PULL_FAILED' });
        expect(helper.status).toBe('error');
    });

    it('fails with what Docker said when the container does not start', async () => {
        const { helper, docker } = setup({ imagePresent: true, runFails: true });
        await helper.prepare();
        const failure = await helper.ensureRunning().catch((error: unknown) => {
            return error;
        });
        expect(failure).toBeInstanceOf(FlareSolverrDockerError);
        expect(failure).toMatchObject({ code: 'START_FAILED', message: 'docker: port is already allocated' });
        expect(helper.status).toBe('error');
        expect(helper.error).toBe('docker: port is already allocated');
        expect(helper.failure).toEqual({ code: 'start-failed', message: 'docker: port is already allocated' });
        // There was no container to read the log of or to stop.
        expect(
            docker.calls.filter((call) => {
                return call[0] === 'logs' || call[0] === 'stop';
            })
        ).toEqual([]);
    });

    it('clears the problem of a start that failed when the next start works', async () => {
        const broken = fakeDocker({ imagePresent: true, runFails: true });
        const working = fakeDocker({ imagePresent: true, containerId: 'good01' });
        let runner = broken.runner;
        const helper = new FlareSolverrDocker({
            docker: (args, onLine) => {
                return runner(args, onLine);
            },
            fetchImpl: okFetch(),
            findFreePort: () => {
                return Promise.resolve(45900);
            },
            containerName: 'pullwave-test',
            startTimeoutMs: 60,
            pollIntervalMs: 5
        });
        await helper.prepare();
        await expect(helper.ensureRunning()).rejects.toMatchObject({ code: 'START_FAILED' });
        expect(helper.failure).toEqual({ code: 'start-failed', message: 'docker: port is already allocated' });
        runner = working.runner;
        await expect(helper.ensureRunning()).resolves.toBe(ADDRESS);
        expect(helper.status).toBe('running');
        expect(helper.failure).toBeNull();
        expect(helper.error).toBeNull();
    });

    it('stops the container and keeps its log when it never answers', async () => {
        const fetchImpl = vi.fn(() => {
            return Promise.reject(new Error('ECONNREFUSED'));
        }) as unknown as typeof fetch;
        const { helper, docker } = setup({ imagePresent: true, containerId: 'dead01' }, fetchImpl);
        await helper.prepare();
        await expect(helper.ensureRunning()).rejects.toMatchObject({ code: 'START_FAILED', message: 'FlareSolverr did not become ready in time' });
        expect(helper.status).toBe('error');
        expect(helper.error).toBe('FlareSolverr did not become ready in time\nFlareSolverr log line');
        expect(docker.calls).toContainEqual(['logs', '--tail', '20', 'dead01']);
        expect(docker.calls.at(-1)).toEqual(['stop', '--time', '3', 'dead01']);
        expect(helper.failure).toEqual({ code: 'start-failed', message: 'FlareSolverr did not become ready in time\nFlareSolverr log line' });
    });

    it('ignores a server that answers with an error', async () => {
        const fetchImpl = vi.fn(() => {
            return Promise.resolve(new Response('no', { status: 503 }));
        }) as unknown as typeof fetch;
        const { helper } = setup({ imagePresent: true }, fetchImpl);
        await helper.prepare();
        await expect(helper.ensureRunning()).rejects.toMatchObject({ code: 'START_FAILED' });
    });
});

describe('createDockerRunner', () => {
    function fakeSpawn() {
        const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        const spawn = vi.fn(() => {
            return child as unknown as ChildProcess;
        });
        return { child, spawn: spawn as unknown as (command: string, args: string[], options: SpawnOptions) => ChildProcess, spied: spawn };
    }

    it('runs docker with the arguments, hidden and without input, and gives its output and code', async () => {
        const { child, spawn, spied } = fakeSpawn();
        const lines: string[] = [];
        const result = createDockerRunner(spawn)(['pull', 'image'], (line) => {
            lines.push(line);
        });
        child.stdout.write('first\nsecond\r\n');
        child.stderr.write('warning\n');
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        child.emit('close', 0);
        await expect(result).resolves.toEqual({ code: 0, stdout: 'first\nsecond\r\n', stderr: 'warning\n' });
        expect(lines).toEqual(['first', 'second', 'warning']);
        expect(spied).toHaveBeenCalledWith('docker', ['pull', 'image'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    });

    it('gives a code of null when docker cannot be run', async () => {
        const { child, spawn } = fakeSpawn();
        const result = createDockerRunner(spawn)(['version']);
        child.emit('error', new Error('spawn docker ENOENT'));
        child.emit('close', null);
        await expect(result).resolves.toEqual({ code: null, stdout: '', stderr: '' });
    });

    it('gives the code docker ended with', async () => {
        const { child, spawn } = fakeSpawn();
        const result = createDockerRunner(spawn)(['image', 'inspect', 'x']);
        child.emit('close', 1);
        await expect(result).resolves.toMatchObject({ code: 1 });
    });

    it('writes the command, each line of both outputs and the code to the log, once', async () => {
        const { child, spawn } = fakeSpawn();
        const { writer, calls } = createFakeLogWriter();
        const openLog = vi.fn(() => {
            return writer;
        });
        const result = createDockerRunner(spawn, openLog)(['pull', 'image']);
        child.stdout.write('first\nsec');
        child.stderr.write('warning\n');
        child.stdout.write('ond');
        await settle();
        child.emit('close', 0);
        child.emit('close', 0);
        await result;
        expect(openLog).toHaveBeenCalledTimes(1);
        expect(calls).toEqual([
            { method: 'command', program: 'docker', args: ['pull', 'image'] },
            { method: 'line', stream: 'stdout', text: 'first' },
            { method: 'line', stream: 'stderr', text: 'warning' },
            { method: 'line', stream: 'stdout', text: 'second' },
            { method: 'exit', code: 0, signal: undefined }
        ]);
    });

    it('writes why docker could not be run to the log, and not an exit too', async () => {
        const { child, spawn } = fakeSpawn();
        const { writer, calls } = createFakeLogWriter();
        const result = createDockerRunner(spawn, () => {
            return writer;
        })(['version']);
        child.emit('error', new Error('spawn docker ENOENT'));
        child.emit('close', null);
        await result;
        expect(calls).toEqual([
            { method: 'command', program: 'docker', args: ['version'] },
            { method: 'failure', message: 'could not start: spawn docker ENOENT' }
        ]);
    });

    it('writes to the log of FlareSolverr of the app by default', async () => {
        const { child, spawn } = fakeSpawn();
        const hub = new LogHub();
        const open = vi.spyOn(processLogs, 'open').mockImplementation((source) => {
            return hub.open(source);
        });
        const result = createDockerRunner(spawn)(['ps']);
        child.emit('close', 0);
        await result;
        expect(open).toHaveBeenCalledWith('flaresolverr');
        expect(
            hub.snapshot('flaresolverr').map((line) => {
                return [line.stream, line.text];
            })
        ).toEqual([
            ['command', 'docker ps'],
            ['event', 'exited with code 0']
        ]);
        open.mockRestore();
    });
});

describe('createContainerLogFollower', () => {
    it('follows the logs of the container with docker, writing the command, the lines of both outputs and the end', async () => {
        const child = makeDockerChild();
        const spawn = vi.fn(() => {
            return child as unknown as ChildProcess;
        });
        const { writer, calls } = createFakeLogWriter();
        createContainerLogFollower(spawn, () => {
            return writer;
        })('c0ffee');
        expect(spawn).toHaveBeenCalledWith('docker', ['logs', '--follow', 'c0ffee'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        child.stdout.write('2026-11-11 10:00:00 INFO     FlareSolverr 3.5.2\n2026-11-11 10:00:01 INFO     Serving on');
        child.stderr.write('2026-11-11 10:00:02 ERROR    Chrome crashed\n');
        await settle();
        child.emit('close', 0, null);
        expect(calls).toEqual([
            { method: 'command', program: 'docker', args: ['logs', '--follow', 'c0ffee'] },
            { method: 'line', stream: 'stdout', text: '2026-11-11 10:00:00 INFO     FlareSolverr 3.5.2' },
            { method: 'line', stream: 'stderr', text: '2026-11-11 10:00:02 ERROR    Chrome crashed' },
            { method: 'line', stream: 'stdout', text: '2026-11-11 10:00:01 INFO     Serving on' },
            { method: 'exit', code: 0, signal: null }
        ]);
    });

    it('stops following by ending docker, which is written as the signal that ended it', () => {
        const child = makeDockerChild();
        const { writer, calls } = createFakeLogWriter();
        const stop = createContainerLogFollower(
            () => {
                return child as unknown as ChildProcess;
            },
            () => {
                return writer;
            }
        )('abc');
        stop();
        expect(child.kill).toHaveBeenCalledTimes(1);
        expect(child.kill).toHaveBeenCalledWith();
        child.emit('close', null, 'SIGTERM');
        expect(calls.at(-1)).toEqual({ method: 'exit', code: null, signal: 'SIGTERM' });
    });

    it('writes why docker could not be run', () => {
        const child = makeDockerChild();
        const { writer, calls } = createFakeLogWriter();
        createContainerLogFollower(
            () => {
                return child as unknown as ChildProcess;
            },
            () => {
                return writer;
            }
        )('abc');
        child.emit('error', new Error('spawn docker ENOENT'));
        expect(calls).toEqual([
            { method: 'command', program: 'docker', args: ['logs', '--follow', 'abc'] },
            { method: 'failure', message: 'could not start: spawn docker ENOENT' }
        ]);
    });

    it('runs docker and writes to the log of FlareSolverr of the app by default', () => {
        const hub = new LogHub({
            now: () => {
                return 1_700_000_000_000;
            }
        });
        const open = vi.spyOn(processLogs, 'open').mockImplementation((source) => {
            return hub.open(source);
        });
        const stop = createContainerLogFollower()('def');
        expect(childProcess.spawn).toHaveBeenCalledWith('docker', ['logs', '--follow', 'def'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        expect(open).toHaveBeenCalledWith('flaresolverr');
        expect(hub.snapshot('flaresolverr')).toEqual([{ id: 1, at: 1_700_000_000_000, stream: 'command', text: 'docker logs --follow def' }]);
        stop();
        const child = childProcess.spawn.mock.results[0]?.value as FakeDockerChild;
        expect(child.kill).toHaveBeenCalledTimes(1);
        open.mockRestore();
    });
});

describe('FlareSolverrDocker logs of the container', () => {
    it('follows the logs of the container once it runs, and stops following when it stops', async () => {
        const { helper, docker } = setup({ imagePresent: true, containerId: 'abc123' });
        await helper.prepare();
        expect(docker.followed).toEqual([]);
        await helper.ensureRunning();
        expect(docker.followed).toEqual(['abc123']);
        expect(docker.unfollowed).toEqual([]);
        await helper.stop();
        expect(docker.unfollowed).toEqual(['abc123']);
        await helper.stop();
        expect(docker.unfollowed).toEqual(['abc123']);
    });

    it('keeps following while the container starts and stops when the start fails', async () => {
        const failing = vi.fn(() => {
            return Promise.resolve(new Response('', { status: 503 }));
        }) as unknown as typeof fetch;
        const { helper, docker } = setup({ imagePresent: true, containerId: 'dead01' }, failing);
        await helper.prepare();
        await expect(helper.ensureRunning()).rejects.toMatchObject({ code: 'START_FAILED' });
        expect(docker.followed).toEqual(['dead01']);
        expect(docker.unfollowed).toEqual(['dead01']);
    });

    it('follows nothing when the container does not start', async () => {
        const { helper, docker } = setup({ imagePresent: true, runFails: true });
        await helper.prepare();
        await expect(helper.ensureRunning()).rejects.toMatchObject({ code: 'START_FAILED' });
        expect(docker.followed).toEqual([]);
    });

    it('follows with docker when no follower is given', async () => {
        const docker = fakeDocker({ imagePresent: true, containerId: 'feed42' });
        const helper = new FlareSolverrDocker({
            docker: docker.runner,
            fetchImpl: okFetch(),
            findFreePort: () => {
                return Promise.resolve(45900);
            },
            pollIntervalMs: 5
        });
        await helper.prepare();
        await helper.ensureRunning();
        expect(childProcess.spawn).toHaveBeenCalledWith('docker', ['logs', '--follow', 'feed42'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        await helper.stop();
        const child = childProcess.spawn.mock.results[0]?.value as FakeDockerChild;
        expect(child.kill).toHaveBeenCalledTimes(1);
    });
});

describe('FlareSolverrDocker another version', () => {
    it('runs the version it is told to, pulling and starting that image', async () => {
        const docker = fakeDocker({ imagePresent: false });
        const helper = new FlareSolverrDocker({
            docker: docker.runner,
            fetchImpl: okFetch(),
            findFreePort: () => {
                return Promise.resolve(45900);
            },
            containerName: 'pullwave-test',
            version: 'v3.9.9',
            pollIntervalMs: 5
        });
        expect(helper.version).toBe('v3.9.9');
        expect(helper.state.version).toBe('v3.9.9');
        await helper.prepare();
        expect(docker.calls).toContainEqual(['pull', `${FLARESOLVERR_IMAGE_NAME}:v3.9.9`]);
        await helper.ensureRunning();
        expect(docker.calls.find((call) => {return call[0] === 'run'})?.at(-1)).toBe(`${FLARESOLVERR_IMAGE_NAME}:v3.9.9`);
    });

    it('is the version the app ships with when none is given', () => {
        expect(setup().helper.version).toBe(FLARESOLVERR_VERSION);
    });

    it('switches: pulls the new image, stops the container that runs, removes the old image and uses the new one from then on', async () => {
        const { helper, docker } = setup({ imagePresent: true, containerId: 'abc123' });
        await helper.prepare();
        await helper.ensureRunning();
        const state = await helper.switchTo('v3.9.9');
        expect(state).toMatchObject({ status: 'ready', version: 'v3.9.9' });
        expect(helper.version).toBe('v3.9.9');
        expect(helper.status).toBe('stopped');
        expect(helper.baseUrl).toBeNull();
        expect(docker.calls).toContainEqual(['stop', '--time', '3', 'abc123']);
        expect(docker.calls.at(-1)).toEqual(['rmi', FLARESOLVERR_IMAGE]);
        await helper.ensureRunning();
        expect(docker.calls.filter((call) => {return call[0] === 'run'}).at(-1)?.at(-1)).toBe(`${FLARESOLVERR_IMAGE_NAME}:v3.9.9`);
    });

    it('goes back to the old version, and keeps its image, when the new image cannot be pulled', async () => {
        const docker = fakeDocker({ imagePresent: true });
        const failing: typeof docker.runner = (args, onLine) => {
            if (args[0] === 'image' && args[4] !== FLARESOLVERR_IMAGE) {
                return Promise.resolve({ code: 1, stdout: '', stderr: 'No such image' });
            }
            if (args[0] === 'pull') {
                return Promise.resolve({ code: 1, stdout: '', stderr: 'manifest unknown' });
            }
            return docker.runner(args, onLine);
        };
        const helper = new FlareSolverrDocker({ docker: failing, fetchImpl: okFetch(), pollIntervalMs: 5 });
        await helper.prepare();
        const state = await helper.switchTo('v9.9.9');
        expect(helper.version).toBe(FLARESOLVERR_VERSION);
        expect(state).toMatchObject({ status: 'ready', version: FLARESOLVERR_VERSION, error: { code: 'DOWNLOAD_FAILED' } });
        expect(helper.failure).toBeNull();
        expect(docker.calls.some((call) => {return call[0] === 'rmi'})).toBe(false);
    });

    it('goes back to not installed when it was not installed and the new image cannot be pulled', async () => {
        const { helper } = setup({ dockerMissing: true });
        const state = await helper.switchTo('v9.9.9');
        expect(helper.version).toBe(FLARESOLVERR_VERSION);
        expect(state.status).toBe('missing');
    });
});

describe('who a container of the helper belongs to', () => {
    it('reads the process id at the end of the name', () => {
        expect(ownerPid('pullwave-flaresolverr-1464512')).toBe(1464512);
        expect(ownerPid(' pullwave-flaresolverr-77 ')).toBe(77);
    });

    it('has none for a name that does not end with one', () => {
        expect(ownerPid('flaresolverr')).toBeNull();
        expect(ownerPid('pullwave-flaresolverr-x1')).toBeNull();
        expect(ownerPid('')).toBeNull();
    });

    it('knows whether a process is alive', () => {
        expect(defaultIsProcessAlive(process.pid)).toBe(true);
        expect(defaultIsProcessAlive(2 ** 22 + 12345)).toBe(false);
    });

    it('takes a process it is not allowed to signal for alive', () => {
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
            throw Object.assign(new Error('not allowed'), { code: 'EPERM' });
        });
        expect(defaultIsProcessAlive(1)).toBe(true);
        kill.mockRestore();
    });
});

