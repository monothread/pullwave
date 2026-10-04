import { posix, win32 } from 'node:path';
import type { AniDownloadProgress, AniError, AnimeAddRequest, AnimeAddResponse, AnimeDownloadRequest, AnimeEpisodeRecord, AnimeJob, AnimeRecord, LibraryAnime } from '@shared/anime';
import type { Settings } from '@shared/types';
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

// Progress lines come many times a second; the screen only needs to hear about a visible change.
const MIN_PERCENT_STEP = 0.5;

export interface AnimeQueueDependencies {
    db: AnimeDb;
    download: (options: AniDownloadOptions) => AniDownloadHandle;
    getSettings: () => Settings;
    defaultDownloadDir: string;
    ensureDirectory: (path: string) => void;
    // The size of a file, or null when it is not there.
    fileSize: (path: string) => number | null;
    // Whether a folder is there.
    directoryExists: (path: string) => boolean;
    // An episode was downloaded and is in the library: what is kept beside the video can be written.
    onEpisodeDownloaded?: (episodeId: number) => void;
    onJobUpdate: (job: AnimeJob) => void;
    onLibraryChanged: () => void;
    // Deletes a folder with what is in it (the folder of an episode whose download was cut short by closing the app).
    removeDirectory?: (path: string) => void;
    // The system the files are on (decides the rules of file names); this one by default.
    platform?: NodeJS.Platform;
}

// How long closing the app waits for the downloads to end before it deletes what they left behind.
export const ANIME_SHUTDOWN_TIMEOUT_MS = 5000;

function isActive(job: AnimeJob): boolean {
    return job.status === 'queued' || job.status === 'running';
}

export class AnimeDownloadQueue {
    private readonly jobs = new Map<number, AnimeJob>();
    private readonly handles = new Map<number, AniDownloadHandle>();
    private readonly lastReported = new Map<number, number>();
    // The folder each running download writes to.
    private readonly downloadDirs = new Map<number, string>();
    private closed = false;
    // Episodes asked to pause: the run is ended on purpose, and its partial file is kept for the next one to go on from.
    private readonly pauseRequested = new Set<number>();

    constructor(private readonly deps: AnimeQueueDependencies) {}

    list(): AnimeJob[] {
        return [...this.jobs.values()];
    }

    pendingCount(): number {
        return this.list().filter(isActive).length;
    }

    // Queues the episodes (the ones already downloaded or already waiting are left as they are) and returns the anime.
    enqueue(request: AnimeDownloadRequest): LibraryAnime | null {
        const anime = this.deps.db.upsertAnime({ title: request.title, query: request.query, searchIndex: request.index, audio: request.audio });
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

    // Puts the anime in the library with all its episodes, none of them downloaded (they are `idle`; the ones it has already are left as they
    // are). The series it goes under is only set when it is new to the library: an anime that is in it already keeps the one it has. A
    // season the series already has is refused, with the one it could take.
    addToLibrary(request: AnimeAddRequest): AnimeAddResponse {
        const known = this.deps.db.findAnime(request.title, request.audio);
        const joins = known === null && request.series !== null && request.season !== null;
        if (joins && this.deps.db.seasonTaken(request.series as string, request.season as number, request.audio, 0)) {
            return { ok: false, reason: 'season-taken', suggested: this.deps.db.firstFreeSeason(request.series as string, request.audio) };
        }
        const anime = this.deps.db.upsertAnime({ title: request.title, query: request.query, searchIndex: request.index, audio: request.audio });
        if (joins) {
            this.deps.db.setSeries(anime.id, request.series, request.season, request.seasonName);
        }
        this.deps.db.registerEpisodes(anime.id, request.episodes);
        this.deps.onLibraryChanged();
        return { ok: true, anime: this.deps.db.getLibraryAnime(anime.id) as LibraryAnime };
    }

    // Queues every episode of these anime that is not downloaded and not waiting or downloading already (the ones that were not
    // downloaded yet, failed, were cancelled or paused).
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

    // Queues an episode of the library again (after an error or a cancellation, also after the app was restarted).
    retry(episodeId: number): void {
        const episode = this.deps.db.getEpisode(episodeId);
        const anime = episode ? this.deps.db.getAnime(episode.animeId) : null;
        if (!episode || !anime || episode.status === 'done' || this.isActiveJob(episodeId)) {
            return;
        }
        this.queueEpisode(anime, this.deps.db.ensureEpisode(anime.id, episode.number));
        this.deps.onLibraryChanged();
        this.pump();
    }

    // Ends the run of a download that is going on, keeping what it downloaded so far.
    pause(episodeId: number): void {
        const job = this.jobs.get(episodeId);
        const handle = this.handles.get(episodeId);
        if (job?.status !== 'running' || !handle) {
            return;
        }
        this.pauseRequested.add(episodeId);
        handle.cancel();
    }

    // Queues a paused episode again (also after the app was restarted): the download finds its partial file and goes on from it.
    resume(episodeId: number): void {
        if (this.deps.db.getEpisode(episodeId)?.status === 'paused') {
            this.retry(episodeId);
        }
    }

    cancel(episodeId: number): void {
        const job = this.jobs.get(episodeId);
        if (job?.status === 'paused') {
            this.deps.db.markFailed(episodeId, 'cancelled', null);
            this.update(job, { status: 'cancelled' });
            this.deps.onLibraryChanged();
            return;
        }
        if (!job || !isActive(job)) {
            return;
        }
        const handle = this.handles.get(episodeId);
        if (handle) {
            // The result of the run settles the job.
            handle.cancel();
            return;
        }
        this.deps.db.markFailed(episodeId, 'cancelled', null);
        this.update(job, { status: 'cancelled' });
        this.deps.onLibraryChanged();
    }

    clearFinished(): void {
        this.list().forEach((job) => {
            if (!isActive(job)) {
                this.jobs.delete(job.episodeId);
            }
        });
    }

    // The episodes are gone from the library: whatever is still running for them is stopped and forgotten.
    forget(episodeIds: number[]): void {
        episodeIds.forEach((episodeId) => {
            this.handles.get(episodeId)?.cancel();
            this.handles.delete(episodeId);
            this.jobs.delete(episodeId);
            this.lastReported.delete(episodeId);
            this.pauseRequested.delete(episodeId);
        });
        this.pump();
    }

    // Whether closing the app has downloads to end.
    hasRunsToEnd(): boolean {
        return this.handles.size > 0;
    }

    // Closing the app: a download that was being paused is kept as paused at once (the app may be gone before its run ends), and every
    // other one is cancelled and the folder of its episode is deleted, with the unfinished file in it.
    async shutdown(timeoutMs: number = ANIME_SHUTDOWN_TIMEOUT_MS): Promise<void> {
        this.closed = true;
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

    private isActiveJob(episodeId: number): boolean {
        const job = this.jobs.get(episodeId);
        return job !== undefined && isActive(job);
    }

    private queueEpisode(anime: AnimeRecord, episode: AnimeEpisodeRecord): void {
        if (episode.status === 'done' || this.isActiveJob(episode.id)) {
            return;
        }
        const job: AnimeJob = {
            episodeId: episode.id,
            animeId: anime.id,
            animeTitle: anime.title,
            episode: episode.number,
            status: 'queued',
            percent: 0,
            speed: '',
            eta: '',
            error: null
        };
        this.jobs.set(episode.id, job);
        this.deps.onJobUpdate({ ...job });
    }

    private update(job: AnimeJob, changes: Partial<AnimeJob>): void {
        Object.assign(job, changes);
        this.deps.onJobUpdate({ ...job });
    }

    private pump(): void {
        if (this.closed) {
            return;
        }
        const limit = this.deps.getSettings().maxConcurrent;
        let running = this.handles.size;
        for (const job of this.jobs.values()) {
            if (running >= limit) {
                return;
            }
            if (job.status === 'queued' && !this.handles.has(job.episodeId) && this.launch(job)) {
                running += 1;
            }
        }
    }

    // Whether a download was started (it is not when the job has to end right away).
    private launch(job: AnimeJob): boolean {
        const { db } = this.deps;
        const anime = db.getAnime(job.animeId);
        if (!anime) {
            this.jobs.delete(job.episodeId);
            return false;
        }
        const settings = this.deps.getSettings();
        const platform = this.deps.platform ?? process.platform;
        const animeDirectory = this.existingAnimeDirectory(anime.id, platform) ?? this.newAnimeDirectory(anime, settings, platform);
        const downloadDir = episodeDownloadDirectory(animeDirectory, job.episode, platform);
        try {
            this.deps.ensureDirectory(downloadDir);
        } catch (error) {
            this.finishWithError(job, { code: 'UNKNOWN', raw: error instanceof Error ? error.message : String(error) });
            this.deps.onLibraryChanged();
            return false;
        }
        db.markDownloading(job.episodeId);
        this.lastReported.delete(job.episodeId);
        this.update(job, { status: 'running' });
        this.deps.onLibraryChanged();
        const handle = this.deps.download({
            query: anime.query,
            index: anime.searchIndex,
            episode: job.episode,
            quality: settings.animeQuality,
            audio: anime.audio,
            downloadDir,
            onProgress: (progress) => {
                this.reportProgress(job, progress);
            }
        });
        this.handles.set(job.episodeId, handle);
        this.downloadDirs.set(job.episodeId, downloadDir);
        void handle.result.then((result) => {
            this.handles.delete(job.episodeId);
            this.downloadDirs.delete(job.episodeId);
            // The pause only counts for the run it was asked of, whichever way that run ended.
            const paused = this.pauseRequested.delete(job.episodeId);
            if (!this.jobs.has(job.episodeId)) {
                return;
            }
            if (result.status === 'cancelled' && paused) {
                db.markPaused(job.episodeId);
                this.update(job, { status: 'paused', speed: '', eta: '' });
            } else if (result.status === 'cancelled') {
                db.markFailed(job.episodeId, 'cancelled', null);
                this.update(job, { status: 'cancelled', speed: '', eta: '' });
            } else if (result.status === 'error') {
                this.finishWithError(job, result.error);
            } else {
                this.finishDownloaded(job, result.value.filePath, downloadDir, anime.title, platform);
            }
            this.deps.onLibraryChanged();
            this.pump();
        });
        return true;
    }

    // Where an anime that has nothing downloaded yet goes: the folder of its season when it is part of a series, otherwise one of
    // its own.
    private newAnimeDirectory(anime: AnimeRecord, settings: Settings, platform: NodeJS.Platform): string {
        const baseDirectory = animeBaseDirectory(settings, this.deps.defaultDownloadDir, platform);
        if (anime.series !== null && anime.season !== null) {
            return seasonDownloadDirectory(baseDirectory, anime.series, anime.season, anime.title, platform);
        }
        return animeDownloadDirectory(baseDirectory, anime.title, platform);
    }

    // The folder the anime already has, when the folder was renamed or moved the new episodes still go with the old ones. Only a
    // folder that holds the folders of the episodes counts: the videos downloaded before that sit in the folder of the anime,
    // but a video put anywhere else says nothing about where an anime goes.
    private existingAnimeDirectory(animeId: number, platform: NodeJS.Platform): string | null {
        const downloaded = this.deps.db.getLibraryAnime(animeId)?.episodes.find((episode) => {
            return episode.status === 'done' && episode.filePath !== null && episodeFolderOf(episode.filePath, episode.number, platform) !== null;
        });
        if (!downloaded?.filePath) {
            return null;
        }
        const folder = animeFolderOf(downloaded.filePath, downloaded.number, platform);
        return this.deps.directoryExists(folder) ? folder : null;
    }

    private reportProgress(job: AnimeJob, progress: AniDownloadProgress): void {
        const last = this.lastReported.get(job.episodeId) ?? 0;
        if (progress.percent < 100 && Math.abs(progress.percent - last) < MIN_PERCENT_STEP) {
            return;
        }
        this.lastReported.set(job.episodeId, progress.percent);
        this.update(job, { percent: progress.percent, speed: progress.speed ?? '', eta: progress.eta ?? '' });
    }

    private finishDownloaded(job: AnimeJob, filePath: string | null, downloadDir: string, title: string, platform: NodeJS.Platform): void {
        const path = filePath ?? (platform === 'win32' ? win32 : posix).join(downloadDir, animeFileName(title, job.episode));
        const size = this.deps.fileSize(path);
        if (size === null) {
            this.finishWithError(job, { code: 'UNKNOWN', raw: `The downloaded file was not found: ${path}` });
            return;
        }
        this.deps.db.markDone(job.episodeId, path, size);
        this.deps.onEpisodeDownloaded?.(job.episodeId);
        this.update(job, { status: 'done', percent: 100, speed: '', eta: '' });
        // The screen of the downloads is for what is going on or went wrong: a download that is complete is in the library.
        this.jobs.delete(job.episodeId);
    }

    private finishWithError(job: AnimeJob, error: AniError): void {
        this.deps.db.markFailed(job.episodeId, 'error', error);
        this.update(job, { status: 'error', speed: '', eta: '', error });
    }
}
