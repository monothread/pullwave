import { rmdirSync, rmSync } from 'node:fs';
import { dirname, join, posix, win32 } from 'node:path';
import { MAX_SEASON } from '@shared/series';
import type { Settings } from '@shared/types';
import { subtitleFilesOf, type SubtitleFileSystem } from './subtitleFiles';

export const DEFAULT_ANIME_FOLDER = 'Pullwave Anime';
export const MAX_FOLDER_NAME_LENGTH = 100;
export const MIN_FOLDER_NAME_LENGTH = 20;
export const WINDOWS_PATH_BUDGET = 240;
const FORBIDDEN_FILE_CHARACTERS = new RegExp(`[<>:"/\\\\|?*${String.fromCharCode(0)}-${String.fromCharCode(31)}]`, 'g');
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export interface FolderNameOptions {
    platform?: NodeJS.Platform;
    maxLength?: number;
}

function pathFor(platform: NodeJS.Platform): typeof posix {
    return platform === 'win32' ? win32 : posix;
}

export function subtitlePathFor(videoPath: string): string {
    const extension = posix.extname(videoPath);
    return `${extension.length > 0 ? videoPath.slice(0, -extension.length) : videoPath}.vtt`;
}

export function filesOfEpisode(videoPath: string, files?: SubtitleFileSystem): string[] {
    return [...new Set([videoPath, subtitlePathFor(videoPath), ...subtitleFilesOf(videoPath, files), metadataPathFor(videoPath)])];
}

export function animeFolderName(title: string, options: FolderNameOptions = {}): string {
    const { platform = process.platform, maxLength = MAX_FOLDER_NAME_LENGTH } = options;
    let cleaned = title.replace(FORBIDDEN_FILE_CHARACTERS, '_').trim().replace(/^\.+/, '').slice(0, maxLength).trim();
    if (platform === 'win32') {
        cleaned = cleaned.replace(/[. ]+$/, '');
        cleaned = WINDOWS_RESERVED_NAME.test(cleaned) ? `_${cleaned}` : cleaned;
    }
    return cleaned.length > 0 ? cleaned : 'anime';
}

export function animeFileName(title: string, episode: string): string {
    return `${title.replace(FORBIDDEN_FILE_CHARACTERS, '_')} Episode ${episode}.mp4`;
}

export const METADATA_FILE_NAME = 'pullwave.json';

export function metadataPathFor(videoPath: string): string {
    return join(dirname(videoPath), METADATA_FILE_NAME);
}

export const EPISODE_FOLDER_PREFIX = 'Episode ';

export function episodeFolderName(episode: string): string {
    return `${EPISODE_FOLDER_PREFIX}${episode}`;
}

export function episodeDownloadDirectory(animeDirectory: string, episode: string, platform: NodeJS.Platform = process.platform): string {
    return pathFor(platform).join(animeDirectory, episodeFolderName(episode));
}

export function episodeFolderOf(videoPath: string, episode: string, platform: NodeJS.Platform = process.platform): string | null {
    const path = pathFor(platform);
    const folder = path.dirname(videoPath);
    return path.basename(folder) === episodeFolderName(episode) ? folder : null;
}

export function animeFolderOf(videoPath: string, episode: string, platform: NodeJS.Platform = process.platform): string {
    const path = pathFor(platform);
    const episodeFolder = episodeFolderOf(videoPath, episode, platform);
    return path.dirname(episodeFolder ?? videoPath);
}

export function seriesFolderOf(animeFolder: string, platform: NodeJS.Platform = process.platform): string | null {
    const path = pathFor(platform);
    return new RegExp(`^${SEASON_FOLDER_PREFIX}\\d+$`).test(path.basename(animeFolder)) ? path.dirname(animeFolder) : null;
}

export function isInsideDirectory(child: string, parent: string, platform: NodeJS.Platform = process.platform): boolean {
    const path = pathFor(platform);
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    const leavesParent = relative === '..' || relative.startsWith(`..${path.sep}`);
    return !leavesParent && !path.isAbsolute(relative);
}

export function folderNameBudget(baseDir: string, title: string, platform: NodeJS.Platform = process.platform, extraLevels = 0): number {
    if (platform !== 'win32') {
        return MAX_FOLDER_NAME_LENGTH;
    }
    const used = baseDir.length + 1 + 1 + extraLevels + episodeFolderName('999').length + 1 + animeFileName(title, '999').length;
    return Math.min(MAX_FOLDER_NAME_LENGTH, Math.max(MIN_FOLDER_NAME_LENGTH, WINDOWS_PATH_BUDGET - used));
}

export function animeBaseDirectory(settings: Settings, defaultDownloadDir: string, platform: NodeJS.Platform = process.platform): string {
    return settings.animeDownloadDir.length > 0 ? settings.animeDownloadDir : pathFor(platform).join(defaultDownloadDir, DEFAULT_ANIME_FOLDER);
}

function expectedFolderName(parent: string, title: string, platform: NodeJS.Platform): string {
    return animeFolderName(title, { platform, maxLength: folderNameBudget(parent, title, platform) });
}

export const SEASON_FOLDER_PREFIX = 'Season ';

export function seasonFolderName(season: number): string {
    return `${SEASON_FOLDER_PREFIX}${season}`;
}

export function seasonDownloadDirectory(baseDir: string, series: string, season: number, title: string, platform: NodeJS.Platform = process.platform): string {
    const extra = seasonFolderName(MAX_SEASON).length + 1;
    const budget = Math.max(MIN_FOLDER_NAME_LENGTH, folderNameBudget(baseDir, title, platform, extra));
    const seriesFolder = animeFolderName(series, { platform, maxLength: budget });
    return pathFor(platform).join(baseDir, seriesFolder, seasonFolderName(season));
}

export function animeDownloadDirectory(baseDir: string, title: string, platform: NodeJS.Platform = process.platform): string {
    return pathFor(platform).join(baseDir, expectedFolderName(baseDir, title, platform));
}

export function animeFoldersToRemove(title: string, filePaths: readonly string[], baseDir: string, platform: NodeJS.Platform = process.platform): string[] {
    const path = pathFor(platform);
    const candidates = [
        ...filePaths.map((file) => {
            return path.dirname(file);
        }),
        animeDownloadDirectory(baseDir, title, platform)
    ];
    return [...new Set(candidates)].filter((folder) => {
        return path.basename(folder) === expectedFolderName(path.dirname(folder), title, platform);
    });
}

export function foldersWithoutOthers(folders: readonly string[], otherFiles: readonly string[], platform: NodeJS.Platform = process.platform): string[] {
    const path = pathFor(platform);
    return folders.filter((folder) => {
        const prefix = folder.endsWith(path.sep) ? folder : `${folder}${path.sep}`;
        return !otherFiles.some((file) => {
            return file.startsWith(prefix);
        });
    });
}

function defaultRemove(path: string): void {
    rmSync(path, { recursive: true, force: true });
}

function defaultRemoveEmpty(path: string): void {
    rmdirSync(path);
}

export function removeEmptyDirectories(paths: readonly string[], remove: (path: string) => void = defaultRemoveEmpty): void {
    paths.forEach((path) => {
        try {
            remove(path);
        } catch {
            return;
        }
    });
}

export function removeDirectories(paths: readonly string[], remove: (path: string) => void = defaultRemove): void {
    paths.forEach((path) => {
        try {
            remove(path);
        } catch {
            return;
        }
    });
}
