import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import {
    buildAppImageRestart,
    buildRelaunchOptions,
    cleanAppImageEnvironment,
    restartApplication,
    type Environment,
    type RestartDependencies
} from '@main/services/relaunch';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

const APP_IMAGE = '/home/lucas/.apps/pullwave.appimage';
const ARGV = ['/tmp/.mount_pullwave_abc/pullwave', '--no-sandbox', '--user-data-dir=/tmp/x'];
const MOUNT = '/tmp/.mount_pullwave_abc';

afterEach(() => {
    cleanTempDirs();
});

describe('buildRelaunchOptions', () => {
    it('keeps the command line arguments without the executable', () => {
        expect(buildRelaunchOptions(ARGV)).toEqual({ args: ['--no-sandbox', '--user-data-dir=/tmp/x'] });
    });

    it('drops the flag of the start at login, so a restart is not taken for one', () => {
        expect(buildRelaunchOptions([...ARGV, '--autostart'])).toEqual({ args: ['--no-sandbox', '--user-data-dir=/tmp/x'] });
    });

    it('returns no arguments when the app was started without any', () => {
        expect(buildRelaunchOptions(['/usr/bin/app'])).toEqual({ args: [] });
    });
});

describe('cleanAppImageEnvironment', () => {
    it('drops the variables of the closing AppImage and the entries that point into its mount', () => {
        const env: Environment = {
            APPDIR: MOUNT,
            ARGV0: APP_IMAGE,
            OWD: '/home/lucas',
            APPIMAGE: APP_IMAGE,
            HOME: '/home/lucas',
            PATH: `${MOUNT}:${MOUNT}/usr/sbin:/usr/local/bin:/usr/bin`,
            LD_LIBRARY_PATH: `${MOUNT}/usr/lib`,
            XDG_DATA_DIRS: `${MOUNT}/usr/share/:/usr/share`
        };
        expect(cleanAppImageEnvironment(env)).toEqual({
            APPIMAGE: APP_IMAGE,
            HOME: '/home/lucas',
            PATH: '/usr/local/bin:/usr/bin',
            XDG_DATA_DIRS: '/usr/share'
        });
    });

    it('does not change the environment it was given', () => {
        const env: Environment = { APPDIR: MOUNT, PATH: `${MOUNT}:/usr/bin` };
        cleanAppImageEnvironment(env);
        expect(env).toEqual({ APPDIR: MOUNT, PATH: `${MOUNT}:/usr/bin` });
    });

    it('keeps the path lists untouched when there is no mount to remove', () => {
        expect(cleanAppImageEnvironment({ PATH: '/usr/bin:/bin', LD_LIBRARY_PATH: '/opt/lib' })).toEqual({ PATH: '/usr/bin:/bin', LD_LIBRARY_PATH: '/opt/lib' });
    });
});

describe('buildAppImageRestart', () => {
    it('runs a shell that waits for the app, passing the pid, the AppImage and its arguments as plain arguments', () => {
        const restart = buildAppImageRestart(APP_IMAGE, { APPDIR: MOUNT }, ARGV, 4321);
        expect(restart.command).toBe('sh');
        expect(restart.args[0]).toBe('-c');
        expect(restart.args.slice(2)).toEqual(['pullwave-restart', '4321', APP_IMAGE, '--no-sandbox', '--user-data-dir=/tmp/x']);
        expect(restart.env).toEqual({});
    });

    it('drops the flag of the start at login from the arguments of the new instance', () => {
        const restart = buildAppImageRestart(APP_IMAGE, {}, [...ARGV, '--autostart'], 4321);
        expect(restart.args.slice(2)).toEqual(['pullwave-restart', '4321', APP_IMAGE, '--no-sandbox', '--user-data-dir=/tmp/x']);
    });

    it('never puts the path or the arguments inside the script text', () => {
        const hostile = '/tmp/a b; touch /tmp/pwned #.appimage';
        const restart = buildAppImageRestart(hostile, {}, ['/x', '$(touch /tmp/pwned)'], 1);
        expect(restart.args[1]).not.toContain('pwned');
        expect(restart.args.slice(3)).toEqual(['1', hostile, '$(touch /tmp/pwned)']);
    });
});

describe('restartApplication', () => {
    function setup(overrides: Partial<RestartDependencies> = {}) {
        const child = { on: vi.fn(), unref: vi.fn() };
        const spawnProcess = vi.fn(() => {
            return child;
        });
        const relaunch = vi.fn();
        restartApplication({ relaunch, spawn: spawnProcess, env: { APPIMAGE: APP_IMAGE, APPDIR: MOUNT, HOME: '/home/lucas' }, argv: ARGV, pid: 99, ...overrides });
        return { child, spawnProcess, relaunch };
    }

    it('starts the AppImage again through a detached shell and leaves Electron\'s own relaunch alone', () => {
        const { child, spawnProcess, relaunch } = setup();
        expect(spawnProcess).toHaveBeenCalledTimes(1);
        const [command, args, options] = spawnProcess.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
        expect(command).toBe('sh');
        expect(args.slice(2)).toEqual(['pullwave-restart', '99', APP_IMAGE, '--no-sandbox', '--user-data-dir=/tmp/x']);
        expect(options).toEqual({ detached: true, stdio: 'ignore', env: { APPIMAGE: APP_IMAGE, HOME: '/home/lucas' } });
        expect(child.unref).toHaveBeenCalledTimes(1);
        expect(relaunch).not.toHaveBeenCalled();
    });

    it('ignores an error of the shell process instead of crashing the app', () => {
        const { child } = setup();
        expect(child.on).toHaveBeenCalledWith('error', expect.any(Function));
        const handler = child.on.mock.calls[0]?.[1] as () => unknown;
        expect(handler()).toBeUndefined();
    });

    it('uses Electron\'s relaunch when the app is not an AppImage', () => {
        const { spawnProcess, relaunch } = setup({ env: { HOME: '/home/lucas' } });
        expect(spawnProcess).not.toHaveBeenCalled();
        expect(relaunch).toHaveBeenCalledTimes(1);
        expect(relaunch).toHaveBeenCalledWith({ args: ['--no-sandbox', '--user-data-dir=/tmp/x'] });
    });

    it('falls back to Electron\'s relaunch when the shell cannot be started', () => {
        const relaunch = vi.fn();
        restartApplication({
            relaunch,
            spawn: () => {
                throw new Error('spawn sh ENOENT');
            },
            env: { APPIMAGE: APP_IMAGE },
            argv: ARGV,
            pid: 99
        });
        expect(relaunch).toHaveBeenCalledWith({ args: ['--no-sandbox', '--user-data-dir=/tmp/x'] });
    });
});

describe.skipIf(process.platform === 'win32')('the shell that starts the AppImage again', () => {
    function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
        return new Promise((resolve) => {
            const startedAt = Date.now();
            const check = (): void => {
                if (condition()) {
                    resolve(true);
                } else if (Date.now() - startedAt > timeoutMs) {
                    resolve(false);
                } else {
                    setTimeout(check, 50);
                }
            };
            check();
        });
    }

    function fakeAppImage(dir: string): { path: string; marker: string } {
        const path = join(dir, 'fake app.appimage');
        const marker = join(dir, 'started.txt');
        writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$@" > '${marker}'\nenv | grep -E '^APPDIR=' >> '${marker}'\ntrue\n`);
        chmodSync(path, 0o755);
        return { path, marker };
    }

    it('starts the program only after the app has closed, with the same arguments and a clean environment', async () => {
        const dir = makeTempDir();
        const { path, marker } = fakeAppImage(dir);
        const closing = spawn('sleep', ['1'], { stdio: 'ignore' });
        const restart = buildAppImageRestart(path, { PATH: process.env.PATH, APPDIR: MOUNT }, ['/x', '--flag', 'with space'], closing.pid ?? 0);
        spawn(restart.command, restart.args, { detached: true, stdio: 'ignore', env: restart.env }).unref();

        await new Promise((resolve) => {
            setTimeout(resolve, 400);
        });
        expect(existsSync(marker)).toBe(false);

        expect(await waitFor(() => {
            return existsSync(marker);
        }, 5000)).toBe(true);
        expect(closing.exitCode ?? closing.signalCode).not.toBeNull();
        expect(readFileSync(marker, 'utf-8')).toBe('--flag\nwith space\n');
    });

    it('starts the program at once when the app is already gone', async () => {
        const dir = makeTempDir();
        const { path, marker } = fakeAppImage(dir);
        const gone = spawn('true', [], { stdio: 'ignore' });
        await new Promise((resolve) => {
            gone.on('exit', resolve);
        });
        const restart = buildAppImageRestart(path, { PATH: process.env.PATH }, ['/x'], gone.pid ?? 0);
        spawn(restart.command, restart.args, { detached: true, stdio: 'ignore', env: restart.env }).unref();
        expect(await waitFor(() => {
            return existsSync(marker);
        }, 3000)).toBe(true);
    });

    it('does not run anything hidden in the path of the AppImage', async () => {
        const dir = makeTempDir();
        const gone = spawn('true', [], { stdio: 'ignore' });
        await new Promise((resolve) => {
            gone.on('exit', resolve);
        });
        const pwned = join(dir, 'pwned');
        const restart = buildAppImageRestart(`${dir}/x; touch ${pwned}`, { PATH: process.env.PATH }, ['/x', `$(touch ${pwned})`], gone.pid ?? 0);
        spawn(restart.command, restart.args, { detached: true, stdio: 'ignore', env: restart.env }).unref();
        await new Promise((resolve) => {
            setTimeout(resolve, 800);
        });
        expect(existsSync(pwned)).toBe(false);
    });
});
