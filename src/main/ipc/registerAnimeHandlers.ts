import {
    ANIME_AUDIOS,
    type AniError,
    type AnimeAudio,
    type AnimeAvailability,
    type AnimeAvailabilityTarget,
    type AnimeEpisodeRecord,
    type AnimeHistoryEntry,
    type AnimeHistoryRequest,
    type AnimeDownloadRequest,
    type AnimeDownloadResponse,
    type AnimeImportResponse,
    type AnimeMigrationResponse,
    type AnimeProgressUpdate,
    type AnimeScheduleRequest,
    type AnimeScheduleResponse,
    type AnimeSeriesResponse,
    type AnimeStreamResponse,
    type AnimeSubtitleCheckResponse,
    type AnimeSubtitleImportResponse,
    type AnimeSubtitleTrack
} from '@shared/anime';
import { IPC } from '@shared/constants';
import { cleanSeasonName, cleanSeriesName, isValidSeason, sameSeries } from '@shared/series';
import type { AnimeAddResponse, AnimeRenameSeriesResponse, AnimeStatus } from '@shared/anime';
import type { UpdateResult } from '@shared/types';
import type { AnimeDb } from '../services/animeDb';
import { animeFolderOf, animeFoldersToRemove, episodeFolderOf, filesOfEpisode, foldersWithoutOthers, seriesFolderOf } from '../services/animeFiles';
import type { AnimeDownloadQueue } from '../services/animeDownloadQueue';
import { isValidEpisode, isValidIndex, sanitizeQuery } from '../services/aniArgsBuilder';
import type { AniCliService } from '../services/aniCliService';
import type { StreamSessions } from '../services/streamProxy';
import type { IpcMainLike } from './registerHandlers';

export const MAX_TEXT_LENGTH = 200;
export const MAX_EPISODES_PER_REQUEST = 2000;
// How many anime of the schedule can be asked about at once: a week has a few hundred at most.
export const MAX_AVAILABILITY_TARGETS = 500;
// The longest stretch that can be listed: a week, which is seven days (of 23 to 25 hours where the clock changes) and some more.
export const MAX_SCHEDULE_SPAN_SECONDS = 8 * 24 * 60 * 60;

export interface AnimeHandlerDependencies {
    service: Pick<AniCliService, 'isAvailable' | 'info' | 'search' | 'episodes' | 'resolveStream'>;
    // The cover of an anime by its title (null when there is none).
    covers: { find: (title: string) => Promise<string | null> };
    // Which anime of the schedule the source has: what is known is answered, the rest is checked in the background.
    availability: { request: (targets: AnimeAvailabilityTarget[]) => AnimeAvailability[] };
    // The episodes that air in a stretch of time.
    schedule: { list: (request: AnimeScheduleRequest) => Promise<AnimeScheduleResponse> };
    updateAniCli: () => Promise<UpdateResult>;
    resetAniCli: () => UpdateResult;
    streams: Pick<StreamSessions, 'create' | 'close'>;
    // The quality of the settings, used to pick the stream.
    streamQuality: () => string;
    queue: AnimeDownloadQueue;
    db: AnimeDb;
    removeFiles: (paths: string[]) => void;
    removeFolders: (paths: string[]) => void;
    // Removes the folders that have nothing left in them.
    removeEmptyFolders: (paths: string[]) => void;
    // Whether a file is on the disk.
    fileExists: (path: string) => boolean;
    // What is kept beside the video of a downloaded episode (see episodeMetadata.ts) is written again.
    refreshMetadata: (episodeId: number) => void;
    // Asks for a folder of anime and puts what is in it into the library.
    importLibrary: () => Promise<AnimeImportResponse>;
    // Asks for the folder the anime are moved to and moves them there (see animeMigration.ts).
    migrateFolder: () => Promise<AnimeMigrationResponse>;
    // Opens a folder in the file manager of the system.
    openFolder: (path: string) => void;
    // The folder all the anime go into, as the settings say now.
    baseDirectory: () => string;
    // The system the files are on (decides the rules of folder names); this one by default.
    platform?: NodeJS.Platform;
    onLibraryChanged: () => void;
    // The subtitle files of a downloaded episode: the ones it has, loading one the user chooses and looking for the ones the source
    // offers that it does not have yet.
    subtitles: {
        list: (episodeId: number) => AnimeSubtitleTrack[];
        import: (episodeId: number) => Promise<AnimeSubtitleImportResponse>;
        check: (episodeId: number) => Promise<AnimeSubtitleCheckResponse>;
    };
}

const UNSUPPORTED: AniError = { code: 'UNKNOWN', raw: 'The anime section is only available on Linux.' };

function asText(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function asAudio(value: unknown): AnimeAudio | null {
    return ANIME_AUDIOS.find((audio) => {
        return audio === value;
    }) ?? null;
}

function asId(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

// The ids that came from the screen that are ids, without repeating one.
function validIds(value: unknown): number[] {
    const ids = (Array.isArray(value) ? value : []).map(asId).filter((id): id is number => {
        return id !== null;
    });
    return [...new Set(ids)];
}

function invalid(raw: string): { ok: false; error: AniError } {
    return { ok: false, error: { code: 'INVALID_SELECTION', raw } };
}

function validQuery(value: unknown): string | null {
    const query = sanitizeQuery(asText(value).slice(0, MAX_TEXT_LENGTH));
    return query.length > 0 ? query : null;
}

// Checks what came from the screen before it reaches ani-cli or the library.
export function parseDownloadRequest(input: unknown): AnimeDownloadRequest | string {
    const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
    const title = asText(raw.title).trim().slice(0, MAX_TEXT_LENGTH);
    const query = validQuery(raw.query);
    const audio = asAudio(raw.audio);
    const index = raw.index;
    const episodes = Array.isArray(raw.episodes) ? raw.episodes : [];
    if (title.length === 0 || query === null) {
        return 'The anime name is missing.';
    }
    if (audio === null) {
        return 'The audio must be sub or dub.';
    }
    if (typeof index !== 'number' || !isValidIndex(index)) {
        return 'The position of the anime in the search is invalid.';
    }
    const numbers = [...new Set(episodes.map(asText))];
    if (numbers.length === 0 || numbers.length > MAX_EPISODES_PER_REQUEST || !numbers.every(isValidEpisode)) {
        return 'The episodes are invalid.';
    }
    const joined = parseSeries(raw.series, raw.season, raw.seasonName);
    if (joined === 'invalid') {
        return 'The series, the order or the name is invalid.';
    }
    return { title, query, index, audio, episodes: numbers, ...(joined ?? {}) };
}

// The series and the season that came with a request: none, both valid, or "invalid" (one without the other, a name that cannot be
// kept, a season out of range).
function parseSeries(series: unknown, season: unknown, seasonName: unknown): { series: string; season: number; seasonName?: string | null } | 'invalid' | null {
    const noSeries = series === undefined || series === null || series === '';
    const noSeason = season === undefined || season === null;
    if (noSeries && noSeason) {
        return null;
    }
    const cleaned = noSeries ? null : cleanSeriesName(asText(series));
    if (cleaned === null || !isValidSeason(season)) {
        return 'invalid';
    }
    if (seasonName === undefined) {
        return { series: cleaned, season };
    }
    const name = seasonName === null ? null : cleanSeasonName(asText(seasonName));
    return name === undefined ? 'invalid' : { series: cleaned, season, seasonName: name };
}

// Checks what the screen says it opened or watched before it is kept in the history. The episode is optional (null when it was only
// opened).
export function parseHistoryRequest(input: unknown): AnimeHistoryRequest | null {
    const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
    const title = asText(raw.title).trim().slice(0, MAX_TEXT_LENGTH);
    const query = validQuery(raw.query);
    const audio = asAudio(raw.audio);
    const { index } = raw;
    const episode = raw.episode === null || raw.episode === undefined ? null : asText(raw.episode);
    // The position 0 is an anime whose place in the search is not known: it is searched by its title when it is opened again.
    if (title.length === 0 || query === null || audio === null || typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
        return null;
    }
    if (episode !== null && !isValidEpisode(episode)) {
        return null;
    }
    return { title, query, index, audio, episode };
}

// Checks the stretch of time the screen asks the schedule of: two moments in seconds, the second after the first and not too far from it.
export function parseScheduleRequest(input: unknown): AnimeScheduleRequest | null {
    const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
    const { from, to } = raw;
    if (typeof from !== 'number' || typeof to !== 'number' || !Number.isInteger(from) || !Number.isInteger(to)) {
        return null;
    }
    if (from < 1 || to <= from || to - from > MAX_SCHEDULE_SPAN_SECONDS) {
        return null;
    }
    return { from, to, refresh: raw.refresh === true };
}

function nameOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, MAX_TEXT_LENGTH) : null;
}

// Checks the anime the screen asks the availability of: a list of ids with their two names; what is not shaped so is left out.
export function parseAvailabilityTargets(input: unknown): AnimeAvailabilityTarget[] {
    if (!Array.isArray(input)) {
        return [];
    }
    const targets: AnimeAvailabilityTarget[] = [];
    input.slice(0, MAX_AVAILABILITY_TARGETS).forEach((item: unknown) => {
        const raw = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
        const anilistId = raw.anilistId;
        if (typeof anilistId !== 'number' || !Number.isInteger(anilistId) || anilistId < 1) {
            return;
        }
        const english = nameOrNull(raw.english);
        const romaji = nameOrNull(raw.romaji);
        if (english !== null || romaji !== null) {
            targets.push({ anilistId, english, romaji });
        }
    });
    return targets;
}

export function parseProgress(input: unknown): AnimeProgressUpdate | null {
    const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
    const episodeId = asId(raw.episodeId);
    const { positionSeconds, durationSeconds, watched } = raw;
    if (
        episodeId === null ||
        typeof positionSeconds !== 'number' ||
        typeof durationSeconds !== 'number' ||
        typeof watched !== 'boolean' ||
        !Number.isFinite(positionSeconds) ||
        !Number.isFinite(durationSeconds) ||
        positionSeconds < 0 ||
        durationSeconds < 0
    ) {
        return null;
    }
    return { episodeId, positionSeconds, durationSeconds, watched };
}

// The folders of the episodes of an anime and the folder of the anime they are in, from the innermost out, for the episodes that
// were in a folder of their own.
function emptiedFolders(episodes: readonly AnimeEpisodeRecord[], platform: NodeJS.Platform | undefined): string[] {
    const inFolders = episodes.filter((episode) => {
        return episode.filePath !== null && episodeFolderOf(episode.filePath, episode.number, platform) !== null;
    });
    const episodeFolders = inFolders.map((episode) => {
        return episodeFolderOf(episode.filePath as string, episode.number, platform) as string;
    });
    const animeFolders = inFolders.map((episode) => {
        return animeFolderOf(episode.filePath as string, episode.number, platform);
    });
    const seriesFolders = animeFolders.flatMap((folder) => {
        const series = seriesFolderOf(folder, platform);
        return series === null ? [] : [series];
    });
    return [...new Set([...episodeFolders, ...animeFolders, ...seriesFolders])];
}

// On systems where the section does not exist it still answers, so the screen can tell and hide it.
function registerUnsupported(ipcMain: IpcMainLike): void {
    const status: AnimeStatus = { supported: false, available: false, aniCli: null };
    ipcMain.handle(IPC.animeStatus, () => {
        return status;
    });
    ipcMain.handle(IPC.animeSearch, () => {
        return { ok: false, error: UNSUPPORTED };
    });
    ipcMain.handle(IPC.animeEpisodes, () => {
        return { ok: false, error: UNSUPPORTED };
    });
    ipcMain.handle(IPC.animeDownload, (): AnimeDownloadResponse => {
        return { ok: false, message: UNSUPPORTED.raw };
    });
    ipcMain.handle(IPC.animeAddToLibrary, (): AnimeAddResponse => {
        return { ok: false, reason: 'invalid' };
    });
    ipcMain.handle(IPC.animeDownloadMissing, (): void => {
        return undefined;
    });
    ipcMain.handle(IPC.animeOpenSeriesFolder, (): void => {
        return undefined;
    });
    ipcMain.handle(IPC.animeRenameSeries, (): AnimeRenameSeriesResponse => {
        return { ok: false, reason: 'invalid' };
    });
    ipcMain.handle(IPC.animeSchedule, (): AnimeScheduleResponse => {
        return { ok: false, error: UNSUPPORTED };
    });
    ipcMain.handle(IPC.animeCover, (): null => {
        return null;
    });
    ipcMain.handle(IPC.animeAvailability, (): AnimeAvailability[] => {
        return [];
    });
    ipcMain.handle(IPC.animeLibrary, () => {
        return [];
    });
    ipcMain.handle(IPC.animeJobs, () => {
        return [];
    });
    ipcMain.handle(IPC.animeHistoryList, (): AnimeHistoryEntry[] => {
        return [];
    });
    ipcMain.handle(IPC.animeStreamOpen, (): AnimeStreamResponse => {
        return { ok: false, error: UNSUPPORTED };
    });
    ipcMain.handle(IPC.animeUpdateCli, (): UpdateResult => {
        return { ok: false, output: UNSUPPORTED.raw };
    });
    ipcMain.handle(IPC.animeResetCli, (): UpdateResult => {
        return { ok: false, output: UNSUPPORTED.raw };
    });
    ipcMain.handle(IPC.animeImportLibrary, (): AnimeImportResponse => {
        return { ok: false, reason: 'cancelled' };
    });
    ipcMain.handle(IPC.animeMigrateFolder, (): AnimeMigrationResponse => {
        return { ok: false, reason: 'failed' };
    });
    ipcMain.handle(IPC.animeSetSeries, (): AnimeSeriesResponse => {
        return { ok: false, reason: 'invalid' };
    });
    ipcMain.handle(IPC.animeSubtitles, (): AnimeSubtitleTrack[] => {
        return [];
    });
    ipcMain.handle(IPC.animeSubtitleImport, (): AnimeSubtitleImportResponse => {
        return { ok: false, reason: 'missing' };
    });
    ipcMain.handle(IPC.animeSubtitlesCheck, (): AnimeSubtitleCheckResponse => {
        return { ok: false, reason: 'missing' };
    });
    [IPC.animeCancel, IPC.animeRetry, IPC.animePause, IPC.animeResume, IPC.animeClearFinished, IPC.animeRemoveEpisode, IPC.animeRemoveAnime, IPC.animeOpenFolder, IPC.animeProgress, IPC.animeStreamClose, IPC.animeHistoryRecord, IPC.animeHistoryRemove, IPC.animeHistoryClear].forEach((channel) => {
        ipcMain.handle(channel, (): void => {
            return undefined;
        });
    });
}

export function registerAnimeHandlers(ipcMain: IpcMainLike, deps: AnimeHandlerDependencies | null): void {
    if (deps === null) {
        registerUnsupported(ipcMain);
        return;
    }
    const { service, queue, db } = deps;
    let migrating = false;

    ipcMain.handle(IPC.animeStatus, (): AnimeStatus => {
        return { supported: true, available: service.isAvailable(), aniCli: service.info() };
    });
    ipcMain.handle(IPC.animeUpdateCli, (): Promise<UpdateResult> => {
        return deps.updateAniCli();
    });
    ipcMain.handle(IPC.animeResetCli, (): UpdateResult => {
        return deps.resetAniCli();
    });
    ipcMain.handle(IPC.animeSearch, async (_event, query, audio) => {
        const cleaned = validQuery(query);
        const chosen = asAudio(audio);
        if (cleaned === null || chosen === null) {
            return invalid('The search is empty or the audio is invalid.');
        }
        const result = await service.search(cleaned, chosen);
        if (result.status === 'done') {
            return { ok: true, results: result.value };
        }
        return { ok: false, error: result.status === 'error' ? result.error : { code: 'UNKNOWN', raw: 'The search was cancelled.' } };
    });
    ipcMain.handle(IPC.animeEpisodes, async (_event, query, index, audio) => {
        const cleaned = validQuery(query);
        const chosen = asAudio(audio);
        if (cleaned === null || chosen === null || typeof index !== 'number' || !isValidIndex(index)) {
            return invalid('The search, the position or the audio is invalid.');
        }
        const result = await service.episodes(cleaned, index, chosen);
        if (result.status === 'done') {
            return { ok: true, episodes: result.value };
        }
        return { ok: false, error: result.status === 'error' ? result.error : { code: 'UNKNOWN', raw: 'The search was cancelled.' } };
    });
    ipcMain.handle(IPC.animeCover, (_event, title): Promise<string | null> => {
        const cleaned = asText(title).trim().slice(0, MAX_TEXT_LENGTH);
        return cleaned.length === 0 ? Promise.resolve(null) : deps.covers.find(cleaned);
    });
    ipcMain.handle(IPC.animeAvailability, (_event, input): AnimeAvailability[] => {
        return deps.availability.request(parseAvailabilityTargets(input));
    });
    ipcMain.handle(IPC.animeSchedule, (_event, input): Promise<AnimeScheduleResponse> | AnimeScheduleResponse => {
        const request = parseScheduleRequest(input);
        if (request === null) {
            return invalid('The stretch of time is invalid.');
        }
        return deps.schedule.list(request);
    });
    ipcMain.handle(IPC.animeDownload, (_event, input): AnimeDownloadResponse => {
        if (migrating) {
            return { ok: false, message: 'The anime folder is being migrated. Try again when it is done.' };
        }
        const request = parseDownloadRequest(input);
        if (typeof request === 'string') {
            return { ok: false, message: request };
        }
        if (request.series && request.season && db.seasonTaken(request.series, request.season, request.audio, db.findAnime(request.title, request.audio)?.id ?? 0)) {
            return { ok: false, message: `Order ${request.season} of "${request.series}" is already used by another anime.` };
        }
        const anime = queue.enqueue(request);
        return anime ? { ok: true, anime } : { ok: false, message: 'The anime could not be saved.' };
    });
    ipcMain.handle(IPC.animeAddToLibrary, (_event, input): AnimeAddResponse => {
        if (migrating) {
            return { ok: false, reason: 'busy' };
        }
        const request = parseDownloadRequest(input);
        if (typeof request === 'string') {
            return { ok: false, reason: 'invalid' };
        }
        return queue.addToLibrary({
            title: request.title,
            query: request.query,
            index: request.index,
            audio: request.audio,
            episodes: request.episodes,
            series: request.series ?? null,
            season: request.season ?? null,
            seasonName: request.seasonName ?? null
        });
    });
    ipcMain.handle(IPC.animeDownloadMissing, (_event, ids): void => {
        if (migrating) {
            return;
        }
        queue.downloadMissing(validIds(ids));
    });
    ipcMain.handle(IPC.animeLibrary, () => {
        return db.list().map((anime) => {
            return {
                ...anime,
                episodes: anime.episodes.map((episode) => {
                    return { ...episode, fileMissing: episode.status === 'done' && (episode.filePath === null || !deps.fileExists(episode.filePath)) };
                })
            };
        });
    });
    ipcMain.handle(IPC.animeImportLibrary, async (): Promise<AnimeImportResponse> => {
        const result = await deps.importLibrary();
        if (result.ok) {
            deps.onLibraryChanged();
        }
        return result;
    });
    // The files are moved one migration at a time, and never while an episode is being downloaded (nor is one started meanwhile).
    ipcMain.handle(IPC.animeMigrateFolder, async (): Promise<AnimeMigrationResponse> => {
        if (migrating || queue.pendingCount() > 0) {
            return { ok: false, reason: 'busy' };
        }
        migrating = true;
        try {
            const result = await deps.migrateFolder();
            if (result.ok) {
                deps.onLibraryChanged();
            }
            return result;
        } finally {
            migrating = false;
        }
    });
    ipcMain.handle(IPC.animeJobs, () => {
        return queue.list();
    });
    ipcMain.handle(IPC.animeHistoryList, (): AnimeHistoryEntry[] => {
        return db.listHistory();
    });
    ipcMain.handle(IPC.animeHistoryRecord, (_event, input): void => {
        const request = parseHistoryRequest(input);
        if (request !== null) {
            db.recordHistory(request);
        }
    });
    ipcMain.handle(IPC.animeHistoryRemove, (_event, id): void => {
        const entryId = asId(id);
        if (entryId !== null) {
            db.removeHistory(entryId);
        }
    });
    ipcMain.handle(IPC.animeHistoryClear, (): void => {
        db.clearHistory();
    });
    ipcMain.handle(IPC.animeCancel, (_event, episodeId): void => {
        const id = asId(episodeId);
        if (id !== null) {
            queue.cancel(id);
        }
    });
    ipcMain.handle(IPC.animePause, (_event, episodeId): void => {
        const id = asId(episodeId);
        if (id !== null) {
            queue.pause(id);
        }
    });
    ipcMain.handle(IPC.animeResume, (_event, episodeId): void => {
        const id = asId(episodeId);
        if (id !== null) {
            queue.resume(id);
        }
    });
    ipcMain.handle(IPC.animeRetry, (_event, episodeId): void => {
        const id = asId(episodeId);
        if (id !== null) {
            queue.retry(id);
        }
    });
    ipcMain.handle(IPC.animeClearFinished, (): void => {
        queue.clearFinished();
    });
    // Removing always deletes the files too: what is in the library is what is on the disk.
    ipcMain.handle(IPC.animeRemoveEpisode, (_event, episodeId): void => {
        const id = asId(episodeId);
        if (id === null) {
            return;
        }
        queue.forget([id]);
        const number = db.getEpisode(id)?.number ?? '';
        const filePath = db.removeEpisode(id);
        if (filePath !== null) {
            deps.removeFiles(filesOfEpisode(filePath));
            // The folder of the episode goes with it once it is empty.
            const folder = episodeFolderOf(filePath, number, deps.platform);
            if (folder !== null) {
                deps.removeEmptyFolders([folder]);
            }
        }
        deps.onLibraryChanged();
    });
    ipcMain.handle(IPC.animeRemoveAnime, (_event, animeId): void => {
        const id = asId(animeId);
        const anime = id === null ? null : db.getLibraryAnime(id);
        if (id === null || anime === null) {
            return;
        }
        queue.forget(
            anime.episodes.map((episode) => {
                return episode.id;
            })
        );
        const files = db.removeAnime(id);
        deps.removeFiles(
            files.flatMap((file) => {
                return filesOfEpisode(file);
            })
        );
        // The folder of a series holds the seasons of the other anime of the series: it is never removed whole while any of them has a
        // file in it.
        const others = db.list().flatMap((remaining) => {
            return remaining.episodes.flatMap((episode) => {
                return episode.filePath === null ? [] : [episode.filePath];
            });
        });
        deps.removeFolders(foldersWithoutOthers(animeFoldersToRemove(anime.title, files, deps.baseDirectory(), deps.platform), others, deps.platform));
        // A folder that was renamed is not one the app may remove whole, but what is left of it once its files are gone is empty.
        deps.removeEmptyFolders(emptiedFolders(anime.episodes, deps.platform));
        deps.onLibraryChanged();
    });
    // What is kept beside the videos of an anime (it says the series) is written again.
    const refreshMetadataOf = (animeId: number): void => {
        db.getLibraryAnime(animeId)?.episodes.forEach((episode) => {
            if (episode.status === 'done') {
                deps.refreshMetadata(episode.id);
            }
        });
    };
    // The series of an anime is fixed once it is in the library (it can only be renamed with the whole series, and leaving it is
    // removing the anime): what can change here is its season, and the name it is shown with, inside the series it has.
    ipcMain.handle(IPC.animeSetSeries, (_event, animeId, series, season, seasonName): AnimeSeriesResponse => {
        const id = asId(animeId);
        const current = id === null ? null : db.getAnime(id);
        if (id === null || current === null || current.series === null) {
            return { ok: false, reason: 'invalid' };
        }
        const cleaned = typeof series === 'string' ? cleanSeriesName(series) : null;
        if (cleaned === null || !sameSeries(cleaned, current.series) || !isValidSeason(season)) {
            return { ok: false, reason: 'invalid' };
        }
        const name = seasonName === null || seasonName === undefined ? null : typeof seasonName === 'string' ? cleanSeasonName(seasonName) : undefined;
        if (name === undefined) {
            return { ok: false, reason: 'invalid' };
        }
        if (!db.setSeries(id, current.series, season, name)) {
            return { ok: false, reason: 'season-taken', suggested: db.firstFreeSeason(current.series, current.audio, [id]) };
        }
        refreshMetadataOf(id);
        deps.onLibraryChanged();
        return { ok: true };
    });
    // The anime of a series get another name for it together; a season the other series has too is refused (see AnimeDb.renameSeries).
    ipcMain.handle(IPC.animeRenameSeries, (_event, ids, name): AnimeRenameSeriesResponse => {
        const animeIds = validIds(ids).filter((id) => {
            return db.getAnime(id) !== null;
        });
        const cleaned = typeof name === 'string' ? cleanSeriesName(name) : null;
        if (animeIds.length === 0 || cleaned === null) {
            return { ok: false, reason: 'invalid' };
        }
        const result = db.renameSeries(animeIds, cleaned);
        if (!result.ok) {
            return { ok: false, reason: 'season-taken', anime: result.anime, season: result.season, suggested: result.suggested };
        }
        animeIds.forEach(refreshMetadataOf);
        deps.onLibraryChanged();
        return { ok: true };
    });
    // The address comes from the library, never from the screen: only the folder of an anime that is in it can be opened.
    ipcMain.handle(IPC.animeOpenFolder, (_event, animeId): void => {
        const id = asId(animeId);
        const anime = id === null ? null : db.getLibraryAnime(id);
        const downloaded = anime?.episodes.find((episode) => {
            return episode.status === 'done' && episode.filePath !== null;
        });
        if (downloaded?.filePath) {
            deps.openFolder(animeFolderOf(downloaded.filePath, downloaded.number, deps.platform));
        }
    });
    // The folder of the series the anime is in: where the folders of its seasons are (an anime on its own has its own folder).
    ipcMain.handle(IPC.animeOpenSeriesFolder, (_event, animeId): void => {
        const id = asId(animeId);
        const anime = id === null ? null : db.getLibraryAnime(id);
        const downloaded = anime?.episodes.find((episode) => {
            return episode.status === 'done' && episode.filePath !== null;
        });
        if (downloaded?.filePath) {
            const folder = animeFolderOf(downloaded.filePath, downloaded.number, deps.platform);
            deps.openFolder(seriesFolderOf(folder, deps.platform) ?? folder);
        }
    });
    ipcMain.handle(IPC.animeStreamOpen, async (_event, input): Promise<AnimeStreamResponse> => {
        const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
        const query = validQuery(raw.query);
        const audio = asAudio(raw.audio);
        const episode = asText(raw.episode);
        const { index } = raw;
        if (query === null || audio === null || typeof index !== 'number' || !isValidIndex(index) || !isValidEpisode(episode)) {
            return invalid('The search, the position, the audio or the episode is invalid.');
        }
        const result = await service.resolveStream({ query, index, audio, episode, quality: deps.streamQuality() });
        if (result.status === 'done') {
            return { ok: true, stream: deps.streams.create(result.value) };
        }
        return { ok: false, error: result.status === 'error' ? result.error : { code: 'UNKNOWN', raw: 'The request was cancelled.' } };
    });
    ipcMain.handle(IPC.animeStreamClose, (_event, sessionId): void => {
        const id = asText(sessionId);
        if (id.length > 0) {
            deps.streams.close(id);
        }
    });
    ipcMain.handle(IPC.animeSubtitles, (_event, episodeId): AnimeSubtitleTrack[] => {
        const id = asId(episodeId);
        return id === null ? [] : deps.subtitles.list(id);
    });
    ipcMain.handle(IPC.animeSubtitleImport, async (_event, episodeId): Promise<AnimeSubtitleImportResponse> => {
        const id = asId(episodeId);
        return id === null ? { ok: false, reason: 'missing' } : deps.subtitles.import(id);
    });
    // What the source offers that the episode does not have is saved next to its video; what is kept beside the video is written again.
    ipcMain.handle(IPC.animeSubtitlesCheck, async (_event, episodeId): Promise<AnimeSubtitleCheckResponse> => {
        const id = asId(episodeId);
        if (id === null) {
            return { ok: false, reason: 'missing' };
        }
        const result = await deps.subtitles.check(id);
        if (result.ok && result.added.length > 0) {
            deps.refreshMetadata(id);
        }
        return result;
    });
    ipcMain.handle(IPC.animeProgress, (_event, input): void => {
        const update = parseProgress(input);
        if (update !== null) {
            db.saveProgress(update);
            deps.refreshMetadata(update.episodeId);
        }
    });
}
