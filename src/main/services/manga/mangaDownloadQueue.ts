import type { LibraryManga, MangaChapterRecord, MangaDownloadRequest, MangaError, MangaJob, MangaOutputFormat, MangaRecord } from '@shared/manga';
import type { ChapterDownloadHandle, ChapterDownloadOptions } from './mangaChapterDownloader';
import type { MangaDb } from './mangaDb';
import { chapterOutputPath, chapterWorkDirectory, DEFAULT_MANGA_FOLDER, mangaDirectory, uniquePath } from './mangaFiles';
import { join } from 'node:path';

// Progress comes after every page; the screen only needs to hear about a visible change.
const MIN_PERCENT_STEP = 0.5;
// How many times a chapter is tried before it is left as an error to retry by hand.
export const MAX_TRIES = 3;
// How long closing the app waits for the downloads to end before it deletes what they left behind.
export const MANGA_SHUTDOWN_TIMEOUT_MS = 5000;
// Errors that asking again will not fix.
const FINAL_ERRORS: ReadonlySet<string> = new Set(['EMPTY_CHAPTER', 'DISK']);

export interface MangaQueueSettings {
    maxConcurrent: number;
    // Where the mangas are kept; empty means the default folder inside the downloads folder.
    mangaDirectory: string;
    mangaFormat: MangaOutputFormat;
}

export interface MangaQueueDependencies {
    db: MangaDb;
    download: (options: ChapterDownloadOptions) => ChapterDownloadHandle;
    getSettings: () => MangaQueueSettings;
    defaultDownloadDir: string;
    ensureDirectory: (path: string) => void;
    pathExists: (path: string) => boolean;
    // Deletes a file or a folder with what is in it.
    removePath: (path: string) => void;
    onJobUpdate: (job: MangaJob) => void;
    onLibraryChanged: () => void;
    // The system the files are on (decides the rules of file names); this one by default.
    platform?: NodeJS.Platform;
}

function isActive(job: MangaJob): boolean {
    return job.status === 'queued' || job.status === 'running';
}

// Downloads chapters one at a time for each source (so a site is not asked for several things at once), a few sources together.
export class MangaDownloadQueue {
    private readonly jobs = new Map<number, MangaJob>();
    private readonly handles = new Map<number, ChapterDownloadHandle>();
    private readonly lastReported = new Map<number, number>();
    private readonly tries = new Map<number, number>();
    // Where each chapter that is running or paused is being made: the same place again when it goes on.
    private readonly outputPaths = new Map<number, string>();
    private readonly pauseRequested = new Set<number>();
    private closed = false;

    constructor(private readonly deps: MangaQueueDependencies) {}

    list(): MangaJob[] {
        return [...this.jobs.values()];
    }

    pendingCount(): number {
        return this.list().filter(isActive).length;
    }

    // Puts the manga and the chapters in the library and queues them (the ones already downloaded or already waiting are left as
    // they are). Returns the manga as the library has it.
    enqueue(request: MangaDownloadRequest): LibraryManga | null {
        const known = this.deps.db.findManga(request.manga.sourceId, request.manga.remoteId) !== null;
        const manga = this.deps.db.upsertManga(request.manga);
        if (request.details !== null) {
            this.deps.db.saveDetails(manga.id, request.details);
        }
        // The oldest chapter goes first, whatever order the screen sent them in (the list shows the newest first).
        [...request.chapters]
            .sort((first, second) => {
                return first.sourceOrder - second.sourceOrder;
            })
            .forEach((chapter) => {
                this.queueChapter(manga, this.deps.db.ensureChapter(manga.id, chapter, known));
            });
        this.deps.onLibraryChanged();
        this.pump();
        return this.deps.db.getLibraryManga(manga.id);
    }

    // Puts the manga in the library with the chapters given, none of them downloaded (the ones it has already keep their state).
    addToLibrary(request: MangaDownloadRequest): LibraryManga | null {
        // The chapters a manga comes with are not new; the ones added to a manga that was there already are.
        const known = this.deps.db.findManga(request.manga.sourceId, request.manga.remoteId) !== null;
        const manga = this.deps.db.upsertManga(request.manga);
        if (request.details !== null) {
            this.deps.db.saveDetails(manga.id, request.details);
        }
        this.deps.db.registerChapters(manga.id, request.chapters, known);
        this.deps.onLibraryChanged();
        return this.deps.db.getLibraryManga(manga.id);
    }

    // Queues every chapter of these mangas that is not downloaded and not waiting or downloading already, the oldest first (the
    // order they are read in).
    downloadMissing(mangaIds: readonly number[]): void {
        mangaIds.forEach((mangaId) => {
            const manga = this.deps.db.getManga(mangaId);
            if (manga === null) {
                return;
            }
            [...this.deps.db.chaptersOf(mangaId)].reverse().forEach((chapter) => {
                if (chapter.status !== 'done') {
                    this.queueChapter(manga, chapter);
                }
            });
        });
        this.deps.onLibraryChanged();
        this.pump();
    }

    // Queues these chapters of a manga of the library (the ones that are not downloaded and not waiting or going on already), the oldest first.
    downloadChapters(mangaId: number, chapterRemoteIds: readonly number[]): void {
        const manga = this.deps.db.getManga(mangaId);
        if (manga === null) {
            return;
        }
        chapterRemoteIds
            .flatMap((remoteId) => {
                const chapter = this.deps.db.findChapter(mangaId, remoteId);
                return chapter === null ? [] : [chapter];
            })
            .sort((first, second) => {
                return first.sourceOrder - second.sourceOrder;
            })
            .forEach((chapter) => {
                this.queueChapter(manga, chapter);
            });
        this.deps.onLibraryChanged();
        this.pump();
    }

    // Queues a chapter again (after an error or a cancellation, also after the app was restarted, and a paused one).
    retry(chapterId: number): void {
        const chapter = this.deps.db.getChapter(chapterId);
        const manga = chapter === null ? null : this.deps.db.getManga(chapter.mangaId);
        if (chapter === null || manga === null || chapter.status === 'done' || this.isActiveJob(chapterId)) {
            return;
        }
        this.tries.delete(chapterId);
        this.queueChapter(manga, chapter);
        this.deps.onLibraryChanged();
        this.pump();
    }

    // Ends the run of a download that is going on, keeping the pages it has.
    pause(chapterId: number): void {
        const job = this.jobs.get(chapterId);
        const handle = this.handles.get(chapterId);
        if (job?.status !== 'running' || handle === undefined) {
            return;
        }
        this.pauseRequested.add(chapterId);
        handle.cancel();
    }

    // Queues a paused chapter again (also after the app was restarted): it goes on from the pages it has.
    resume(chapterId: number): void {
        if (this.deps.db.getChapter(chapterId)?.status === 'paused') {
            this.retry(chapterId);
        }
    }

    // Pauses everything: the chapters that wait are held first (so none of them takes the place of one that is paused), then the ones that
    // are running end their run, keeping their pages.
    pauseAll(): void {
        const jobs = this.list();
        jobs.forEach((job) => {
            if (job.status === 'queued' && !this.handles.has(job.chapterId)) {
                this.deps.db.markPaused(job.chapterId);
                this.update(job, { status: 'paused' });
            }
        });
        jobs.forEach((job) => {
            if (job.status === 'running') {
                this.pause(job.chapterId);
            }
        });
        this.deps.onLibraryChanged();
    }

    // Queues again every chapter that is paused.
    resumeAll(): void {
        this.list().forEach((job) => {
            if (job.status === 'paused') {
                this.resume(job.chapterId);
            }
        });
    }

    cancel(chapterId: number): void {
        const job = this.jobs.get(chapterId);
        if (job === undefined || job.status === 'done') {
            return;
        }
        const handle = this.handles.get(chapterId);
        if (handle !== undefined) {
            // The result of the run settles the job.
            handle.cancel();
            return;
        }
        this.discardWork(chapterId);
        this.deps.db.markFailed(chapterId, 'cancelled', null);
        this.update(job, { status: 'cancelled' });
        this.deps.onLibraryChanged();
    }

    clearFinished(): void {
        this.list().forEach((job) => {
            if (!isActive(job)) {
                this.jobs.delete(job.chapterId);
            }
        });
    }

    // The chapters are gone from the library: whatever is still running for them is stopped and forgotten.
    forget(chapterIds: number[]): void {
        chapterIds.forEach((chapterId) => {
            this.pauseRequested.delete(chapterId);
            this.handles.get(chapterId)?.cancel();
            this.handles.delete(chapterId);
            this.discardWork(chapterId);
            this.jobs.delete(chapterId);
            this.lastReported.delete(chapterId);
            this.tries.delete(chapterId);
        });
        this.pump();
    }

    // Whether closing the app has downloads to end.
    hasRunsToEnd(): boolean {
        return this.handles.size > 0;
    }

    // Closing the app: a download that was being paused is kept as paused at once, and every other one is cancelled and its
    // unfinished pages are deleted.
    async shutdown(timeoutMs: number = MANGA_SHUTDOWN_TIMEOUT_MS): Promise<void> {
        this.closed = true;
        const ending: Array<Promise<unknown>> = [];
        const discarded: number[] = [];
        this.handles.forEach((handle, chapterId) => {
            if (this.pauseRequested.has(chapterId)) {
                this.deps.db.markPaused(chapterId);
            } else {
                discarded.push(chapterId);
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
        discarded.forEach((chapterId) => {
            this.discardWork(chapterId);
        });
    }

    private isActiveJob(chapterId: number): boolean {
        const job = this.jobs.get(chapterId);
        return job !== undefined && isActive(job);
    }

    private queueChapter(manga: MangaRecord, chapter: MangaChapterRecord): void {
        if (chapter.status === 'done' || this.isActiveJob(chapter.id)) {
            return;
        }
        this.deps.db.markQueued(chapter.id);
        const job: MangaJob = {
            chapterId: chapter.id,
            mangaId: manga.id,
            mangaTitle: manga.title,
            chapterName: chapter.name.length > 0 ? chapter.name : `Chapter ${chapter.number ?? ''}`.trim(),
            sourceId: manga.sourceId,
            status: 'queued',
            pagesDone: 0,
            pageCount: 0,
            percent: 0,
            error: null
        };
        this.jobs.set(chapter.id, job);
        this.deps.onJobUpdate({ ...job });
    }

    private update(job: MangaJob, changes: Partial<MangaJob>): void {
        Object.assign(job, changes);
        this.deps.onJobUpdate({ ...job });
    }

    private runningSources(): Set<string> {
        const sources = new Set<string>();
        this.handles.forEach((_handle, chapterId) => {
            const job = this.jobs.get(chapterId);
            if (job !== undefined) {
                sources.add(job.sourceId);
            }
        });
        return sources;
    }

    // Starts what waits, up to the limit, one chapter at a time for each source.
    private pump(): void {
        if (this.closed) {
            return;
        }
        const limit = this.deps.getSettings().maxConcurrent;
        const busySources = this.runningSources();
        let running = this.handles.size;
        for (const job of this.jobs.values()) {
            if (running >= limit) {
                return;
            }
            if (job.status !== 'queued' || this.handles.has(job.chapterId) || busySources.has(job.sourceId)) {
                continue;
            }
            if (this.launch(job)) {
                running += 1;
                busySources.add(job.sourceId);
            }
        }
    }

    // Where the chapter is made: the place it had when it was started before, otherwise a free one in the folder of its manga.
    private outputPathFor(manga: MangaRecord, chapter: MangaChapterRecord): string {
        const known = this.outputPaths.get(chapter.id);
        if (known !== undefined) {
            return known;
        }
        const platform = this.deps.platform ?? process.platform;
        const settings = this.deps.getSettings();
        const base = settings.mangaDirectory.length > 0 ? settings.mangaDirectory : join(this.deps.defaultDownloadDir, DEFAULT_MANGA_FOLDER);
        const taken = new Set(this.outputPaths.values());
        const wanted = chapterOutputPath(mangaDirectory(base, manga.title, platform), chapter, settings.mangaFormat, platform);
        return uniquePath(
            wanted,
            (path) => {
                return taken.has(path) || this.deps.pathExists(path) || this.deps.pathExists(chapterWorkDirectory(path));
            },
            platform
        );
    }

    // Whether a download was started (it is not when the job has to end right away).
    private launch(job: MangaJob): boolean {
        const { db } = this.deps;
        const chapter = db.getChapter(job.chapterId);
        const manga = chapter === null ? null : db.getManga(chapter.mangaId);
        if (chapter === null || manga === null) {
            this.jobs.delete(job.chapterId);
            return false;
        }
        const outputPath = this.outputPathFor(manga, chapter);
        try {
            this.deps.ensureDirectory(join(outputPath, '..'));
        } catch (error) {
            this.finishWithError(job, { code: 'DISK', message: error instanceof Error ? error.message : String(error) });
            this.deps.onLibraryChanged();
            return false;
        }
        this.outputPaths.set(chapter.id, outputPath);
        db.markDownloading(chapter.id);
        this.lastReported.delete(chapter.id);
        this.update(job, { status: 'running', error: null });
        this.deps.onLibraryChanged();
        const handle = this.deps.download({
            chapterRemoteId: chapter.remoteId,
            seriesTitle: manga.title,
            chapter,
            details: { author: manga.author, artist: manga.artist, description: manga.description, genres: manga.genres },
            format: this.deps.getSettings().mangaFormat,
            outputPath,
            onPageCount: (pageCount) => {
                db.setPageCount(chapter.id, pageCount);
                this.update(job, { pageCount });
            },
            onProgress: (pagesDone, pageCount) => {
                this.reportProgress(job, pagesDone, pageCount);
            }
        });
        this.handles.set(chapter.id, handle);
        void handle.result.then((result) => {
            this.handles.delete(chapter.id);
            // The pause only counts for the run it was asked of, whichever way that run ended.
            const paused = this.pauseRequested.delete(chapter.id);
            if (!this.jobs.has(chapter.id)) {
                return;
            }
            if (result.status === 'cancelled' && paused) {
                db.markPaused(chapter.id);
                this.update(job, { status: 'paused' });
            } else if (result.status === 'cancelled') {
                this.discardWork(chapter.id);
                db.markFailed(chapter.id, 'cancelled', null);
                this.update(job, { status: 'cancelled' });
            } else if (result.status === 'error') {
                this.onFailure(job, result.error);
            } else {
                this.finishDownloaded(job, result.value.filePath, result.value.sizeBytes, result.value.pageCount);
            }
            this.deps.onLibraryChanged();
            this.pump();
        });
        return true;
    }

    private reportProgress(job: MangaJob, pagesDone: number, pageCount: number): void {
        const percent = pageCount > 0 ? (pagesDone / pageCount) * 100 : 0;
        const last = this.lastReported.get(job.chapterId) ?? 0;
        if (percent < 100 && Math.abs(percent - last) < MIN_PERCENT_STEP) {
            return;
        }
        this.lastReported.set(job.chapterId, percent);
        this.update(job, { pagesDone, pageCount, percent });
    }

    // A failure that may pass is tried again (the pages already downloaded are kept); one that will not, or a chapter that has used
    // its tries, is left as an error.
    private onFailure(job: MangaJob, error: MangaError): void {
        const tries = (this.tries.get(job.chapterId) ?? 0) + 1;
        if (FINAL_ERRORS.has(error.code) || tries >= MAX_TRIES) {
            this.tries.delete(job.chapterId);
            this.finishWithError(job, error);
            return;
        }
        this.tries.set(job.chapterId, tries);
        this.deps.db.markQueued(job.chapterId);
        this.update(job, { status: 'queued', error: null });
    }

    private finishDownloaded(job: MangaJob, filePath: string, sizeBytes: number, pageCount: number): void {
        this.deps.db.markDone(job.chapterId, filePath, sizeBytes, pageCount);
        this.outputPaths.delete(job.chapterId);
        this.tries.delete(job.chapterId);
        this.update(job, { status: 'done', percent: 100, pagesDone: pageCount, pageCount });
        // The screen of the downloads is for what is going on or went wrong: a chapter that is complete is in the library.
        this.jobs.delete(job.chapterId);
    }

    private finishWithError(job: MangaJob, error: MangaError): void {
        this.discardWork(job.chapterId);
        this.deps.db.markFailed(job.chapterId, 'error', error);
        this.update(job, { status: 'error', error });
    }

    // Deletes the pages a chapter left half done, and forgets where it was being made.
    private discardWork(chapterId: number): void {
        const path = this.outputPaths.get(chapterId);
        this.outputPaths.delete(chapterId);
        if (path !== undefined) {
            this.deps.removePath(chapterWorkDirectory(path));
        }
    }
}
