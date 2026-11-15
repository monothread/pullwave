import { copyFileSync, constants, existsSync, mkdirSync, rmdirSync, rmSync, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import type { AnimeMigrationFailure, AnimeMigrationProgress, LibraryAnime } from '@shared/anime';
import type { AnimeDb } from './animeDb';
import {
    animeDownloadDirectory,
    animeFolderOf,
    episodeDownloadDirectory,
    episodeFolderOf,
    filesOfEpisode,
    isInsideDirectory,
    removeEmptyDirectories,
    seasonDownloadDirectory,
    seriesFolderOf
} from './animeFiles';

export interface MigrationFileSystem {
    size: (path: string) => number | null;
    exists: (path: string) => boolean;
    makeDirectory: (path: string) => void;
    copy: (from: string, to: string) => Promise<void>;
    removeFile: (path: string) => void;
    removeEmptyDirectory: (path: string) => void;
}

export const defaultMigrationFileSystem: MigrationFileSystem = {
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

export interface MigrationDependencies {
    db: Pick<AnimeDb, 'list' | 'relinkEpisodes'>;
    filesOf?: (videoPath: string) => string[];
    files?: MigrationFileSystem;
    platform: NodeJS.Platform;
    currentDirectory: string;
    newDirectory: string;
    saveDirectory: (directory: string) => void;
    onProgress: (progress: AnimeMigrationProgress) => void;
}

export type MigrationOutcome = { ok: true; episodes: number; files: number } | { ok: false; reason: Exclude<AnimeMigrationFailure, 'cancelled' | 'busy'> };

interface PlannedFile {
    from: string;
    to: string;
}

interface PlannedEpisode {
    episodeId: number;
    number: string;
    oldVideoPath: string;
    oldSizeBytes: number | null;
    newVideoPath: string;
    files: PlannedFile[];
}

function pathFor(platform: NodeJS.Platform): typeof posix {
    return platform === 'win32' ? win32 : posix;
}

function newEpisodeFolder(anime: LibraryAnime, number: string, newDirectory: string, platform: NodeJS.Platform): string {
    const folder =
        anime.series !== null && anime.season !== null
            ? seasonDownloadDirectory(newDirectory, anime.series, anime.season, anime.title, platform)
            : animeDownloadDirectory(newDirectory, anime.title, platform);
    return episodeDownloadDirectory(folder, number, platform);
}

function withoutRepeats(planned: readonly PlannedFile[], platform: NodeJS.Platform): PlannedFile[] {
    const seen = new Set<string>();
    return planned.filter((file) => {
        const key = platform === 'win32' ? file.to.toLowerCase() : file.to;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function planEpisodes(library: readonly LibraryAnime[], dependencies: MigrationDependencies, files: MigrationFileSystem): PlannedEpisode[] {
    const { platform, newDirectory } = dependencies;
    const path = pathFor(platform);
    const filesOf = dependencies.filesOf ?? filesOfEpisode;
    return library.flatMap((anime) => {
        return anime.episodes.flatMap((episode) => {
            if (episode.status !== 'done' || episode.filePath === null || files.size(episode.filePath) === null) {
                return [];
            }
            const folder = newEpisodeFolder(anime, episode.number, newDirectory, platform);
            const planned = withoutRepeats(
                filesOf(episode.filePath)
                    .filter((file) => {
                        return files.exists(file);
                    })
                    .map((file) => {
                        return { from: file, to: path.join(folder, path.basename(file)) };
                    }),
                platform
            );
            return [
                {
                    episodeId: episode.id,
                    number: episode.number,
                    oldVideoPath: episode.filePath,
                    oldSizeBytes: episode.sizeBytes,
                    newVideoPath: path.join(folder, path.basename(episode.filePath)),
                    files: planned
                }
            ];
        });
    });
}

function hasConflict(episodes: readonly PlannedEpisode[], files: MigrationFileSystem): boolean {
    const destinations = new Set<string>();
    return episodes
        .flatMap((episode) => {
            return episode.files;
        })
        .some((file) => {
            if (destinations.has(file.to) || files.exists(file.to)) {
                return true;
            }
            destinations.add(file.to);
            return false;
        });
}

function missingFolders(directory: string, files: MigrationFileSystem, platform: NodeJS.Platform): string[] {
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

function undoCopy(copied: readonly string[], created: ReadonlySet<string>, files: MigrationFileSystem): void {
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

function copiesAreComplete(episodes: readonly PlannedEpisode[], files: MigrationFileSystem): boolean {
    return episodes
        .flatMap((episode) => {
            return episode.files;
        })
        .every((file) => {
            const original = files.size(file.from);
            return original !== null && files.size(file.to) === original;
        });
}

function foldersToClean(episodes: readonly PlannedEpisode[], dependencies: MigrationDependencies): string[] {
    const { platform, currentDirectory } = dependencies;
    const folders = new Set<string>();
    episodes.forEach((episode) => {
        const episodeFolder = episodeFolderOf(episode.oldVideoPath, episode.number, platform);
        const animeFolder = animeFolderOf(episode.oldVideoPath, episode.number, platform);
        const seriesFolder = seriesFolderOf(animeFolder, platform);
        const ownFolders = episodeFolder === null && !isInsideDirectory(animeFolder, currentDirectory, platform) ? [] : [animeFolder, seriesFolder];
        [episodeFolder, ...ownFolders].forEach((folder) => {
            if (folder !== null) {
                folders.add(folder);
            }
        });
    });
    const path = pathFor(platform);
    return [
        ...byDepth(folders).filter((folder) => {
            return folder !== path.resolve(currentDirectory);
        }),
        currentDirectory
    ];
}

export async function migrateAnimeFolder(dependencies: MigrationDependencies): Promise<MigrationOutcome> {
    const { db, platform, currentDirectory, newDirectory } = dependencies;
    const files = dependencies.files ?? defaultMigrationFileSystem;
    const path = pathFor(platform);
    if (path.resolve(newDirectory) === path.resolve(currentDirectory)) {
        return { ok: false, reason: 'same' };
    }
    if (isInsideDirectory(newDirectory, currentDirectory, platform)) {
        return { ok: false, reason: 'inside' };
    }
    const episodes = planEpisodes(db.list(), dependencies, files);
    if (hasConflict(episodes, files)) {
        return { ok: false, reason: 'conflict' };
    }
    const plan = episodes.flatMap((episode) => {
        return episode.files;
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
        if (!copiesAreComplete(episodes, files)) {
            throw new Error('A copy is not like its original.');
        }
    } catch {
        undoCopy(copied, created, files);
        return { ok: false, reason: 'failed' };
    }
    try {
        db.relinkEpisodes(
            episodes.map((episode) => {
                return { episodeId: episode.episodeId, filePath: episode.newVideoPath, sizeBytes: files.size(episode.newVideoPath) };
            })
        );
        dependencies.saveDirectory(newDirectory);
    } catch {
        db.relinkEpisodes(
            episodes.map((episode) => {
                return { episodeId: episode.episodeId, filePath: episode.oldVideoPath, sizeBytes: episode.oldSizeBytes };
            })
        );
        undoCopy(copied, created, files);
        return { ok: false, reason: 'failed' };
    }
    removeOldFiles(plan, foldersToClean(episodes, dependencies), files);
    return { ok: true, episodes: episodes.length, files: plan.length };
}

function removeOldFiles(plan: readonly PlannedFile[], folders: readonly string[], files: MigrationFileSystem): void {
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
