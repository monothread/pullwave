import { hasChapterFile } from '@shared/manga';
import type { LibraryManga, MangaChapterRecord, MangaDownloadRequest, MangaError, MangaJob, MangaOutputFormat, MangaRecord } from '@shared/manga';
import type { ChapterDownloadHandle, ChapterDownloadOptions, ChapterDownloadResult } from './mangaChapterDownloader';
import type { MangaDb } from './mangaDb';
import { chapterOutputPath, chapterWorkDirectory, DEFAULT_MANGA_FOLDER, formatOfPath, mangaDirectory, numberedPath, uniquePath } from './mangaFiles';
import { PageTransferRate } from './mangaTransferRate';
import { join } from 'node:path';

const MIN_PERCENT_STEP = 0.5;
export const RATE_REPORT_INTERVAL_MS = 1000;
export const MAX_TRIES = 3;
export const MANGA_SHUTDOWN_TIMEOUT_MS = 5000;
const FINAL_ERRORS: ReadonlySet<string> = new Set(['EMPTY_CHAPTER', 'DISK']);

export interface MangaDownloadLimits {
    sources: number;
    perSource: number;
}

export const MANGA_DOWNLOAD_LIMITS: MangaDownloadLimits = { sources: 3, perSource: 3 };

export interface MangaQueueSettings {
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
    removePath: (path: string) => void;
    countCompletePages: (workDirectory: string) => number;
    onJobUpdate: (job: MangaJob) => void;
    onLibraryChanged: () => void;
    onLibraryEntryChanged: (mangaId: number) => void;
    onHeldChange: (held: boolean) => void;
    limits?: MangaDownloadLimits;
    platform?: NodeJS.Platform;
    now?: () => number;
}

function isActive(job: MangaJob): boolean {
    return job.status === 'queued' || job.status === 'running';
}

interface ChapterTarget {
    outputPath: string;
    format: MangaOutputFormat;
}

export class MangaDownloadQueue {
    private readonly jobs = new Map<number, MangaJob>();
    private readonly handles = new Map<number, ChapterDownloadHandle>();
    private readonly runSources = new Map<number, string>();
    private readonly lastReported = new Map<number, number>();
    private readonly rates = new Map<number, PageTransferRate>();
    private readonly lastRateReported = new Map<number, number>();
    private readonly rateTimers = new Map<number, ReturnType<typeof setInterval>>();
    private readonly tries = new Map<number, number>();
    private readonly outputPaths = new Map<number, string>();
    private readonly pauseRequested = new Set<number>();
    private held = false;
    private readonly startsWhileHeld = new Set<number>();
    private closed = false;
    private foldersMoving = false;

    constructor(private readonly deps: MangaQueueDependencies) {}

    list(): MangaJob[] {
        return [...this.jobs.values()];
    }

    pendingCount(): number {
        return this.list().filter(isActive).length;
    }

    setFoldersMoving(moving: boolean): void {
        this.foldersMoving = moving;
        if (!moving) {
            this.pump();
        }
    }

    isHeld(): boolean {
        return this.held;
    }

    enqueue(request: MangaDownloadRequest): LibraryManga | null {
        const known = this.deps.db.findManga(request.manga.sourceId, request.manga.remoteId) !== null;
        const manga = this.deps.db.upsertManga(request.manga);
        if (request.details !== null) {
            this.deps.db.saveDetails(manga.id, request.details);
        }
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

    addToLibrary(request: MangaDownloadRequest): LibraryManga | null {
        const known = this.deps.db.findManga(request.manga.sourceId, request.manga.remoteId) !== null;
        const manga = this.deps.db.upsertManga(request.manga);
        if (request.details !== null) {
            this.deps.db.saveDetails(manga.id, request.details);
        }
        this.deps.db.registerChapters(manga.id, request.chapters, known);
        this.deps.onLibraryChanged();
        return this.deps.db.getLibraryManga(manga.id);
    }

    downloadMissing(mangaIds: readonly number[]): void {
        mangaIds.forEach((mangaId) => {
            const manga = this.deps.db.getManga(mangaId);
            if (manga === null) {
                return;
            }
            [...this.deps.db.chaptersOf(mangaId)].reverse().forEach((chapter) => {
                if (!hasChapterFile(chapter.status)) {
                    this.queueChapter(manga, chapter);
                }
            });
        });
        this.deps.onLibraryChanged();
        this.pump();
    }

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

    retry(chapterId: number): void {
        const chapter = this.deps.db.getChapter(chapterId);
        const manga = chapter === null ? null : this.deps.db.getManga(chapter.mangaId);
        if (chapter === null || manga === null || hasChapterFile(chapter.status) || this.isActiveJob(chapterId)) {
            return;
        }
        this.tries.delete(chapterId);
        this.queueChapter(manga, chapter);
        this.deps.onLibraryEntryChanged(manga.id);
        this.pump();
    }

    pause(chapterId: number): void {
        const job = this.jobs.get(chapterId);
        const handle = this.handles.get(chapterId);
        if (job?.status !== 'running' || handle === undefined) {
            return;
        }
        this.pauseRequested.add(chapterId);
        handle.cancel();
    }

    resume(chapterId: number): void {
        if (this.deps.db.getChapter(chapterId)?.status !== 'paused') {
            return;
        }
        if (this.held) {
            this.startsWhileHeld.add(chapterId);
        }
        this.retry(chapterId);
    }

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

    pauseMangas(mangaIds: readonly number[]): void {
        this.jobsOfMangas(mangaIds).forEach((job) => {
            if (job.status === 'running') {
                this.pause(job.chapterId);
            } else if (job.status === 'queued') {
                this.pauseWaiting(job);
            }
        });
        this.deps.onLibraryChanged();
    }

    resumeMangas(mangaIds: readonly number[]): void {
        this.jobsOfMangas(mangaIds).forEach((job) => {
            if (job.status === 'paused') {
                this.resume(job.chapterId);
            }
        });
        this.pump();
    }

    cancelMangas(mangaIds: readonly number[]): void {
        this.jobsOfMangas(mangaIds).forEach((job) => {
            if (job.status === 'queued' || job.status === 'running' || job.status === 'paused') {
                this.cancel(job.chapterId);
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
            this.pauseRequested.delete(chapterId);
            handle.cancel();
            return;
        }
        this.discardWork(chapterId);
        this.startsWhileHeld.delete(chapterId);
        this.deps.db.markFailed(chapterId, 'cancelled', null);
        this.update(job, { status: 'cancelled' });
        this.deps.onLibraryEntryChanged(job.mangaId);
    }

    clearFinished(): void {
        this.list().forEach((job) => {
            if (!isActive(job) && job.status !== 'paused') {
                this.jobs.delete(job.chapterId);
            }
        });
    }

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
            this.forgetRate(chapterId);
            this.tries.delete(chapterId);
        });
        this.pump();
    }

    hasRunsToEnd(): boolean {
        return this.handles.size > 0;
    }

    async shutdown(timeoutMs: number = MANGA_SHUTDOWN_TIMEOUT_MS): Promise<void> {
        this.closed = true;
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

    private jobsOfMangas(mangaIds: readonly number[]): MangaJob[] {
        const wanted = new Set(mangaIds);
        return this.list().filter((job) => {
            return wanted.has(job.mangaId);
        });
    }

    private pauseWaiting(job: MangaJob): void {
        this.startsWhileHeld.delete(job.chapterId);
        this.deps.db.markPaused(job.chapterId);
        this.update(job, { status: 'paused' });
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
            bytesPerSecond: null,
            etaSeconds: null,
            error: null,
            missingPages: 0
        };
    }

    private queueChapter(manga: MangaRecord, chapter: MangaChapterRecord): void {
        if (hasChapterFile(chapter.status) || this.isActiveJob(chapter.id)) {
            return;
        }
        this.deps.db.markQueued(chapter.id);
        const job = this.newJob(manga, chapter);
        this.jobs.set(chapter.id, job);
        this.deps.onJobUpdate({ ...job });
    }

    private update(job: MangaJob, changes: Partial<MangaJob>): void {
        const stopsRunning = changes.status !== undefined && changes.status !== 'running';
        if (stopsRunning) {
            this.forgetRate(job.chapterId);
        }
        Object.assign(job, stopsRunning ? { ...changes, bytesPerSecond: null, etaSeconds: null } : changes);
        this.deps.onJobUpdate({ ...job });
    }

    private now(): number {
        return (this.deps.now ?? Date.now)();
    }

    private forgetRate(chapterId: number): void {
        this.rates.delete(chapterId);
        this.lastRateReported.delete(chapterId);
        const timer = this.rateTimers.get(chapterId);
        if (timer !== undefined) {
            clearInterval(timer);
            this.rateTimers.delete(chapterId);
        }
    }

    private startRate(job: MangaJob): void {
        this.forgetRate(job.chapterId);
        this.rates.set(job.chapterId, new PageTransferRate(this.now()));
        const timer = setInterval(() => {
            this.reportRate(job);
        }, RATE_REPORT_INTERVAL_MS);
        timer.unref?.();
        this.rateTimers.set(job.chapterId, timer);
    }

    private reportRate(job: MangaJob): void {
        const changes = this.rateChanges(job, job.pageCount - job.pagesDone);
        const changed = changes.bytesPerSecond !== undefined && (changes.bytesPerSecond !== job.bytesPerSecond || changes.etaSeconds !== job.etaSeconds);
        if (changed) {
            this.update(job, changes);
        }
    }

    private setHeld(held: boolean): void {
        if (this.held !== held) {
            this.held = held;
            this.deps.onHeldChange(held);
        }
    }

    private runsBySource(): Map<string, number> {
        const runs = new Map<string, number>();
        this.runSources.forEach((sourceId) => {
            runs.set(sourceId, (runs.get(sourceId) ?? 0) + 1);
        });
        return runs;
    }

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

    private pump(): void {
        if (this.closed || this.foldersMoving) {
            return;
        }
        const runs = this.runsBySource();
        for (const job of this.jobs.values()) {
            if (this.canStart(job, runs) && this.launch(job)) {
                runs.set(job.sourceId, (runs.get(job.sourceId) ?? 0) + 1);
            }
        }
    }

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

    private canReuse(chapterId: number, outputPath: string): boolean {
        return !this.deps.pathExists(outputPath) && !this.isPlaceTaken(chapterId, outputPath);
    }

    private isPlaceTaken(chapterId: number, outputPath: string): boolean {
        const takenHere = [...this.outputPaths.entries()].some(([otherId, path]) => {
            return otherId !== chapterId && path === outputPath;
        });
        return takenHere || this.deps.db.isOutputPathClaimed(outputPath, chapterId);
    }

    private wantedPath(manga: MangaRecord, chapter: MangaChapterRecord): string {
        const platform = this.deps.platform ?? process.platform;
        const settings = this.deps.getSettings();
        const base = settings.mangaDirectory.length > 0 ? settings.mangaDirectory : join(this.deps.defaultDownloadDir, DEFAULT_MANGA_FOLDER);
        return chapterOutputPath(mangaDirectory(base, manga.title, platform), chapter, settings.mangaFormat, platform);
    }

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
            this.deps.onLibraryEntryChanged(job.mangaId);
            return false;
        }
        this.outputPaths.set(chapter.id, outputPath);
        db.markDownloading(chapter.id, outputPath);
        this.lastReported.delete(chapter.id);
        this.update(job, { status: 'running', error: null });
        this.deps.onLibraryEntryChanged(job.mangaId);
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
                this.startRate(job);
            },
            onPageFetched: (bytes) => {
                this.rates.get(chapter.id)?.add(this.now(), bytes);
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
            const paused = this.pauseRequested.delete(chapter.id);
            if (!this.jobs.has(chapter.id)) {
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
                this.finishDownloaded(job, result.value);
            }
            if (job.status !== 'queued') {
                this.startsWhileHeld.delete(chapter.id);
            }
            this.deps.onLibraryEntryChanged(job.mangaId);
            this.pump();
        });
        return true;
    }

    private reportProgress(job: MangaJob, pagesDone: number, pageCount: number): void {
        const changes = { ...this.pageChanges(job, pagesDone, pageCount), ...this.rateChanges(job, pageCount - pagesDone) };
        if (Object.keys(changes).length > 0) {
            this.update(job, changes);
        }
    }

    private pageChanges(job: MangaJob, pagesDone: number, pageCount: number): Partial<MangaJob> {
        const percent = pageCount > 0 ? (pagesDone / pageCount) * 100 : 0;
        const last = this.lastReported.get(job.chapterId) ?? 0;
        if (percent < 100 && Math.abs(percent - last) < MIN_PERCENT_STEP) {
            return {};
        }
        this.lastReported.set(job.chapterId, percent);
        return { pagesDone, pageCount, percent };
    }

    private rateChanges(job: MangaJob, pagesLeft: number): Partial<MangaJob> {
        const rate = this.rates.get(job.chapterId);
        const at = this.now();
        const last = this.lastRateReported.get(job.chapterId);
        if (rate === undefined || (last !== undefined && at - last < RATE_REPORT_INTERVAL_MS)) {
            return {};
        }
        this.lastRateReported.set(job.chapterId, at);
        return rate.measure(at, pagesLeft);
    }

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

    private finishDownloaded(job: MangaJob, result: ChapterDownloadResult): void {
        const { filePath, sizeBytes, pageCount, missingPages } = result;
        if (missingPages.length > 0) {
            this.deps.db.markIncomplete(job.chapterId, filePath, sizeBytes, pageCount);
        } else {
            this.deps.db.markDone(job.chapterId, filePath, sizeBytes, pageCount);
        }
        this.outputPaths.delete(job.chapterId);
        this.tries.delete(job.chapterId);
        this.update(job, { status: 'done', percent: 100, pagesDone: pageCount, pageCount, missingPages: missingPages.length });
        this.jobs.delete(job.chapterId);
    }

    private finishWithError(job: MangaJob, error: MangaError): void {
        this.discardWork(job.chapterId);
        this.deps.db.markFailed(job.chapterId, 'error', error);
        this.update(job, { status: 'error', error });
    }

    private discardWork(chapterId: number): void {
        const path = this.outputPaths.get(chapterId);
        this.outputPaths.delete(chapterId);
        if (path !== undefined) {
            this.deps.removePath(chapterWorkDirectory(path));
        }
    }
}
