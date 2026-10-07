import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { withoutAutostartFlag } from './startupLaunch';

export type Environment = Record<string, string | undefined>;

export interface RelaunchOptions {
    args: string[];
}

export interface AppImageRestart {
    command: string;
    args: string[];
    env: Environment;
}

export interface RestartDependencies {
    relaunch: (options: RelaunchOptions) => void;
    spawn?: (command: string, args: string[], options: SpawnOptions) => Pick<ChildProcess, 'unref' | 'on'>;
    env: Environment;
    argv: readonly string[];
    pid: number;
}

const WAIT_STEP_SECONDS = '0.2';
const MAX_WAIT_STEPS = 150;
// Variables whose entries point into the mount of the instance that is closing; the new AppImage sets its own.
const APPIMAGE_VARIABLES = ['APPDIR', 'ARGV0', 'OWD'];
const PATH_LIST_VARIABLES = ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'GSETTINGS_SCHEMA_DIR'];

// $1 is the pid of the closing app, $2 the program to start and the rest its arguments. Everything reaches the shell as
// arguments, never spliced into the script, so nothing in a path or argument can be run as a command.
const WAIT_THEN_START_SCRIPT = [
    'steps=0',
    `while kill -0 "$1" 2>/dev/null && [ "$steps" -lt ${MAX_WAIT_STEPS} ]; do sleep ${WAIT_STEP_SECONDS}; steps=$((steps + 1)); done`,
    'shift',
    'exec "$@"'
].join('\n');

export function buildRelaunchOptions(argv: readonly string[]): RelaunchOptions {
    return { args: withoutAutostartFlag(argv.slice(1)) };
}

function withoutMountEntries(list: string, mountDir: string): string {
    return list
        .split(':')
        .filter((entry) => {
            return entry.length > 0 && !entry.startsWith(mountDir);
        })
        .join(':');
}

// The environment for the new instance without what the AppImage runtime of the closing one put there.
export function cleanAppImageEnvironment(env: Environment): Environment {
    const mountDir = env.APPDIR;
    const cleaned: Environment = { ...env };
    APPIMAGE_VARIABLES.forEach((name) => {
        delete cleaned[name];
    });
    if (mountDir) {
        PATH_LIST_VARIABLES.forEach((name) => {
            const value = cleaned[name];
            const kept = value === undefined ? '' : withoutMountEntries(value, mountDir);
            if (kept.length > 0) {
                cleaned[name] = kept;
            } else {
                delete cleaned[name];
            }
        });
    }
    return cleaned;
}

// Starting an AppImage mounts it through the setuid fusermount, which Linux refuses to a process created by Electron's own
// app.relaunch (it inherits no_new_privs from the Chromium sandbox): "Cannot mount AppImage, please check your FUSE setup".
// So a small shell, created by the main process, waits for the app to close and starts the .AppImage.
export function buildAppImageRestart(appImage: string, env: Environment, argv: readonly string[], pid: number): AppImageRestart {
    return {
        command: 'sh',
        args: ['-c', WAIT_THEN_START_SCRIPT, 'pullwave-restart', String(pid), appImage, ...withoutAutostartFlag(argv.slice(1))],
        env: cleanAppImageEnvironment(env)
    };
}

function startAppImageAgain(restart: AppImageRestart, spawn: NonNullable<RestartDependencies['spawn']>): void {
    const child = spawn(restart.command, restart.args, { detached: true, stdio: 'ignore', env: restart.env });
    child.on('error', () => {
        return undefined;
    });
    child.unref();
}

// Arranges for the app to start again once it closes; the caller then quits the app.
export function restartApplication(deps: RestartDependencies): void {
    const appImage = deps.env.APPIMAGE;
    if (!appImage) {
        deps.relaunch(buildRelaunchOptions(deps.argv));
        return;
    }
    try {
        startAppImageAgain(buildAppImageRestart(appImage, deps.env, deps.argv, deps.pid), deps.spawn ?? nodeSpawn);
    } catch {
        deps.relaunch(buildRelaunchOptions(deps.argv));
    }
}
