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

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | null {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'string' ? code : null;
}

export function removeLegacyBinaries(
    dataDir: string,
    keep: readonly string[] = [],
    onError?: (message: string) => void,
    removeFile: (path: string) => void = (path) => {
        rmSync(path);
    }
): string[] {
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
            const target = join(folder, name);
            try {
                removeFile(target);
                removed.push(name);
            } catch (error) {
                onError?.(`Could not remove legacy binary ${target}: ${errorMessage(error)}`);
            }
        });
    try {
        rmdirSync(folder);
    } catch (error) {
        const code = errorCode(error);
        if (code !== 'ENOTEMPTY' && code !== 'ENOENT') {
            onError?.(`Could not remove legacy folder ${folder}: ${errorMessage(error)}`);
        }
    }
    return removed;
}
