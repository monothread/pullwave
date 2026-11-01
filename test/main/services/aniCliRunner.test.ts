import type { AniDownloadProgress } from '@shared/anime';
import { asDownloadResult, runAniCli, type AniRunOutcome } from '@main/services/aniCliRunner';
import { EXIT_GRACE_MS, KILL_ESCALATION_MS } from '@main/services/ytdlpRunner';
import { createFakeChild } from '../../helpers/fakeChild';

const NOW = 1_700_000_000_000;
const COMMAND = '/app/resources/bin/ani/busybox sh /app/resources/bin/ani/ani-cli naruto';
const ESC = String.fromCharCode(27);
const ENV = { PATH: '/data/anime/tools' };

function start(platform: NodeJS.Platform = 'linux') {
    const fake = createFakeChild();
    Object.assign(fake.child, { pid: 4321 });
    const spawnFn = vi.fn(() => {
        return fake.child;
    });
    const killGroup = vi.fn();
    const progress: AniDownloadProgress[] = [];
    const destinations: string[] = [];
    const handle = runAniCli({
        binary: '/app/resources/bin/ani/busybox',
        args: ['sh', '/app/resources/bin/ani/ani-cli', 'naruto'],
        env: ENV,
        spawnFn,
        platform,
        killGroup,
        onProgress: (value) => {
            progress.push(value);
        },
        onDestination: (path) => {
            destinations.push(path);
        }
    });
    return { fake, spawnFn, killGroup, progress, destinations, handle };
}

beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('runAniCli', () => {
    it('spawns the command with its arguments and environment', () => {
        const { spawnFn } = start();
        expect(spawnFn).toHaveBeenCalledTimes(1);
        expect(spawnFn).toHaveBeenCalledWith('/app/resources/bin/ani/busybox', ['sh', '/app/resources/bin/ani/ani-cli', 'naruto'], ENV);
    });

    it('collects the menu choices apart from the output', async () => {
        const { fake, handle } = start();
        fake.stderr.write('PULLWAVE_MENU\tSelect anime: \t1 Naruto\n');
        fake.stderr.write('PULLWAVE_MENU\tSelect anime: \t2 Naruto Shippuden\n');
        fake.stderr.write(`${ESC}[2K\r${ESC}[1;31mInvalid anime selection${ESC}[0m\n`);
        fake.emitter.emit('close', 1);

        expect(await handle.result).toEqual({
            status: 'done',
            value: {
                exitCode: 1,
                output: 'Invalid anime selection\n',
                menuChoices: [
                    { prompt: 'Select anime:', choice: '1 Naruto' },
                    { prompt: 'Select anime:', choice: '2 Naruto Shippuden' }
                ],
                destination: null
            }
        });
    });

    it('reports progress and the destination file from stdout', async () => {
        const { fake, handle, progress, destinations } = start();
        fake.stdout.write('[download] Destination: /home/me/Anime/Naruto Episode 1.mp4\n');
        fake.stdout.write('[download]  50.0% of ~ 100.00MiB at 2.00MiB/s ETA 00:25 (frag 1/2)\r');
        fake.stdout.write('[download] 100% of  100.00MiB in 00:00:50 at 2.00MiB/s\n');
        fake.emitter.emit('close', 0);

        const result = await handle.result;
        expect(progress).toEqual([
            { percent: 50, totalBytes: 100 * 1024 ** 2, speed: '2.00MiB/s', eta: '00:25' },
            { percent: 100, totalBytes: 100 * 1024 ** 2, speed: '2.00MiB/s', eta: null }
        ]);
        expect(destinations).toEqual(['/home/me/Anime/Naruto Episode 1.mp4']);
        expect(result).toEqual({
            status: 'done',
            value: {
                exitCode: 0,
                output: '[download] Destination: /home/me/Anime/Naruto Episode 1.mp4\n',
                menuChoices: [],
                destination: '/home/me/Anime/Naruto Episode 1.mp4'
            }
        });
    });

    it('joins a line that arrives in pieces and flushes the last one without a line break', async () => {
        const { fake, handle } = start();
        fake.stdout.write('Checking dep');
        fake.stdout.write('endencies...\nlinks fetched');
        fake.emitter.emit('close', 0);

        const result = await handle.result;
        expect(result.status === 'done' && result.value.output).toBe('Checking dependencies...\nlinks fetched\n');
    });

    it('works without progress and destination callbacks', async () => {
        const fake = createFakeChild();
        const handle = runAniCli({ binary: 'busybox', args: [], env: ENV, spawnFn: () => { return fake.child; } });
        fake.stdout.write('[download] Destination: /a.mp4\n');
        fake.stdout.write('[download]  1.0% of 1.00MiB at 1.00MiB/s ETA 00:01\n');
        fake.emitter.emit('close', 0);
        expect(await handle.result).toEqual({
            status: 'done',
            value: { exitCode: 0, output: '[download] Destination: /a.mp4\n', menuChoices: [], destination: '/a.mp4' }
        });
    });

    it('resolves with an error when the program cannot be started', async () => {
        const { fake, handle } = start();
        const failure = Object.assign(new Error('spawn busybox ENOENT'), { code: 'ENOENT', errno: -2, syscall: 'spawn busybox' });
        fake.emitter.emit('error', failure);
        expect(await handle.result).toEqual({
            status: 'error',
            error: {
                code: 'BINARY_MISSING',
                raw: 'spawn busybox ENOENT',
                details: { occurredAt: NOW, errorName: 'Error', stack: failure.stack, systemCode: 'ENOENT', operation: 'Running ani-cli', command: COMMAND }
            }
        });
    });

    it('ignores what happens after it resolved', async () => {
        const { fake, handle } = start();
        fake.emitter.emit('close', 0);
        const first = await handle.result;
        fake.emitter.emit('error', new Error('late'));
        fake.emitter.emit('close', 1);
        expect(await handle.result).toBe(first);
    });

    describe('cancel', () => {
        it('ends the process group and resolves as cancelled', async () => {
            vi.useFakeTimers();
            const { fake, handle, killGroup } = start();
            handle.cancel();
            expect(killGroup).toHaveBeenCalledTimes(1);
            expect(killGroup).toHaveBeenCalledWith(4321, 'SIGTERM');

            fake.emitter.emit('close', null);
            expect(await handle.result).toEqual({ status: 'cancelled' });
        });

        it('kills what is still alive after the grace period', () => {
            vi.useFakeTimers();
            const { handle, killGroup } = start();
            handle.cancel();
            vi.advanceTimersByTime(KILL_ESCALATION_MS);
            expect(killGroup.mock.calls).toEqual([
                [4321, 'SIGTERM'],
                [4321, 'SIGKILL']
            ]);
        });

        it('does not kill again once the process is gone', async () => {
            vi.useFakeTimers();
            const { fake, handle, killGroup } = start();
            handle.cancel();
            fake.emitter.emit('close', null);
            await handle.result;
            vi.advanceTimersByTime(KILL_ESCALATION_MS * 2);
            expect(killGroup).toHaveBeenCalledTimes(1);
        });

        it('only cancels once', () => {
            vi.useFakeTimers();
            const { handle, killGroup } = start();
            handle.cancel();
            handle.cancel();
            expect(killGroup).toHaveBeenCalledTimes(1);
        });

        it('does nothing after the run is over', async () => {
            const { fake, handle, killGroup } = start();
            fake.emitter.emit('close', 0);
            await handle.result;
            handle.cancel();
            expect(killGroup).not.toHaveBeenCalled();
        });

        it('kills the process alone when the group cannot be reached', () => {
            vi.useFakeTimers();
            const { fake, handle, killGroup } = start();
            killGroup.mockImplementation(() => {
                throw new Error('ESRCH');
            });
            handle.cancel();
            expect(fake.kill).toHaveBeenCalledWith('SIGTERM');
        });
    });

    describe('process that exits with the pipes still open', () => {
        it('gives the result after the grace period and ends what is left', async () => {
            vi.useFakeTimers();
            const { fake, handle, killGroup } = start();
            const stdoutDestroy = vi.spyOn(fake.stdout, 'destroy');
            const stderrDestroy = vi.spyOn(fake.stderr, 'destroy');
            fake.stdout.write('links fetched\n');
            fake.emitter.emit('exit', 0);

            vi.advanceTimersByTime(EXIT_GRACE_MS);

            expect(killGroup).toHaveBeenCalledWith(4321, 'SIGKILL');
            expect(stdoutDestroy).toHaveBeenCalledTimes(1);
            expect(stderrDestroy).toHaveBeenCalledTimes(1);
            expect(await handle.result).toEqual({
                status: 'done',
                value: { exitCode: 0, output: 'links fetched\n', menuChoices: [], destination: null }
            });
        });

        it('does not wait for the grace period when the pipes close in time', async () => {
            vi.useFakeTimers();
            const { fake, handle, killGroup } = start();
            fake.emitter.emit('exit', 0);
            fake.emitter.emit('close', 0);
            await handle.result;
            vi.advanceTimersByTime(EXIT_GRACE_MS * 2);
            expect(killGroup).not.toHaveBeenCalled();
        });

        it('resolves as cancelled when it was cancelled meanwhile', async () => {
            vi.useFakeTimers();
            const { fake, handle } = start();
            handle.cancel();
            fake.emitter.emit('exit', null);
            vi.advanceTimersByTime(EXIT_GRACE_MS);
            expect(await handle.result).toEqual({ status: 'cancelled' });
        });
    });

    it('uses the default spawn when none is given', () => {
        const handle = runAniCli({ binary: '/nonexistent/busybox-for-test', args: [], env: ENV });
        return expect(handle.result).resolves.toMatchObject({ status: 'error', error: { code: 'BINARY_MISSING' } });
    });
});

describe('asDownloadResult', () => {
    const outcome: AniRunOutcome = { exitCode: 0, output: 'ok\n', menuChoices: [], destination: '/a.mp4' };

    it('keeps a clean exit as done', () => {
        expect(asDownloadResult(outcome)).toEqual({ status: 'done', value: outcome });
    });

    it('turns a failed exit into the error ani-cli reported', () => {
        expect(asDownloadResult({ ...outcome, exitCode: 1, output: 'No sources found for sub!\n' })).toEqual({
            status: 'error',
            error: { code: 'NO_SOURCES', raw: 'No sources found for sub!', details: { occurredAt: NOW, exitCode: 1, operation: 'Downloading an episode with ani-cli' } }
        });
    });

    it('treats a missing exit code as a failure', () => {
        expect(asDownloadResult({ ...outcome, exitCode: null, output: '' })).toEqual({
            status: 'error',
            error: { code: 'UNKNOWN', raw: 'ani-cli exited with code unknown', details: { occurredAt: NOW, operation: 'Downloading an episode with ani-cli' } }
        });
    });
});
