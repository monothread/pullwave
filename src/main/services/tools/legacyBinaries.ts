import { lstatSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const LEGACY_FILES: readonly string[] = ['yt-dlp', 'yt-dlp.exe', 'yt-dlp.tmp', 'yt-dlp.exe.tmp', 'ani-cli', 'ani-cli.tmp'];

function isPlainFile(path: string): boolean {
    try {
        return lstatSync(path).isFile();
    } catch {
        return false;
    }
}

export function removeLegacyBinaries(dataDir: string, keep: readonly string[] = []): string[] {
    const folder = join(dataDir, 'bin');
    let present: string[];
    try {
        present = readdirSync(folder);
    } catch {
        return [];
    }
    const protectedPaths = keep
        .filter((path) => {
            return path.length > 0;
        })
        .map((path) => {
            return resolve(path);
        });
    const removed: string[] = [];
    present
        .filter((name) => {
            const path = join(folder, name);
            return LEGACY_FILES.includes(name) && isPlainFile(path) && !protectedPaths.includes(resolve(path));
        })
        .forEach((name) => {
            try {
                rmSync(join(folder, name));
                removed.push(name);
            } catch {
                // Kept: the next start tries again.
            }
        });
    try {
        rmdirSync(folder);
    } catch {
        // Not empty (something else is there) or not removable: kept.
    }
    return removed;
}
