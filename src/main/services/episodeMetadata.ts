import { cleanSeasonName, cleanSeriesName, isValidSeason } from '@shared/series';
import type { AnimeEpisodeRecord, AnimeRecord } from '@shared/anime';
import { isValidEpisode } from './aniArgsBuilder';
import { episodeFolderOf, METADATA_FILE_NAME, metadataPathFor } from './animeFiles';
import type { AnimeDb } from './animeDb';

// Next to the video of each episode the app keeps what it needs to recognize it again, whatever the folders are called: if the
// library is lost (a new computer, a reinstall) the folder can be scanned and every episode comes back as it was.
export { METADATA_FILE_NAME, metadataPathFor };
export const METADATA_VERSION = 1;
// The audio of the episode: always the subtitled one (the app has no dubbed anime any more). It is still written, so the versions of the app
// that read it (they refused a file without it) can import the library; it is not needed to read a file.
export const METADATA_AUDIO = 'sub';

export interface EpisodeMetadata {
    version: typeof METADATA_VERSION;
    title: string;
    query: string;
    // The position of the anime in its search; 0 when it is not known.
    searchIndex: number;
    audio: typeof METADATA_AUDIO;
    number: string;
    positionSeconds: number;
    durationSeconds: number;
    watched: boolean;
    // The series and season the user gave the anime (both, or neither).
    series?: string;
    season?: number;
    // The name the anime is shown with in its series (only with them).
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

// The metadata in a text, or null when it is not valid: a file that was edited or damaged is ignored as a whole.
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
    // The series and the season only count together; a pair that cannot be used is left out and the rest of the file is kept.
    const cleanedSeries = typeof series === 'string' ? cleanSeriesName(series) : null;
    const cleanedName = typeof seasonName === 'string' ? cleanSeasonName(seasonName) : null;
    const joined = cleanedSeries !== null && isValidSeason(season) ? { series: cleanedSeries, season, ...(cleanedName ? { seasonName: cleanedName } : {}) } : {};
    return { version, title, query, searchIndex, audio: METADATA_AUDIO, number, positionSeconds, durationSeconds, watched, ...joined };
}

export function readEpisodeMetadata(videoPath: string, files: Pick<MetadataFiles, 'read'>): EpisodeMetadata | null {
    const content = files.read(metadataPathFor(videoPath));
    return content === null ? null : parseEpisodeMetadata(content);
}

// Failing to write it never fails what the user was doing: the library works without it.
export function writeEpisodeMetadata(videoPath: string, metadata: EpisodeMetadata, files: Pick<MetadataFiles, 'write'>): void {
    try {
        files.write(metadataPathFor(videoPath), `${JSON.stringify(metadata, null, 2)}\n`);
    } catch {
        return;
    }
}

// Saves what the library knows of a downloaded episode next to its video. Only an episode in a folder of its own gets one: the
// videos that were downloaded before that share the folder of the anime, which has room for a single file.
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
