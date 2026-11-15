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
const APPIMAGE_VARIABLES = ['APPDIR', 'ARGV0', 'OWD'];
const PATH_LIST_VARIABLES = ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'GSETTINGS_SCHEMA_DIR'];

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
