import type { LibraryManga, MangaChapterRecord, MangaDownloadRequest, MangaError, MangaJob, MangaOutputFormat, MangaRecord } from '@shared/manga';
import type { ChapterDownloadHandle, ChapterDownloadOptions } from './mangaChapterDownloader';
import type { MangaDb } from './mangaDb';
import { chapterOutputPath, chapterWorkDirectory, DEFAULT_MANGA_FOLDER, formatOfPath, mangaDirectory, numberedPath, uniquePath } from './mangaFiles';
import { join } from 'node:path';

// Progress comes after every page; the screen only needs to hear about a visible change.
const MIN_PERCENT_STEP = 0.5;
// How many times a chapter is tried before it is left as an error to retry by hand.
export const MAX_TRIES = 3;
// How long closing the app waits for the downloads to end before it deletes what they left behind.
export const MANGA_SHUTDOWN_TIMEOUT_MS = 5000;
// Errors that asking again will not fix.
const FINAL_ERRORS: ReadonlySet<string> = new Set(['EMPTY_CHAPTER', 'DISK']);

// How many sources download at the same time, and how many chapters each of them downloads at the same time (the chapters of one
// manga included). They are fixed: the user does not change them.
export interface MangaDownloadLimits {
    sources: number;
    perSource: number;
}

export const MANGA_DOWNLOAD_LIMITS: MangaDownloadLimits = { sources: 3, perSource: 3 };

export interface MangaQueueSettings {
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
    // How many pages are complete in the folder of a chapter being downloaded (0 when the folder is not there).
    countCompletePages: (workDirectory: string) => number;
    onJobUpdate: (job: MangaJob) => void;
    onLibraryChanged: () => void;
    // The queue was held (by PAUSE ALL) or let go (by RESUME ALL).
    onHeldChange: (held: boolean) => void;
    // The limits of the downloads at the same time; the fixed ones by default (the tests give others).
    limits?: MangaDownloadLimits;
    // The system the files are on (decides the rules of file names); this one by default.
    platform?: NodeJS.Platform;
}

function isActive(job: MangaJob): boolean {
    return job.status === 'queued' || job.status === 'running';
}

// Where a chapter is made, and how.
interface ChapterTarget {
    outputPath: string;
    format: MangaOutputFormat;
}

// Downloads a few chapters at a time for each source (so a site is not asked for too many things at once), a few sources together.
export class MangaDownloadQueue {
    private readonly jobs = new Map<number, MangaJob>();
    private readonly handles = new Map<number, ChapterDownloadHandle>();
    // The source of each run, kept until the run ends (also for a chapter forgotten while it ran, whose job is gone).
    private readonly runSources = new Map<number, string>();
    private readonly lastReported = new Map<number, number>();
    private readonly tries = new Map<number, number>();
    // Where each chapter that is running or paused is being made: the same place again when it goes on.
    private readonly outputPaths = new Map<number, string>();
    private readonly pauseRequested = new Set<number>();
    // While the queue is held (PAUSE ALL) the chapters that wait keep waiting; only the ones the user resumed one by one start.
    private held = false;
    private readonly startsWhileHeld = new Set<number>();
    private closed = false;

    constructor(private readonly deps: MangaQueueDependencies) {}

    list(): MangaJob[] {
        return [...this.jobs.values()];
    }

    pendingCount(): number {
        return this.list().filter(isActive).length;
    }

    isHeld(): boolean {
        return this.held;
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

    // Queues a paused chapter again (also after the app was restarted): it goes on from the pages it has, even while the queue is held.
    resume(chapterId: number): void {
        if (this.deps.db.getChapter(chapterId)?.status !== 'paused') {
            return;
        }
        if (this.held) {
            this.startsWhileHeld.add(chapterId);
        }
        this.retry(chapterId);
    }

    // The chapters that were paused when the app last closed are shown again as paused, with the pages they kept, so they can go on or
    // be cancelled. A chapter paused before the place was remembered gets back the folder of pages it left, when it is found.
    restore(): void {
        this.deps.db.pausedChapters().forEach((chapter) => {
            const manga = this.deps.db.getManga(chapter.mangaId);
            if (manga === null || this.jobs.has(chapter.id)) {
                return;
            }
            const outputPath = this.deps.db.outputPathOf(chapter.id) ?? this.findLeftoverWork(manga, chapter);
            if (outputPath !== null) {
                this.outputPaths.set(chapter.id, outputPath);
            }
            const pagesDone = outputPath === null ? 0 : Math.min(this.deps.countCompletePages(chapterWorkDirectory(outputPath)), chapter.pageCount);
            this.jobs.set(chapter.id, {
                ...this.newJob(manga, chapter),
                status: 'paused',
                pagesDone,
                pageCount: chapter.pageCount,
                percent: chapter.pageCount > 0 ? (pagesDone / chapter.pageCount) * 100 : 0
            });
        });
    }

    // Pauses everything: the queue is held first (so the chapters that wait keep waiting, and none takes the place of one that is
    // paused), then the ones that are running end their run, keeping their pages.
    pauseAll(): void {
        this.setHeld(true);
        this.startsWhileHeld.clear();
        this.list().forEach((job) => {
            if (job.status === 'running') {
                this.pause(job.chapterId);
            }
        });
        this.deps.onLibraryChanged();
    }

    // Lets the queue go and queues again every chapter that is paused.
    resumeAll(): void {
        this.setHeld(false);
        this.startsWhileHeld.clear();
        this.list().forEach((job) => {
            if (job.status === 'paused') {
                this.resume(job.chapterId);
            }
        });
        this.pump();
    }

    cancel(chapterId: number): void {
        const job = this.jobs.get(chapterId);
        if (job === undefined || job.status === 'done') {
            return;
        }
        const handle = this.handles.get(chapterId);
        if (handle !== undefined) {
            // A pause asked for before wins no more: the result of the run settles the job as cancelled.
            this.pauseRequested.delete(chapterId);
            handle.cancel();
            return;
        }
        this.discardWork(chapterId);
        this.startsWhileHeld.delete(chapterId);
        this.deps.db.markFailed(chapterId, 'cancelled', null);
        this.update(job, { status: 'cancelled' });
        this.deps.onLibraryChanged();
    }

    // A paused chapter is not finished: it stays, so it can still go on or be cancelled.
    clearFinished(): void {
        this.list().forEach((job) => {
            if (!isActive(job) && job.status !== 'paused') {
                this.jobs.delete(job.chapterId);
            }
        });
    }

    // The chapters are gone from the library: whatever is still running for them is stopped and forgotten. The pages of a run are
    // deleted once it has ended (before, it could still write one), and its place goes to the next chapter only then.
    forget(chapterIds: number[]): void {
        chapterIds.forEach((chapterId) => {
            this.pauseRequested.delete(chapterId);
            this.startsWhileHeld.delete(chapterId);
            const handle = this.handles.get(chapterId);
            if (handle === undefined) {
                this.discardWork(chapterId);
            } else {
                handle.cancel();
            }
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
        // The chapters that wait in a held queue were paused by the user: they are found paused when the app opens again.
        if (this.held) {
            this.list().forEach((job) => {
                if (job.status === 'queued' && !this.handles.has(job.chapterId)) {
                    this.deps.db.markPaused(job.chapterId);
                }
            });
        }
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

    private newJob(manga: MangaRecord, chapter: MangaChapterRecord): MangaJob {
        return {
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
    }

    private queueChapter(manga: MangaRecord, chapter: MangaChapterRecord): void {
        if (chapter.status === 'done' || this.isActiveJob(chapter.id)) {
            return;
        }
        this.deps.db.markQueued(chapter.id);
        const job = this.newJob(manga, chapter);
        this.jobs.set(chapter.id, job);
        this.deps.onJobUpdate({ ...job });
    }

    private update(job: MangaJob, changes: Partial<MangaJob>): void {
        Object.assign(job, changes);
        this.deps.onJobUpdate({ ...job });
    }

    private setHeld(held: boolean): void {
        if (this.held !== held) {
            this.held = held;
            this.deps.onHeldChange(held);
        }
    }

    // How many chapters each source is downloading.
    private runsBySource(): Map<string, number> {
        const runs = new Map<string, number>();
        this.runSources.forEach((sourceId) => {
            runs.set(sourceId, (runs.get(sourceId) ?? 0) + 1);
        });
        return runs;
    }

    // Whether a chapter that waits may start now: the queue is not held (or the user resumed it), and its source has room (a source
    // that is not downloading yet needs a free place among the sources).
    private canStart(job: MangaJob, runs: ReadonlyMap<string, number>): boolean {
        if (job.status !== 'queued' || this.handles.has(job.chapterId)) {
            return false;
        }
        if (this.held && !this.startsWhileHeld.has(job.chapterId)) {
            return false;
        }
        const limits = this.deps.limits ?? MANGA_DOWNLOAD_LIMITS;
        const running = runs.get(job.sourceId) ?? 0;
        return running < limits.perSource && (running > 0 || runs.size < limits.sources);
    }

    // Starts what waits, the oldest first, up to the limits of the sources.
    private pump(): void {
        if (this.closed) {
            return;
        }
        const runs = this.runsBySource();
        for (const job of this.jobs.values()) {
            if (this.canStart(job, runs) && this.launch(job)) {
                runs.set(job.sourceId, (runs.get(job.sourceId) ?? 0) + 1);
            }
        }
    }

    // Where the chapter is made: the place (and the format) it had when it was started before, so it goes on from the pages it kept;
    // otherwise a free place in the folder of its manga.
    private targetFor(manga: MangaRecord, chapter: MangaChapterRecord): ChapterTarget {
        const known = this.outputPaths.get(chapter.id) ?? this.deps.db.outputPathOf(chapter.id);
        if (known !== null && this.canReuse(chapter.id, known)) {
            return { outputPath: known, format: formatOfPath(known) };
        }
        const platform = this.deps.platform ?? process.platform;
        const format = this.deps.getSettings().mangaFormat;
        const outputPath = uniquePath(
            this.wantedPath(manga, chapter),
            (path) => {
                return this.isPlaceTaken(chapter.id, path) || this.deps.pathExists(path) || this.deps.pathExists(chapterWorkDirectory(path));
            },
            platform
        );
        return { outputPath, format };
    }

    // The place a chapter that was started before goes on at: not when the chapter is already there, nor when another one took it.
    private canReuse(chapterId: number, outputPath: string): boolean {
        return !this.deps.pathExists(outputPath) && !this.isPlaceTaken(chapterId, outputPath);
    }

    private isPlaceTaken(chapterId: number, outputPath: string): boolean {
        const takenHere = [...this.outputPaths.entries()].some(([otherId, path]) => {
            return otherId !== chapterId && path === outputPath;
        });
        return takenHere || this.deps.db.isOutputPathClaimed(outputPath, chapterId);
    }

    // The place the settings give a chapter, before a number is added to make it free.
    private wantedPath(manga: MangaRecord, chapter: MangaChapterRecord): string {
        const platform = this.deps.platform ?? process.platform;
        const settings = this.deps.getSettings();
        const base = settings.mangaDirectory.length > 0 ? settings.mangaDirectory : join(this.deps.defaultDownloadDir, DEFAULT_MANGA_FOLDER);
        return chapterOutputPath(mangaDirectory(base, manga.title, platform), chapter, settings.mangaFormat, platform);
    }

    // The folder of pages a chapter paused before its place was remembered left behind: the first place of its name (" (2)", " (3)"...
    // included) that has the folder, is not downloaded and no other chapter claims. It is remembered from now on.
    private findLeftoverWork(manga: MangaRecord, chapter: MangaChapterRecord): string | null {
        const platform = this.deps.platform ?? process.platform;
        const wanted = this.wantedPath(manga, chapter);
        for (let attempt = 1; ; attempt += 1) {
            const candidate = numberedPath(wanted, attempt, platform);
            const hasWork = this.deps.pathExists(chapterWorkDirectory(candidate));
            const isFinished = this.deps.pathExists(candidate);
            if (!hasWork && !isFinished) {
                return null;
            }
            if (hasWork && !isFinished && !this.isPlaceTaken(chapter.id, candidate)) {
                this.deps.db.setOutputPath(chapter.id, candidate);
                return candidate;
            }
        }
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
        const { outputPath, format } = this.targetFor(manga, chapter);
        try {
            this.deps.ensureDirectory(join(outputPath, '..'));
        } catch (error) {
            this.finishWithError(job, { code: 'DISK', message: error instanceof Error ? error.message : String(error) });
            this.deps.onLibraryChanged();
            return false;
        }
        this.outputPaths.set(chapter.id, outputPath);
        db.markDownloading(chapter.id, outputPath);
        this.lastReported.delete(chapter.id);
        this.update(job, { status: 'running', error: null });
        this.deps.onLibraryChanged();
        const handle = this.deps.download({
            chapterRemoteId: chapter.remoteId,
            seriesTitle: manga.title,
            chapter,
            details: { author: manga.author, artist: manga.artist, description: manga.description, genres: manga.genres },
            format,
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
        this.runSources.set(chapter.id, job.sourceId);
        void handle.result.then((result) => {
            this.handles.delete(chapter.id);
            this.runSources.delete(chapter.id);
            // The pause only counts for the run it was asked of, whichever way that run ended.
            const paused = this.pauseRequested.delete(chapter.id);
            if (!this.jobs.has(chapter.id)) {
                // The chapter was forgotten while it ran: its pages go now that nothing writes them.
                this.discardWork(chapter.id);
                this.pump();
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
            // A chapter the user resumed in a held queue may still start again when it is tried again after a failure.
            if (job.status !== 'queued') {
                this.startsWhileHeld.delete(chapter.id);
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
