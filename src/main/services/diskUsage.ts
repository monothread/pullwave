import type { Dirent } from 'node:fs';
import { lstat, readdir, stat, statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DiskSection, DiskSiblingPlacement, DiskUsage, Settings } from '@shared/types';
import { DEFAULT_ANIME_FOLDER, isInsideDirectory } from './animeFiles';
import { createConcurrencyLimit, type ConcurrencyLimit } from './concurrencyLimit';
import { DEFAULT_MANGA_FOLDER } from './manga/mangaFiles';

export const WALK_CONCURRENCY = 8;

export interface DiskFolder {
    section: DiskSection;
    directory: string;
}

export function siblingSection(section: DiskSection): DiskSection {
    return section === 'anime' ? 'manga' : 'anime';
}

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

export function folderSize(directory: string, limit: ConcurrencyLimit = createConcurrencyLimit(WALK_CONCURRENCY)): Promise<number> {
    return walkSize(directory, limit);
}

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

export function readSectionDiskUsage(section: DiskSection, settings: Settings, defaultDownloadDir: string): Promise<DiskUsage | null> {
    const other = siblingSection(section);
    return readDiskUsage(
        { section, directory: sectionDirectory(section, settings, defaultDownloadDir) },
        { section: other, directory: sectionDirectory(other, settings, defaultDownloadDir) }
    );
}
