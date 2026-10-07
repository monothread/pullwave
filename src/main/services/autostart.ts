import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AUTOSTART_FLAG } from './startupLaunch';

export const DESKTOP_ENTRY_NAME = 'pullwave.desktop';

export interface AutostartFiles {
    write: (path: string, content: string) => void;
    remove: (path: string) => void;
}

export interface AutostartDependencies {
    platform: NodeJS.Platform;
    // False where the app is not an installed one (a development run), so that no entry pointing at it is left behind.
    canRegister: boolean;
    // The program the login entry starts: the .AppImage when there is one, otherwise the executable of the app.
    command: string;
    // The folder of the login entries of the Linux desktops (~/.config/autostart).
    autostartDir: string;
    files: AutostartFiles;
    // Windows keeps the entry in the registry, which Electron writes.
    setLoginItem: (enabled: boolean, args: string[]) => void;
}

export const defaultAutostartFiles: AutostartFiles = {
    write: (path, content) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, 'utf-8');
    },
    remove: (path) => {
        rmSync(path, { force: true });
    }
};

// The value of an Exec key: the program between quotes (with " ` $ \ escaped), then the string escaping of the file format (a backslash
// is written twice), and % doubled so it is not read as a field code.
export function quoteExecArgument(value: string): string {
    const quoted = value.replace(/(["`$\\])/g, '\\$1');
    return `"${quoted.replace(/\\/g, '\\\\').replace(/%/g, '%%')}"`;
}

export function buildDesktopEntry(command: string): string {
    return [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Pullwave',
        'Comment=Cyberpunk yt-dlp GUI and video downloader',
        `Exec=${quoteExecArgument(command)} ${AUTOSTART_FLAG}`,
        'Icon=pullwave',
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true',
        ''
    ].join('\n');
}

export class Autostart {
    constructor(private readonly deps: AutostartDependencies) {}

    // Writes or removes the login entry so that it matches the setting (and points at the app as it is now, wherever it was moved to).
    sync(enabled: boolean): void {
        if (!this.deps.canRegister) {
            return;
        }
        if (this.deps.platform === 'linux') {
            this.syncDesktopEntry(enabled);
            return;
        }
        if (this.deps.platform === 'win32') {
            this.deps.setLoginItem(enabled, [AUTOSTART_FLAG]);
        }
    }

    private syncDesktopEntry(enabled: boolean): void {
        const path = join(this.deps.autostartDir, DESKTOP_ENTRY_NAME);
        try {
            if (enabled) {
                this.deps.files.write(path, buildDesktopEntry(this.deps.command));
            } else {
                this.deps.files.remove(path);
            }
        } catch {
            // A folder that cannot be written must not stop the app; the entry just does not change.
        }
    }
}
