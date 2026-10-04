import { randomUUID } from 'node:crypto';
import { hasUnboundedAutoSubtitles } from '@shared/subtitles';
import { isValidHttpUrl } from '@shared/url';
import { statSync } from 'node:fs';
import type { AddJobResult, DownloadJob, DownloadError, DownloadInfo, HistoryEntry, PostProcessEvent, ProgressInfo, Settings } from '@shared/types';
import type { RunHandle, RunResult } from './ytdlpRunner';
import { buildYtdlpArgs, type RequestExtras } from './ytdlpArgsBuilder';
import { translateMain } from './language';
import { keepInside, type PausedDownload, type PausedStorage } from './pausedStore';

export interface QueueDependencies {
    getSettings: () => Settings;
    defaultDownloadDir: string;
    resolveYtdlpPath: (settings: Settings) => string;
    resolveFfmpegLocation: (settings: Settings) => string | null;
    startRun: (
        binary: string,
        args: string[],
        onProgress: (progress: ProgressInfo) => void,
        onInfo: (info: DownloadInfo) => void,
        onWaiting?: () => void,
        onPostProcess?: (event: PostProcessEvent) => void
    ) => RunHandle;
    // Size of a file on disk, or null when it does not exist (used to show how much of a live stream is recorded).
    fileSize?: (path: string) => number | null;
    // Turns the partial file of a recording that was ended by killing yt-dlp into the final file; returns its path.
    salvageRecording?: (filePath: string) => Promise<string | null>;
    // Joins the parts of a recording that was resumed after the stream came back (in order) into the first one; returns its path.
    mergeParts?: (paths: string[]) => Promise<string | null>;
    // The unfinished files (.part...) that belong to the download of a final file, and a way to delete files.
    findPartialFiles?: (finalPath: string) => string[];
    deleteFiles?: (paths: string[]) => void;
    // Where the paused downloads are kept between runs of the app (see pausedStore.ts); without it a pause only lasts while the app is open.
    pausedStorage?: PausedStorage;
    addHistory: (entry: HistoryEntry) => void;
    onJobUpdate: (job: DownloadJob) => void;
    onJobRemoved: (id: string) => void;
    onHistoryChanged: () => void;
    generateId?: () => string;
    now?: () => number;
}

export const LIVE_TICK_MS = 1000;
export const LIVE_STOP_TIMEOUT_MS = 8000;
// Pause between two attempts to find out whether a live stream that stopped is back.
export const LIVE_END_RETRY_MS = 2000;

function defaultFileSize(path: string): number | null {
    try {
        return statSync(path).size;
    } catch {
        return null;
    }
}

const SALVAGE_FAILED_ERROR: DownloadError = {
    code: 'UNKNOWN',
    title: 'The recording could not be saved',
    hint: 'The stream was stopped, but the partial file could not be converted. A file ending in .part may still be in the download folder.',
    raw: 'ffmpeg could not copy the partial recording into the final file.'
};

// A live stream that seems to have ended, while the app checks whether it really did.
interface EndCheck {
    original: RunResult;
    secondsLeft: number;
    attempts: number;
    interval: ReturnType<typeof setInterval>;
    retry: ReturnType<typeof setTimeout> | null;
}

const FINISHED_STATUSES: ReadonlyArray<DownloadJob['status']> = ['done', 'error', 'cancelled'];

function isFinished(job: DownloadJob): boolean {
    return FINISHED_STATUSES.includes(job.status);
}

export class QueueManager {
    private readonly jobs: DownloadJob[] = [];
    private readonly handles = new Map<string, RunHandle>();
    private readonly extras = new Map<string, RequestExtras>();
    private readonly salvaging = new Set<Promise<void>>();
    private readonly livePaths = new Map<string, string>();
    private readonly outputPaths = new Map<string, Set<string>>();
    private readonly tickers = new Map<string, ReturnType<typeof setInterval>>();
    private readonly endChecks = new Map<string, EndCheck>();
    // Live recordings that were asked to stop on purpose (STOP & SAVE): their end is final, so it is not double-checked.
    private readonly stopRequested = new Set<string>();
    // Downloads asked to pause: the run is ended, and its partial files are kept so it can go on from there.
    private readonly pauseRequested = new Set<string>();
    // The part of the recording each live job is in (1 for the first file, +1 each time the stream came back).
    private readonly parts = new Map<string, number>();
    private closed = false;
    private readonly generateId: () => string;
    private readonly now: () => number;

    constructor(private readonly deps: QueueDependencies) {
        this.generateId = deps.generateId ?? randomUUID;
        this.now = deps.now ?? Date.now;
        this.restorePaused();
    }

    // The downloads that were paused when the app was closed are back, paused, with what is needed to go on from their partial files.
    private restorePaused(): void {
        (this.deps.pausedStorage?.load() ?? []).forEach((paused) => {
            if (this.find(paused.job.id) !== undefined) {
                return;
            }
            const job = { ...paused.job };
            const settings = this.deps.getSettings();
            const directory = paused.extras.downloadDir ?? (settings.downloadDir.length > 0 ? settings.downloadDir : this.deps.defaultDownloadDir);
            this.jobs.push(job);
            this.extras.set(job.id, { ...paused.extras, ...(job.pageUrl !== null ? { pageUrl: job.pageUrl } : {}) });
            this.outputPaths.set(job.id, new Set(keepInside(paused.outputPaths, directory)));
            job.hasPartial = this.leftoversOf(job).length > 0;
        });
    }

    // Keeps the paused downloads in the file: it holds exactly the ones that are paused now, so one that was resumed, cancelled or removed
    // is not back the next time. The cookie of a page never goes to the disk.
    private savePaused(): void {
        const kept: PausedDownload[] = this.jobs
            .filter((job) => {
                return job.status === 'paused';
            })
            .map((job) => {
                const extras = { ...this.extras.get(job.id) };
                delete extras.cookie;
                delete extras.resumedPart;
                return { job: { ...job }, extras, outputPaths: [...(this.outputPaths.get(job.id) ?? [])] };
            });
        this.deps.pausedStorage?.save(kept);
    }

    list(): DownloadJob[] {
        return this.jobs.map((job) => {
            return { ...job };
        });
    }

    pendingCount(): number {
        return this.jobs.filter((job) => {
            return job.status === 'running' || job.status === 'queued';
        }).length;
    }

    hasLiveJobs(): boolean {
        return this.jobs.some((job) => {
            return job.status === 'running' && job.live;
        });
    }

    // Stops a live recording keeping what was recorded so far (the download then completes normally).
    stop(id: string): void {
        const job = this.find(id);
        if (job?.status !== 'running' || !job.live) {
            return;
        }
        if (this.endChecks.has(id)) {
            this.concludeEndCheck(job);
            return;
        }
        this.stopRequested.add(id);
        job.saving = true;
        this.emit(job);
        this.handles.get(id)?.stop();
    }

    // Only a plain download that is running can be paused: not a live recording, nor one that is waiting for a live stream to start, nor
    // one that is already closing its file (ffmpeg joining or converting).
    canPause(job: DownloadJob): boolean {
        return job.status === 'running' && !job.live && !job.waitingForLive && job.postProcess === null && !job.merging && !job.saving && !this.endChecks.has(job.id);
    }

    // Ends the run keeping the partial files, so `resume` continues from them; the card waits as PAUSED and frees its place in the queue.
    pause(id: string): void {
        const job = this.find(id);
        if (!job || !this.canPause(job)) {
            return;
        }
        this.pauseRequested.add(id);
        this.handles.get(id)?.cancel();
    }

    // Puts a paused download back in the queue: yt-dlp finds its partial file and goes on from where it stopped.
    resume(id: string): void {
        const job = this.find(id);
        if (job?.status !== 'paused') {
            return;
        }
        Object.assign(job, { status: 'queued', speed: '', eta: '' });
        this.savePaused();
        this.emit(job);
        this.pump();
    }

    // Whether closing the app has something to wait for: a recording to save, or a download to end and clean up after.
    hasRunsToEnd(): boolean {
        return this.handles.size > 0;
    }

    // Live recordings are asked to finish (and given a moment to save their file). A download that was being paused is kept as paused, at
    // once, so closing the app right after pausing does not lose it. Every other download is cancelled and the unfinished files it left
    // behind are deleted (the setting that keeps them after a failure does not apply: nothing is there to resume once the app is closed).
    async shutdown(timeoutMs: number = LIVE_STOP_TIMEOUT_MS): Promise<void> {
        this.closed = true;
        this.jobs.forEach((job) => {
            if (this.endChecks.has(job.id)) {
                this.concludeEndCheck(job);
            }
        });
        const waiting: Array<Promise<unknown>> = [];
        const stopped: RunHandle[] = [];
        const discarded: Array<{ job: DownloadJob; paths: string[] }> = [];
        this.handles.forEach((handle, id) => {
            const job = this.find(id);
            if (job?.live) {
                handle.stop();
                stopped.push(handle);
                waiting.push(handle.result);
                return;
            }
            if (job !== undefined && this.pauseRequested.has(id)) {
                // The run ends on its own; finishPaused will find the card already paused and write the same thing again.
                Object.assign(job, { status: 'paused', speed: '', eta: '' });
                this.savePaused();
            } else if (job !== undefined) {
                discarded.push({ job, paths: [...(this.outputPaths.get(id) ?? [])] });
                waiting.push(handle.result);
            }
            handle.cancel();
        });
        if (waiting.length > 0 || this.salvaging.size > 0) {
            await Promise.race([
                Promise.allSettled(waiting).then(() => {
                    return Promise.allSettled([...this.salvaging]);
                }),
                new Promise((resolve) => {
                    setTimeout(resolve, timeoutMs);
                })
            ]);
        }
        // A recording that did not finish in time is ended, so nothing is left running (and writing) after the app is gone.
        this.handles.forEach((handle) => {
            if (stopped.includes(handle)) {
                handle.cancel();
            }
        });
        this.deleteDiscarded(discarded);
    }

    // The unfinished files of the downloads that were cancelled because the app is closing, found once their processes have ended.
    private deleteDiscarded(discarded: ReadonlyArray<{ job: DownloadJob; paths: readonly string[] }>): void {
        const find = this.deps.findPartialFiles;
        if (find === undefined) {
            return;
        }
        discarded.forEach(({ job, paths }) => {
            const files = [...new Set(paths.flatMap(find))];
            if (files.length > 0) {
                this.deps.deleteFiles?.(files);
            }
            if (job.hasPartial) {
                job.hasPartial = false;
                this.emit(job);
            }
        });
    }

    getJob(id: string): DownloadJob | undefined {
        const job = this.find(id);
        return job ? { ...job } : undefined;
    }

    add(url: string, options: RequestExtras = {}): AddJobResult {
        const trimmed = url.trim();
        if (!isValidHttpUrl(trimmed)) {
            return { ok: false, job: null, message: translateMain('url.invalid') };
        }
        if (hasUnboundedAutoSubtitles(this.deps.getSettings())) {
            return { ok: false, job: null, message: translateMain('subtitles.unbounded') };
        }
        const job: DownloadJob = {
            id: this.generateId(),
            url: trimmed,
            status: 'queued',
            title: options.title ?? null,
            percent: 0,
            speed: '',
            eta: '',
            filePath: null,
            error: null,
            createdAt: this.now(),
            pageUrl: options.pageUrl ?? null,
            live: false,
            elapsedSeconds: 0,
            downloadedBytes: 0,
            hasPartial: false,
            customized: Object.keys(options.options ?? {}).length > 0,
            waitingForLive: false,
            endCheck: null,
            merging: false,
            saving: false,
            postProcess: null
        };
        this.jobs.push(job);
        this.extras.set(job.id, options);
        this.emit(job);
        this.pump();
        return { ok: true, job: { ...job }, message: null };
    }

    cancel(id: string): void {
        const job = this.find(id);
        if (!job) {
            return;
        }
        if (job.status === 'running') {
            if (this.endChecks.has(id)) {
                this.concludeEndCheck(job);
                return;
            }
            this.handles.get(id)?.cancel();
            return;
        }
        if (job.status === 'queued') {
            job.status = 'cancelled';
            this.emit(job);
            return;
        }
        if (job.status === 'paused') {
            Object.assign(job, { status: 'cancelled', speed: '', eta: '' });
            this.settleLeftovers(job);
            this.savePaused();
            this.emit(job);
        }
    }

    retry(id: string): void {
        const job = this.find(id);
        if (!job || (job.status !== 'error' && job.status !== 'cancelled')) {
            return;
        }
        Object.assign(job, { status: 'queued', percent: 0, speed: '', eta: '', error: null, filePath: null, live: false, elapsedSeconds: 0, downloadedBytes: 0, hasPartial: false, waitingForLive: false, endCheck: null, merging: false, saving: false, postProcess: null });
        this.outputPaths.delete(job.id);
        this.parts.delete(job.id);
        this.stopRequested.delete(job.id);
        this.emit(job);
        this.pump();
    }

    // Removing a failed or cancelled download also deletes what it left in the folder. The bulk clear keeps live recordings.
    remove(id: string, options: { deleteLiveRecording?: boolean } = {}): void {
        const job = this.find(id);
        if (!job) {
            return;
        }
        if (job.status === 'running') {
            this.abandonEndCheck(id);
            this.handles.get(id)?.cancel();
        } else if (job.hasPartial) {
            this.deleteLeftovers(job, options.deleteLiveRecording ?? true);
        }
        this.jobs.splice(this.jobs.indexOf(job), 1);
        this.extras.delete(id);
        if (job.status === 'paused') {
            this.savePaused();
        }
        if (job.status !== 'running') {
            this.outputPaths.delete(id);
        }
        this.stopTicker(id);
        this.parts.delete(id);
        this.stopRequested.delete(id);
        this.pauseRequested.delete(id);
        this.deps.onJobRemoved(id);
        this.pump();
    }

    clearFinished(): void {
        this.jobs
            .filter(isFinished)
            .forEach((job) => {
                this.remove(job.id, { deleteLiveRecording: false });
            });
    }

    // Deletes the unfinished files of a failed or cancelled download and keeps its card.
    clearPartials(id: string): void {
        const job = this.find(id);
        if (!job || !job.hasPartial) {
            return;
        }
        this.deleteLeftovers(job, true);
        job.hasPartial = false;
        this.emit(job);
    }

    private find(id: string): DownloadJob | undefined {
        return this.jobs.find((job) => {
            return job.id === id;
        });
    }

    private emit(job: DownloadJob): void {
        this.deps.onJobUpdate({ ...job });
    }

    private pump(): void {
        if (this.closed) {
            return;
        }
        const settings = this.deps.getSettings();
        let running = this.jobs.filter((job) => {
            return job.status === 'running';
        }).length;
        for (const job of this.jobs) {
            if (running >= settings.maxConcurrent) {
                return;
            }
            if (job.status === 'queued') {
                this.start(job);
                running += 1;
            }
        }
    }

    // The settings of a download: the ones saved, replaced by the options chosen for this download only.
    private settingsFor(job: DownloadJob): Settings {
        return { ...this.deps.getSettings(), ...this.extras.get(job.id)?.options };
    }

    private start(job: DownloadJob): void {
        job.status = 'running';
        this.emit(job);
        this.launch(job, this.settingsFor(job), this.extras.get(job.id));
    }

    // Runs yt-dlp for a job. `resumedPart` is set for the attempts that look for a live stream that stopped: they only
    // record when it is live again and write to a new file.
    private launch(job: DownloadJob, settings: Settings, extras: RequestExtras | undefined, resumedPart?: number): void {
        const args = buildYtdlpArgs(job.url, settings, this.deps.defaultDownloadDir, this.deps.resolveFfmpegLocation(settings), { ...extras, resumedPart });
        let wentLive = false;
        const handle = this.deps.startRun(
            this.deps.resolveYtdlpPath(settings),
            args,
            (progress) => {
                this.applyProgress(job, progress);
            },
            (info) => {
                if (info.live && resumedPart !== undefined && !wentLive) {
                    wentLive = true;
                    this.resumeRecording(job, resumedPart);
                }
                this.applyInfo(job, info);
            },
            () => {
                this.applyWaiting(job);
            },
            (event) => {
                this.applyPostProcess(job, event);
            }
        );
        this.handles.set(job.id, handle);
        void handle.result.then((result) => {
            if (this.handles.get(job.id) === handle) {
                this.handles.delete(job.id);
            }
            job.postProcess = null;
            if (result.status === 'cancelled' && this.pauseRequested.delete(job.id)) {
                this.finishPaused(job);
                return;
            }
            if (resumedPart !== undefined && !wentLive) {
                this.endCheckAttemptEnded(job);
                return;
            }
            if (result.status === 'stopped') {
                const salvage = this.finishStopped(job).finally(() => {
                    this.salvaging.delete(salvage);
                });
                this.salvaging.add(salvage);
                return;
            }
            if (this.shouldCheckEnd(job, result)) {
                this.beginEndCheck(job, result);
                return;
            }
            this.finishMerged(job, result);
        });
    }

    // yt-dlp prints "[wait]" while it waits for a scheduled live stream; the first recording line ends the wait.
    // The download is complete and yt-dlp is now converting, merging or tagging the file: the speed no longer means anything.
    private applyPostProcess(job: DownloadJob, event: PostProcessEvent): void {
        if (event.status !== 'started' || !this.find(job.id)) {
            return;
        }
        Object.assign(job, { postProcess: event.processor, percent: 100, speed: '', eta: '', waitingForLive: false });
        this.emit(job);
    }

    private applyWaiting(job: DownloadJob): void {
        if (job.waitingForLive || job.live) {
            return;
        }
        job.waitingForLive = true;
        this.emit(job);
    }

    private shouldCheckEnd(job: DownloadJob, result: RunResult): boolean {
        const settings = this.settingsFor(job);
        return !this.closed && job.live && !this.stopRequested.has(job.id) && settings.verifyLiveEnd && (result.status === 'done' || result.status === 'error') && this.find(job.id) !== undefined;
    }

    // A live stream that ended (or dropped) is not finished right away: for a few seconds the app keeps asking yt-dlp whether
    // it is live again. If it is, the recording goes on in a new file of the same card; if not, the card ends as it would have.
    private beginEndCheck(job: DownloadJob, original: RunResult): void {
        const totalSeconds = this.settingsFor(job).verifyLiveEndSeconds;
        this.stopTicker(job.id);
        const check: EndCheck = {
            original,
            secondsLeft: totalSeconds,
            attempts: 0,
            interval: setInterval(() => {
                this.tickEndCheck(job);
            }, LIVE_TICK_MS),
            retry: null
        };
        this.endChecks.set(job.id, check);
        Object.assign(job, { speed: '', eta: '', endCheck: { secondsLeft: totalSeconds, totalSeconds } });
        this.emit(job);
        this.attemptEndCheck(job);
    }

    private tickEndCheck(job: DownloadJob): void {
        const check = this.endChecks.get(job.id);
        if (!check || !job.endCheck) {
            return;
        }
        check.secondsLeft -= 1;
        if (check.secondsLeft <= 0) {
            this.concludeEndCheck(job);
            return;
        }
        job.endCheck = { ...job.endCheck, secondsLeft: check.secondsLeft };
        this.emit(job);
    }

    private attemptEndCheck(job: DownloadJob): void {
        const check = this.endChecks.get(job.id);
        if (!check) {
            return;
        }
        check.retry = null;
        check.attempts += 1;
        this.launch(job, this.settingsFor(job), this.extras.get(job.id), (this.parts.get(job.id) ?? 1) + 1);
    }

    // An attempt ended without the stream being live: try again shortly, while there is time left.
    private endCheckAttemptEnded(job: DownloadJob): void {
        const check = this.endChecks.get(job.id);
        if (!check || check.retry !== null) {
            return;
        }
        check.retry = setTimeout(() => {
            this.attemptEndCheck(job);
        }, LIVE_END_RETRY_MS);
    }

    private clearEndCheck(id: string): EndCheck | undefined {
        const check = this.endChecks.get(id);
        if (!check) {
            return undefined;
        }
        clearInterval(check.interval);
        if (check.retry !== null) {
            clearTimeout(check.retry);
        }
        this.endChecks.delete(id);
        const job = this.find(id);
        if (job) {
            job.endCheck = null;
        }
        return check;
    }

    // The time is up (or the user wants to stop waiting): the card ends the way the recording ended.
    private concludeEndCheck(job: DownloadJob): void {
        const check = this.clearEndCheck(job.id);
        if (!check) {
            return;
        }
        const attempt = this.handles.get(job.id);
        this.handles.delete(job.id);
        attempt?.cancel();
        this.finishMerged(job, check.original);
    }

    // The card was removed during the check: nothing to finish, only timers and the running attempt to stop.
    private abandonEndCheck(id: string): void {
        if (!this.clearEndCheck(id)) {
            return;
        }
        const attempt = this.handles.get(id);
        this.handles.delete(id);
        attempt?.cancel();
        this.outputPaths.delete(id);
    }

    // The stream is live again: the attempt is now the recording of this job.
    private resumeRecording(job: DownloadJob, part: number): void {
        this.clearEndCheck(job.id);
        this.parts.set(job.id, part);
    }

    // A live stream has no end and no size to measure a percentage against: show how long it has been recording and
    // how much was written to its partial file instead.
    private applyInfo(job: DownloadJob, info: DownloadInfo): void {
        this.outputPaths.set(job.id, (this.outputPaths.get(job.id) ?? new Set<string>()).add(info.filePath));
        if (!info.live || this.tickers.has(job.id)) {
            return;
        }
        job.live = true;
        job.waitingForLive = false;
        this.livePaths.set(job.id, info.filePath);
        const startedAt = this.now();
        // A recording that was resumed after the stream came back keeps counting from where the previous part stopped.
        const elapsedBefore = job.elapsedSeconds;
        const tick = (): void => {
            job.elapsedSeconds = elapsedBefore + Math.round((this.now() - startedAt) / 1000);
            const size = (this.deps.fileSize ?? defaultFileSize)(`${info.filePath}.part`) ?? (this.deps.fileSize ?? defaultFileSize)(info.filePath);
            job.downloadedBytes = size ?? job.downloadedBytes;
            this.emit(job);
        };
        this.tickers.set(job.id, setInterval(tick, LIVE_TICK_MS));
        this.emit(job);
    }

    private stopTicker(id: string): void {
        const ticker = this.tickers.get(id);
        if (ticker !== undefined) {
            clearInterval(ticker);
            this.tickers.delete(id);
        }
    }

    private applyProgress(job: DownloadJob, progress: ProgressInfo): void {
        job.live = job.live || progress.live;
        job.waitingForLive = false;
        job.postProcess = null;
        job.downloadedBytes = progress.downloadedBytes ?? job.downloadedBytes;
        if (!this.tickers.has(job.id)) {
            job.elapsedSeconds = progress.elapsedSeconds ?? job.elapsedSeconds;
        }
        job.percent = progress.percent;
        job.speed = progress.speed;
        job.eta = progress.eta;
        job.title = progress.title.length > 0 ? progress.title : job.title;
        this.emit(job);
    }

    private async finishStopped(job: DownloadJob): Promise<void> {
        this.stopTicker(job.id);
        const livePath = this.livePaths.get(job.id);
        this.livePaths.delete(job.id);
        const saved = livePath && this.deps.salvageRecording ? await this.deps.salvageRecording(livePath).catch(() => {
            return null;
        }) : null;
        if (saved) {
            this.finish(job, await this.withMergedParts(job, { status: 'done', filePath: saved }));
            return;
        }
        this.finish(job, { status: 'error', error: SALVAGE_FAILED_ERROR });
    }

    private partsToMerge(job: DownloadJob, result: RunResult): string[] {
        const paths = [...(this.outputPaths.get(job.id) ?? [])];
        const resumed = (this.parts.get(job.id) ?? 1) > 1;
        const mergeable = result.status === 'done' && resumed && this.deps.mergeParts !== undefined && this.find(job.id) !== undefined;
        return mergeable && paths.length > 1 ? paths : [];
    }

    // A recording that was resumed after the stream came back ends as one file: the parts are joined, in order, into the
    // first one. If they cannot be joined the card ends as it was, and every part stays in the folder.
    private async withMergedParts(job: DownloadJob, result: RunResult): Promise<RunResult> {
        const paths = this.partsToMerge(job, result);
        if (paths.length === 0 || !this.deps.mergeParts) {
            return result;
        }
        job.merging = true;
        this.emit(job);
        const merged = await this.deps.mergeParts(paths).catch(() => {
            return null;
        });
        return merged ? { status: 'done', filePath: merged } : result;
    }

    private finishMerged(job: DownloadJob, result: RunResult): void {
        if (this.partsToMerge(job, result).length === 0) {
            this.finish(job, result);
            return;
        }
        this.stopTicker(job.id);
        const merging = this.withMergedParts(job, result)
            .then((merged) => {
                this.finish(job, merged);
            })
            .finally(() => {
                this.salvaging.delete(merging);
            });
        this.salvaging.add(merging);
    }

    private leftoversOf(job: DownloadJob): string[] {
        const find = this.deps.findPartialFiles;
        const paths = [...(this.outputPaths.get(job.id) ?? [])];
        return find
            ? [
                  ...new Set(
                      paths.flatMap((path) => {
                          return find(path);
                      })
                  )
              ]
            : [];
    }

    private deleteLeftovers(job: DownloadJob, includeLiveRecording: boolean): void {
        if (job.live && !includeLiveRecording) {
            return;
        }
        const files = this.leftoversOf(job);
        if (files.length > 0) {
            this.deps.deleteFiles?.(files);
        }
    }

    // After an error or a cancel: delete what was left behind when the user asked for it (live recordings are always kept,
    // they can still be played), otherwise remember that it is there so the card can offer to clear it.
    private settleLeftovers(job: DownloadJob): void {
        const files = this.leftoversOf(job);
        if (files.length > 0 && !job.live && this.deps.getSettings().deletePartialsOnFailure) {
            this.deps.deleteFiles?.(files);
            job.hasPartial = false;
            return;
        }
        job.hasPartial = files.length > 0;
    }

    private finish(job: DownloadJob, result: RunResult): void {
        this.stopTicker(job.id);
        this.pauseRequested.delete(job.id);
        this.parts.delete(job.id);
        this.stopRequested.delete(job.id);
        job.waitingForLive = false;
        job.merging = false;
        job.saving = false;
        job.postProcess = null;
        if (!this.find(job.id)) {
            // The card was removed while the download was running: whatever it left behind goes too, except a live recording.
            this.deleteLeftovers(job, false);
            this.outputPaths.delete(job.id);
            return;
        }
        if (result.status === 'done') {
            Object.assign(job, { status: 'done', percent: 100, speed: '', eta: '', filePath: result.filePath });
            this.recordHistory(job, 'done', null);
        } else if (result.status === 'error') {
            Object.assign(job, { status: 'error', speed: '', eta: '', error: result.error });
            this.recordHistory(job, 'error', result.error);
        } else {
            Object.assign(job, { status: 'cancelled', speed: '', eta: '' });
        }
        if (job.status === 'error' || job.status === 'cancelled') {
            this.settleLeftovers(job);
        } else {
            this.outputPaths.delete(job.id);
        }
        this.emit(job);
        this.pump();
    }

    // The run was ended on purpose to pause: the card waits with its partial files and the place in the queue is free.
    private finishPaused(job: DownloadJob): void {
        this.stopTicker(job.id);
        if (!this.find(job.id)) {
            // The card was removed while the download was being paused: whatever it left behind goes too.
            this.deleteLeftovers(job, false);
            this.outputPaths.delete(job.id);
            return;
        }
        Object.assign(job, { status: 'paused', speed: '', eta: '', hasPartial: this.leftoversOf(job).length > 0 });
        this.savePaused();
        this.emit(job);
        this.pump();
    }

    private recordHistory(job: DownloadJob, status: 'done' | 'error', error: DownloadError | null): void {
        this.deps.addHistory({
            id: job.id,
            url: job.url,
            title: job.title ?? job.url,
            filePath: job.filePath,
            status,
            errorTitle: error?.title ?? null,
            finishedAt: this.now()
        });
        this.deps.onHistoryChanged();
    }
}
