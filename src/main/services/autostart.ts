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
    canRegister: boolean;
    command: string;
    autostartDir: string;
    files: AutostartFiles;
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
