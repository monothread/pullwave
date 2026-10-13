import { lstatSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// What the versions before the programs were downloaded by the app left in <userData>/bin: the yt-dlp and the ani-cli an update saved (and the
// temporary file of one that was cut). Nothing reads them any more.
export const LEGACY_FILES: readonly string[] = ['yt-dlp', 'yt-dlp.exe', 'yt-dlp.tmp', 'yt-dlp.exe.tmp', 'ani-cli', 'ani-cli.tmp'];

// Whether the path is a plain file that is there (a link, a folder or something that is gone is not).
function isPlainFile(path: string): boolean {
    try {
        return lstatSync(path).isFile();
    } catch {
        return false;
    }
}

// Deletes those files (only those, only when each is there and is a plain file, and never one the user points to in the settings: `keep`) and
// the folder when nothing else is in it. Returns the names it deleted. What cannot be deleted is left (it is not worth stopping the app for).
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
