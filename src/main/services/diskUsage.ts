import { lstat, readdir, statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DiskSection, DiskUsage, Settings } from '@shared/types';
import { DEFAULT_ANIME_FOLDER } from './animeFiles';
import { DEFAULT_MANGA_FOLDER } from './manga/mangaFiles';

// The folder a section keeps its files in: the one of the settings, or the default one inside the downloads folder of the system.
export function sectionDirectory(section: DiskSection, settings: Settings, defaultDownloadDir: string): string {
    const chosen = section === 'anime' ? settings.animeDownloadDir : settings.mangaDirectory;
    const fallback = section === 'anime' ? DEFAULT_ANIME_FOLDER : DEFAULT_MANGA_FOLDER;
    return chosen.length > 0 ? chosen : join(defaultDownloadDir, fallback);
}

// The size of everything inside a folder. Links are counted as links (not followed), and what cannot be read counts as zero, so one
// locked folder does not hide the size of the rest.
export async function folderSize(directory: string): Promise<number> {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch {
        return 0;
    }
    let total = 0;
    for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            total += await folderSize(path);
            continue;
        }
        try {
            total += (await lstat(path)).size;
        } catch {
            // The file went away while the folder was read.
        }
    }
    return total;
}

// A folder that was not created yet is on the disk of the closest folder above it that exists.
async function existingAncestor(directory: string): Promise<string> {
    let current = directory;
    for (;;) {
        try {
            await lstat(current);
            return current;
        } catch {
            const parent = dirname(current);
            if (parent === current) {
                return current;
            }
            current = parent;
        }
    }
}

// Null when the disk cannot be read.
export async function readDiskUsage(directory: string): Promise<DiskUsage | null> {
    try {
        const stats = await statfs(await existingAncestor(directory));
        return {
            directory,
            totalBytes: stats.blocks * stats.bsize,
            freeBytes: stats.bavail * stats.bsize,
            folderBytes: await folderSize(directory)
        };
    } catch {
        return null;
    }
}
