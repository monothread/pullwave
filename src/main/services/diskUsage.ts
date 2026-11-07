import type { Dirent } from 'node:fs';
import { lstat, readdir, stat, statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DiskSection, DiskSiblingPlacement, DiskUsage, Settings } from '@shared/types';
import { DEFAULT_ANIME_FOLDER, isInsideDirectory } from './animeFiles';
import { createConcurrencyLimit, type ConcurrencyLimit } from './concurrencyLimit';
import { DEFAULT_MANGA_FOLDER } from './manga/mangaFiles';

// How many reads of the disk are asked at once while the folders are added up. The pool of threads of the system is small (four), so
// a few more than that keeps it busy without leaving the rest of the app (the downloads writing files) waiting for its turn.
export const WALK_CONCURRENCY = 8;

// A folder of a section: where it is and which section keeps its files in it.
export interface DiskFolder {
    section: DiskSection;
    directory: string;
}

export function siblingSection(section: DiskSection): DiskSection {
    return section === 'anime' ? 'manga' : 'anime';
}

// The folder a section keeps its files in: the one of the settings, or the default one inside the downloads folder of the system.
export function sectionDirectory(section: DiskSection, settings: Settings, defaultDownloadDir: string): string {
    const chosen = section === 'anime' ? settings.animeDownloadDir : settings.mangaDirectory;
    const fallback = section === 'anime' ? DEFAULT_ANIME_FOLDER : DEFAULT_MANGA_FOLDER;
    return chosen.length > 0 ? chosen : join(defaultDownloadDir, fallback);
}

async function entrySize(path: string, isDirectory: boolean, limit: ConcurrencyLimit): Promise<number> {
    if (isDirectory) {
        return walkSize(path, limit);
    }
    try {
        return (await limit(() => {
            return lstat(path);
        })).size;
    } catch {
        // The file went away while the folder was read.
        return 0;
    }
}

async function walkSize(directory: string, limit: ConcurrencyLimit): Promise<number> {
    let entries: Dirent[];
    try {
        entries = await limit(() => {
            return readdir(directory, { withFileTypes: true });
        });
    } catch {
        return 0;
    }
    const sizes = await Promise.all(
        entries.map((entry) => {
            return entrySize(join(directory, entry.name), entry.isDirectory(), limit);
        })
    );
    return sizes.reduce((total, size) => {
        return total + size;
    }, 0);
}

// The size of everything inside a folder, with the folders inside it read side by side (a few reads at once, see WALK_CONCURRENCY).
// Links are counted as links (not followed), and what cannot be read counts as zero, so one locked folder does not hide the size of
// the rest. Folders measured with the same `limit` share its places.
export function folderSize(directory: string, limit: ConcurrencyLimit = createConcurrencyLimit(WALK_CONCURRENCY)): Promise<number> {
    return walkSize(directory, limit);
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

// The disk a folder is on, told by the number the system gives it; null when it cannot be told.
async function diskOf(directory: string): Promise<number | null> {
    try {
        return (await stat(await existingAncestor(directory))).dev;
    } catch {
        return null;
    }
}

function samePath(first: string, second: string): boolean {
    return isInsideDirectory(first, second) && isInsideDirectory(second, first);
}

// The same folder, or one inside the other: what is in the inner one is in the outer one too.
function foldersOverlap(first: string, second: string): boolean {
    return isInsideDirectory(first, second) || isInsideDirectory(second, first);
}

async function placementOf(directory: string, siblingDirectory: string): Promise<DiskSiblingPlacement> {
    if (foldersOverlap(directory, siblingDirectory)) {
        return 'overlap';
    }
    const [disk, siblingDisk] = await Promise.all([diskOf(directory), diskOf(siblingDirectory)]);
    return disk !== null && disk === siblingDisk ? 'same-disk' : 'other-disk';
}

// The disk of a folder, what the folder takes in it and what the folder of the other section takes. Null when the disk cannot be read.
// The two folders are added up at the same time, sharing the places of one limit; the same folder is not read twice.
export async function readDiskUsage(folder: DiskFolder, sibling: DiskFolder): Promise<DiskUsage | null> {
    try {
        const stats = await statfs(await existingAncestor(folder.directory));
        const limit = createConcurrencyLimit(WALK_CONCURRENCY);
        const sameFolder = samePath(folder.directory, sibling.directory);
        const [folderBytes, siblingBytes, placement] = await Promise.all([
            folderSize(folder.directory, limit),
            sameFolder ? Promise.resolve(0) : folderSize(sibling.directory, limit),
            placementOf(folder.directory, sibling.directory)
        ]);
        return {
            directory: folder.directory,
            totalBytes: stats.blocks * stats.bsize,
            freeBytes: stats.bavail * stats.bsize,
            folderBytes,
            sibling: { section: sibling.section, directory: sibling.directory, bytes: sameFolder ? folderBytes : siblingBytes, placement }
        };
    } catch {
        return null;
    }
}

// The disk of the folder of a section, as the settings say now, with the folder of the other section next to it.
export function readSectionDiskUsage(section: DiskSection, settings: Settings, defaultDownloadDir: string): Promise<DiskUsage | null> {
    const other = siblingSection(section);
    return readDiskUsage(
        { section, directory: sectionDirectory(section, settings, defaultDownloadDir) },
        { section: other, directory: sectionDirectory(other, settings, defaultDownloadDir) }
    );
}
