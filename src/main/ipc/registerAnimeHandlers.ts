import {
    ANIME_AIRING_OVERRIDES,
    DEFAULT_TRANSLATION_LANGUAGE,
    IDLE_CHECK_STATE,
    MAX_SEARCH_RESULTS,
    type AniError,
    type AnimeCheckResponse,
    type AnimeCheckState,
    type AnimeEpisodeRecord,
    type AnimeHistoryEntry,
    type AnimeHistoryRequest,
    type AnimeDownloadRequest,
    type AnimeDownloadResponse,
    type AnimeAudioCheckResponse,
    type AnimeRepairResponse,
    type AnimeImportResponse,
    type AnimeMigrationResponse,
    type AnimeProgressUpdate,
    type AnimeScheduleRequest,
    type AnimeScheduleResponse,
    type AnimeSeriesResponse,
    type AnimeStreamResponse,
    type AnimeSubtitleCheckResponse,
    type AnimeSubtitleDeleteResponse,
    type AnimeSubtitleImportResponse,
    type AnimeSubtitleTrack,
    type AnimeUpdateEntry,
    type SubtitleEstimateRequest,
    type SubtitleGenerateEstimateResponse,
    type SubtitleGenerateRequest,
    type SubtitleGenerateResponse,
    type SubtitleJobs,
    type SubtitleTranslatableResponse,
    TRANSCRIPTION_LANGUAGES,
    type TranscriptionLanguage,
    type SubtitleEstimateResponse,
    type SubtitleTranslateRequest,
    type SubtitleTranslateResponse,
    TRANSLATION_LANGUAGES,
    type TranslationLanguage
} from '@shared/anime';
import { IPC } from '@shared/constants';
import { cleanSeasonName, cleanSeriesName, isValidSeason, sameSeries } from '@shared/series';
import type { AnimeAddResponse, AnimeRenameSeriesResponse, AnimeStatus, LibraryAnime } from '@shared/anime';
import type { AnimeDb } from '../services/animeDb';
import { animeFolderOf, animeFoldersToRemove, episodeFolderOf, filesOfEpisode, foldersWithoutOthers, seriesFolderOf } from '../services/animeFiles';
import type { AnimeDownloadQueue } from '../services/animeDownloadQueue';
import type { AnimeUpdateChecker } from '../services/animeUpdateChecker';
import { isValidEpisode, isValidIndex, sanitizeQuery } from '../services/aniArgsBuilder';
import type { AniCliService } from '../services/aniCliService';
import type { StreamSessions } from '../services/streamProxy';
import type { IpcMainLike } from './registerHandlers';

export const MAX_TEXT_LENGTH = 200;
export const MAX_EPISODES_PER_REQUEST = 2000;
export const MAX_SCHEDULE_SPAN_SECONDS = 8 * 24 * 60 * 60;

export interface AnimeHandlerDependencies {
    service: Pick<AniCliService, 'isAvailable' | 'info' | 'searchListing' | 'episodes' | 'resolveStream'>;
    covers: { find: (title: string) => Promise<string | null> };
    updates: Pick<AnimeUpdateChecker, 'checkNow' | 'checkAnime' | 'state'>;
    schedule: { list: (request: AnimeScheduleRequest) => Promise<AnimeScheduleResponse> };
    streams: Pick<StreamSessions, 'create' | 'close'>;
    streamQuality: () => string;
    queue: AnimeDownloadQueue;
    db: AnimeDb;
    removeFiles: (paths: string[]) => void;
    removeFolders: (paths: string[]) => void;
    removeEmptyFolders: (paths: string[]) => void;
    fileExists: (path: string) => boolean;
    refreshMetadata: (episodeId: number) => void;
    importLibrary: () => Promise<AnimeImportResponse>;
    checkAudio: () => Promise<AnimeAudioCheckResponse>;
    repairEpisodes: (episodeIds: number[]) => Promise<AnimeRepairResponse>;
    migrateFolder: () => Promise<AnimeMigrationResponse>;
    openFolder: (path: string) => void;
    baseDirectory: () => string;
    platform?: NodeJS.Platform;
    onLibraryChanged: () => void;
    subtitles: {
        list: (episodeId: number) => AnimeSubtitleTrack[];
        import: (episodeId: number) => Promise<AnimeSubtitleImportResponse>;
        deleteTranslated: (episodeId: number, trackId: string) => AnimeSubtitleDeleteResponse;
        check: (episodeId: number) => Promise<AnimeSubtitleCheckResponse>;
        translate: (request: SubtitleTranslateRequest) => Promise<SubtitleTranslateResponse>;
        translatable: (episodeIds: readonly number[]) => SubtitleTranslatableResponse;
        estimate: (request: SubtitleEstimateRequest) => Promise<SubtitleEstimateResponse>;
        cancelTranslation: (episodeId: number | null) => void;
        generate: (request: SubtitleGenerateRequest) => Promise<SubtitleGenerateResponse>;
        estimateGeneration: (episodeId: number) => Promise<SubtitleGenerateEstimateResponse>;
        cancelGeneration: (episodeId: number) => void;
        jobs: () => SubtitleJobs;
    };
}

const UNSUPPORTED: AniError = { code: 'UNKNOWN', raw: 'The anime section is only available on Linux.' };

function asText(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function asLoadedCount(value: unknown): number | null {
    if (value === undefined) {
        return 0;
    }
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_SEARCH_RESULTS ? value : null;
}

function asId(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

function validIds(value: unknown): number[] {
    const ids = (Array.isArray(value) ? value : []).map(asId).filter((id): id is number => {
        return id !== null;
    });
    return [...new Set(ids)];
}

function asLanguage(value: unknown): TranslationLanguage | null {
    return TRANSLATION_LANGUAGES.find((language) => {
        return language === value;
    }) ?? null;
}

function asSpokenLanguage(value: unknown): TranscriptionLanguage | null {
    return TRANSCRIPTION_LANGUAGES.find((language) => {
        return language === value;
    }) ?? null;
}

function asTrackId(value: unknown): string | null | undefined {
    if (value === null || value === undefined) {
        return null;
    }
    return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? value : undefined;
}

function invalid(raw: string): { ok: false; error: AniError } {
    return { ok: false, error: { code: 'INVALID_SELECTION', raw } };
}

function validQuery(value: unknown): string | null {
    const query = sanitizeQuery(asText(value).slice(0, MAX_TEXT_LENGTH));
    return query.length > 0 ? query : null;
}

export function asSourceId(value: unknown): string | null {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,200}$/.test(value) ? value : null;
}

export function parseDownloadRequest(input: unknown): AnimeDownloadRequest | string {
    const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
    const title = asText(raw.title).trim().slice(0, MAX_TEXT_LENGTH);
    const query = validQuery(raw.query);
    const index = raw.index;
    const episodes = Array.isArray(raw.episodes) ? raw.episodes : [];
    if (title.length === 0 || query === null) {
        return 'The anime name is missing.';
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
    const sourceId = asSourceId(raw.sourceId);
    return { title, query, index, episodes: numbers, ...(sourceId === null ? {} : { sourceId }), ...(joined ?? {}) };
}

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

export function parseHistoryRequest(input: unknown): AnimeHistoryRequest | null {
    const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
    const title = asText(raw.title).trim().slice(0, MAX_TEXT_LENGTH);
    const query = validQuery(raw.query);
    const { index } = raw;
    const episode = raw.episode === null || raw.episode === undefined ? null : asText(raw.episode);
    if (title.length === 0 || query === null || typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
        return null;
    }
    if (episode !== null && !isValidEpisode(episode)) {
        return null;
    }
    return { title, query, index, episode };
}

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
    ipcMain.handle(IPC.animeUpdates, (): AnimeUpdateEntry[] => {
        return [];
    });
    ipcMain.handle(IPC.animeUpdatesClear, (): void => {
        return undefined;
    });
    ipcMain.handle(IPC.animeCheckNew, (): AnimeCheckResponse => {
        return { ok: false, error: { code: 'UNKNOWN', message: UNSUPPORTED.raw } };
    });
    ipcMain.handle(IPC.animeCheckState, (): AnimeCheckState => {
        return IDLE_CHECK_STATE;
    });
    ipcMain.handle(IPC.animeSetAiring, (): void => {
        return undefined;
    });
    ipcMain.handle(IPC.animeLibrary, () => {
        return [];
    });
    ipcMain.handle(IPC.animeLibraryEntry, () => {
        return null;
    });
    ipcMain.handle(IPC.animeJobs, () => {
        return [];
    });
    ipcMain.handle(IPC.animeSubtitleJobs, (): SubtitleJobs => {
        return { translations: [], generations: [] };
    });
    ipcMain.handle(IPC.animeHistoryList, (): AnimeHistoryEntry[] => {
        return [];
    });
    ipcMain.handle(IPC.animeStreamOpen, (): AnimeStreamResponse => {
        return { ok: false, error: UNSUPPORTED };
    });
    ipcMain.handle(IPC.animeImportLibrary, (): AnimeImportResponse => {
        return { ok: false, reason: 'cancelled' };
    });
    ipcMain.handle(IPC.animeCheckAudio, (): AnimeAudioCheckResponse => {
        return { ok: false, reason: 'unsupported' };
    });
    ipcMain.handle(IPC.animeRepairEpisodes, (): AnimeRepairResponse => {
        return { ok: false, reason: 'unsupported' };
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
    ipcMain.handle(IPC.animeSubtitleDelete, (): AnimeSubtitleDeleteResponse => {
        return { ok: false, reason: 'missing' };
    });
    ipcMain.handle(IPC.animeSubtitlesCheck, (): AnimeSubtitleCheckResponse => {
        return { ok: false, reason: 'missing' };
    });
    ipcMain.handle(IPC.animeSubtitleTranslate, (): SubtitleTranslateResponse => {
        return { ok: false, reason: 'missing' };
    });
    ipcMain.handle(IPC.animeSubtitleTranslateEstimate, (): SubtitleEstimateResponse => {
        return { ok: false, reason: 'missing' };
    });
    ipcMain.handle(IPC.animeSubtitleTranslateMany, (): number => {
        return 0;
    });
    ipcMain.handle(IPC.animeSubtitleTranslatable, (): SubtitleTranslatableResponse => {
        return { language: DEFAULT_TRANSLATION_LANGUAGE, episodeIds: [] };
    });
    ipcMain.handle(IPC.animeSubtitleGenerate, (): SubtitleGenerateResponse => {
        return { ok: false, reason: 'missing' };
    });
    ipcMain.handle(IPC.animeSubtitleGenerateEstimate, (): SubtitleGenerateEstimateResponse => {
        return { ok: false, reason: 'missing' };
    });
    ipcMain.handle(IPC.animeQueueHeld, (): boolean => {
        return false;
    });
    [IPC.animeSubtitleTranslateCancel, IPC.animeSubtitleGenerateCancel, IPC.animeCancel, IPC.animeRetry, IPC.animeRedownload, IPC.animeRedownloadMany, IPC.animePause, IPC.animeResume, IPC.animeClearFinished, IPC.animePauseAll, IPC.animeResumeAll, IPC.animePauseAnimes, IPC.animeResumeAnimes, IPC.animeCancelAnimes, IPC.animeRemoveEpisode, IPC.animeRemoveAnime, IPC.animeOpenFolder, IPC.animeProgress, IPC.animeStreamClose, IPC.animeHistoryRecord, IPC.animeHistoryRemove, IPC.animeHistoryClear].forEach((channel) => {
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
    const { service, queue, db, fileExists } = deps;
    let migrating = false;

    ipcMain.handle(IPC.animeStatus, (): AnimeStatus => {
        return { supported: true, available: service.isAvailable(), aniCli: service.info() };
    });
    ipcMain.handle(IPC.animeSearch, async (_event, query, loaded) => {
        const cleaned = validQuery(query);
        const already = asLoadedCount(loaded);
        if (cleaned === null || already === null) {
            return invalid('The search is empty or the number of results already listed is invalid.');
        }
        const result = await service.searchListing(cleaned, already + 1);
        if (result.status === 'done') {
            return { ok: true, ...result.value };
        }
        return { ok: false, error: result.status === 'error' ? result.error : { code: 'UNKNOWN', raw: 'The search was cancelled.' } };
    });
    ipcMain.handle(IPC.animeEpisodes, async (_event, query, index) => {
        const cleaned = validQuery(query);
        if (cleaned === null || typeof index !== 'number' || !isValidIndex(index)) {
            return invalid('The search or the position is invalid.');
        }
        const result = await service.episodes(cleaned, index);
        if (result.status === 'done') {
            return { ok: true, episodes: result.value };
        }
        return { ok: false, error: result.status === 'error' ? result.error : { code: 'UNKNOWN', raw: 'The search was cancelled.' } };
    });
    ipcMain.handle(IPC.animeCover, (_event, title): Promise<string | null> => {
        const cleaned = asText(title).trim().slice(0, MAX_TEXT_LENGTH);
        return cleaned.length === 0 ? Promise.resolve(null) : deps.covers.find(cleaned);
    });
    ipcMain.handle(IPC.animeUpdates, (): AnimeUpdateEntry[] => {
        return db.updates();
    });
    ipcMain.handle(IPC.animeUpdatesClear, (): void => {
        db.clearUpdates();
    });
    ipcMain.handle(IPC.animeCheckNew, (_event, animeId): Promise<AnimeCheckResponse> | AnimeCheckResponse => {
        if (animeId === null) {
            return deps.updates.checkNow('manual');
        }
        const id = asId(animeId);
        if (id === null) {
            return { ok: false, error: { code: 'UNKNOWN', message: 'The anime is invalid.' } };
        }
        return deps.updates.checkAnime(id);
    });
    ipcMain.handle(IPC.animeCheckState, (): AnimeCheckState => {
        return deps.updates.state();
    });
    ipcMain.handle(IPC.animeSetAiring, (_event, animeId, override): void => {
        const id = asId(animeId);
        const chosen = override === null ? null : (ANIME_AIRING_OVERRIDES.find((candidate) => {
            return candidate === override;
        }) ?? undefined);
        if (id === null || chosen === undefined || db.getAnime(id) === null) {
            return;
        }
        db.setAiringOverride(id, chosen);
        deps.onLibraryChanged();
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
        if (request.series && request.season && db.seasonTaken(request.series, request.season, db.findAnime(request.title)?.id ?? 0)) {
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
            ...(request.sourceId === undefined ? {} : { sourceId: request.sourceId }),
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
    function present(anime: LibraryAnime): LibraryAnime {
        return {
            ...anime,
            episodes: anime.episodes.map((episode) => {
                return { ...episode, fileMissing: episode.status === 'done' && (episode.filePath === null || !fileExists(episode.filePath)) };
            })
        };
    }
    ipcMain.handle(IPC.animeLibrary, () => {
        return db.list().map(present);
    });
    ipcMain.handle(IPC.animeLibraryEntry, (_event, animeId: unknown): LibraryAnime | null => {
        const id = asId(animeId);
        const anime = id === null ? null : db.getLibraryAnime(id);
        return anime === null ? null : present(anime);
    });
    ipcMain.handle(IPC.animeCheckAudio, async (): Promise<AnimeAudioCheckResponse> => {
        const result = await deps.checkAudio();
        if (result.ok) {
            deps.onLibraryChanged();
        }
        return result;
    });
    ipcMain.handle(IPC.animeRepairEpisodes, async (_event, ids): Promise<AnimeRepairResponse> => {
        const result = await deps.repairEpisodes(validIds(ids));
        if (result.ok) {
            deps.onLibraryChanged();
        }
        return result;
    });
    ipcMain.handle(IPC.animeImportLibrary, async (): Promise<AnimeImportResponse> => {
        const result = await deps.importLibrary();
        if (result.ok) {
            deps.onLibraryChanged();
        }
        return result;
    });
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
    ipcMain.handle(IPC.animeRedownload, (_event, episodeId): void => {
        const id = asId(episodeId);
        if (id !== null) {
            queue.redownload(id);
        }
    });
    ipcMain.handle(IPC.animeRedownloadMany, (_event, ids): void => {
        queue.redownloadEpisodes(validIds(ids));
    });
    ipcMain.handle(IPC.animeClearFinished, (): void => {
        queue.clearFinished();
    });
    ipcMain.handle(IPC.animeQueueHeld, (): boolean => {
        return queue.isHeld();
    });
    ipcMain.handle(IPC.animePauseAll, (): void => {
        queue.pauseAll();
    });
    ipcMain.handle(IPC.animeResumeAll, (): void => {
        queue.resumeAll();
    });
    ipcMain.handle(IPC.animePauseAnimes, (_event, animeIds): void => {
        queue.pauseAnimes(validIds(animeIds));
    });
    ipcMain.handle(IPC.animeResumeAnimes, (_event, animeIds): void => {
        queue.resumeAnimes(validIds(animeIds));
    });
    ipcMain.handle(IPC.animeCancelAnimes, (_event, animeIds): void => {
        queue.cancelAnimes(validIds(animeIds));
    });
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
        const others = db.list().flatMap((remaining) => {
            return remaining.episodes.flatMap((episode) => {
                return episode.filePath === null ? [] : [episode.filePath];
            });
        });
        deps.removeFolders(foldersWithoutOthers(animeFoldersToRemove(anime.title, files, deps.baseDirectory(), deps.platform), others, deps.platform));
        deps.removeEmptyFolders(emptiedFolders(anime.episodes, deps.platform));
        deps.onLibraryChanged();
    });
    const refreshMetadataOf = (animeId: number): void => {
        db.getLibraryAnime(animeId)?.episodes.forEach((episode) => {
            if (episode.status === 'done') {
                deps.refreshMetadata(episode.id);
            }
        });
    };
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
            return { ok: false, reason: 'season-taken', suggested: db.firstFreeSeason(current.series, [id]) };
        }
        refreshMetadataOf(id);
        deps.onLibraryChanged();
        return { ok: true };
    });
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
        const episode = asText(raw.episode);
        const { index } = raw;
        if (query === null || typeof index !== 'number' || !isValidIndex(index) || !isValidEpisode(episode)) {
            return invalid('The search, the position or the episode is invalid.');
        }
        const result = await service.resolveStream({ query, index, episode, quality: deps.streamQuality() });
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
    ipcMain.handle(IPC.animeSubtitleDelete, (_event, episodeId, trackId): AnimeSubtitleDeleteResponse => {
        const id = asId(episodeId);
        const track = asTrackId(trackId);
        if (id === null || track === undefined || track === null || track.length === 0) {
            return { ok: false, reason: 'missing' };
        }
        const result = deps.subtitles.deleteTranslated(id, track);
        if (result.ok) {
            deps.refreshMetadata(id);
        }
        return result;
    });
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
    const translateAndRefresh = async (request: SubtitleTranslateRequest): Promise<SubtitleTranslateResponse> => {
        const result = await deps.subtitles.translate(request);
        if (result.ok) {
            deps.refreshMetadata(request.episodeId);
        }
        return result;
    };
    ipcMain.handle(IPC.animeSubtitleTranslate, (_event, input): Promise<SubtitleTranslateResponse> => {
        const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
        const episodeId = asId(raw.episodeId);
        const trackId = asTrackId(raw.trackId);
        const language = asLanguage(raw.language);
        if (episodeId === null || trackId === undefined || language === null) {
            return Promise.resolve({ ok: false, reason: 'missing' });
        }
        return translateAndRefresh({ episodeId, trackId, language, replace: true });
    });
    ipcMain.handle(IPC.animeSubtitleTranslateEstimate, (_event, input): Promise<SubtitleEstimateResponse> => {
        const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
        const episodeId = asId(raw.episodeId);
        const trackId = asTrackId(raw.trackId);
        if (episodeId === null || trackId === undefined) {
            return Promise.resolve({ ok: false, reason: 'missing' });
        }
        return deps.subtitles.estimate({ episodeId, trackId });
    });
    ipcMain.handle(IPC.animeSubtitleTranslatable, (_event, episodeIds): SubtitleTranslatableResponse => {
        return deps.subtitles.translatable(validIds(episodeIds).slice(0, MAX_EPISODES_PER_REQUEST));
    });
    ipcMain.handle(IPC.animeSubtitleTranslateMany, (_event, input): number => {
        const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
        const language = asLanguage(raw.language);
        const ids = validIds(raw.episodeIds).slice(0, MAX_EPISODES_PER_REQUEST);
        if (language === null) {
            return 0;
        }
        ids.forEach((episodeId) => {
            void translateAndRefresh({ episodeId, trackId: null, language, replace: false });
        });
        return ids.length;
    });
    ipcMain.handle(IPC.animeSubtitleTranslateCancel, (_event, episodeId): void => {
        if (episodeId === null) {
            deps.subtitles.cancelTranslation(null);
            return;
        }
        const id = asId(episodeId);
        if (id !== null) {
            deps.subtitles.cancelTranslation(id);
        }
    });
    ipcMain.handle(IPC.animeSubtitleGenerate, async (_event, input): Promise<SubtitleGenerateResponse> => {
        const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
        const episodeId = asId(raw.episodeId);
        const audioLanguage = asSpokenLanguage(raw.audioLanguage);
        const language = asLanguage(raw.language);
        if (episodeId === null || audioLanguage === null || language === null) {
            return { ok: false, reason: 'missing' };
        }
        const result = await deps.subtitles.generate({ episodeId, audioLanguage, language });
        if (result.ok) {
            deps.refreshMetadata(episodeId);
        }
        return result;
    });
    ipcMain.handle(IPC.animeSubtitleGenerateEstimate, (_event, episodeId): Promise<SubtitleGenerateEstimateResponse> => {
        const id = asId(episodeId);
        return id === null ? Promise.resolve({ ok: false, reason: 'missing' }) : deps.subtitles.estimateGeneration(id);
    });
    ipcMain.handle(IPC.animeSubtitleGenerateCancel, (_event, episodeId): void => {
        const id = asId(episodeId);
        if (id !== null) {
            deps.subtitles.cancelGeneration(id);
        }
    });
    ipcMain.handle(IPC.animeSubtitleJobs, (): SubtitleJobs => {
        return deps.subtitles.jobs();
    });
    ipcMain.handle(IPC.animeProgress, (_event, input): void => {
        const update = parseProgress(input);
        if (update !== null) {
            db.saveProgress(update);
            deps.refreshMetadata(update.episodeId);
        }
    });
}
