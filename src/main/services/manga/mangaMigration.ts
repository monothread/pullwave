import { copyFileSync, constants, existsSync, mkdirSync, readdirSync, rmdirSync, rmSync, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { hasChapterFile } from '@shared/manga';
import type { LibraryManga, MangaChapterRecord, MangaMigrationFailure, MangaMigrationProgress } from '@shared/manga';
import { isInsideDirectory, removeEmptyDirectories } from '../animeFiles';
import type { MangaDb } from './mangaDb';

export interface MangaMigrationFileSystem {
    size: (path: string) => number | null;
    exists: (path: string) => boolean;
    isDirectory: (path: string) => boolean;
    listFiles: (directory: string) => string[];
    makeDirectory: (path: string) => void;
    copy: (from: string, to: string) => Promise<void>;
    removeFile: (path: string) => void;
    removeEmptyDirectory: (path: string) => void;
}

function listRecursively(directory: string, prefix: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const relative = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
        return entry.isDirectory() ? listRecursively(`${directory}/${entry.name}`, relative) : [relative];
    });
}

export const defaultMangaMigrationFileSystem: MangaMigrationFileSystem = {
    size: (path) => {
        try {
            const stats = statSync(path);
            return stats.isFile() ? stats.size : null;
        } catch {
            return null;
        }
    },
    exists: (path) => {
        return existsSync(path);
    },
    isDirectory: (path) => {
        try {
            return statSync(path).isDirectory();
        } catch {
            return false;
        }
    },
    listFiles: (directory) => {
        return listRecursively(directory, '');
    },
    makeDirectory: (path) => {
        mkdirSync(path, { recursive: true });
    },
    copy: (from, to) => {
        return new Promise((resolve, reject) => {
            setImmediate(() => {
                try {
                    copyFileSync(from, to, constants.COPYFILE_EXCL);
                    resolve();
                } catch (error) {
                    reject(error instanceof Error ? error : new Error(String(error)));
                }
            });
        });
    },
    removeFile: (path) => {
        rmSync(path, { force: true });
    },
    removeEmptyDirectory: (path) => {
        rmdirSync(path);
    }
};

export interface MangaMigrationDependencies {
    db: Pick<MangaDb, 'list' | 'relinkChapters'>;
    files?: MangaMigrationFileSystem;
    platform: NodeJS.Platform;
    currentDirectory: string;
    newDirectory: string;
    saveDirectory: (directory: string) => void;
    onProgress: (progress: MangaMigrationProgress) => void;
}

export type MangaMigrationOutcome = { ok: true; chapters: number; files: number } | { ok: false; reason: Exclude<MangaMigrationFailure, 'cancelled' | 'busy'> };

interface PlannedFile {
    from: string;
    to: string;
}

interface PlannedChapter {
    chapterId: number;
    oldPath: string;
    oldSizeBytes: number | null;
    newPath: string;
    oldMangaFolder: string;
    files: PlannedFile[];
}

function pathFor(platform: NodeJS.Platform): typeof posix {
    return platform === 'win32' ? win32 : posix;
}

function filesOfChapter(oldPath: string, newPath: string, files: MangaMigrationFileSystem, platform: NodeJS.Platform): PlannedFile[] {
    const path = pathFor(platform);
    if (!files.isDirectory(oldPath)) {
        return [{ from: oldPath, to: newPath }];
    }
    return files.listFiles(oldPath).map((relative) => {
        const parts = relative.split('/');
        return { from: path.join(oldPath, ...parts), to: path.join(newPath, ...parts) };
    });
}

function planChapters(library: readonly LibraryManga[], dependencies: MangaMigrationDependencies, files: MangaMigrationFileSystem): PlannedChapter[] {
    const { platform, currentDirectory, newDirectory } = dependencies;
    const path = pathFor(platform);
    return library.flatMap((manga) => {
        return manga.chapters.flatMap((chapter: MangaChapterRecord) => {
            const oldPath = chapter.filePath;
            if (!hasChapterFile(chapter.status) || oldPath === null || !files.exists(oldPath) || !isInsideDirectory(oldPath, currentDirectory, platform)) {
                return [];
            }
            const oldMangaFolder = path.dirname(oldPath);
            const newPath = path.join(newDirectory, path.relative(path.resolve(currentDirectory), path.resolve(oldPath)));
            return [{ chapterId: chapter.id, oldPath, oldSizeBytes: chapter.sizeBytes, newPath, oldMangaFolder, files: filesOfChapter(oldPath, newPath, files, platform) }];
        });
    });
}

function hasConflict(chapters: readonly PlannedChapter[], files: MangaMigrationFileSystem): boolean {
    const destinations = new Set<string>();
    return chapters
        .flatMap((chapter) => {
            return chapter.files;
        })
        .some((file) => {
            if (destinations.has(file.to) || files.exists(file.to)) {
                return true;
            }
            destinations.add(file.to);
            return false;
        });
}

function missingFolders(directory: string, files: MangaMigrationFileSystem, platform: NodeJS.Platform): string[] {
    const missing: string[] = [];
    let current = directory;
    const path = pathFor(platform);
    while (!files.exists(current) && path.dirname(current) !== current) {
        missing.push(current);
        current = path.dirname(current);
    }
    return missing;
}

function byDepth(folders: Iterable<string>): string[] {
    return [...folders].sort((first, second) => {
        return second.length - first.length;
    });
}

function undoCopy(copied: readonly string[], created: ReadonlySet<string>, files: MangaMigrationFileSystem): void {
    copied.forEach((file) => {
        try {
            files.removeFile(file);
        } catch {
            return;
        }
    });
    byDepth(created).forEach((folder) => {
        try {
            files.removeEmptyDirectory(folder);
        } catch {
            return;
        }
    });
}

function copiesAreComplete(chapters: readonly PlannedChapter[], files: MangaMigrationFileSystem): boolean {
    return chapters
        .flatMap((chapter) => {
            return chapter.files;
        })
        .every((file) => {
            const original = files.size(file.from);
            return original !== null && files.size(file.to) === original;
        });
}

function sizeOfMoved(chapter: PlannedChapter, files: MangaMigrationFileSystem): number | null {
    const sizes = chapter.files.map((file) => {
        return files.size(file.to);
    });
    return sizes.every((size): size is number => {
        return size !== null;
    })
        ? sizes.reduce((total, size) => {
              return total + size;
          }, 0)
        : null;
}

function foldersToClean(chapters: readonly PlannedChapter[], files: MangaMigrationFileSystem, dependencies: MangaMigrationDependencies): string[] {
    const path = pathFor(dependencies.platform);
    const folders = new Set<string>();
    chapters.forEach((chapter) => {
        folders.add(chapter.oldMangaFolder);
        if (files.isDirectory(chapter.oldPath)) {
            chapter.files.forEach((file) => {
                let current = path.dirname(file.from);
                while (path.resolve(current) !== path.resolve(chapter.oldMangaFolder) && isInsideDirectory(current, chapter.oldPath, dependencies.platform)) {
                    folders.add(current);
                    current = path.dirname(current);
                }
            });
            folders.add(chapter.oldPath);
        }
    });
    return [
        ...byDepth(folders).filter((folder) => {
            return path.resolve(folder) !== path.resolve(dependencies.currentDirectory);
        }),
        dependencies.currentDirectory
    ];
}

export async function migrateMangaFolder(dependencies: MangaMigrationDependencies): Promise<MangaMigrationOutcome> {
    const { db, platform, currentDirectory, newDirectory } = dependencies;
    const files = dependencies.files ?? defaultMangaMigrationFileSystem;
    const path = pathFor(platform);
    if (path.resolve(newDirectory) === path.resolve(currentDirectory)) {
        return { ok: false, reason: 'same' };
    }
    if (isInsideDirectory(newDirectory, currentDirectory, platform)) {
        return { ok: false, reason: 'inside' };
    }
    const chapters = planChapters(db.list(), dependencies, files);
    if (hasConflict(chapters, files)) {
        return { ok: false, reason: 'conflict' };
    }
    const plan = chapters.flatMap((chapter) => {
        return chapter.files;
    });
    const copied: string[] = [];
    const created = new Set<string>();
    dependencies.onProgress({ done: 0, total: plan.length });
    try {
        for (const file of plan) {
            const folder = path.dirname(file.to);
            missingFolders(folder, files, platform).forEach((missing) => {
                created.add(missing);
            });
            files.makeDirectory(folder);
            await files.copy(file.from, file.to);
            copied.push(file.to);
            dependencies.onProgress({ done: copied.length, total: plan.length });
        }
        if (!copiesAreComplete(chapters, files)) {
            throw new Error('A copy is not like its original.');
        }
    } catch {
        undoCopy(copied, created, files);
        return { ok: false, reason: 'failed' };
    }
    try {
        db.relinkChapters(
            chapters.map((chapter) => {
                return { chapterId: chapter.chapterId, filePath: chapter.newPath, sizeBytes: sizeOfMoved(chapter, files) };
            })
        );
        dependencies.saveDirectory(newDirectory);
    } catch {
        db.relinkChapters(
            chapters.map((chapter) => {
                return { chapterId: chapter.chapterId, filePath: chapter.oldPath, sizeBytes: chapter.oldSizeBytes };
            })
        );
        undoCopy(copied, created, files);
        return { ok: false, reason: 'failed' };
    }
    removeOldFiles(plan, foldersToClean(chapters, files, dependencies), files);
    return { ok: true, chapters: chapters.length, files: plan.length };
}

function removeOldFiles(plan: readonly PlannedFile[], folders: readonly string[], files: MangaMigrationFileSystem): void {
    plan.forEach((file) => {
        try {
            files.removeFile(file.from);
        } catch {
            return;
        }
    });
    removeEmptyDirectories(folders, (folder) => {
        files.removeEmptyDirectory(folder);
    });
}
