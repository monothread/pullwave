import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { readEpisodeMetadata } from './episodeMetadata';

export const VIDEO_EXTENSIONS: readonly string[] = ['.mp4', '.mkv', '.webm', '.m4v'];
export const MAX_SCAN_DEPTH = 3;
const EPISODE_FOLDER = /^Episode (\d+(?:\.\d+)?)$/;
const SEASON_FOLDER = /^Season (\d{1,2})$/;
const EPISODE_FILE = /^(.*\S) Episode (\d+(?:\.\d+)?)$/;

export interface ScanEntry {
    name: string;
    directory: boolean;
}

export interface ScanFileSystem {
    entries: (directory: string) => ScanEntry[];
    read: (path: string) => string | null;
}

export const defaultScanFileSystem: ScanFileSystem = {
    entries: (directory) => {
        try {
            return readdirSync(directory, { withFileTypes: true }).map((entry) => {
                return { name: entry.name, directory: entry.isDirectory() };
            });
        } catch {
            return [];
        }
    },
    read: (path) => {
        try {
            return readFileSync(path, 'utf-8');
        } catch {
            return null;
        }
    }
};

export interface ScannedEpisode {
    videoPath: string;
    title: string;
    number: string;
    query: string;
    searchIndex: number;
    progress: { positionSeconds: number; durationSeconds: number; watched: boolean } | null;
    series: string | null;
    season: number | null;
    seasonName: string | null;
}

export interface ScanResult {
    episodes: ScannedEpisode[];
    ignored: number;
}

function withoutExtension(fileName: string): string {
    const extension = extname(fileName);
    return extension.length > 0 ? fileName.slice(0, -extension.length) : fileName;
}

function episodeFromNames(videoPath: string): Pick<ScannedEpisode, 'title' | 'number'> | null {
    const folder = basename(dirname(videoPath));
    const fromFolder = EPISODE_FOLDER.exec(folder)?.[1];
    const fromFile = EPISODE_FILE.exec(withoutExtension(basename(videoPath)));
    const number = fromFolder ?? fromFile?.[2];
    if (number === undefined) {
        return null;
    }
    const parent = basename(dirname(dirname(videoPath)));
    const animeFolder = fromFolder === undefined ? folder : SEASON_FOLDER.test(parent) ? basename(dirname(dirname(dirname(videoPath)))) : parent;
    const title = fromFile && fromFile[2] === number ? fromFile[1] : animeFolder;
    return title !== undefined && title.length > 0 ? { title, number } : null;
}

function seriesFromFolders(videoPath: string): { series: string; season: number } | null {
    const episodeFolder = dirname(videoPath);
    const seasonFolder = dirname(episodeFolder);
    const season = SEASON_FOLDER.exec(basename(seasonFolder))?.[1];
    const series = basename(dirname(seasonFolder));
    if (!EPISODE_FOLDER.test(basename(episodeFolder)) || season === undefined || series.length === 0 || series === basename(seasonFolder)) {
        return null;
    }
    return { series, season: Number(season) };
}

function scanOne(videoPath: string, files: ScanFileSystem): ScannedEpisode | null {
    const metadata = readEpisodeMetadata(videoPath, files);
    if (metadata) {
        return {
            videoPath,
            title: metadata.title,
            number: metadata.number,
            query: metadata.query,
            searchIndex: metadata.searchIndex,
            progress: { positionSeconds: metadata.positionSeconds, durationSeconds: metadata.durationSeconds, watched: metadata.watched },
            series: metadata.series ?? null,
            season: metadata.season ?? null,
            seasonName: metadata.seasonName ?? null
        };
    }
    const names = episodeFromNames(videoPath);
    const joined = seriesFromFolders(videoPath);
    return names ? { videoPath, ...names, query: names.title, searchIndex: 0, progress: null, series: joined?.series ?? null, season: joined?.season ?? null, seasonName: null } : null;
}

export function scanLibraryFolder(root: string, files: ScanFileSystem = defaultScanFileSystem): ScanResult {
    const episodes: ScannedEpisode[] = [];
    let ignored = 0;
    const walk = (directory: string, depth: number): void => {
        const entries = files.entries(directory).sort((first, second) => {
            return first.name.localeCompare(second.name);
        });
        entries.forEach((entry) => {
            const path = join(directory, entry.name);
            if (entry.directory) {
                if (depth < MAX_SCAN_DEPTH) {
                    walk(path, depth + 1);
                }
                return;
            }
            if (!VIDEO_EXTENSIONS.includes(extname(entry.name).toLowerCase())) {
                return;
            }
            const found = scanOne(path, files);
            if (found) {
                episodes.push(found);
            } else {
                ignored += 1;
            }
        });
    };
    walk(root, 0);
    return { episodes, ignored };
}
