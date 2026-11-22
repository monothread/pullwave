import type { RepairResult } from './imageHeaderRepair';
import { posix, win32 } from 'node:path';
import type { AniDownloadProgress, AniError, AniErrorCode, AniPartStart, AnimeAddRequest, AnimeAddResponse, AnimeDownloadRequest, AnimeEpisodeRecord, AnimeJob, AnimeRecord, LibraryAnime } from '@shared/anime';
import { ANIME_JOIN_STEP } from '@shared/anime';
import { CONCURRENT_DOWNLOADS } from '@shared/constants';
import type { DownloadPart, Settings } from '@shared/types';
import type { AnimeDb } from './animeDb';
import {
    animeBaseDirectory,
    animeDownloadDirectory,
    animeFileName,
    animeFolderOf,
    episodeDownloadDirectory,
    episodeFolderOf,
    seasonDownloadDirectory
} from './animeFiles';
import type { AniDownloadHandle, AniDownloadOptions } from './aniCliService';

const MIN_PERCENT_STEP = 0.5;

export interface AnimeQueueDependencies {
    db: AnimeDb;
    download: (options: AniDownloadOptions) => AniDownloadHandle;
    getSettings: () => Settings;
    defaultDownloadDir: string;
    ensureDirectory: (path: string) => void;
    fileSize: (path: string) => number | null;
    directoryExists: (path: string) => boolean;
    onEpisodeDownloaded?: (episodeId: number) => void;
    hasAudio?: (path: string) => Promise<boolean | null>;
    repairVideo?: (path: string) => Promise<RepairResult>;
    onJobUpdate: (job: AnimeJob) => void;
    onLibraryChanged: () => void;
    onLibraryEntryChanged: (animeId: number) => void;
    onHeldChange?: (held: boolean) => void;
    removeDirectory?: (path: string) => void;
    removeFile?: (path: string) => void;
    platform?: NodeJS.Platform;
    sourceProvider?: () => string | null;
    maxConcurrent?: number;
}

interface PendingReplacement {
    animeId: number;
    episodeNumber: string;
    filePath: string;
    sizeBytes: number | null;
    noAudio: boolean;
}

export const ANIME_SHUTDOWN_TIMEOUT_MS = 5000;
export const ANIME_MAX_TRIES = 3;
const FINAL_ERRORS: ReadonlySet<AniErrorCode> = new Set<AniErrorCode>(['NO_RESULTS', 'NO_SOURCES', 'EPISODE_NOT_RELEASED', 'INVALID_SELECTION', 'BINARY_MISSING']);

function isActive(job: AnimeJob): boolean {
    return job.status === 'queued' || job.status === 'running';
}

export class AnimeDownloadQueue {
    private readonly jobs = new Map<number, AnimeJob>();
    private readonly handles = new Map<number, AniDownloadHandle>();
    private readonly lastReported = new Map<number, number>();
    private readonly currentParts = new Map<number, number>();
    private readonly downloadDirs = new Map<number, string>();
    private closed = false;
    private readonly pauseRequested = new Set<number>();
    private readonly tries = new Map<number, number>();
    private held = false;
    private readonly startsWhileHeld = new Set<number>();
    private readonly pendingReplacements = new Map<number, PendingReplacement>();
    private readonly replacementDirs = new Map<number, string>();

    constructor(private readonly deps: AnimeQueueDependencies) {}

    list(): AnimeJob[] {
        return [...this.jobs.values()];
    }

    pendingCount(): number {
        return this.list().filter(isActive).length;
    }

    isHeld(): boolean {
        return this.held;
    }

    enqueue(request: AnimeDownloadRequest): LibraryAnime | null {
        const anime = this.deps.db.upsertAnime({ title: request.title, query: request.query, searchIndex: request.index, sourceId: request.sourceId ?? null, sourceProvider: this.deps.sourceProvider?.() ?? null });
        if (request.series && request.season) {
            this.deps.db.setSeries(anime.id, request.series, request.season, request.seasonName === undefined ? anime.seasonName : request.seasonName);
        }
        request.episodes.forEach((number) => {
            this.queueEpisode(anime, this.deps.db.ensureEpisode(anime.id, number));
        });
        this.deps.onLibraryChanged();
        this.pump();
        return this.deps.db.getLibraryAnime(anime.id);
    }

    addToLibrary(request: AnimeAddRequest): AnimeAddResponse {
        const known = this.deps.db.findAnime(request.title, request.sourceId, this.deps.sourceProvider?.() ?? null);
        const joins = known === null && request.series !== null && request.season !== null;
        if (joins && this.deps.db.seasonTaken(request.series as string, request.season as number, 0)) {
            return { ok: false, reason: 'season-taken', suggested: this.deps.db.firstFreeSeason(request.series as string) };
        }
        const anime = this.deps.db.upsertAnime({ title: request.title, query: request.query, searchIndex: request.index, sourceId: request.sourceId ?? null, sourceProvider: this.deps.sourceProvider?.() ?? null });
        if (joins) {
            this.deps.db.setSeries(anime.id, request.series, request.season, request.seasonName);
        }
        this.deps.db.registerEpisodes(anime.id, request.episodes);
        this.deps.onLibraryChanged();
        return { ok: true, anime: this.deps.db.getLibraryAnime(anime.id) as LibraryAnime };
    }

    downloadMissing(animeIds: readonly number[]): void {
        animeIds.forEach((animeId) => {
            const anime = this.deps.db.getAnime(animeId);
            if (!anime) {
                return;
            }
            this.deps.db.getLibraryAnime(animeId)?.episodes.forEach((episode) => {
                if (episode.status !== 'done' && !this.isActiveJob(episode.id)) {
                    this.queueEpisode(anime, this.deps.db.ensureEpisode(anime.id, episode.number));
                }
            });
        });
        this.deps.onLibraryChanged();
        this.pump();
    }

    downloadEpisodes(animeId: number, numbers: readonly string[]): void {
        const anime = this.deps.db.getAnime(animeId);
        if (!anime) {
            return;
        }
        numbers.forEach((number) => {
            this.queueEpisode(anime, this.deps.db.ensureEpisode(anime.id, number));
        });
        this.deps.onLibraryChanged();
        this.pump();
    }

    retry(episodeId: number): void {
        const episode = this.deps.db.getEpisode(episodeId);
        const anime = episode ? this.deps.db.getAnime(episode.animeId) : null;
        if (!episode || !anime || episode.status === 'done' || this.isActiveJob(episodeId)) {
            return;
        }
        this.tries.delete(episodeId);
        this.queueEpisode(anime, this.deps.db.ensureEpisode(anime.id, episode.number));
        this.deps.onLibraryEntryChanged(anime.id);
        this.pump();
    }

    redownload(episodeId: number): void {
        if (this.closed) {
            return;
        }
        const episode = this.deps.db.getEpisode(episodeId);
        const anime = episode ? this.deps.db.getAnime(episode.animeId) : null;
        if (!episode || !anime || episode.status !== 'done' || this.isActiveJob(episodeId) || !this.canQueueReplacement(episode)) {
            return;
        }
        if (!this.isFileMissing(episode) && episode.filePath !== null) {
            if (this.hasFreeSlot()) {
                const platform = this.deps.platform ?? process.platform;
                const downloadDir = this.downloadDirectoryOf(anime, episode.number, platform);
                try {
                    this.deps.ensureDirectory(downloadDir);
                    this.deps.removeFile?.(episode.filePath);
                } catch {
                    return;
                }
                this.replacementDirs.set(episodeId, downloadDir);
            } else {
                this.pendingReplacements.set(episodeId, {
                    animeId: anime.id,
                    episodeNumber: episode.number,
                    filePath: episode.filePath,
                    sizeBytes: episode.sizeBytes,
                    noAudio: episode.noAudio
                });
            }
        }
        this.deps.db.markForRedownload(episodeId);
        this.queueEpisode(anime, this.deps.db.ensureEpisode(anime.id, episode.number));
        this.deps.onLibraryEntryChanged(anime.id);
        this.pump();
    }

    redownloadEpisodes(episodeIds: readonly number[]): void {
        episodeIds.forEach((episodeId) => {
            this.redownload(episodeId);
        });
    }

    restore(): void {
        this.deps.db.pausedEpisodes().forEach((episode) => {
            const anime = this.deps.db.getAnime(episode.animeId);
            if (anime === null || this.jobs.has(episode.id)) {
                return;
            }
            this.jobs.set(episode.id, { ...this.newJob(anime, episode), status: 'paused' });
        });
    }

    pause(episodeId: number): void {
        const job = this.jobs.get(episodeId);
        const handle = this.handles.get(episodeId);
        if (job?.status !== 'running' || !handle) {
            return;
        }
        this.pauseRequested.add(episodeId);
        handle.cancel();
    }

    resume(episodeId: number): void {
        if (this.deps.db.getEpisode(episodeId)?.status !== 'paused') {
            return;
        }
        if (this.held) {
            this.startsWhileHeld.add(episodeId);
        }
        this.retry(episodeId);
    }

    pauseAll(): void {
        this.setHeld(true);
        this.startsWhileHeld.clear();
        this.list().forEach((job) => {
            if (job.status === 'running') {
                this.pause(job.episodeId);
            }
        });
        this.deps.onLibraryChanged();
    }

    resumeAll(): void {
        this.setHeld(false);
        this.startsWhileHeld.clear();
        this.list().forEach((job) => {
            if (job.status === 'paused') {
                this.resume(job.episodeId);
            }
        });
        this.pump();
    }

    pauseAnimes(animeIds: readonly number[]): void {
        this.jobsOfAnimes(animeIds).forEach((job) => {
            if (job.status === 'running') {
                this.pause(job.episodeId);
            } else if (job.status === 'queued') {
                this.pauseWaiting(job);
            }
        });
        this.deps.onLibraryChanged();
    }

    resumeAnimes(animeIds: readonly number[]): void {
        this.jobsOfAnimes(animeIds).forEach((job) => {
            if (job.status === 'paused') {
                this.resume(job.episodeId);
            }
        });
        this.pump();
    }

    cancelAnimes(animeIds: readonly number[]): void {
        this.jobsOfAnimes(animeIds).forEach((job) => {
            if (job.status === 'queued' || job.status === 'running' || job.status === 'paused') {
                this.cancel(job.episodeId);
            }
        });
    }

    cancel(episodeId: number): void {
        const job = this.jobs.get(episodeId);
        if (!job || (!isActive(job) && job.status !== 'paused')) {
            return;
        }
        const handle = this.handles.get(episodeId);
        if (handle) {
            this.pauseRequested.delete(episodeId);
            handle.cancel();
            return;
        }
        const replacement = this.pendingReplacements.get(episodeId);
        if (replacement !== undefined) {
            this.pendingReplacements.delete(episodeId);
            this.restoreReplacement(episodeId, replacement);
            this.startsWhileHeld.delete(episodeId);
            this.tries.delete(episodeId);
            this.update(job, { status: 'cancelled' });
            this.deps.onLibraryEntryChanged(job.animeId);
            return;
        }
        this.removePartial(job.animeId, job.episode);
        this.startsWhileHeld.delete(episodeId);
        this.tries.delete(episodeId);
        this.deps.db.markFailed(episodeId, 'cancelled', null);
        this.update(job, { status: 'cancelled' });
        this.deps.onLibraryEntryChanged(job.animeId);
    }

    clearFinished(): void {
        this.list().forEach((job) => {
            if (!isActive(job) && job.status !== 'paused') {
                this.jobs.delete(job.episodeId);
            }
        });
    }

    forget(episodeIds: number[]): void {
        episodeIds.forEach((episodeId) => {
            const handle = this.handles.get(episodeId);
            const episode = this.deps.db.getEpisode(episodeId);
            const replacement = this.pendingReplacements.get(episodeId);
            if (replacement !== undefined) {
                this.pendingReplacements.delete(episodeId);
                this.restoreReplacement(episodeId, replacement);
            } else if (handle) {
                handle.cancel();
            } else if (episode && episode.status !== 'done') {
                this.removePartial(episode.animeId, episode.number);
            }
            this.jobs.delete(episodeId);
            this.lastReported.delete(episodeId);
            this.currentParts.delete(episodeId);
            this.pauseRequested.delete(episodeId);
            this.startsWhileHeld.delete(episodeId);
            this.tries.delete(episodeId);
            this.replacementDirs.delete(episodeId);
        });
        this.pump();
    }

    hasRunsToEnd(): boolean {
        return this.handles.size > 0;
    }

    async shutdown(timeoutMs: number = ANIME_SHUTDOWN_TIMEOUT_MS): Promise<void> {
        this.closed = true;
        this.pendingReplacements.forEach((replacement, episodeId) => {
            this.restoreReplacement(episodeId, replacement);
        });
        this.pendingReplacements.clear();
        if (this.held) {
            this.list().forEach((job) => {
                if (job.status === 'queued' && !this.handles.has(job.episodeId)) {
                    const episode = this.deps.db.getEpisode(job.episodeId);
                    if (episode !== null && episode.status !== 'done') {
                        this.deps.db.markPaused(job.episodeId);
                    }
                }
            });
        }
        const ending: Array<Promise<unknown>> = [];
        const discarded: string[] = [];
        this.handles.forEach((handle, episodeId) => {
            const directory = this.downloadDirs.get(episodeId);
            if (this.pauseRequested.has(episodeId)) {
                this.deps.db.markPaused(episodeId);
            } else if (directory !== undefined) {
                discarded.push(directory);
            }
            ending.push(handle.result);
            handle.cancel();
        });
        if (ending.length > 0) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([
                Promise.allSettled(ending),
                new Promise((resolve) => {
                    timer = setTimeout(resolve, timeoutMs);
                })
            ]);
            clearTimeout(timer);
        }
        discarded.forEach((directory) => {
            this.deps.removeDirectory?.(directory);
        });
    }

    private jobsOfAnimes(animeIds: readonly number[]): AnimeJob[] {
        const wanted = new Set(animeIds);
        return this.list().filter((job) => {
            return wanted.has(job.animeId);
        });
    }

    private pauseWaiting(job: AnimeJob): void {
        this.startsWhileHeld.delete(job.episodeId);
        this.deps.db.markPaused(job.episodeId);
        this.update(job, { status: 'paused' });
    }

    private setHeld(held: boolean): void {
        if (this.held !== held) {
            this.held = held;
            this.deps.onHeldChange?.(held);
        }
    }

    private hasFreeSlot(): boolean {
        const limit = this.deps.maxConcurrent ?? CONCURRENT_DOWNLOADS;
        return !this.closed && !this.held && this.handles.size < limit;
    }

    private canStart(job: AnimeJob): boolean {
        if (job.status !== 'queued' || this.handles.has(job.episodeId)) {
            return false;
        }
        return !this.held || this.startsWhileHeld.has(job.episodeId);
    }

    private isActiveJob(episodeId: number): boolean {
        const job = this.jobs.get(episodeId);
        return job !== undefined && isActive(job);
    }

    private newJob(anime: AnimeRecord, episode: AnimeEpisodeRecord): AnimeJob {
        return {
            episodeId: episode.id,
            animeId: anime.id,
            animeTitle: anime.title,
            episode: episode.number,
            status: 'queued',
            percent: 0,
            speed: '',
            eta: '',
            error: null,
            parts: null,
            postProcess: null,
            postProcessSteps: []
        };
    }

    private isFileMissing(episode: AnimeEpisodeRecord): boolean {
        return episode.filePath === null || this.deps.fileSize(episode.filePath) === null;
    }

    private canQueueReplacement(episode: AnimeEpisodeRecord): boolean {
        if (this.isFileMissing(episode)) {
            return true;
        }
        return episode.noAudio && episode.filePath !== null && this.deps.removeFile !== undefined;
    }

    private restoreReplacement(episodeId: number, replacement: PendingReplacement): void {
        this.deps.db.markDone(episodeId, replacement.filePath, replacement.sizeBytes);
        if (replacement.noAudio) {
            this.deps.db.markAudioChecked(episodeId, replacement.filePath, false);
        }
    }

    private queueEpisode(anime: AnimeRecord, episode: AnimeEpisodeRecord): void {
        if (episode.status === 'done' || this.isActiveJob(episode.id)) {
            return;
        }
        const job = this.newJob(anime, episode);
        this.jobs.set(episode.id, job);
        this.deps.onJobUpdate({ ...job });
    }

    private downloadDirectoryOf(anime: AnimeRecord, episode: string, platform: NodeJS.Platform): string {
        const animeDirectory = this.existingAnimeDirectory(anime.id, platform) ?? this.newAnimeDirectory(anime, this.deps.getSettings(), platform);
        return episodeDownloadDirectory(animeDirectory, episode, platform);
    }

    private removePartial(animeId: number, episode: string): void {
        const anime = this.deps.db.getAnime(animeId);
        if (anime) {
            this.deps.removeDirectory?.(this.downloadDirectoryOf(anime, episode, this.deps.platform ?? process.platform));
        }
    }

    private update(job: AnimeJob, changes: Partial<AnimeJob>): void {
        Object.assign(job, changes);
        this.deps.onJobUpdate({ ...job });
    }

    private pump(): void {
        if (this.closed) {
            return;
        }
        const limit = this.deps.maxConcurrent ?? CONCURRENT_DOWNLOADS;
        let running = this.handles.size;
        for (const job of this.jobs.values()) {
            if (running >= limit) {
                return;
            }
            if (this.canStart(job) && this.launch(job)) {
                running += 1;
            }
        }
    }

    private launch(job: AnimeJob): boolean {
        const { db } = this.deps;
        const anime = db.getAnime(job.animeId);
        if (!anime) {
            this.pendingReplacements.delete(job.episodeId);
            this.jobs.delete(job.episodeId);
            return false;
        }
        const settings = this.deps.getSettings();
        const platform = this.deps.platform ?? process.platform;
        const overrideDir = this.replacementDirs.get(job.episodeId);
        this.replacementDirs.delete(job.episodeId);
        const downloadDir = overrideDir ?? this.downloadDirectoryOf(anime, job.episode, platform);
        const replacement = this.pendingReplacements.get(job.episodeId);
        if (replacement !== undefined) {
            this.pendingReplacements.delete(job.episodeId);
            try {
                this.deps.ensureDirectory(downloadDir);
                this.deps.removeFile?.(replacement.filePath);
            } catch {
                this.restoreReplacement(job.episodeId, replacement);
                this.startsWhileHeld.delete(job.episodeId);
                this.update(job, { status: 'cancelled' });
                this.jobs.delete(job.episodeId);
                this.deps.onLibraryEntryChanged(job.animeId);
                return false;
            }
        } else {
            try {
                this.deps.ensureDirectory(downloadDir);
            } catch (error) {
                this.finishWithError(job, { code: 'UNKNOWN', raw: error instanceof Error ? error.message : String(error) });
                this.deps.onLibraryEntryChanged(job.animeId);
                return false;
            }
        }
        db.markDownloading(job.episodeId);
        this.lastReported.delete(job.episodeId);
        this.currentParts.delete(job.episodeId);
        this.update(job, { status: 'running', postProcess: null, postProcessSteps: [] });
        this.deps.onLibraryEntryChanged(job.animeId);
        const handle = this.deps.download({
            query: anime.query,
            index: anime.searchIndex,
            episode: job.episode,
            quality: settings.animeQuality,
            downloadDir,
            onProgress: (progress) => {
                this.reportProgress(job, progress);
            },
            onPart: (part) => {
                this.startPart(job, part);
            },
            onJoin: () => {
                this.startJoin(job);
            }
        });
        this.handles.set(job.episodeId, handle);
        this.downloadDirs.set(job.episodeId, downloadDir);
        void handle.result.then((result) => {
            this.handles.delete(job.episodeId);
            this.downloadDirs.delete(job.episodeId);
            this.currentParts.delete(job.episodeId);
            const paused = this.pauseRequested.delete(job.episodeId);
            if (!this.jobs.has(job.episodeId)) {
                this.deps.removeDirectory?.(downloadDir);
                this.pump();
                return;
            }
            if (result.status === 'cancelled' && paused) {
                db.markPaused(job.episodeId);
                this.update(job, { status: 'paused', speed: '', eta: '', postProcess: null });
            } else if (result.status === 'cancelled') {
                if (!this.closed) {
                    this.deps.removeDirectory?.(downloadDir);
                }
                db.markFailed(job.episodeId, 'cancelled', null);
                this.update(job, { status: 'cancelled', speed: '', eta: '', postProcess: null });
            } else if (result.status === 'error') {
                this.onFailure(job, result.error);
            } else {
                this.finishDownloaded(job, result.value.filePath, downloadDir, anime.title, platform);
            }
            if (job.status !== 'queued') {
                this.startsWhileHeld.delete(job.episodeId);
            }
            this.deps.onLibraryEntryChanged(job.animeId);
            this.pump();
        });
        return true;
    }

    private newAnimeDirectory(anime: AnimeRecord, settings: Settings, platform: NodeJS.Platform): string {
        const baseDirectory = animeBaseDirectory(settings, this.deps.defaultDownloadDir, platform);
        if (anime.series !== null && anime.season !== null) {
            return seasonDownloadDirectory(baseDirectory, anime.series, anime.season, anime.title, platform);
        }
        return animeDownloadDirectory(baseDirectory, anime.title, platform);
    }

    private existingAnimeDirectory(animeId: number, platform: NodeJS.Platform): string | null {
        const downloaded = this.deps.db.getLibraryAnime(animeId)?.episodes.find((episode) => {
            return episode.status === 'done' && episode.filePath !== null && episodeFolderOf(episode.filePath, episode.number, platform) !== null;
        });
        if (downloaded?.filePath) {
            const folder = animeFolderOf(downloaded.filePath, downloaded.number, platform);
            if (this.deps.directoryExists(folder)) {
                return folder;
            }
        }
        for (const replacement of this.pendingReplacements.values()) {
            if (replacement.animeId === animeId && episodeFolderOf(replacement.filePath, replacement.episodeNumber, platform) !== null) {
                const folder = animeFolderOf(replacement.filePath, replacement.episodeNumber, platform);
                if (this.deps.directoryExists(folder)) {
                    return folder;
                }
            }
        }
        return null;
    }

    private reportProgress(job: AnimeJob, progress: AniDownloadProgress): void {
        const last = this.lastReported.get(job.episodeId) ?? 0;
        if (progress.percent < 100 && Math.abs(progress.percent - last) < MIN_PERCENT_STEP) {
            return;
        }
        this.lastReported.set(job.episodeId, progress.percent);
        this.update(job, { percent: progress.percent, speed: progress.speed ?? '', eta: progress.eta ?? '', parts: this.partsAfter(job, progress.percent) });
    }

    private startPart(job: AnimeJob, part: AniPartStart): void {
        this.currentParts.set(job.episodeId, part.index);
        this.lastReported.delete(job.episodeId);
        const parts = part.kinds.map((kind, position): DownloadPart => {
            return { kind, percent: position < part.index ? 100 : 0 };
        });
        this.update(job, { parts });
    }

    private startJoin(job: AnimeJob): void {
        const parts = job.parts?.map((part): DownloadPart => {
            return { ...part, percent: 100 };
        }) ?? null;
        this.update(job, { parts, percent: 100, speed: '', eta: '', postProcess: ANIME_JOIN_STEP, postProcessSteps: [...job.postProcessSteps, ANIME_JOIN_STEP] });
    }

    private partsAfter(job: AnimeJob, percent: number): DownloadPart[] | null {
        const index = this.currentParts.get(job.episodeId);
        if (job.parts === null || index === undefined) {
            return job.parts;
        }
        return job.parts.map((part, position) => {
            return position === index ? { ...part, percent: Math.min(100, Math.max(0, percent)) } : part;
        });
    }

    private onFailure(job: AnimeJob, error: AniError): void {
        const tries = (this.tries.get(job.episodeId) ?? 0) + 1;
        if (FINAL_ERRORS.has(error.code) || tries >= ANIME_MAX_TRIES) {
            this.tries.delete(job.episodeId);
            this.finishWithError(job, error);
            return;
        }
        this.tries.set(job.episodeId, tries);
        this.deps.db.ensureEpisode(job.animeId, job.episode);
        this.update(job, { status: 'queued', speed: '', eta: '', error: null, postProcess: null });
    }

    private finishDownloaded(job: AnimeJob, filePath: string | null, downloadDir: string, title: string, platform: NodeJS.Platform): void {
        const path = filePath ?? (platform === 'win32' ? win32 : posix).join(downloadDir, animeFileName(title, job.episode));
        const size = this.deps.fileSize(path);
        if (size === null) {
            this.finishWithError(job, { code: 'UNKNOWN', raw: `The downloaded file was not found: ${path}` });
            return;
        }
        this.tries.delete(job.episodeId);
        this.deps.db.markDone(job.episodeId, path, size);
        this.deps.onEpisodeDownloaded?.(job.episodeId);
        this.update(job, { status: 'done', percent: 100, speed: '', eta: '', postProcess: null });
        this.jobs.delete(job.episodeId);
        void this.afterDownload(job.animeId, job.episodeId, path);
    }

    private async afterDownload(animeId: number, episodeId: number, path: string): Promise<void> {
        await this.repairVideo(animeId, episodeId, path);
        await this.checkAudio(animeId, episodeId, path);
    }

    private async repairVideo(animeId: number, episodeId: number, path: string): Promise<void> {
        if (!this.deps.repairVideo) {
            return;
        }
        try {
            const result = await this.deps.repairVideo(path);
            if (result.status === 'repaired') {
                this.deps.db.updateFileSize(episodeId, path, result.sizeBytes);
                this.deps.onLibraryEntryChanged(animeId);
            }
        } catch {
            return;
        }
    }

    private async checkAudio(animeId: number, episodeId: number, path: string): Promise<void> {
        if (!this.deps.hasAudio) {
            return;
        }
        try {
            const hasAudio = await this.deps.hasAudio(path);
            if (hasAudio !== null) {
                this.deps.db.markAudioChecked(episodeId, path, hasAudio);
                this.deps.onLibraryEntryChanged(animeId);
            }
        } catch {
            return;
        }
    }

    private finishWithError(job: AnimeJob, error: AniError): void {
        this.deps.db.markFailed(job.episodeId, 'error', error);
        this.update(job, { status: 'error', speed: '', eta: '', error, postProcess: null });
    }
}
