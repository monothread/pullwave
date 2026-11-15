import type { TraySupport } from '@shared/types';
import { translateMain } from './language';
import { defaultExecFile, type ExecFileFn } from './binaryLocator';

export const WATCHER_NAME = 'org.kde.StatusNotifierWatcher';

export const WATCHER_CHECK_ARGS = [
    'call',
    '--session',
    '--dest',
    'org.freedesktop.DBus',
    '--object-path',
    '/org/freedesktop/DBus',
    '--method',
    'org.freedesktop.DBus.NameHasOwner',
    WATCHER_NAME
];

export async function hasStatusNotifierWatcher(exec: ExecFileFn = defaultExecFile): Promise<boolean | null> {
    try {
        const output = await exec('gdbus', WATCHER_CHECK_ARGS);
        return /true/.test(output);
    } catch {
        return null;
    }
}

export function isGnomeDesktop(desktop: string | undefined): boolean {
    return (desktop ?? '')
        .toLowerCase()
        .split(':')
        .includes('gnome');
}

export async function checkTraySupport(
    env: NodeJS.ProcessEnv = process.env,
    exec: ExecFileFn = defaultExecFile,
    platform: NodeJS.Platform = process.platform
): Promise<TraySupport> {
    if (platform !== 'linux') {
        return { available: true, reason: null };
    }
    const watcher = await hasStatusNotifierWatcher(exec);
    if (watcher === true) {
        return { available: true, reason: null };
    }
    if (isGnomeDesktop(env.XDG_CURRENT_DESKTOP)) {
        return { available: false, reason: translateMain('tray.noTray') };
    }
    return { available: true, reason: null };
}
