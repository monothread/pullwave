import { cleanSeasonName, cleanSeriesName, isValidSeason } from '@shared/series';
import type { AnimeEpisodeRecord, AnimeRecord } from '@shared/anime';
import { isValidEpisode } from './aniArgsBuilder';
import { episodeFolderOf, METADATA_FILE_NAME, metadataPathFor } from './animeFiles';
import type { AnimeDb } from './animeDb';

export { METADATA_FILE_NAME, metadataPathFor };
export const METADATA_VERSION = 1;
export const METADATA_AUDIO = 'sub';

export interface EpisodeMetadata {
    version: typeof METADATA_VERSION;
    title: string;
    query: string;
    searchIndex: number;
    audio: typeof METADATA_AUDIO;
    number: string;
    positionSeconds: number;
    durationSeconds: number;
    watched: boolean;
    series?: string;
    season?: number;
    seasonName?: string;
}

export interface MetadataFiles {
    read: (path: string) => string | null;
    write: (path: string, content: string) => void;
}

export function metadataOf(anime: AnimeRecord, episode: AnimeEpisodeRecord): EpisodeMetadata {
    const joined =
        anime.series !== null && anime.season !== null
            ? { series: anime.series, season: anime.season, ...(anime.seasonName !== null ? { seasonName: anime.seasonName } : {}) }
            : {};
    return {
        version: METADATA_VERSION,
        ...joined,
        title: anime.title,
        query: anime.query,
        searchIndex: anime.searchIndex,
        audio: METADATA_AUDIO,
        number: episode.number,
        positionSeconds: episode.positionSeconds,
        durationSeconds: episode.durationSeconds,
        watched: episode.watched
    };
}

function isNonNegative(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function parseEpisodeMetadata(content: string): EpisodeMetadata | null {
    let raw: unknown;
    try {
        raw = JSON.parse(content);
    } catch {
        return null;
    }
    if (typeof raw !== 'object' || raw === null) {
        return null;
    }
    const { version, title, query, searchIndex, number, positionSeconds, durationSeconds, watched, series, season, seasonName } = raw as Record<string, unknown>;
    if (
        version !== METADATA_VERSION ||
        typeof title !== 'string' ||
        title.trim().length === 0 ||
        typeof query !== 'string' ||
        typeof searchIndex !== 'number' ||
        !Number.isInteger(searchIndex) ||
        searchIndex < 0 ||
        typeof number !== 'string' ||
        !isValidEpisode(number) ||
        !isNonNegative(positionSeconds) ||
        !isNonNegative(durationSeconds) ||
        typeof watched !== 'boolean'
    ) {
        return null;
    }
    const cleanedSeries = typeof series === 'string' ? cleanSeriesName(series) : null;
    const cleanedName = typeof seasonName === 'string' ? cleanSeasonName(seasonName) : null;
    const joined = cleanedSeries !== null && isValidSeason(season) ? { series: cleanedSeries, season, ...(cleanedName ? { seasonName: cleanedName } : {}) } : {};
    return { version, title, query, searchIndex, audio: METADATA_AUDIO, number, positionSeconds, durationSeconds, watched, ...joined };
}

export function readEpisodeMetadata(videoPath: string, files: Pick<MetadataFiles, 'read'>): EpisodeMetadata | null {
    const content = files.read(metadataPathFor(videoPath));
    return content === null ? null : parseEpisodeMetadata(content);
}

export function writeEpisodeMetadata(videoPath: string, metadata: EpisodeMetadata, files: Pick<MetadataFiles, 'write'>): void {
    try {
        files.write(metadataPathFor(videoPath), `${JSON.stringify(metadata, null, 2)}\n`);
    } catch {
        return;
    }
}

export function refreshEpisodeMetadata(
    db: Pick<AnimeDb, 'getEpisode' | 'getAnime'>,
    episodeId: number,
    files: Pick<MetadataFiles, 'write'>,
    platform: NodeJS.Platform = process.platform
): void {
    const episode = db.getEpisode(episodeId);
    const anime = episode ? db.getAnime(episode.animeId) : null;
    if (!episode || !anime || episode.status !== 'done' || episode.filePath === null) {
        return;
    }
    if (episodeFolderOf(episode.filePath, episode.number, platform) === null) {
        return;
    }
    writeEpisodeMetadata(episode.filePath, metadataOf(anime, episode), files);
}
