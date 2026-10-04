import { DEFAULT_SETTINGS } from '@shared/constants';
import type { DownloadError, DownloadInfo, DownloadJob, HistoryEntry, PostProcessEvent, ProgressInfo, Settings } from '@shared/types';
import { applyLanguage } from '@main/services/language';
import type { PausedDownload } from '@main/services/pausedStore';
import { makeJob } from '../../helpers/mockApi';
import { LIVE_END_RETRY_MS, LIVE_TICK_MS, QueueManager, type QueueDependencies } from '@main/services/queueManager';
import { buildYtdlpArgs } from '@main/services/ytdlpArgsBuilder';
import type { RunHandle, RunResult } from '@main/services/ytdlpRunner';

interface ControlledRun {
    binary: string;
    args: string[];
    onProgress: (progress: ProgressInfo) => void;
    onInfo: (info: DownloadInfo) => void;
    onWaiting: (() => void) | undefined;
    onPostProcess: ((event: PostProcessEvent) => void) | undefined;
    resolve: (result: RunResult) => void;
    cancel: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
}

function progress(overrides: Partial<ProgressInfo> = {}): ProgressInfo {
    return { percent: 0, speed: '', eta: '', title: '', downloadedBytes: null, elapsedSeconds: null, live: false, ...overrides };
}

const DOWNLOAD_ERROR: DownloadError = { code: 'NETWORK', title: 'Network failure', hint: 'Check your connection and try again.', raw: 'boom' };

function setup(settings: Partial<Settings> = {}, extraDeps: Partial<QueueDependencies> = {}) {
    const runs: ControlledRun[] = [];
    const updates: DownloadJob[] = [];
    const removed: string[] = [];
    const history: HistoryEntry[] = [];
    const onHistoryChanged = vi.fn();
    let counter = 0;
    let clock = 1000;
    const fileSizes = new Map<string, number>();
    const currentSettings: Settings = { ...DEFAULT_SETTINGS, maxConcurrent: 2, verifyLiveEnd: false, ...settings };
    const queue = new QueueManager({
        getSettings: () => {
            return currentSettings;
        },
        defaultDownloadDir: '/dl',
        resolveYtdlpPath: (resolvedSettings) => {
            return resolvedSettings.ytdlpPath.length > 0 ? resolvedSettings.ytdlpPath : 'yt-dlp';
        },
        resolveFfmpegLocation: () => {
            return '/bundled/bin';
        },
        fileSize: (path) => {
            return fileSizes.get(path) ?? null;
        },
        startRun: (binary, args, onProgress, onInfo, onWaiting, onPostProcess): RunHandle => {
            let resolveResult: (result: RunResult) => void = () => {
                return undefined;
            };
            const result = new Promise<RunResult>((resolve) => {
                resolveResult = resolve;
            });
            const cancel = vi.fn(() => {
                resolveResult({ status: 'cancelled' });
            });
            const stop = vi.fn(() => {
                resolveResult({ status: 'done', filePath: '/dl/recorded.mp4' });
            });
            runs.push({ binary, args, onProgress, onInfo, onWaiting, onPostProcess, resolve: resolveResult, cancel, stop });
            return { result, cancel, stop };
        },
        addHistory: (entry) => {
            history.push(entry);
        },
        onJobUpdate: (job) => {
            updates.push(job);
        },
        onJobRemoved: (id) => {
            removed.push(id);
        },
        onHistoryChanged,
        ...extraDeps,
        generateId: () => {
            counter += 1;
            return `job-${counter}`;
        },
        now: () => {
            clock += 1;
            return clock;
        }
    });
    const advanceClock = (milliseconds: number): void => {
        clock += milliseconds;
    };
    return { queue, runs, updates, removed, history, onHistoryChanged, currentSettings, fileSizes, advanceClock };
}

async function flush(): Promise<void> {
    await new Promise((resolve) => {
        setImmediate(resolve);
    });
}

const URL_A = 'https://example.com/a';
const URL_B = 'https://example.com/b';
const URL_C = 'https://example.com/c';

describe('QueueManager.add messages in another language', () => {
    afterEach(() => {
        applyLanguage('en', 'en-US');
    });

    it('translates the invalid URL message', () => {
        applyLanguage('pt', 'en-US');
        const { queue } = setup();
        expect(queue.add('nope')).toEqual({ ok: false, job: null, message: 'URL inválida. Use um link http(s).' });
    });

    it('translates the unbounded auto-subtitles message', () => {
        applyLanguage('zh', 'en-US');
        const { queue } = setup({ writeSubtitles: true, autoSubtitles: true, subtitleLangs: '' });
        expect(queue.add('https://example.com/a')).toEqual({
            ok: false,
            job: null,
            message: '自动生成的字幕需要指定语言。请在“设置”中填写“字幕语言”（例如 ja），或关闭“包含自动生成的字幕”。'
        });
    });
});

describe('QueueManager.add', () => {
    it('rejects invalid URLs without creating a job', () => {
        const { queue, runs, updates } = setup();
        expect(queue.add('nope')).toEqual({ ok: false, job: null, message: 'Invalid URL. Use an http(s) link.' });
        expect(queue.list()).toEqual([]);
        expect(runs).toHaveLength(0);
        expect(updates).toHaveLength(0);
    });

    it('rejects the download when auto-generated subtitles have no language, without creating a job', () => {
        const { queue, runs, updates } = setup({ writeSubtitles: true, autoSubtitles: true, subtitleLangs: '' });
        expect(queue.add(URL_A)).toEqual({
            ok: false,
            job: null,
            message: 'Auto-generated subtitles need a language. Fill in "Subtitle languages" in Settings (e.g. ja), or turn off "Include auto-generated subtitles".'
        });
        expect(queue.list()).toEqual([]);
        expect(runs).toHaveLength(0);
        expect(updates).toHaveLength(0);
    });

    it('accepts the download when auto-generated subtitles have an explicit language', () => {
        const { queue, runs } = setup({ writeSubtitles: true, autoSubtitles: true, subtitleLangs: 'ja' });
        expect(queue.add(URL_A).ok).toBe(true);
        expect(runs).toHaveLength(1);
        expect(runs[0]?.args).toEqual(expect.arrayContaining(['--write-subs', '--write-auto-subs', '--sub-langs', 'ja']));
    });

    it('accepts the download with an empty language when auto-generated subtitles are off', () => {
        const { queue, runs } = setup({ writeSubtitles: true, autoSubtitles: false, subtitleLangs: '' });
        expect(queue.add(URL_A).ok).toBe(true);
        expect(runs).toHaveLength(1);
        expect(runs[0]?.args[(runs[0]?.args.indexOf('--sub-langs') ?? 0) + 1]).toBe('all');
    });

    it('creates a job, starts it immediately and emits queued then running', () => {
        const { queue, runs, updates } = setup();
        const result = queue.add(`  ${URL_A} `);
        expect(result.ok).toBe(true);
        expect(result.message).toBeNull();
        expect(result.job).toEqual({
            id: 'job-1',
            url: URL_A,
            status: 'running',
            title: null,
            percent: 0,
            speed: '',
            eta: '',
            filePath: null,
            error: null,
            createdAt: 1001,
            pageUrl: null,
            live: false,
            elapsedSeconds: 0,
            downloadedBytes: 0,
            hasPartial: false,
            customized: false,
            waitingForLive: false,
            endCheck: null,
            merging: false,
            saving: false,
            postProcess: null
        });
        expect(updates.map((job) => {
            return job.status;
        })).toEqual(['queued', 'running']);
        expect(runs).toHaveLength(1);
        expect(runs[0]?.binary).toBe('yt-dlp');
        expect(runs[0]?.args).toEqual(buildYtdlpArgs(URL_A, { ...DEFAULT_SETTINGS, maxConcurrent: 2 }, '/dl', '/bundled/bin'));
    });

    it('uses the custom yt-dlp binary path', () => {
        const { queue, runs } = setup({ ytdlpPath: '/opt/yt-dlp' });
        queue.add(URL_A);
        expect(runs[0]?.binary).toBe('/opt/yt-dlp');
    });

    it('respects the concurrency limit and starts queued jobs when a slot frees', async () => {
        const { queue, runs } = setup({ maxConcurrent: 1 });
        queue.add(URL_A);
        queue.add(URL_B);
        expect(runs).toHaveLength(1);
        expect(queue.list().map((job) => {
            return job.status;
        })).toEqual(['running', 'queued']);
        runs[0]?.resolve({ status: 'done', filePath: '/dl/a.mp4' });
        await flush();
        expect(runs).toHaveLength(2);
        expect(runs[1]?.args.at(-1)).toBe(URL_B);
        expect(queue.list().map((job) => {
            return job.status;
        })).toEqual(['done', 'running']);
    });

    it('runs jobs in parallel up to the limit', () => {
        const { queue, runs } = setup({ maxConcurrent: 2 });
        queue.add(URL_A);
        queue.add(URL_B);
        queue.add(URL_C);
        expect(runs).toHaveLength(2);
        expect(queue.list().map((job) => {
            return job.status;
        })).toEqual(['running', 'running', 'queued']);
    });
});

describe('QueueManager progress and completion', () => {
    it('applies progress updates and keeps the last known title', () => {
        const { queue, runs } = setup();
        queue.add(URL_A);
        runs[0]?.onProgress(progress({ percent: 42.5, speed: '1MiB/s', eta: '00:10', title: 'My Video' }));
        runs[0]?.onProgress(progress({ percent: 50, speed: '2MiB/s', eta: '00:05', title: '' }));
        expect(queue.list()[0]).toMatchObject({ percent: 50, speed: '2MiB/s', eta: '00:05', title: 'My Video' });
    });

    it('marks a job done, records history and notifies', async () => {
        const { queue, runs, history, onHistoryChanged } = setup();
        queue.add(URL_A);
        runs[0]?.onProgress(progress({ percent: 90, speed: '1MiB/s', eta: '00:01', title: 'My Video' }));
        runs[0]?.resolve({ status: 'done', filePath: '/dl/My Video.mp4' });
        await flush();
        expect(queue.list()[0]).toMatchObject({ status: 'done', percent: 100, speed: '', eta: '', filePath: '/dl/My Video.mp4', error: null });
        expect(history).toEqual([
            { id: 'job-1', url: URL_A, title: 'My Video', filePath: '/dl/My Video.mp4', status: 'done', errorTitle: null, finishedAt: expect.any(Number) }
        ]);
        expect(onHistoryChanged).toHaveBeenCalledTimes(1);
    });

    it('marks a job as error, records history with the URL as title fallback', async () => {
        const { queue, runs, history, onHistoryChanged } = setup();
        queue.add(URL_A);
        runs[0]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
        await flush();
        expect(queue.list()[0]).toMatchObject({ status: 'error', error: DOWNLOAD_ERROR, speed: '', eta: '' });
        expect(history).toEqual([
            { id: 'job-1', url: URL_A, title: URL_A, filePath: null, status: 'error', errorTitle: 'Network failure', finishedAt: expect.any(Number) }
        ]);
        expect(onHistoryChanged).toHaveBeenCalledTimes(1);
    });

    it('marks a cancelled run without recording history', async () => {
        const { queue, runs, history, onHistoryChanged } = setup();
        queue.add(URL_A);
        runs[0]?.resolve({ status: 'cancelled' });
        await flush();
        expect(queue.list()[0]?.status).toBe('cancelled');
        expect(history).toEqual([]);
        expect(onHistoryChanged).not.toHaveBeenCalled();
    });
});

describe('QueueManager.cancel', () => {
    it('cancels a running job through its handle', async () => {
        const { queue, runs } = setup();
        queue.add(URL_A);
        queue.cancel('job-1');
        expect(runs[0]?.cancel).toHaveBeenCalledTimes(1);
        await flush();
        expect(queue.list()[0]?.status).toBe('cancelled');
    });

    it('cancels a queued job immediately without starting it', () => {
        const { queue, runs, updates } = setup({ maxConcurrent: 1 });
        queue.add(URL_A);
        queue.add(URL_B);
        queue.cancel('job-2');
        expect(queue.list()[1]?.status).toBe('cancelled');
        expect(updates.at(-1)).toMatchObject({ id: 'job-2', status: 'cancelled' });
        expect(runs).toHaveLength(1);
    });

    it('ignores unknown ids and finished jobs', async () => {
        const { queue, runs } = setup();
        queue.add(URL_A);
        runs[0]?.resolve({ status: 'done', filePath: null });
        await flush();
        queue.cancel('unknown');
        queue.cancel('job-1');
        expect(queue.list()[0]?.status).toBe('done');
        expect(runs[0]?.cancel).not.toHaveBeenCalled();
    });
});

describe('QueueManager.retry', () => {
    it('requeues a failed job and restarts it with a clean state', async () => {
        const { queue, runs } = setup();
        queue.add(URL_A);
        runs[0]?.onProgress(progress({ percent: 30, speed: '1MiB/s', eta: '00:10', title: 'T' }));
        runs[0]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
        await flush();
        queue.retry('job-1');
        expect(runs).toHaveLength(2);
        expect(queue.list()[0]).toMatchObject({ status: 'running', percent: 0, speed: '', eta: '', error: null, filePath: null });
    });

    it('requeues a cancelled job', async () => {
        const { queue, runs } = setup();
        queue.add(URL_A);
        queue.cancel('job-1');
        await flush();
        queue.retry('job-1');
        expect(runs).toHaveLength(2);
        expect(queue.list()[0]?.status).toBe('running');
    });

    it('ignores jobs that are running, done or unknown', async () => {
        const { queue, runs } = setup();
        queue.add(URL_A);
        queue.retry('job-1');
        queue.retry('missing');
        expect(runs).toHaveLength(1);
        runs[0]?.resolve({ status: 'done', filePath: null });
        await flush();
        queue.retry('job-1');
        expect(runs).toHaveLength(1);
        expect(queue.list()[0]?.status).toBe('done');
    });
});

describe('QueueManager.remove and clearFinished', () => {
    it('removes a finished job and emits the removal', async () => {
        const { queue, runs, removed } = setup();
        queue.add(URL_A);
        runs[0]?.resolve({ status: 'done', filePath: null });
        await flush();
        queue.remove('job-1');
        expect(queue.list()).toEqual([]);
        expect(removed).toEqual(['job-1']);
    });

    it('cancels the process when removing a running job and ignores its late result', async () => {
        const { queue, runs, history } = setup();
        queue.add(URL_A);
        queue.remove('job-1');
        expect(runs[0]?.cancel).toHaveBeenCalledTimes(1);
        await flush();
        expect(queue.list()).toEqual([]);
        expect(history).toEqual([]);
    });

    it('ignores unknown ids', () => {
        const { queue, removed } = setup();
        queue.remove('missing');
        expect(removed).toEqual([]);
    });

    it('starts the next queued job after removing a running one', () => {
        const { queue, runs } = setup({ maxConcurrent: 1 });
        queue.add(URL_A);
        queue.add(URL_B);
        queue.remove('job-1');
        expect(runs).toHaveLength(2);
        expect(runs[1]?.args.at(-1)).toBe(URL_B);
    });

    it('clears only finished jobs', async () => {
        const { queue, runs, removed } = setup({ maxConcurrent: 3 });
        queue.add(URL_A);
        queue.add(URL_B);
        queue.add(URL_C);
        runs[0]?.resolve({ status: 'done', filePath: null });
        runs[1]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
        await flush();
        queue.clearFinished();
        expect(removed).toEqual(['job-1', 'job-2']);
        expect(queue.list().map((job) => {
            return job.id;
        })).toEqual(['job-3']);
    });
});

describe('QueueManager partial files', () => {
    const FILE_A = '/dl/Video A [abc].mp4';
    const PARTIALS_A = [`${FILE_A}.part`, '/dl/Video A [abc].f137.mp4.part'];
    const LIVE_FILE = '/dl/Live Show [live].mp4';

    function setupWithPartials(settings: Partial<Settings> = {}) {
        const partials = new Map<string, string[]>([
            [FILE_A, PARTIALS_A],
            ['/dl/Video B [def].mp4', ['/dl/Video B [def].mp4.part']],
            [LIVE_FILE, [`${LIVE_FILE}.part`]]
        ]);
        const findPartialFiles = vi.fn((finalPath: string) => {
            return partials.get(finalPath) ?? [];
        });
        const deleteFiles = vi.fn();
        return { ...setup(settings, { findPartialFiles, deleteFiles }), findPartialFiles, deleteFiles };
    }

    async function failDownload(setupResult: ReturnType<typeof setupWithPartials>, filePath: string = FILE_A, live = false): Promise<void> {
        setupResult.queue.add(URL_A);
        setupResult.runs[0]?.onInfo({ live, filePath });
        setupResult.runs[0]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
        await flush();
    }

    describe('when the setting is on (default)', () => {
        it('is on by default', () => {
            expect(DEFAULT_SETTINGS.deletePartialsOnFailure).toBe(true);
        });

        it('deletes the partial files of a download that failed', async () => {
            const result = setupWithPartials();
            await failDownload(result);
            expect(result.findPartialFiles).toHaveBeenCalledWith(FILE_A);
            expect(result.deleteFiles).toHaveBeenCalledTimes(1);
            expect(result.deleteFiles).toHaveBeenCalledWith(PARTIALS_A);
            expect(result.queue.getJob('job-1')).toMatchObject({ status: 'error', hasPartial: false });
        });

        it('deletes the partial files of a download that was cancelled', async () => {
            const result = setupWithPartials();
            result.queue.add(URL_A);
            result.runs[0]?.onInfo({ live: false, filePath: FILE_A });
            result.queue.cancel('job-1');
            await flush();
            expect(result.deleteFiles).toHaveBeenCalledWith(PARTIALS_A);
            expect(result.queue.getJob('job-1')).toMatchObject({ status: 'cancelled', hasPartial: false });
        });

        it('deletes the partial files of every video a playlist reported, each only once', async () => {
            const result = setupWithPartials();
            result.queue.add(URL_A);
            result.runs[0]?.onInfo({ live: false, filePath: FILE_A });
            result.runs[0]?.onInfo({ live: false, filePath: FILE_A });
            result.runs[0]?.onInfo({ live: false, filePath: '/dl/Video B [def].mp4' });
            result.runs[0]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
            await flush();
            expect(result.deleteFiles).toHaveBeenCalledTimes(1);
            expect(result.deleteFiles).toHaveBeenCalledWith([...PARTIALS_A, '/dl/Video B [def].mp4.part']);
        });

        it('keeps the recording of a live stream and remembers that it is there', async () => {
            const result = setupWithPartials();
            await failDownload(result, LIVE_FILE, true);
            expect(result.deleteFiles).not.toHaveBeenCalled();
            expect(result.queue.getJob('job-1')).toMatchObject({ status: 'error', live: true, hasPartial: true });
        });

        it('does nothing for a download that never reported a file', async () => {
            const result = setupWithPartials();
            result.queue.add(URL_A);
            result.runs[0]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
            await flush();
            expect(result.findPartialFiles).not.toHaveBeenCalled();
            expect(result.deleteFiles).not.toHaveBeenCalled();
            expect(result.queue.getJob('job-1')?.hasPartial).toBe(false);
        });

        it('does nothing when the download left no partial file', async () => {
            const result = setupWithPartials();
            await failDownload(result, '/dl/Nothing.mp4');
            expect(result.deleteFiles).not.toHaveBeenCalled();
            expect(result.queue.getJob('job-1')?.hasPartial).toBe(false);
        });

        it('does not look for partial files after a download that succeeded', async () => {
            const result = setupWithPartials();
            result.queue.add(URL_A);
            result.runs[0]?.onInfo({ live: false, filePath: FILE_A });
            result.runs[0]?.resolve({ status: 'done', filePath: FILE_A });
            await flush();
            expect(result.findPartialFiles).not.toHaveBeenCalled();
            expect(result.deleteFiles).not.toHaveBeenCalled();
            expect(result.queue.getJob('job-1')).toMatchObject({ status: 'done', hasPartial: false });
        });
    });

    describe('when the setting is off', () => {
        it('keeps the partial files and marks the job so the card can offer to clear them', async () => {
            const result = setupWithPartials({ deletePartialsOnFailure: false });
            await failDownload(result);
            expect(result.deleteFiles).not.toHaveBeenCalled();
            expect(result.queue.getJob('job-1')).toMatchObject({ status: 'error', hasPartial: true });
            expect(result.updates.at(-1)).toMatchObject({ status: 'error', hasPartial: true });
        });
    });

    describe('clearPartials', () => {
        it('deletes what a failed download left behind and keeps its card', async () => {
            const result = setupWithPartials({ deletePartialsOnFailure: false });
            await failDownload(result);
            result.updates.length = 0;
            result.queue.clearPartials('job-1');
            expect(result.deleteFiles).toHaveBeenCalledTimes(1);
            expect(result.deleteFiles).toHaveBeenCalledWith(PARTIALS_A);
            expect(result.queue.getJob('job-1')).toMatchObject({ status: 'error', hasPartial: false });
            expect(result.updates).toHaveLength(1);
            expect(result.updates[0]).toMatchObject({ id: 'job-1', hasPartial: false });
        });

        it('also deletes a live recording, because the user asked for it', async () => {
            const result = setupWithPartials();
            await failDownload(result, LIVE_FILE, true);
            result.queue.clearPartials('job-1');
            expect(result.deleteFiles).toHaveBeenCalledWith([`${LIVE_FILE}.part`]);
            expect(result.queue.getJob('job-1')?.hasPartial).toBe(false);
        });

        it('ignores running, finished and unknown downloads', async () => {
            const result = setupWithPartials();
            result.queue.add(URL_A);
            result.runs[0]?.onInfo({ live: false, filePath: FILE_A });
            result.queue.clearPartials('job-1');
            result.queue.clearPartials('missing');
            result.runs[0]?.resolve({ status: 'done', filePath: FILE_A });
            await flush();
            result.queue.clearPartials('job-1');
            expect(result.deleteFiles).not.toHaveBeenCalled();
        });
    });

    describe('remove', () => {
        it('deletes what a failed download left behind', async () => {
            const result = setupWithPartials({ deletePartialsOnFailure: false });
            await failDownload(result);
            result.queue.remove('job-1');
            expect(result.deleteFiles).toHaveBeenCalledTimes(1);
            expect(result.deleteFiles).toHaveBeenCalledWith(PARTIALS_A);
            expect(result.queue.list()).toEqual([]);
        });

        it('deletes a live recording when it is removed one by one', async () => {
            const result = setupWithPartials();
            await failDownload(result, LIVE_FILE, true);
            result.queue.remove('job-1');
            expect(result.deleteFiles).toHaveBeenCalledWith([`${LIVE_FILE}.part`]);
        });

        it('does not look for files when a finished download is removed', async () => {
            const result = setupWithPartials();
            result.queue.add(URL_A);
            result.runs[0]?.onInfo({ live: false, filePath: FILE_A });
            result.runs[0]?.resolve({ status: 'done', filePath: FILE_A });
            await flush();
            result.queue.remove('job-1');
            expect(result.findPartialFiles).not.toHaveBeenCalled();
            expect(result.deleteFiles).not.toHaveBeenCalled();
        });

        it('deletes what a running download leaves behind once its process has stopped', async () => {
            const result = setupWithPartials();
            result.queue.add(URL_A);
            result.runs[0]?.onInfo({ live: false, filePath: FILE_A });
            result.queue.remove('job-1');
            expect(result.deleteFiles).not.toHaveBeenCalled();
            await flush();
            expect(result.deleteFiles).toHaveBeenCalledWith(PARTIALS_A);
            expect(result.queue.list()).toEqual([]);
        });

        it('keeps the recording of a live stream that is removed while it is running', async () => {
            const result = setupWithPartials();
            result.queue.add(URL_A);
            result.runs[0]?.onInfo({ live: true, filePath: LIVE_FILE });
            result.queue.remove('job-1');
            await flush();
            expect(result.deleteFiles).not.toHaveBeenCalled();
        });
    });

    describe('clearFinished', () => {
        it('deletes what the failed downloads left but keeps the live recordings', async () => {
            const result = setupWithPartials({ maxConcurrent: 3 });
            result.queue.add(URL_A);
            result.queue.add(URL_B);
            result.runs[0]?.onInfo({ live: false, filePath: FILE_A });
            result.runs[1]?.onInfo({ live: true, filePath: LIVE_FILE });
            result.runs[0]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
            result.runs[1]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
            await flush();
            result.deleteFiles.mockClear();
            result.queue.clearFinished();
            expect(result.deleteFiles).not.toHaveBeenCalled();
            expect(result.queue.list()).toEqual([]);
        });

        it('deletes the leftovers of failed downloads when the setting kept them', async () => {
            const result = setupWithPartials({ deletePartialsOnFailure: false });
            await failDownload(result);
            result.queue.clearFinished();
            expect(result.deleteFiles).toHaveBeenCalledWith(PARTIALS_A);
        });
    });

    describe('retry', () => {
        it('forgets the previous leftovers and keeps no flag for the new attempt', async () => {
            const result = setupWithPartials({ deletePartialsOnFailure: false });
            await failDownload(result);
            result.queue.retry('job-1');
            expect(result.queue.getJob('job-1')).toMatchObject({ status: 'running', hasPartial: false });
            result.runs[1]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
            await flush();
            expect(result.queue.getJob('job-1')).toMatchObject({ status: 'error', hasPartial: false });
            expect(result.deleteFiles).not.toHaveBeenCalled();
        });
    });
});

describe('QueueManager.list', () => {
    it('returns copies that do not mutate the internal state', () => {
        const { queue } = setup();
        queue.add(URL_A);
        const snapshot = queue.list();
        if (snapshot[0]) {
            snapshot[0].percent = 99;
        }
        expect(queue.list()[0]?.percent).toBe(0);
    });
});

describe('QueueManager.shutdown', () => {
    it('cancels every running process', () => {
        const { queue, runs } = setup({ maxConcurrent: 3 });
        queue.add(URL_A);
        queue.add(URL_B);
        queue.shutdown();
        expect(runs[0]?.cancel).toHaveBeenCalledTimes(1);
        expect(runs[1]?.cancel).toHaveBeenCalledTimes(1);
    });

    it('does not start queued jobs when a running one is cancelled', async () => {
        const { queue, runs } = setup({ maxConcurrent: 1 });
        queue.add(URL_A);
        queue.add(URL_B);
        queue.shutdown();
        await flush();
        expect(runs).toHaveLength(1);
        expect(queue.list().map((job) => {
            return job.status;
        })).toEqual(['cancelled', 'queued']);
    });

    it('does not start new jobs added after the shutdown', () => {
        const { queue, runs } = setup();
        queue.shutdown();
        const result = queue.add(URL_A);
        expect(result.ok).toBe(true);
        expect(result.job?.status).toBe('queued');
        expect(runs).toHaveLength(0);
    });

    it('does nothing when no job is running', () => {
        const { queue, runs } = setup();
        expect(() => {
            queue.shutdown();
        }).not.toThrow();
        expect(runs).toHaveLength(0);
    });
});

describe('QueueManager.pendingCount', () => {
    it('is zero for an empty queue', () => {
        expect(setup().queue.pendingCount()).toBe(0);
    });

    it('counts running and queued jobs', () => {
        const { queue } = setup({ maxConcurrent: 1 });
        queue.add(URL_A);
        queue.add(URL_B);
        expect(queue.pendingCount()).toBe(2);
    });

    it('does not count finished, failed or cancelled jobs', async () => {
        const { queue, runs } = setup({ maxConcurrent: 3 });
        queue.add(URL_A);
        queue.add(URL_B);
        queue.add(URL_C);
        runs[0]?.resolve({ status: 'done', filePath: null });
        runs[1]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
        await flush();
        expect(queue.pendingCount()).toBe(1);
        queue.cancel('job-3');
        await flush();
        expect(queue.pendingCount()).toBe(0);
    });
});

describe('QueueManager request extras (streams found on a page)', () => {
    const STREAM = 'https://cdn.test/v/master.m3u8';
    const EXTRAS = { referer: 'https://site.test/ep-1', userAgent: 'Agent/1.0', cookie: 'sid=1', title: 'Episode 1' };

    it('starts the job with the extras and shows the page title right away', () => {
        const { queue, runs } = setup();
        const result = queue.add(STREAM, EXTRAS);
        expect(result.job?.title).toBe('Episode 1');
        expect(runs[0]?.args).toEqual(buildYtdlpArgs(STREAM, { ...DEFAULT_SETTINGS, maxConcurrent: 2 }, '/dl', '/bundled/bin', EXTRAS));
        expect(runs[0]?.args).toEqual(expect.arrayContaining(['--referer', 'https://site.test/ep-1', '--user-agent', 'Agent/1.0', '--add-header', 'Cookie:sid=1']));
    });

    it('keeps the extras when the job is retried', async () => {
        const { queue, runs } = setup();
        queue.add(STREAM, EXTRAS);
        runs[0]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
        await flush();
        queue.retry('job-1');
        expect(runs[1]?.args).toEqual(runs[0]?.args);
    });

    it('forgets the extras when the job is removed', async () => {
        const { queue, runs } = setup();
        queue.add(STREAM, EXTRAS);
        runs[0]?.resolve({ status: 'done', filePath: null });
        await flush();
        queue.remove('job-1');
        queue.add(STREAM);
        expect(runs[1]?.args).not.toContain('--referer');
    });

    it('does not leak extras between jobs', () => {
        const { queue, runs } = setup({ maxConcurrent: 3 });
        queue.add(STREAM, EXTRAS);
        queue.add(URL_B);
        expect(runs[0]?.args).toContain('--referer');
        expect(runs[1]?.args).not.toContain('--referer');
        expect(runs[1]?.args).toContain('%(title).80s [%(id)s].%(ext)s');
    });
});

describe('QueueManager page address and IP family extras', () => {
    it('remembers the page a stream came from on the job and forces the bound IP family', () => {
        const { queue, runs } = setup();
        const result = queue.add('https://cdn.test/videoplayback?ip=2001:db8::1', { pageUrl: 'https://site.test/ep-1', ipFamily: 6 });
        expect(result.job?.pageUrl).toBe('https://site.test/ep-1');
        expect(queue.getJob('job-1')?.pageUrl).toBe('https://site.test/ep-1');
        expect(runs[0]?.args).toContain('--force-ipv6');
        expect(runs[0]?.args).not.toContain('https://site.test/ep-1');
    });

    it('has no page address for a link the user pasted', () => {
        const { queue } = setup();
        expect(queue.add(URL_A).job?.pageUrl).toBeNull();
    });

    it('keeps the page address and the IP family when the job is retried', async () => {
        const { queue, runs } = setup();
        queue.add('https://cdn.test/v?ip=203.0.113.9', { pageUrl: 'https://site.test/ep-1', ipFamily: 4 });
        runs[0]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
        await flush();
        queue.retry('job-1');
        expect(runs[1]?.args).toContain('--force-ipv4');
        expect(queue.getJob('job-1')?.pageUrl).toBe('https://site.test/ep-1');
    });
});

describe('QueueManager.getJob', () => {
    it('returns a copy of the job', () => {
        const { queue } = setup();
        queue.add(URL_A);
        const job = queue.getJob('job-1');
        expect(job).toMatchObject({ id: 'job-1', url: URL_A, status: 'running' });
        if (job) {
            job.percent = 50;
        }
        expect(queue.getJob('job-1')?.percent).toBe(0);
    });

    it('returns undefined for unknown ids', () => {
        expect(setup().queue.getJob('nope')).toBeUndefined();
    });
});

describe('QueueManager live recordings', () => {
    const LIVE_FILE = '/dl/Live Show [abc].mp4';
    const liveInfo = { live: true, filePath: LIVE_FILE };

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('marks a job as live when yt-dlp announces a live stream', () => {
        const { queue, runs } = setup();
        queue.add(URL_A);
        expect(queue.getJob('job-1')?.live).toBe(false);
        runs[0]?.onInfo(liveInfo);
        expect(queue.getJob('job-1')).toMatchObject({ live: true, status: 'running', elapsedSeconds: 0, downloadedBytes: 0 });
    });

    it('does not mark ordinary downloads as live', () => {
        const { queue, runs } = setup();
        queue.add(URL_A);
        runs[0]?.onInfo({ live: false, filePath: '/dl/v.mp4' });
        vi.advanceTimersByTime(LIVE_TICK_MS * 3);
        expect(queue.getJob('job-1')).toMatchObject({ live: false, elapsedSeconds: 0 });
    });

    it('counts the recording time and reads the size of the partial file every second', () => {
        const { queue, runs, fileSizes, updates, advanceClock } = setup();
        queue.add(URL_A);
        runs[0]?.onInfo(liveInfo);
        fileSizes.set(`${LIVE_FILE}.part`, 5000);
        advanceClock(3000);
        vi.advanceTimersByTime(LIVE_TICK_MS);
        expect(queue.getJob('job-1')).toMatchObject({ elapsedSeconds: 3, downloadedBytes: 5000 });
        fileSizes.set(`${LIVE_FILE}.part`, 9000);
        advanceClock(2000);
        vi.advanceTimersByTime(LIVE_TICK_MS);
        expect(queue.getJob('job-1')).toMatchObject({ elapsedSeconds: 5, downloadedBytes: 9000 });
        expect(updates.at(-1)).toMatchObject({ id: 'job-1', live: true, elapsedSeconds: 5, downloadedBytes: 9000 });
    });

    it('falls back to the finished file when there is no partial file, and keeps the last size when neither exists', () => {
        const { queue, runs, fileSizes } = setup();
        queue.add(URL_A);
        runs[0]?.onInfo(liveInfo);
        fileSizes.set(LIVE_FILE, 777);
        vi.advanceTimersByTime(LIVE_TICK_MS);
        expect(queue.getJob('job-1')?.downloadedBytes).toBe(777);
        fileSizes.clear();
        vi.advanceTimersByTime(LIVE_TICK_MS);
        expect(queue.getJob('job-1')?.downloadedBytes).toBe(777);
    });

    it('starts a single ticker even if the stream is announced twice', () => {
        const { queue, runs, updates } = setup();
        queue.add(URL_A);
        runs[0]?.onInfo(liveInfo);
        runs[0]?.onInfo(liveInfo);
        const before = updates.length;
        vi.advanceTimersByTime(LIVE_TICK_MS);
        expect(updates.length - before).toBe(1);
    });

    it('uses the numbers reported by yt-dlp at the end of a live recording', () => {
        const { queue, runs } = setup();
        queue.add(URL_A);
        runs[0]?.onProgress(progress({ percent: 100, live: true, downloadedBytes: 648600, elapsedSeconds: 16 }));
        expect(queue.getJob('job-1')).toMatchObject({ live: true, downloadedBytes: 648600, elapsedSeconds: 16 });
    });

    it('does not let the reported elapsed time override the live ticker', () => {
        const { queue, runs, advanceClock } = setup();
        queue.add(URL_A);
        runs[0]?.onInfo(liveInfo);
        advanceClock(4000);
        vi.advanceTimersByTime(LIVE_TICK_MS);
        runs[0]?.onProgress(progress({ live: true, elapsedSeconds: 1 }));
        expect(queue.getJob('job-1')?.elapsedSeconds).toBe(4);
    });

    it('stops ticking when the recording ends', async () => {
        const { queue, runs, updates } = setup();
        queue.add(URL_A);
        runs[0]?.onInfo(liveInfo);
        runs[0]?.resolve({ status: 'done', filePath: LIVE_FILE });
        await vi.advanceTimersByTimeAsync(0);
        const before = updates.length;
        vi.advanceTimersByTime(LIVE_TICK_MS * 5);
        expect(updates.length).toBe(before);
        expect(queue.getJob('job-1')).toMatchObject({ status: 'done', live: true, filePath: LIVE_FILE });
    });

    it('stops ticking when the job is removed', () => {
        const { queue, runs, updates } = setup();
        queue.add(URL_A);
        runs[0]?.onInfo(liveInfo);
        queue.remove('job-1');
        const before = updates.length;
        vi.advanceTimersByTime(LIVE_TICK_MS * 3);
        expect(updates.length).toBe(before);
    });

    it('stop asks the running live recording to finish and completes it with its file', async () => {
        const { queue, runs, history } = setup();
        queue.add(URL_A);
        runs[0]?.onInfo(liveInfo);
        queue.stop('job-1');
        expect(runs[0]?.stop).toHaveBeenCalledTimes(1);
        expect(runs[0]?.cancel).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(0);
        expect(queue.getJob('job-1')).toMatchObject({ status: 'done', filePath: '/dl/recorded.mp4' });
        expect(history).toHaveLength(1);
    });

    it('marks the card as saving as soon as stop is asked and until the file is closed', async () => {
        const { queue, runs, updates } = setup();
        queue.add(URL_A);
        runs[0]?.onInfo(liveInfo);
        runs[0]?.stop.mockImplementation(() => {
            return undefined;
        });
        expect(queue.getJob('job-1')?.saving).toBe(false);
        queue.stop('job-1');
        expect(queue.getJob('job-1')).toMatchObject({ status: 'running', saving: true });
        expect(updates.at(-1)).toMatchObject({ id: 'job-1', status: 'running', saving: true });
        runs[0]?.resolve({ status: 'done', filePath: LIVE_FILE });
        await vi.advanceTimersByTimeAsync(0);
        expect(queue.getJob('job-1')).toMatchObject({ status: 'done', filePath: LIVE_FILE, saving: false });
    });

    it('keeps the card saving while a killed recording is converted into its file', async () => {
        let finishSalvage: (path: string | null) => void = () => {
            return undefined;
        };
        const salvageRecording = vi.fn().mockImplementation(() => {
            return new Promise<string | null>((resolve) => {
                finishSalvage = resolve;
            });
        });
        const { queue, runs } = setup({}, { salvageRecording });
        queue.add(URL_A);
        runs[0]?.onInfo(liveInfo);
        runs[0]?.stop.mockImplementation(() => {
            return undefined;
        });
        queue.stop('job-1');
        runs[0]?.resolve({ status: 'stopped' });
        await vi.advanceTimersByTimeAsync(0);
        expect(queue.getJob('job-1')).toMatchObject({ status: 'running', saving: true });
        finishSalvage(LIVE_FILE);
        await vi.advanceTimersByTimeAsync(0);
        expect(queue.getJob('job-1')).toMatchObject({ status: 'done', filePath: LIVE_FILE, saving: false });
    });

    it('never marks a card as saving when stop is ignored', () => {
        const { queue, runs } = setup();
        queue.add(URL_A);
        queue.stop('job-1');
        queue.stop('missing');
        expect(queue.getJob('job-1')?.saving).toBe(false);
        expect(runs[0]?.stop).not.toHaveBeenCalled();
    });

    it('does not mark the card as saving when stop only ends the end check', async () => {
        const context = setup({ verifyLiveEnd: true, verifyLiveEndSeconds: 10 });
        context.queue.add(URL_A);
        context.runs[0]?.onInfo(liveInfo);
        context.runs[0]?.resolve({ status: 'done', filePath: LIVE_FILE });
        await vi.advanceTimersByTimeAsync(0);
        context.queue.stop('job-1');
        expect(context.queue.getJob('job-1')).toMatchObject({ saving: false });
    });

    it('stop ignores jobs that are not live, not running or unknown', async () => {
        const { queue, runs } = setup({ maxConcurrent: 1 });
        queue.add(URL_A);
        queue.add(URL_B);
        queue.stop('job-1');
        queue.stop('job-2');
        queue.stop('missing');
        expect(runs[0]?.stop).not.toHaveBeenCalled();
        runs[0]?.onInfo(liveInfo);
        runs[0]?.resolve({ status: 'done', filePath: LIVE_FILE });
        await vi.advanceTimersByTimeAsync(0);
        queue.stop('job-1');
        expect(runs[0]?.stop).not.toHaveBeenCalled();
    });

    it('cancel still discards a live recording', async () => {
        const { queue, runs } = setup();
        queue.add(URL_A);
        runs[0]?.onInfo(liveInfo);
        queue.cancel('job-1');
        expect(runs[0]?.cancel).toHaveBeenCalledTimes(1);
        expect(runs[0]?.stop).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(0);
        expect(queue.getJob('job-1')?.status).toBe('cancelled');
    });

    it('resets the live fields when a failed recording is retried', async () => {
        const { queue, runs, fileSizes } = setup();
        queue.add(URL_A);
        runs[0]?.onInfo(liveInfo);
        fileSizes.set(`${LIVE_FILE}.part`, 100);
        vi.advanceTimersByTime(LIVE_TICK_MS);
        runs[0]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
        await vi.advanceTimersByTimeAsync(0);
        queue.retry('job-1');
        expect(queue.getJob('job-1')).toMatchObject({ live: false, elapsedSeconds: 0, downloadedBytes: 0, status: 'running' });
    });

    it('reports whether a live recording is running', async () => {
        const { queue, runs } = setup();
        expect(queue.hasLiveJobs()).toBe(false);
        queue.add(URL_A);
        expect(queue.hasLiveJobs()).toBe(false);
        runs[0]?.onInfo(liveInfo);
        expect(queue.hasLiveJobs()).toBe(true);
        runs[0]?.resolve({ status: 'done', filePath: LIVE_FILE });
        await vi.advanceTimersByTimeAsync(0);
        expect(queue.hasLiveJobs()).toBe(false);
    });

    describe('shutdown', () => {
        it('asks live recordings to finish and waits for them, cancelling everything else', async () => {
            const { queue, runs } = setup({ maxConcurrent: 3 });
            queue.add(URL_A);
            queue.add(URL_B);
            runs[0]?.onInfo(liveInfo);
            const shutdown = queue.shutdown();
            await vi.advanceTimersByTimeAsync(0);
            await shutdown;
            expect(runs[0]?.stop).toHaveBeenCalledTimes(1);
            expect(runs[0]?.cancel).not.toHaveBeenCalled();
            expect(runs[1]?.cancel).toHaveBeenCalledTimes(1);
            expect(runs[1]?.stop).not.toHaveBeenCalled();
        });

        it('does not wait forever for a recording that never finishes', async () => {
            const { queue, runs } = setup();
            queue.add(URL_A);
            runs[0]?.onInfo(liveInfo);
            runs[0]?.stop.mockImplementation(() => {
                return undefined;
            });
            let finished = false;
            const shutdown = queue.shutdown(5000).then(() => {
                finished = true;
            });
            await vi.advanceTimersByTimeAsync(4999);
            expect(finished).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            await shutdown;
            expect(finished).toBe(true);
        });

        it('ends a recording that did not finish in time, so nothing keeps running after the app is gone', async () => {
            const { queue, runs } = setup();
            queue.add(URL_A);
            runs[0]?.onInfo(liveInfo);
            runs[0]?.stop.mockImplementation(() => {
                return undefined;
            });
            const shutdown = queue.shutdown(5000);
            await vi.advanceTimersByTimeAsync(4999);
            expect(runs[0]?.cancel).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            await shutdown;
            expect(runs[0]?.stop).toHaveBeenCalledTimes(1);
            expect(runs[0]?.cancel).toHaveBeenCalledTimes(1);
        });

        it('does not end a recording again when it finished in time', async () => {
            const { queue, runs } = setup();
            queue.add(URL_A);
            runs[0]?.onInfo(liveInfo);
            const shutdown = queue.shutdown();
            await vi.advanceTimersByTimeAsync(0);
            await shutdown;
            expect(runs[0]?.stop).toHaveBeenCalledTimes(1);
            expect(runs[0]?.cancel).not.toHaveBeenCalled();
        });

        it('resolves immediately when there are no live recordings and starts nothing new afterwards', async () => {
            const { queue, runs } = setup({ maxConcurrent: 1 });
            queue.add(URL_A);
            queue.add(URL_B);
            await queue.shutdown();
            expect(runs[0]?.cancel).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(0);
            expect(runs).toHaveLength(1);
        });
    });
});

describe('QueueManager with a recording that was ended by killing yt-dlp (Windows)', () => {
    const LIVE_FILE = 'C:\\dl\\Live Show [abc].mp4';
    const liveInfo = { live: true, filePath: LIVE_FILE };

    function startLive(salvage: QueueDependencies['salvageRecording']) {
        const context = setup({}, salvage ? { salvageRecording: salvage } : {});
        context.queue.add(URL_A);
        context.runs[0]?.onInfo(liveInfo);
        return context;
    }

    it('salvages the partial file and completes the job with the saved file', async () => {
        const salvage = vi.fn<(path: string) => Promise<string | null>>().mockResolvedValue(LIVE_FILE);
        const { queue, runs, history, onHistoryChanged } = startLive(salvage);
        runs[0]?.resolve({ status: 'stopped' });
        await flush();
        expect(salvage).toHaveBeenCalledTimes(1);
        expect(salvage).toHaveBeenCalledWith(LIVE_FILE);
        expect(queue.getJob('job-1')).toMatchObject({ status: 'done', percent: 100, filePath: LIVE_FILE, error: null, live: true });
        expect(history).toEqual([
            { id: 'job-1', url: URL_A, title: URL_A, filePath: LIVE_FILE, status: 'done', errorTitle: null, finishedAt: expect.any(Number) }
        ]);
        expect(onHistoryChanged).toHaveBeenCalledTimes(1);
    });

    it('fails with a clear error when the partial file cannot be saved', async () => {
        const { queue, runs, history } = startLive(async () => {
            return null;
        });
        runs[0]?.resolve({ status: 'stopped' });
        await flush();
        const job = queue.getJob('job-1');
        expect(job?.status).toBe('error');
        expect(job?.filePath).toBeNull();
        expect(job?.error).toEqual({
            code: 'UNKNOWN',
            title: 'The recording could not be saved',
            hint: 'The stream was stopped, but the partial file could not be converted. A file ending in .part may still be in the download folder.',
            raw: 'ffmpeg could not copy the partial recording into the final file.'
        });
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({ status: 'error', errorTitle: 'The recording could not be saved' });
    });

    it('fails the same way when salvaging throws', async () => {
        const { queue, runs } = startLive(async () => {
            throw new Error('ffmpeg crashed');
        });
        runs[0]?.resolve({ status: 'stopped' });
        await flush();
        expect(queue.getJob('job-1')?.status).toBe('error');
    });

    it('fails when there is no way to salvage', async () => {
        const { queue, runs } = startLive(undefined);
        runs[0]?.resolve({ status: 'stopped' });
        await flush();
        expect(queue.getJob('job-1')?.status).toBe('error');
    });

    it('fails when yt-dlp never said where the recording was written', async () => {
        const salvage = vi.fn<(path: string) => Promise<string | null>>().mockResolvedValue(LIVE_FILE);
        const { queue, runs } = setup({}, { salvageRecording: salvage });
        queue.add(URL_A);
        runs[0]?.resolve({ status: 'stopped' });
        await flush();
        expect(salvage).not.toHaveBeenCalled();
        expect(queue.getJob('job-1')?.status).toBe('error');
    });

    it('starts the next queued job once the recording has been saved', async () => {
        const { queue, runs } = setup({ maxConcurrent: 1 }, {
            salvageRecording: async () => {
                return LIVE_FILE;
            }
        });
        queue.add(URL_A);
        queue.add(URL_B);
        runs[0]?.onInfo(liveInfo);
        expect(runs).toHaveLength(1);
        runs[0]?.resolve({ status: 'stopped' });
        await flush();
        expect(runs).toHaveLength(2);
        expect(runs[1]?.args.at(-1)).toBe(URL_B);
    });

    it('shutdown waits for the recording to be saved before it resolves', async () => {
        let finishSalvage: (path: string) => void = () => {
            return undefined;
        };
        const { queue, runs } = setup({}, {
            salvageRecording: () => {
                return new Promise<string | null>((resolve) => {
                    finishSalvage = resolve;
                });
            }
        });
        queue.add(URL_A);
        runs[0]?.onInfo(liveInfo);
        runs[0]?.stop.mockImplementation(() => {
            runs[0]?.resolve({ status: 'stopped' });
        });
        let shutdownDone = false;
        const shutdown = queue.shutdown(60000).then(() => {
            shutdownDone = true;
        });
        await flush();
        expect(shutdownDone).toBe(false);
        finishSalvage(LIVE_FILE);
        await shutdown;
        expect(shutdownDone).toBe(true);
    });
});

describe('QueueManager with a folder chosen for one download', () => {
    it('downloads into that folder and keeps it when the job is retried', () => {
        const { queue, runs } = setup();
        queue.add(URL_A, { downloadDir: '/media/special' });
        expect(runs[0]?.args[(runs[0]?.args.indexOf('-P') ?? 0) + 1]).toBe('/media/special');
        runs[0]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
        return flush().then(() => {
            queue.retry('job-1');
            expect(runs).toHaveLength(2);
            expect(runs[1]?.args[(runs[1]?.args.indexOf('-P') ?? 0) + 1]).toBe('/media/special');
        });
    });

    it('uses the settings folder for the other downloads', () => {
        const { queue, runs } = setup({ downloadDir: '/from/settings' });
        queue.add(URL_A, { downloadDir: '/media/special' });
        queue.add(URL_B);
        expect(runs[1]?.args[(runs[1]?.args.indexOf('-P') ?? 0) + 1]).toBe('/from/settings');
    });
});


describe('QueueManager end of live check', () => {
    const LIVE_FILE = '/dl/Live Show [abc].mp4';
    const NEXT_FILE = '/dl/Live Show [abc] (part 2).mp4';
    const liveInfo = { live: true, filePath: LIVE_FILE };
    const ENDED: RunResult = { status: 'done', filePath: LIVE_FILE };

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function settle(): Promise<void> {
        await vi.advanceTimersByTimeAsync(0);
    }

    async function recordLive(settings: Partial<Settings> = {}) {
        const context = setup({ verifyLiveEnd: true, verifyLiveEndSeconds: 10, ...settings });
        context.queue.add(URL_A);
        context.runs[0]?.onInfo(liveInfo);
        return context;
    }

    async function endRecording(context: Awaited<ReturnType<typeof recordLive>>, result: RunResult = ENDED): Promise<void> {
        context.runs[0]?.resolve(result);
        await settle();
    }

    describe('opening the check', () => {
        it('opens the check instead of finishing when a live recording ends normally', async () => {
            const context = await recordLive();
            await endRecording(context);
            expect(context.queue.getJob('job-1')).toMatchObject({
                status: 'running',
                live: true,
                speed: '',
                eta: '',
                endCheck: { secondsLeft: 10, totalSeconds: 10 }
            });
            expect(context.history).toEqual([]);
            expect(context.onHistoryChanged).not.toHaveBeenCalled();
        });

        it('opens the check when a live recording fails, for instance when the connection drops', async () => {
            const context = await recordLive();
            await endRecording(context, { status: 'error', error: DOWNLOAD_ERROR });
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'running', error: null, endCheck: { secondsLeft: 10, totalSeconds: 10 } });
            expect(context.history).toEqual([]);
        });

        it('uses the number of seconds from the settings', async () => {
            const context = await recordLive({ verifyLiveEndSeconds: 45 });
            await endRecording(context);
            expect(context.queue.getJob('job-1')?.endCheck).toEqual({ secondsLeft: 45, totalSeconds: 45 });
        });

        it('keeps the concurrency slot while it checks', async () => {
            const context = await recordLive({ maxConcurrent: 1 });
            context.queue.add(URL_B);
            await endRecording(context);
            expect(context.queue.getJob('job-2')?.status).toBe('queued');
            expect(context.runs).toHaveLength(2);
        });

        it('stops counting the recording time while it checks', async () => {
            const context = await recordLive();
            context.advanceClock(4000);
            vi.advanceTimersByTime(LIVE_TICK_MS);
            const before = context.queue.getJob('job-1')?.elapsedSeconds;
            await endRecording(context);
            context.advanceClock(5000);
            vi.advanceTimersByTime(LIVE_TICK_MS);
            expect(context.queue.getJob('job-1')?.elapsedSeconds).toBe(before);
        });

        it('emits the card when the check opens', async () => {
            const context = await recordLive();
            const before = context.updates.length;
            await endRecording(context);
            expect(context.updates.slice(before).at(0)).toMatchObject({ id: 'job-1', status: 'running', endCheck: { secondsLeft: 10, totalSeconds: 10 } });
        });

        it.each([
            ['the setting is off', { verifyLiveEnd: false }],
            ['the job is not a live stream', {}]
        ])('finishes right away when %s', async (_name, settings) => {
            const context = setup({ verifyLiveEnd: true, ...settings });
            context.queue.add(URL_A);
            if (_name === 'the setting is off') {
                context.runs[0]?.onInfo(liveInfo);
            }
            context.runs[0]?.resolve(ENDED);
            await settle();
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'done', endCheck: null });
            expect(context.runs).toHaveLength(1);
        });

        it('does not check when the user stopped the recording on purpose with STOP & SAVE', async () => {
            const context = await recordLive();
            context.queue.stop('job-1');
            await settle();
            expect(context.runs[0]?.stop).toHaveBeenCalledTimes(1);
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'done', filePath: '/dl/recorded.mp4', endCheck: null });
            expect(context.runs).toHaveLength(1);
            expect(context.history).toHaveLength(1);
        });

        it('forgets the stop request when the job is retried, so the next recording is checked again', async () => {
            const context = await recordLive();
            context.runs[0]?.stop.mockImplementation(() => {
                context.runs[0]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
            });
            context.queue.stop('job-1');
            await settle();
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'error', endCheck: null });
            context.queue.retry('job-1');
            context.runs[1]?.onInfo(liveInfo);
            context.runs[1]?.resolve(ENDED);
            await settle();
            expect(context.queue.getJob('job-1')?.endCheck).toEqual({ secondsLeft: 10, totalSeconds: 10 });
        });

        it('does not check when a live recording is cancelled', async () => {
            const context = await recordLive();
            context.queue.cancel('job-1');
            await settle();
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'cancelled', endCheck: null });
            expect(context.runs).toHaveLength(1);
        });

        it('does not check when the recording was ended on purpose by killing the process', async () => {
            const context = await recordLive();
            await endRecording(context, { status: 'stopped' });
            expect(context.queue.getJob('job-1')?.endCheck).toBeNull();
            expect(context.runs).toHaveLength(1);
        });
    });

    describe('looking for the stream again', () => {
        it('starts an attempt right away that only records when the stream is live, in a new file, and does not start over', async () => {
            const context = await recordLive({ liveFromStart: true, waitForLive: true });
            await endRecording(context);
            expect(context.runs).toHaveLength(2);
            expect(context.runs[1]?.args).toEqual(
                buildYtdlpArgs(URL_A, { ...DEFAULT_SETTINGS, maxConcurrent: 2, verifyLiveEnd: true, verifyLiveEndSeconds: 10, liveFromStart: true, waitForLive: true }, '/dl', '/bundled/bin', { resumedPart: 2 })
            );
            expect(context.runs[1]?.args).toEqual(expect.arrayContaining(['--match-filter', 'is_live']));
            expect(context.runs[1]?.args).not.toContain('--live-from-start');
            expect(context.runs[1]?.args).not.toContain('--wait-for-video');
            expect(context.runs[1]?.args).toContain('%(title).80s [%(id)s] (part 2).%(ext)s');
        });

        it('keeps the extras of the request in the attempts', async () => {
            const context = setup({ verifyLiveEnd: true });
            context.queue.add(URL_A, { referer: 'https://page.test/', title: 'Show' });
            context.runs[0]?.onInfo(liveInfo);
            context.runs[0]?.resolve(ENDED);
            await settle();
            expect(context.runs[1]?.args).toEqual(expect.arrayContaining(['--referer', 'https://page.test/']));
            expect(context.runs[1]?.args).toContain('Show [%(id)s] (part 2).%(ext)s');
        });

        it('tries again shortly after an attempt that found nothing, as long as there is time', async () => {
            const context = await recordLive();
            await endRecording(context);
            context.runs[1]?.resolve({ status: 'done', filePath: null });
            await settle();
            expect(context.runs).toHaveLength(2);
            await vi.advanceTimersByTimeAsync(LIVE_END_RETRY_MS);
            expect(context.runs).toHaveLength(3);
            context.runs[2]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
            await settle();
            await vi.advanceTimersByTimeAsync(LIVE_END_RETRY_MS);
            expect(context.runs).toHaveLength(4);
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'running', error: null });
        });

        it('counts down every second', async () => {
            const context = await recordLive();
            await endRecording(context);
            await vi.advanceTimersByTimeAsync(LIVE_TICK_MS);
            expect(context.queue.getJob('job-1')?.endCheck).toEqual({ secondsLeft: 9, totalSeconds: 10 });
            await vi.advanceTimersByTimeAsync(LIVE_TICK_MS * 3);
            expect(context.queue.getJob('job-1')?.endCheck).toEqual({ secondsLeft: 6, totalSeconds: 10 });
            expect(context.updates.at(-1)).toMatchObject({ id: 'job-1', endCheck: { secondsLeft: 6, totalSeconds: 10 } });
        });
    });

    describe('when the stream comes back', () => {
        it('goes on recording in the same card and closes the check', async () => {
            const context = await recordLive();
            context.advanceClock(7000);
            vi.advanceTimersByTime(LIVE_TICK_MS);
            await endRecording(context);
            await vi.advanceTimersByTimeAsync(LIVE_TICK_MS * 2);
            context.runs[1]?.onInfo({ live: true, filePath: NEXT_FILE });
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'running', live: true, endCheck: null, elapsedSeconds: 7 });
            await vi.advanceTimersByTimeAsync(LIVE_TICK_MS * 20);
            expect(context.runs).toHaveLength(2);
            expect(context.queue.getJob('job-1')?.status).toBe('running');
        });

        it('keeps counting the recording time from where the previous part stopped and reads the new file', async () => {
            const context = await recordLive();
            context.advanceClock(7000);
            vi.advanceTimersByTime(LIVE_TICK_MS);
            await endRecording(context);
            context.runs[1]?.onInfo({ live: true, filePath: NEXT_FILE });
            context.fileSizes.set(`${NEXT_FILE}.part`, 4096);
            context.advanceClock(3000);
            vi.advanceTimersByTime(LIVE_TICK_MS);
            expect(context.queue.getJob('job-1')).toMatchObject({ elapsedSeconds: 10, downloadedBytes: 4096 });
        });

        it('finishes with the file of the last part when the new recording ends and the check runs out', async () => {
            const context = await recordLive();
            await endRecording(context);
            context.runs[1]?.onInfo({ live: true, filePath: NEXT_FILE });
            context.runs[1]?.resolve({ status: 'done', filePath: NEXT_FILE });
            await settle();
            expect(context.queue.getJob('job-1')?.endCheck).toEqual({ secondsLeft: 10, totalSeconds: 10 });
            expect(context.runs[2]?.args).toContain('%(title).80s [%(id)s] (part 3).%(ext)s');
            await vi.advanceTimersByTimeAsync(LIVE_TICK_MS * 10);
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'done', filePath: NEXT_FILE, endCheck: null });
            expect(context.history).toEqual([
                { id: 'job-1', url: URL_A, title: URL_A, filePath: NEXT_FILE, status: 'done', errorTitle: null, finishedAt: expect.any(Number) }
            ]);
        });

        it('can be stopped while it records again, as any live recording', async () => {
            const context = await recordLive();
            await endRecording(context);
            context.runs[1]?.onInfo({ live: true, filePath: NEXT_FILE });
            context.queue.stop('job-1');
            await settle();
            expect(context.runs[1]?.stop).toHaveBeenCalledTimes(1);
        });
    });

    describe('merging the parts when the stream came back', () => {
        async function recordTwoParts(mergeParts: QueueDependencies['mergeParts'], extraDeps: Partial<QueueDependencies> = {}) {
            const context = setup({ verifyLiveEnd: true, verifyLiveEndSeconds: 10 }, { mergeParts, ...extraDeps });
            context.queue.add(URL_A);
            context.runs[0]?.onInfo(liveInfo);
            await endRecording(context);
            context.runs[1]?.onInfo({ live: true, filePath: NEXT_FILE });
            return context;
        }

        async function endSecondPart(context: Awaited<ReturnType<typeof recordTwoParts>>): Promise<void> {
            context.runs[1]?.resolve({ status: 'done', filePath: NEXT_FILE });
            await settle();
            await vi.advanceTimersByTimeAsync(LIVE_TICK_MS * 10);
        }

        it('joins the parts in order into the first file when the time runs out', async () => {
            const mergeParts = vi.fn().mockResolvedValue(LIVE_FILE);
            const context = await recordTwoParts(mergeParts);
            await endSecondPart(context);
            expect(mergeParts).toHaveBeenCalledTimes(1);
            expect(mergeParts).toHaveBeenCalledWith([LIVE_FILE, NEXT_FILE]);
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'done', percent: 100, filePath: LIVE_FILE, endCheck: null });
            expect(context.history).toEqual([
                { id: 'job-1', url: URL_A, title: URL_A, filePath: LIVE_FILE, status: 'done', errorTitle: null, finishedAt: expect.any(Number) }
            ]);
        });

        it('keeps the card running until the merge ends', async () => {
            let finishMerge: (path: string | null) => void = () => {
                return undefined;
            };
            const mergeParts = vi.fn().mockImplementation(() => {
                return new Promise<string | null>((resolve) => {
                    finishMerge = resolve;
                });
            });
            const context = await recordTwoParts(mergeParts);
            await endSecondPart(context);
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'running', filePath: null, merging: true });
            expect(context.updates.at(-1)).toMatchObject({ id: 'job-1', status: 'running', merging: true });
            expect(context.history).toEqual([]);
            finishMerge(LIVE_FILE);
            await settle();
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'done', filePath: LIVE_FILE, merging: false });
            expect(context.history).toHaveLength(1);
        });

        it('joins the parts when the user ends the check by hand', async () => {
            const mergeParts = vi.fn().mockResolvedValue(LIVE_FILE);
            const context = await recordTwoParts(mergeParts);
            context.runs[1]?.resolve({ status: 'done', filePath: NEXT_FILE });
            await settle();
            context.queue.stop('job-1');
            await settle();
            expect(mergeParts).toHaveBeenCalledWith([LIVE_FILE, NEXT_FILE]);
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'done', filePath: LIVE_FILE });
        });

        it('joins the parts after STOP & SAVE of the resumed recording', async () => {
            const mergeParts = vi.fn().mockResolvedValue(LIVE_FILE);
            const salvageRecording = vi.fn().mockResolvedValue(NEXT_FILE);
            const context = await recordTwoParts(mergeParts, { salvageRecording });
            context.runs[1]?.resolve({ status: 'stopped' });
            await settle();
            expect(salvageRecording).toHaveBeenCalledWith(NEXT_FILE);
            expect(mergeParts).toHaveBeenCalledTimes(1);
            expect(mergeParts).toHaveBeenCalledWith([LIVE_FILE, NEXT_FILE]);
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'done', filePath: LIVE_FILE });
        });

        it('finishes with the last part and keeps every file when the merge fails', async () => {
            const mergeParts = vi.fn().mockResolvedValue(null);
            const context = await recordTwoParts(mergeParts);
            await endSecondPart(context);
            expect(mergeParts).toHaveBeenCalledTimes(1);
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'done', filePath: NEXT_FILE, merging: false });
        });

        it('finishes with the last part when the merge throws', async () => {
            const mergeParts = vi.fn().mockRejectedValue(new Error('ffmpeg crashed'));
            const context = await recordTwoParts(mergeParts);
            await endSecondPart(context);
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'done', filePath: NEXT_FILE, merging: false });
        });

        it('does not merge when the last part ended with an error', async () => {
            const mergeParts = vi.fn().mockResolvedValue(LIVE_FILE);
            const context = await recordTwoParts(mergeParts);
            context.runs[1]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
            await settle();
            await vi.advanceTimersByTimeAsync(LIVE_TICK_MS * 10);
            expect(mergeParts).not.toHaveBeenCalled();
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'error', error: DOWNLOAD_ERROR });
        });

        it('does not merge when the stream never came back', async () => {
            const mergeParts = vi.fn().mockResolvedValue(LIVE_FILE);
            const context = setup({ verifyLiveEnd: true, verifyLiveEndSeconds: 10 }, { mergeParts });
            context.queue.add(URL_A);
            context.runs[0]?.onInfo(liveInfo);
            await endRecording(context);
            await vi.advanceTimersByTimeAsync(LIVE_TICK_MS * 10);
            expect(mergeParts).not.toHaveBeenCalled();
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'done', filePath: LIVE_FILE, merging: false });
            expect(context.updates.some((job) => {
                return job.merging;
            })).toBe(false);
        });

        it('does not merge the files of a download that is not a resumed live recording', async () => {
            const mergeParts = vi.fn().mockResolvedValue(LIVE_FILE);
            const context = setup({}, { mergeParts });
            context.queue.add(URL_A);
            context.runs[0]?.onInfo({ live: false, filePath: LIVE_FILE });
            context.runs[0]?.onInfo({ live: false, filePath: NEXT_FILE });
            context.runs[0]?.resolve({ status: 'done', filePath: NEXT_FILE });
            await settle();
            expect(mergeParts).not.toHaveBeenCalled();
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'done', filePath: NEXT_FILE });
        });

        it('waits for the merge to end when the app is closed', async () => {
            let finishMerge: (path: string | null) => void = () => {
                return undefined;
            };
            const mergeParts = vi.fn().mockImplementation(() => {
                return new Promise<string | null>((resolve) => {
                    finishMerge = resolve;
                });
            });
            const context = await recordTwoParts(mergeParts);
            context.runs[1]?.resolve({ status: 'done', filePath: NEXT_FILE });
            await settle();
            let closed = false;
            const shutdown = context.queue.shutdown(60000).then(() => {
                closed = true;
            });
            await settle();
            expect(closed).toBe(false);
            finishMerge(LIVE_FILE);
            await shutdown;
            expect(closed).toBe(true);
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'done', filePath: LIVE_FILE });
        });
    });

    describe('when the time runs out', () => {
        it('finishes the card as the recording ended: complete', async () => {
            const context = await recordLive();
            await endRecording(context);
            await vi.advanceTimersByTimeAsync(LIVE_TICK_MS * 10);
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'done', percent: 100, filePath: LIVE_FILE, endCheck: null });
            expect(context.history).toEqual([
                { id: 'job-1', url: URL_A, title: URL_A, filePath: LIVE_FILE, status: 'done', errorTitle: null, finishedAt: expect.any(Number) }
            ]);
            expect(context.onHistoryChanged).toHaveBeenCalledTimes(1);
        });

        it('finishes the card as the recording ended: failed, keeping the recording', async () => {
            const context = await recordLive();
            await endRecording(context, { status: 'error', error: DOWNLOAD_ERROR });
            await vi.advanceTimersByTimeAsync(LIVE_TICK_MS * 10);
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'error', error: DOWNLOAD_ERROR, endCheck: null });
            expect(context.history).toEqual([
                { id: 'job-1', url: URL_A, title: URL_A, filePath: null, status: 'error', errorTitle: 'Network failure', finishedAt: expect.any(Number) }
            ]);
        });

        it('stops the attempt that is still running and the retry timer', async () => {
            const context = await recordLive();
            await endRecording(context);
            await vi.advanceTimersByTimeAsync(LIVE_TICK_MS * 10);
            expect(context.runs[1]?.cancel).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(LIVE_TICK_MS * 30);
            expect(context.runs).toHaveLength(2);
        });

        it('does not try again once it ended, even if an attempt ends later', async () => {
            const context = await recordLive();
            await endRecording(context);
            context.runs[1]?.resolve({ status: 'done', filePath: null });
            await settle();
            await vi.advanceTimersByTimeAsync(LIVE_TICK_MS * 10);
            const attempts = context.runs.length;
            expect(attempts).toBe(3);
            context.runs[2]?.resolve({ status: 'done', filePath: null });
            await vi.advanceTimersByTimeAsync(LIVE_END_RETRY_MS * 5);
            expect(context.runs).toHaveLength(attempts);
            expect(context.queue.getJob('job-1')?.status).toBe('done');
        });

        it('starts the next download of the queue', async () => {
            const context = await recordLive({ maxConcurrent: 1 });
            context.queue.add(URL_B);
            await endRecording(context);
            await vi.advanceTimersByTimeAsync(LIVE_TICK_MS * 10);
            expect(context.queue.getJob('job-2')?.status).toBe('running');
        });
    });

    describe('ending the check by hand', () => {
        it('stop finishes the card at once as the recording ended', async () => {
            const context = await recordLive();
            await endRecording(context);
            context.queue.stop('job-1');
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'done', filePath: LIVE_FILE, endCheck: null });
            expect(context.runs[1]?.cancel).toHaveBeenCalledTimes(1);
            expect(context.runs[1]?.stop).not.toHaveBeenCalled();
            expect(context.history).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(LIVE_TICK_MS * 30);
            expect(context.runs).toHaveLength(2);
        });

        it('cancel does the same', async () => {
            const context = await recordLive();
            await endRecording(context, { status: 'error', error: DOWNLOAD_ERROR });
            context.queue.cancel('job-1');
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'error', endCheck: null });
            expect(context.runs[1]?.cancel).toHaveBeenCalledTimes(1);
        });

        it('stop works between two attempts, when none is running', async () => {
            const context = await recordLive();
            await endRecording(context);
            context.runs[1]?.resolve({ status: 'done', filePath: null });
            await settle();
            context.queue.stop('job-1');
            expect(context.queue.getJob('job-1')?.status).toBe('done');
            await vi.advanceTimersByTimeAsync(LIVE_END_RETRY_MS * 5);
            expect(context.runs).toHaveLength(2);
        });

        it('removing the card drops the check, stops the attempt and keeps the recording files', async () => {
            const deleteFiles = vi.fn();
            const context = setup({ verifyLiveEnd: true, verifyLiveEndSeconds: 10 }, { deleteFiles, findPartialFiles: () => {
                return [`${LIVE_FILE}.part`];
            } });
            context.queue.add(URL_A);
            context.runs[0]?.onInfo(liveInfo);
            await endRecording(context);
            context.queue.remove('job-1');
            expect(context.removed).toEqual(['job-1']);
            expect(context.queue.list()).toEqual([]);
            expect(context.runs[1]?.cancel).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(LIVE_TICK_MS * 30);
            expect(context.runs).toHaveLength(2);
            expect(context.history).toEqual([]);
            expect(deleteFiles).not.toHaveBeenCalled();
        });

        it('quitting the app finishes the card instead of waiting for the check', async () => {
            const context = await recordLive();
            await endRecording(context);
            await context.queue.shutdown(50);
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'done', endCheck: null });
            expect(context.runs[1]?.cancel).toHaveBeenCalledTimes(1);
            expect(context.history).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(LIVE_TICK_MS * 30);
            expect(context.runs).toHaveLength(2);
        });

        it('does not open a check once the app is closing', async () => {
            const context = await recordLive();
            const closing = context.queue.shutdown(50);
            context.runs[0]?.resolve(ENDED);
            await vi.advanceTimersByTimeAsync(100);
            await closing;
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'done', endCheck: null });
            expect(context.runs).toHaveLength(1);
        });
    });

    describe('retry', () => {
        it('starts over without a check or a part number', async () => {
            const context = await recordLive();
            await endRecording(context);
            context.runs[1]?.onInfo({ live: true, filePath: NEXT_FILE });
            context.queue.cancel('job-1');
            context.runs[1]?.resolve({ status: 'cancelled' });
            await settle();
            expect(context.queue.getJob('job-1')?.status).toBe('cancelled');
            context.queue.retry('job-1');
            expect(context.queue.getJob('job-1')).toMatchObject({ status: 'running', live: false, endCheck: null, waitingForLive: false });
            expect(context.runs[2]?.args).not.toContain('--match-filter');
            context.runs[2]?.onInfo(liveInfo);
            context.runs[2]?.resolve(ENDED);
            await settle();
            expect(context.runs[3]?.args).toContain('%(title).80s [%(id)s] (part 2).%(ext)s');
        });
    });
});

describe('QueueManager post-processing of the downloaded file', () => {
    const FILE = '/dl/Video [abc].mp3';
    const started = (processor: string): PostProcessEvent => {
        return { status: 'started', processor };
    };

    function downloadFinished() {
        const context = setup();
        context.queue.add(URL_A);
        context.runs[0]?.onProgress(progress({ percent: 100, speed: '6.61MiB/s', eta: '00:01', title: 'Video' }));
        return context;
    }

    it('starts without a post-processor', () => {
        const { queue } = setup();
        queue.add(URL_A);
        expect(queue.getJob('job-1')?.postProcess).toBeNull();
    });

    it('marks the card as processing, with the step name, and drops the speed and eta that no longer apply', () => {
        const { queue, runs, updates } = downloadFinished();
        expect(queue.getJob('job-1')).toMatchObject({ postProcess: null, speed: '6.61MiB/s', eta: '00:01' });
        runs[0]?.onPostProcess?.(started('ExtractAudio'));
        expect(queue.getJob('job-1')).toMatchObject({ status: 'running', postProcess: 'ExtractAudio', percent: 100, speed: '', eta: '' });
        expect(updates.at(-1)).toMatchObject({ id: 'job-1', postProcess: 'ExtractAudio', speed: '', eta: '' });
    });

    it('moves from one step to the next', () => {
        const { queue, runs } = downloadFinished();
        runs[0]?.onPostProcess?.(started('Merger'));
        runs[0]?.onPostProcess?.({ status: 'finished', processor: 'Merger' });
        expect(queue.getJob('job-1')?.postProcess).toBe('Merger');
        runs[0]?.onPostProcess?.(started('Metadata'));
        expect(queue.getJob('job-1')?.postProcess).toBe('Metadata');
    });

    it('ignores the end of a step, which is followed by another start or by the end of the run', () => {
        const { queue, runs, updates } = downloadFinished();
        const before = updates.length;
        runs[0]?.onPostProcess?.({ status: 'finished', processor: 'ExtractAudio' });
        expect(queue.getJob('job-1')?.postProcess).toBeNull();
        expect(updates).toHaveLength(before);
    });

    it('stops showing the step when a new download stream reports progress (the next item of a playlist)', () => {
        const { queue, runs } = downloadFinished();
        runs[0]?.onPostProcess?.(started('ExtractAudio'));
        runs[0]?.onProgress(progress({ percent: 3, speed: '1MiB/s', eta: '00:09', title: 'Next' }));
        expect(queue.getJob('job-1')).toMatchObject({ postProcess: null, percent: 3, speed: '1MiB/s' });
    });

    it('clears the step when the download completes', async () => {
        const { queue, runs, history } = downloadFinished();
        runs[0]?.onPostProcess?.(started('MoveFiles'));
        runs[0]?.resolve({ status: 'done', filePath: FILE });
        await flush();
        expect(queue.getJob('job-1')).toMatchObject({ status: 'done', percent: 100, filePath: FILE, postProcess: null });
        expect(history).toEqual([{ id: 'job-1', url: URL_A, title: 'Video', filePath: FILE, status: 'done', errorTitle: null, finishedAt: expect.any(Number) }]);
    });

    it('clears the step when the download fails', async () => {
        const { queue, runs } = downloadFinished();
        runs[0]?.onPostProcess?.(started('ExtractAudio'));
        runs[0]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
        await flush();
        expect(queue.getJob('job-1')).toMatchObject({ status: 'error', error: DOWNLOAD_ERROR, postProcess: null });
    });

    it('clears the step when the download is cancelled', async () => {
        const { queue, runs } = downloadFinished();
        runs[0]?.onPostProcess?.(started('Merger'));
        queue.cancel('job-1');
        await flush();
        expect(queue.getJob('job-1')).toMatchObject({ status: 'cancelled', postProcess: null });
    });

    it('does not keep the step after a failed download is retried', async () => {
        const { queue, runs } = downloadFinished();
        runs[0]?.onPostProcess?.(started('ExtractAudio'));
        runs[0]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
        await flush();
        queue.retry('job-1');
        expect(queue.getJob('job-1')).toMatchObject({ status: 'running', postProcess: null });
    });

    it('does not mark a card as processing after it was removed', async () => {
        const { queue, runs, updates } = downloadFinished();
        queue.remove('job-1');
        const before = updates.length;
        runs[0]?.onPostProcess?.(started('ExtractAudio'));
        expect(queue.getJob('job-1')).toBeUndefined();
        expect(updates).toHaveLength(before);
    });

    it('does not show the step while the end of a live recording is checked', async () => {
        vi.useFakeTimers();
        try {
            const { queue, runs } = setup({ verifyLiveEnd: true, verifyLiveEndSeconds: 10 });
            queue.add(URL_A);
            runs[0]?.onInfo({ live: true, filePath: '/dl/Live [abc].mp4' });
            runs[0]?.onPostProcess?.(started('MoveFiles'));
            expect(queue.getJob('job-1')?.postProcess).toBe('MoveFiles');
            runs[0]?.resolve({ status: 'done', filePath: '/dl/Live [abc].mp4' });
            await vi.advanceTimersByTimeAsync(0);
            expect(queue.getJob('job-1')).toMatchObject({ status: 'running', postProcess: null, endCheck: { secondsLeft: 10, totalSeconds: 10 } });
        } finally {
            vi.useRealTimers();
        }
    });

    it('only touches the card of the run that reported the step', () => {
        const { queue, runs } = setup();
        queue.add(URL_A);
        queue.add(URL_B);
        runs[1]?.onPostProcess?.(started('Merger'));
        expect(queue.getJob('job-1')?.postProcess).toBeNull();
        expect(queue.getJob('job-2')?.postProcess).toBe('Merger');
    });
});

describe('QueueManager waiting for a scheduled live stream', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('starts without waiting', () => {
        const { queue } = setup({ waitForLive: true });
        queue.add(URL_A);
        expect(queue.getJob('job-1')?.waitingForLive).toBe(false);
    });

    it('marks the job as waiting when yt-dlp says so and emits it once', () => {
        const { queue, runs, updates } = setup({ waitForLive: true });
        queue.add(URL_A);
        const before = updates.length;
        runs[0]?.onWaiting?.();
        runs[0]?.onWaiting?.();
        expect(queue.getJob('job-1')).toMatchObject({ status: 'running', waitingForLive: true, live: false });
        expect(updates.slice(before)).toHaveLength(1);
        expect(updates.at(-1)).toMatchObject({ id: 'job-1', waitingForLive: true });
    });

    it('stops waiting when the live stream starts being recorded', () => {
        const { queue, runs } = setup({ waitForLive: true });
        queue.add(URL_A);
        runs[0]?.onWaiting?.();
        runs[0]?.onInfo({ live: true, filePath: '/dl/Live [abc].mp4' });
        expect(queue.getJob('job-1')).toMatchObject({ waitingForLive: false, live: true });
    });

    it('stops waiting when progress arrives', () => {
        const { queue, runs } = setup({ waitForLive: true });
        queue.add(URL_A);
        runs[0]?.onWaiting?.();
        runs[0]?.onProgress(progress({ percent: 3 }));
        expect(queue.getJob('job-1')).toMatchObject({ waitingForLive: false, percent: 3 });
    });

    it('ignores a wait message once the stream is live', () => {
        const { queue, runs, updates } = setup({ waitForLive: true });
        queue.add(URL_A);
        runs[0]?.onInfo({ live: true, filePath: '/dl/Live [abc].mp4' });
        const before = updates.length;
        runs[0]?.onWaiting?.();
        expect(queue.getJob('job-1')?.waitingForLive).toBe(false);
        expect(updates).toHaveLength(before);
    });

    it('stops waiting when the download ends or is cancelled', async () => {
        const { queue, runs } = setup({ waitForLive: true });
        queue.add(URL_A);
        runs[0]?.onWaiting?.();
        queue.cancel('job-1');
        await vi.advanceTimersByTimeAsync(0);
        expect(queue.getJob('job-1')).toMatchObject({ status: 'cancelled', waitingForLive: false });
    });

    it('stops waiting when the job is retried', async () => {
        const { queue, runs } = setup({ waitForLive: true });
        queue.add(URL_A);
        runs[0]?.onWaiting?.();
        runs[0]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
        await vi.advanceTimersByTimeAsync(0);
        queue.retry('job-1');
        expect(queue.getJob('job-1')?.waitingForLive).toBe(false);
    });
});

describe('QueueManager download options', () => {
    const LIVE_FILE = '/dl/Live Show [abc].mp4';
    const liveInfo = { live: true, filePath: LIVE_FILE };

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const effective = (overrides: Partial<Settings>): Settings => {
        return { ...DEFAULT_SETTINGS, maxConcurrent: 2, verifyLiveEnd: false, ...overrides };
    };

    it('marks the job as customized only when it has options', () => {
        const { queue } = setup();
        expect(queue.add(URL_A).job?.customized).toBe(false);
        expect(queue.add(URL_B, { options: {} }).job?.customized).toBe(false);
        expect(queue.add(URL_C, { options: { maxResolution: '720' } }).job?.customized).toBe(true);
        expect(queue.getJob('job-3')?.customized).toBe(true);
    });

    it('builds the arguments with the options replacing the settings', () => {
        const { queue, runs } = setup({ maxResolution: 'best', videoContainer: 'mp4', audioOnly: false, audioFormat: 'mp3' });
        queue.add(URL_A, { options: { maxResolution: '720', videoContainer: 'mkv', audioOnly: true, audioFormat: 'opus' } });
        expect(runs[0]?.args).toEqual(
            buildYtdlpArgs(URL_A, effective({ maxResolution: '720', videoContainer: 'mkv', audioOnly: true, audioFormat: 'opus' }), '/dl', '/bundled/bin', {})
        );
        expect(runs[0]?.args).toEqual(expect.arrayContaining(['-x', '--audio-format', 'opus']));
        expect(runs[0]?.args).not.toContain('--merge-output-format');
    });

    it('does not change the arguments of the other downloads', () => {
        const { queue, runs } = setup();
        queue.add(URL_A, { options: { maxResolution: '480' } });
        queue.add(URL_B);
        expect(runs[0]?.args).toEqual(buildYtdlpArgs(URL_A, effective({ maxResolution: '480' }), '/dl', '/bundled/bin', {}));
        expect(runs[1]?.args).toEqual(buildYtdlpArgs(URL_B, effective({}), '/dl', '/bundled/bin', {}));
    });

    it('keeps following the settings for what the options do not choose, even when they change before it starts', async () => {
        const { queue, runs, currentSettings } = setup({ maxConcurrent: 1 });
        queue.add(URL_A);
        queue.add(URL_B, { options: { maxResolution: '720' } });
        currentSettings.videoContainer = 'webm';
        currentSettings.maxResolution = '1080';
        runs[0]?.resolve({ status: 'done', filePath: '/dl/a.mp4' });
        await vi.advanceTimersByTimeAsync(0);
        expect(runs[1]?.args).toEqual(
            buildYtdlpArgs(URL_B, { ...currentSettings, maxResolution: '720', videoContainer: 'webm' }, '/dl', '/bundled/bin', {})
        );
    });

    it('applies the live options of the download', () => {
        const { queue, runs } = setup({ liveFromStart: false, waitForLive: false });
        queue.add(URL_A, { options: { liveFromStart: true, waitForLive: true } });
        expect(runs[0]?.args).toEqual(expect.arrayContaining(['--live-from-start', '--wait-for-video', '30', '--no-quiet']));
        queue.add(URL_B);
        expect(runs[1]?.args).not.toContain('--live-from-start');
        expect(runs[1]?.args).not.toContain('--wait-for-video');
    });

    it('turns the end check on for one download when it is off in the settings', async () => {
        const { queue, runs } = setup({ verifyLiveEnd: false });
        queue.add(URL_A, { options: { verifyLiveEnd: true, verifyLiveEndSeconds: 25 } });
        runs[0]?.onInfo(liveInfo);
        runs[0]?.resolve({ status: 'done', filePath: LIVE_FILE });
        await vi.advanceTimersByTimeAsync(0);
        expect(queue.getJob('job-1')?.endCheck).toEqual({ secondsLeft: 25, totalSeconds: 25 });
        expect(runs).toHaveLength(2);
    });

    it('turns the end check off for one download when it is on in the settings', async () => {
        const { queue, runs } = setup({ verifyLiveEnd: true, verifyLiveEndSeconds: 10 });
        queue.add(URL_A, { options: { verifyLiveEnd: false } });
        queue.add(URL_B);
        runs[0]?.onInfo(liveInfo);
        runs[1]?.onInfo(liveInfo);
        runs[0]?.resolve({ status: 'done', filePath: LIVE_FILE });
        runs[1]?.resolve({ status: 'done', filePath: LIVE_FILE });
        await vi.advanceTimersByTimeAsync(0);
        expect(queue.getJob('job-1')).toMatchObject({ status: 'done', endCheck: null });
        expect(queue.getJob('job-2')).toMatchObject({ status: 'running', endCheck: { secondsLeft: 10, totalSeconds: 10 } });
    });

    it('uses the seconds of the options for the check while the setting keeps another value', async () => {
        const { queue, runs } = setup({ verifyLiveEnd: true, verifyLiveEndSeconds: 10 });
        queue.add(URL_A, { options: { verifyLiveEndSeconds: 3 } });
        runs[0]?.onInfo(liveInfo);
        runs[0]?.resolve({ status: 'done', filePath: LIVE_FILE });
        await vi.advanceTimersByTimeAsync(0);
        expect(queue.getJob('job-1')?.endCheck).toEqual({ secondsLeft: 3, totalSeconds: 3 });
        await vi.advanceTimersByTimeAsync(3000);
        expect(queue.getJob('job-1')?.status).toBe('done');
    });

    it('keeps the options in the attempts that look for the stream again, without waiting or starting over', async () => {
        const { queue, runs } = setup({ verifyLiveEnd: false });
        queue.add(URL_A, { options: { verifyLiveEnd: true, waitForLive: true, liveFromStart: true, maxResolution: '720' } });
        runs[0]?.onInfo(liveInfo);
        runs[0]?.resolve({ status: 'done', filePath: LIVE_FILE });
        await vi.advanceTimersByTimeAsync(0);
        expect(runs[1]?.args).toEqual(
            buildYtdlpArgs(URL_A, effective({ verifyLiveEnd: true, waitForLive: true, liveFromStart: true, maxResolution: '720' }), '/dl', '/bundled/bin', { resumedPart: 2 })
        );
        expect(runs[1]?.args).not.toContain('--live-from-start');
    });

    it('keeps the options when the download is retried', async () => {
        const { queue, runs } = setup();
        queue.add(URL_A, { options: { maxResolution: '720', audioOnly: true } });
        runs[0]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
        await vi.advanceTimersByTimeAsync(0);
        queue.retry('job-1');
        expect(queue.getJob('job-1')?.customized).toBe(true);
        expect(runs[1]?.args).toEqual(runs[0]?.args);
    });

    it('keeps the folder and the options together', () => {
        const { queue, runs } = setup();
        queue.add(URL_A, { downloadDir: '/media/videos', options: { maxResolution: '1080' } });
        expect(runs[0]?.args).toEqual(buildYtdlpArgs(URL_A, effective({ maxResolution: '1080' }), '/dl', '/bundled/bin', { downloadDir: '/media/videos' }));
    });
});

describe('QueueManager pause and resume', () => {
    const FILE = '/dl/Video A [abc].mp4';
    const PARTIALS = [`${FILE}.part`, '/dl/Video A [abc].f137.mp4.part', `${FILE}.ytdl`];

    function setupWithPartials(settings: Partial<Settings> = {}) {
        const findPartialFiles = vi.fn((finalPath: string) => {
            return finalPath === FILE ? PARTIALS : [];
        });
        const deleteFiles = vi.fn();
        return { ...setup(settings, { findPartialFiles, deleteFiles }), findPartialFiles, deleteFiles };
    }

    async function startAndPause(result: ReturnType<typeof setupWithPartials>): Promise<void> {
        result.queue.add(URL_A);
        result.runs[0]?.onInfo({ live: false, filePath: FILE });
        result.runs[0]?.onProgress(progress({ percent: 42.5, speed: '1MiB/s', eta: '00:10', title: 'Video A' }));
        result.queue.pause('job-1');
        await flush();
    }

    describe('pause', () => {
        it('ends the run of a download that is going on, as a cancel does, and not the other way', async () => {
            const { queue, runs } = setup();
            queue.add(URL_A);

            queue.pause('job-1');

            expect(runs[0]?.cancel).toHaveBeenCalledTimes(1);
            expect(runs[0]?.stop).not.toHaveBeenCalled();
        });

        it('leaves the download paused, with the percent it had and no speed or time, instead of cancelled', async () => {
            const result = setupWithPartials();

            await startAndPause(result);

            expect(result.queue.getJob('job-1')).toMatchObject({ status: 'paused', percent: 42.5, speed: '', eta: '', error: null });
        });

        it('keeps the partial files, so the download can go on from them, whatever the setting says', async () => {
            const result = setupWithPartials({ deletePartialsOnFailure: true });

            await startAndPause(result);

            expect(result.findPartialFiles).toHaveBeenCalledWith(FILE);
            expect(result.deleteFiles).not.toHaveBeenCalled();
            expect(result.queue.getJob('job-1')?.hasPartial).toBe(true);
        });

        it('says there is no partial file when yt-dlp had not written one yet', async () => {
            const result = setupWithPartials();
            result.queue.add(URL_A);
            result.runs[0]?.onInfo({ live: false, filePath: '/dl/other.mp4' });

            result.queue.pause('job-1');
            await flush();

            expect(result.queue.getJob('job-1')).toMatchObject({ status: 'paused', hasPartial: false });
        });

        it('does not record it in the history: it is not over', async () => {
            const result = setupWithPartials();

            await startAndPause(result);

            expect(result.history).toEqual([]);
            expect(result.onHistoryChanged).not.toHaveBeenCalled();
        });

        it('tells the screen, in the update, that the card is paused', async () => {
            const result = setupWithPartials();

            await startAndPause(result);

            expect(result.updates.at(-1)).toMatchObject({ id: 'job-1', status: 'paused', percent: 42.5, speed: '', eta: '' });
        });

        it('frees its place in the queue for the next download', async () => {
            const { queue, runs } = setup({ maxConcurrent: 1 });
            queue.add(URL_A);
            queue.add(URL_B);
            expect(runs).toHaveLength(1);

            queue.pause('job-1');
            await flush();

            expect(runs).toHaveLength(2);
            expect(runs[1]?.args).toContain(URL_B);
            expect(queue.list().map((job) => {
                return job.status;
            })).toEqual(['paused', 'running']);
        });

        it('does nothing for a download that is waiting for its turn: it has no run to end', () => {
            const { queue, runs } = setup({ maxConcurrent: 1 });
            queue.add(URL_A);
            queue.add(URL_B);
            const before = queue.list();

            queue.pause('job-2');

            expect(queue.list()).toEqual(before);
            expect(runs).toHaveLength(1);
            expect(runs[0]?.cancel).not.toHaveBeenCalled();
        });

        it('does nothing for a download that is over, or one that does not exist', async () => {
            const { queue, runs } = setup();
            queue.add(URL_A);
            runs[0]?.resolve({ status: 'done', filePath: '/dl/a.mp4' });
            await flush();

            queue.pause('job-1');
            queue.pause('missing');
            await flush();

            expect(queue.list()[0]?.status).toBe('done');
            expect(runs[0]?.cancel).not.toHaveBeenCalled();
        });

        it('does not pause a live recording: it is stopped and saved instead', async () => {
            const { queue, runs } = setup();
            queue.add(URL_A);
            runs[0]?.onInfo({ live: true, filePath: '/dl/live.mp4' });

            queue.pause('job-1');
            await flush();

            expect(runs[0]?.cancel).not.toHaveBeenCalled();
            expect(queue.list()[0]?.status).toBe('running');
            expect(queue.canPause(queue.getJob('job-1') as DownloadJob)).toBe(false);
        });

        it('does not pause a download that waits for a live stream to start', async () => {
            const { queue, runs } = setup();
            queue.add(URL_A);
            runs[0]?.onWaiting?.();

            queue.pause('job-1');
            await flush();

            expect(runs[0]?.cancel).not.toHaveBeenCalled();
            expect(queue.list()[0]?.waitingForLive).toBe(true);
        });

        it('does not pause a download that is already converting or joining its file', async () => {
            const { queue, runs } = setup();
            queue.add(URL_A);
            runs[0]?.onPostProcess?.({ status: 'started', processor: 'Merger' });

            queue.pause('job-1');
            await flush();

            expect(runs[0]?.cancel).not.toHaveBeenCalled();
            expect(queue.list()[0]?.status).toBe('running');
        });

        it('can pause a download that is going on and is not any of those', () => {
            const { queue } = setup();
            queue.add(URL_A);

            expect(queue.canPause(queue.getJob('job-1') as DownloadJob)).toBe(true);
        });

        it('cannot pause a download that is queued, paused or over', async () => {
            const { queue, runs } = setup({ maxConcurrent: 1 });
            queue.add(URL_A);
            queue.add(URL_B);
            expect(queue.canPause(queue.getJob('job-2') as DownloadJob)).toBe(false);
            queue.pause('job-1');
            await flush();
            expect(queue.canPause(queue.getJob('job-1') as DownloadJob)).toBe(false);
            runs[1]?.resolve({ status: 'done', filePath: null });
            await flush();
            expect(queue.canPause(queue.getJob('job-2') as DownloadJob)).toBe(false);
        });

        it('ends as done when the download finished before the pause could end it', async () => {
            const { queue, runs } = setup();
            queue.add(URL_A);
            (runs[0]?.cancel as ReturnType<typeof vi.fn>).mockImplementation(() => {
                return undefined;
            });

            queue.pause('job-1');
            runs[0]?.resolve({ status: 'done', filePath: '/dl/a.mp4' });
            await flush();

            expect(queue.list()[0]).toMatchObject({ status: 'done', filePath: '/dl/a.mp4' });
        });

        it('does not turn a later cancel of the same card into a pause', async () => {
            const { queue, runs } = setup();
            queue.add(URL_A);
            (runs[0]?.cancel as ReturnType<typeof vi.fn>).mockImplementation(() => {
                return undefined;
            });
            queue.pause('job-1');
            runs[0]?.resolve({ status: 'done', filePath: '/dl/a.mp4' });
            await flush();
            queue.retry('job-1');
            queue.cancel('job-1');
            await flush();

            expect(queue.list()[0]?.status).toBe('done');
        });

        it('is not counted as pending: closing the app does not wait for, or ask about, a paused download', async () => {
            const result = setupWithPartials();

            await startAndPause(result);

            expect(result.queue.pendingCount()).toBe(0);
            expect(result.queue.list()).toHaveLength(1);
        });
    });

    describe('resume', () => {
        it('puts the paused download back in the queue and starts it again with the same arguments', async () => {
            const result = setupWithPartials();
            await startAndPause(result);

            result.queue.resume('job-1');

            expect(result.runs).toHaveLength(2);
            expect(result.runs[1]?.args).toEqual(result.runs[0]?.args);
            expect(result.runs[1]?.binary).toBe(result.runs[0]?.binary);
            expect(result.queue.getJob('job-1')).toMatchObject({ status: 'running', percent: 42.5 });
        });

        it('goes to queued first, and then to running, in the updates', async () => {
            const result = setupWithPartials();
            await startAndPause(result);
            result.updates.length = 0;

            result.queue.resume('job-1');

            expect(result.updates.map((job) => {
                return job.status;
            })).toEqual(['queued', 'running']);
        });

        it('waits for its turn when the queue is full', async () => {
            const { queue, runs } = setup({ maxConcurrent: 1 });
            queue.add(URL_A);
            queue.pause('job-1');
            await flush();
            queue.add(URL_B);
            expect(runs).toHaveLength(2);

            queue.resume('job-1');

            expect(runs).toHaveLength(2);
            expect(queue.getJob('job-1')?.status).toBe('queued');
            runs[1]?.resolve({ status: 'done', filePath: null });
            await flush();
            expect(runs).toHaveLength(3);
            expect(queue.getJob('job-1')?.status).toBe('running');
        });

        it('finishes like any other download, and records it in the history', async () => {
            const result = setupWithPartials();
            await startAndPause(result);
            result.queue.resume('job-1');

            result.runs[1]?.resolve({ status: 'done', filePath: FILE });
            await flush();

            expect(result.queue.getJob('job-1')).toMatchObject({ status: 'done', filePath: FILE, percent: 100 });
            expect(result.history).toHaveLength(1);
            expect(result.history[0]).toMatchObject({ id: 'job-1', status: 'done', filePath: FILE });
        });

        it('can be paused again after it was resumed', async () => {
            const result = setupWithPartials();
            await startAndPause(result);
            result.queue.resume('job-1');

            result.queue.pause('job-1');
            await flush();

            expect(result.runs[1]?.cancel).toHaveBeenCalledTimes(1);
            expect(result.queue.getJob('job-1')?.status).toBe('paused');
        });

        it('fails like any other download when it cannot go on, and keeps the partial files for a retry', async () => {
            const result = setupWithPartials({ deletePartialsOnFailure: false });
            await startAndPause(result);
            result.queue.resume('job-1');

            result.runs[1]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
            await flush();

            expect(result.queue.getJob('job-1')).toMatchObject({ status: 'error', error: DOWNLOAD_ERROR, hasPartial: true });
        });

        it.each(['queued', 'running', 'done', 'cancelled', 'error'] as const)('does nothing for a download that is %s', async (state) => {
            const { queue, runs } = setup({ maxConcurrent: 1 });
            queue.add(URL_A);
            if (state === 'queued') {
                queue.add(URL_B);
            }
            if (state === 'done') {
                runs[0]?.resolve({ status: 'done', filePath: null });
                await flush();
            }
            if (state === 'cancelled') {
                queue.cancel('job-1');
                await flush();
            }
            if (state === 'error') {
                runs[0]?.resolve({ status: 'error', error: DOWNLOAD_ERROR });
                await flush();
            }
            const target = state === 'queued' ? 'job-2' : 'job-1';
            const before = queue.list();
            const runCount = runs.length;

            queue.resume(target);

            expect(queue.list()).toEqual(before);
            expect(runs).toHaveLength(runCount);
        });

        it('does nothing for a download that does not exist', () => {
            const { queue, runs } = setup();

            queue.resume('missing');

            expect(runs).toHaveLength(0);
        });
    });

    describe('cancel, remove and clear on a paused download', () => {
        it('cancels it, deleting the partial files when the setting is on', async () => {
            const result = setupWithPartials({ deletePartialsOnFailure: true });
            await startAndPause(result);

            result.queue.cancel('job-1');

            expect(result.deleteFiles).toHaveBeenCalledTimes(1);
            expect(result.deleteFiles).toHaveBeenCalledWith(PARTIALS);
            expect(result.queue.getJob('job-1')).toMatchObject({ status: 'cancelled', hasPartial: false, speed: '', eta: '' });
            expect(result.runs[0]?.cancel).toHaveBeenCalledTimes(1);
        });

        it('cancels it, keeping the partial files when the setting is off, and says they are there', async () => {
            const result = setupWithPartials({ deletePartialsOnFailure: false });
            await startAndPause(result);

            result.queue.cancel('job-1');

            expect(result.deleteFiles).not.toHaveBeenCalled();
            expect(result.queue.getJob('job-1')).toMatchObject({ status: 'cancelled', hasPartial: true });
        });

        it('can be retried after it was cancelled', async () => {
            const result = setupWithPartials({ deletePartialsOnFailure: false });
            await startAndPause(result);
            result.queue.cancel('job-1');

            result.queue.retry('job-1');

            expect(result.runs).toHaveLength(2);
            expect(result.queue.getJob('job-1')).toMatchObject({ status: 'running', percent: 0 });
        });

        it('removes the card and deletes the partial files with it', async () => {
            const result = setupWithPartials({ deletePartialsOnFailure: false });
            await startAndPause(result);

            result.queue.remove('job-1');

            expect(result.deleteFiles).toHaveBeenCalledWith(PARTIALS);
            expect(result.queue.list()).toEqual([]);
            expect(result.removed).toEqual(['job-1']);
        });

        it('removes a card that was being paused, and deletes what it left', async () => {
            const result = setupWithPartials();
            result.queue.add(URL_A);
            result.runs[0]?.onInfo({ live: false, filePath: FILE });
            result.queue.pause('job-1');

            result.queue.remove('job-1');
            await flush();

            expect(result.queue.list()).toEqual([]);
            expect(result.deleteFiles).toHaveBeenCalledWith(PARTIALS);
        });

        it('lets the partial files of a paused download be cleared without losing the card', async () => {
            const result = setupWithPartials();
            await startAndPause(result);

            result.queue.clearPartials('job-1');

            expect(result.deleteFiles).toHaveBeenCalledWith(PARTIALS);
            expect(result.queue.getJob('job-1')).toMatchObject({ status: 'paused', hasPartial: false });
        });

        it('is not removed by the bulk clear of what is finished', async () => {
            const result = setupWithPartials();
            await startAndPause(result);

            result.queue.clearFinished();

            expect(result.queue.list()).toHaveLength(1);
            expect(result.deleteFiles).not.toHaveBeenCalled();
        });

        it('is left alone when the app is closed: nothing is running for it', async () => {
            const result = setupWithPartials();
            await startAndPause(result);

            await result.queue.shutdown();

            expect(result.queue.getJob('job-1')?.status).toBe('paused');
            expect(result.deleteFiles).not.toHaveBeenCalled();
        });
    });
});

describe('QueueManager paused downloads kept for the next run', () => {
    const FILE = '/dl/Video A [abc].mp4';
    const PARTIALS = [`${FILE}.part`, `${FILE}.ytdl`];

    function makeStorage(initial: PausedDownload[] = []) {
        let kept: PausedDownload[] = initial;
        const load = vi.fn((): PausedDownload[] => {
            return kept;
        });
        const save = vi.fn((downloads: PausedDownload[]): void => {
            kept = downloads.map((download) => {
                return JSON.parse(JSON.stringify(download)) as PausedDownload;
            });
        });
        return { storage: { load, save }, load, save, kept: () => {return kept} };
    }

    function setupWithStorage(initial: PausedDownload[] = [], settings: Partial<Settings> = {}) {
        const stored = makeStorage(initial);
        const findPartialFiles = vi.fn((finalPath: string) => {
            return finalPath === FILE ? PARTIALS : [];
        });
        const deleteFiles = vi.fn();
        return { ...setup(settings, { pausedStorage: stored.storage, findPartialFiles, deleteFiles }), ...stored, findPartialFiles, deleteFiles };
    }

    async function pause(result: ReturnType<typeof setupWithStorage>, options: Parameters<QueueManager['add']>[1] = {}): Promise<void> {
        result.queue.add(URL_A, options);
        result.runs[0]?.onInfo({ live: false, filePath: FILE });
        result.runs[0]?.onProgress(progress({ percent: 42.5, speed: '1MiB/s', eta: '00:10', title: 'Video A' }));
        result.queue.pause('job-1');
        await flush();
    }

    describe('keeping them', () => {
        it('writes the paused download, with its files and how it was asked for, as soon as it is paused', async () => {
            const result = setupWithStorage();

            await pause(result, { referer: 'https://example.com/', userAgent: 'Mozilla/5.0', title: 'Video A', pageUrl: 'https://example.com/page', ipFamily: 4, options: { maxResolution: '720' } });

            expect(result.save).toHaveBeenCalledTimes(1);
            const [saved] = result.kept();
            expect(saved?.job).toMatchObject({ id: 'job-1', url: URL_A, status: 'paused', percent: 42.5, speed: '', eta: '', title: 'Video A', pageUrl: 'https://example.com/page', customized: true });
            expect(saved?.extras).toEqual({ referer: 'https://example.com/', userAgent: 'Mozilla/5.0', title: 'Video A', pageUrl: 'https://example.com/page', ipFamily: 4, options: { maxResolution: '720' } });
            expect(saved?.outputPaths).toEqual([FILE]);
        });

        it('never writes the cookie of the page, nor the part number of a recording', async () => {
            const result = setupWithStorage();

            await pause(result, { referer: 'https://example.com/', cookie: 'session=secret', resumedPart: 2 });

            const [saved] = result.kept();
            expect(saved?.extras).toEqual({ referer: 'https://example.com/' });
            expect(JSON.stringify(result.kept())).not.toContain('secret');
            expect(JSON.stringify(result.kept())).not.toContain('cookie');
        });

        it('keeps the cookie in memory, so the download still goes on with it while the app is open', async () => {
            const result = setupWithStorage();
            await pause(result, { cookie: 'session=secret' });

            result.queue.resume('job-1');

            expect(result.runs[1]?.args).toEqual(result.runs[0]?.args);
            expect(result.runs[1]?.args.join(' ')).toContain('session=secret');
        });

        it('keeps all the paused downloads, and only them', async () => {
            const result = setupWithStorage([], { maxConcurrent: 3 });
            result.queue.add(URL_A);
            result.queue.add(URL_B);
            result.queue.add(URL_C);
            result.queue.pause('job-1');
            await flush();
            result.queue.pause('job-3');
            await flush();

            expect(
                result.kept().map((saved) => {
                    return saved.job.id;
                })
            ).toEqual(['job-1', 'job-3']);
        });

        it('writes nothing for a download that was not paused', async () => {
            const result = setupWithStorage();
            result.queue.add(URL_A);
            result.runs[0]?.resolve({ status: 'done', filePath: '/dl/a.mp4' });
            await flush();
            result.queue.add(URL_B);
            result.queue.cancel('job-2');
            await flush();

            expect(result.save).not.toHaveBeenCalled();
        });

        it('forgets it when it is resumed', async () => {
            const result = setupWithStorage();
            await pause(result);

            result.queue.resume('job-1');

            expect(result.kept()).toEqual([]);
        });

        it('keeps the other paused downloads when one is resumed', async () => {
            const result = setupWithStorage([], { maxConcurrent: 2 });
            result.queue.add(URL_A);
            result.queue.add(URL_B);
            result.queue.pause('job-1');
            result.queue.pause('job-2');
            await flush();

            result.queue.resume('job-1');

            expect(
                result.kept().map((saved) => {
                    return saved.job.id;
                })
            ).toEqual(['job-2']);
        });

        it('forgets it when it is cancelled', async () => {
            const result = setupWithStorage();
            await pause(result);

            result.queue.cancel('job-1');

            expect(result.kept()).toEqual([]);
        });

        it('forgets it when its card is removed', async () => {
            const result = setupWithStorage();
            await pause(result);

            result.queue.remove('job-1');

            expect(result.kept()).toEqual([]);
        });

        it('does not write the file again when a card that is not paused is removed', async () => {
            const result = setupWithStorage();
            result.queue.add(URL_A);
            result.runs[0]?.resolve({ status: 'done', filePath: '/dl/a.mp4' });
            await flush();

            result.queue.remove('job-1');

            expect(result.save).not.toHaveBeenCalled();
        });

        it('does not keep a download that was removed while it was being paused', async () => {
            const result = setupWithStorage();
            result.queue.add(URL_A);
            result.runs[0]?.onInfo({ live: false, filePath: FILE });
            result.queue.pause('job-1');

            result.queue.remove('job-1');
            await flush();

            expect(result.kept()).toEqual([]);
        });

        it('goes on without a storage', async () => {
            const { queue, runs } = setup();
            queue.add(URL_A);
            queue.pause('job-1');
            await flush();
            queue.resume('job-1');

            expect(queue.list()[0]?.status).toBe('running');
            expect(runs).toHaveLength(2);
        });
    });

    describe('getting them back', () => {
        function pausedDownload(overrides: Partial<PausedDownload> = {}): PausedDownload {
            return {
                job: makeJob({ id: 'saved-1', url: URL_A, status: 'paused', title: 'Video A', percent: 61.5, speed: '', eta: '', createdAt: 1700000000000, pageUrl: null, customized: false }),
                extras: { referer: 'https://example.com/', userAgent: 'Mozilla/5.0', title: 'Video A' },
                outputPaths: [FILE],
                ...overrides
            };
        }

        it('lists a download that was paused in the earlier run as paused, with what it had downloaded', () => {
            const { queue, updates, runs } = setupWithStorage([pausedDownload()]);

            expect(queue.list()).toHaveLength(1);
            expect(queue.list()[0]).toMatchObject({ id: 'saved-1', url: URL_A, status: 'paused', title: 'Video A', percent: 61.5, speed: '', eta: '', createdAt: 1700000000000 });
            expect(queue.getJob('saved-1')?.status).toBe('paused');
            expect(updates).toEqual([]);
            expect(runs).toHaveLength(0);
        });

        it('says its partial files are still there, when they are', () => {
            const { queue, findPartialFiles } = setupWithStorage([pausedDownload()]);

            expect(findPartialFiles).toHaveBeenCalledWith(FILE);
            expect(queue.getJob('saved-1')?.hasPartial).toBe(true);
        });

        it('says there is no partial file when they were deleted while the app was closed', () => {
            const { queue } = setupWithStorage([pausedDownload({ outputPaths: ['/dl/gone.mp4'] })]);

            expect(queue.getJob('saved-1')?.hasPartial).toBe(false);
            expect(queue.getJob('saved-1')?.status).toBe('paused');
        });

        it('does not count it as pending or running: closing the app does not ask about it', () => {
            const { queue } = setupWithStorage([pausedDownload()]);

            expect(queue.pendingCount()).toBe(0);
            expect(queue.hasLiveJobs()).toBe(false);
        });

        it('goes on from it when it is resumed: yt-dlp is started with the arguments the download was asked for', () => {
            const { queue, runs } = setupWithStorage([pausedDownload({ extras: { referer: 'https://example.com/', userAgent: 'Mozilla/5.0', title: 'Video A', options: { maxResolution: '720' } } })]);

            queue.resume('saved-1');

            expect(runs).toHaveLength(1);
            expect(runs[0]?.args).toEqual(buildYtdlpArgs(URL_A, { ...DEFAULT_SETTINGS, maxConcurrent: 2, verifyLiveEnd: false, ...{ maxResolution: '720' } }, '/dl', '/bundled/bin', { referer: 'https://example.com/', userAgent: 'Mozilla/5.0', title: 'Video A', options: { maxResolution: '720' } }));
            expect(queue.getJob('saved-1')).toMatchObject({ status: 'running', percent: 61.5 });
        });

        it('uses the page it was found on when it is resumed, so a fresh address can still be looked for', () => {
            const { queue } = setupWithStorage([pausedDownload({ job: { ...pausedDownload().job, pageUrl: 'https://example.com/page' } })]);

            queue.resume('saved-1');

            expect(queue.getJob('saved-1')?.pageUrl).toBe('https://example.com/page');
        });

        it('finishes like any other download and goes to the history', async () => {
            const result = setupWithStorage([pausedDownload()]);
            result.queue.resume('saved-1');

            result.runs[0]?.resolve({ status: 'done', filePath: FILE });
            await flush();

            expect(result.queue.getJob('saved-1')).toMatchObject({ status: 'done', filePath: FILE, percent: 100 });
            expect(result.history).toHaveLength(1);
            expect(result.history[0]).toMatchObject({ id: 'saved-1', status: 'done', filePath: FILE });
        });

        it('forgets it in the file when it is resumed, and when it is cancelled', () => {
            const resumed = setupWithStorage([pausedDownload()]);
            resumed.queue.resume('saved-1');
            expect(resumed.kept()).toEqual([]);

            const cancelled = setupWithStorage([pausedDownload()]);
            cancelled.queue.cancel('saved-1');
            expect(cancelled.kept()).toEqual([]);
            expect(cancelled.queue.getJob('saved-1')?.status).toBe('cancelled');
        });

        it('deletes the partial files of a cancelled one, as the setting says', () => {
            const { queue, deleteFiles } = setupWithStorage([pausedDownload()], { deletePartialsOnFailure: true });

            queue.cancel('saved-1');

            expect(deleteFiles).toHaveBeenCalledWith(PARTIALS);
            expect(queue.getJob('saved-1')).toMatchObject({ status: 'cancelled', hasPartial: false });
        });

        it('can be paused again after it was resumed, and is kept again', async () => {
            const result = setupWithStorage([pausedDownload()]);
            result.queue.resume('saved-1');
            result.runs[0]?.onInfo({ live: false, filePath: FILE });

            result.queue.pause('saved-1');
            await flush();

            expect(result.queue.getJob('saved-1')?.status).toBe('paused');
            expect(result.kept()[0]?.job).toMatchObject({ id: 'saved-1', status: 'paused' });
            expect(result.kept()[0]?.outputPaths).toEqual([FILE]);
        });

        it('gets back every one that was kept, in the order they were, together with the new downloads', () => {
            const { queue, runs } = setupWithStorage([
                pausedDownload(),
                pausedDownload({ job: { ...pausedDownload().job, id: 'saved-2', url: URL_B } })
            ]);

            queue.add(URL_C);

            expect(
                queue.list().map((job) => {
                    return [job.id, job.status];
                })
            ).toEqual([
                ['saved-1', 'paused'],
                ['saved-2', 'paused'],
                ['job-1', 'running']
            ]);
            expect(runs).toHaveLength(1);
        });

        it('does not take two downloads with the same id', () => {
            const { queue } = setupWithStorage([pausedDownload(), pausedDownload({ job: { ...pausedDownload().job, url: URL_B } })]);

            expect(queue.list()).toHaveLength(1);
            expect(queue.getJob('saved-1')?.url).toBe(URL_A);
        });

        it('lets what is paused take its turn in the queue after the app is opened', () => {
            const { queue, runs } = setupWithStorage([pausedDownload()], { maxConcurrent: 1 });
            queue.add(URL_B);
            expect(runs).toHaveLength(1);

            queue.resume('saved-1');

            expect(queue.getJob('saved-1')?.status).toBe('queued');
            expect(runs).toHaveLength(1);
        });
    });
});

describe('QueueManager closing the app with downloads going on', () => {
    const FILE = '/dl/Video A [abc].mp4';
    const PARTIALS = [`${FILE}.part`, `${FILE}.ytdl`];

    // The unfinished files are there until they are deleted, as on a disk.
    function setupClosing(settings: Partial<Settings> = {}, initial: PausedDownload[] = []) {
        let present = true;
        const findPartialFiles = vi.fn((finalPath: string) => {
            return present && finalPath === FILE ? PARTIALS : [];
        });
        const deleteFiles = vi.fn((): void => {
            present = false;
        });
        const save = vi.fn();
        const load = vi.fn((): PausedDownload[] => {
            return initial;
        });
        return { ...setup(settings, { findPartialFiles, deleteFiles, pausedStorage: { load, save } }), findPartialFiles, deleteFiles, save };
    }

    function startDownload(result: ReturnType<typeof setupClosing>): void {
        result.queue.add(URL_A);
        result.runs[0]?.onInfo({ live: false, filePath: FILE });
        result.runs[0]?.onProgress(progress({ percent: 30, speed: '1MiB/s', eta: '00:10', title: 'Video A' }));
    }

    describe('hasRunsToEnd', () => {
        it('is false with nothing running, true while a download runs and false once it ended', async () => {
            const result = setupClosing();
            expect(result.queue.hasRunsToEnd()).toBe(false);

            startDownload(result);
            expect(result.queue.hasRunsToEnd()).toBe(true);

            result.runs[0]?.resolve({ status: 'done', filePath: FILE });
            await flush();
            expect(result.queue.hasRunsToEnd()).toBe(false);
        });

        it('is false for a download that waits its turn and for one that is paused', async () => {
            const result = setupClosing({ maxConcurrent: 1 });
            startDownload(result);
            result.queue.add(URL_B);
            result.queue.pause('job-1');
            await flush();

            expect(result.queue.getJob('job-1')?.status).toBe('paused');
            expect(result.runs).toHaveLength(2);
            result.runs[1]?.resolve({ status: 'done', filePath: '/dl/b.mp4' });
            await flush();
            expect(result.queue.hasRunsToEnd()).toBe(false);
        });
    });

    describe('shutdown of a download that is running', () => {
        it.each([
            ['the setting that deletes what a failure leaves behind is off', false],
            ['the setting that deletes what a failure leaves behind is on', true]
        ])('cancels it and deletes its unfinished files when %s', async (_name, deletePartialsOnFailure) => {
            const result = setupClosing({ deletePartialsOnFailure });
            startDownload(result);

            await result.queue.shutdown();

            expect(result.runs[0]?.cancel).toHaveBeenCalledTimes(1);
            expect(result.queue.getJob('job-1')).toMatchObject({ status: 'cancelled', hasPartial: false });
            expect(result.deleteFiles).toHaveBeenCalledTimes(1);
            expect(result.deleteFiles).toHaveBeenCalledWith(PARTIALS);
            expect(result.findPartialFiles).toHaveBeenCalledWith(FILE);
        });

        it('waits for the process to end before it deletes the files, which it may still be writing', async () => {
            const result = setupClosing({ deletePartialsOnFailure: false });
            startDownload(result);
            result.runs[0]?.cancel.mockImplementation(() => {
                return undefined;
            });

            const shutdown = result.queue.shutdown();
            await flush();
            expect(result.deleteFiles).not.toHaveBeenCalled();

            result.runs[0]?.resolve({ status: 'cancelled' });
            await shutdown;
            expect(result.deleteFiles).toHaveBeenCalledTimes(1);
            expect(result.deleteFiles).toHaveBeenCalledWith(PARTIALS);
        });

        it('deletes the files even when the process does not end in time', async () => {
            vi.useFakeTimers();
            try {
                const result = setupClosing({ deletePartialsOnFailure: false });
                startDownload(result);
                result.runs[0]?.cancel.mockImplementation(() => {
                    return undefined;
                });

                const shutdown = result.queue.shutdown(5000);
                await vi.advanceTimersByTimeAsync(5000);
                await shutdown;

                expect(result.deleteFiles).toHaveBeenCalledTimes(1);
                expect(result.deleteFiles).toHaveBeenCalledWith(PARTIALS);
            } finally {
                vi.useRealTimers();
            }
        });

        it('deletes the files of every running download and leaves the ones that wait alone', async () => {
            const result = setupClosing({ maxConcurrent: 2 });
            startDownload(result);
            result.queue.add(URL_B);
            result.runs[1]?.onInfo({ live: false, filePath: '/dl/other.mp4' });
            result.queue.add(URL_C);

            await result.queue.shutdown();

            expect(result.runs).toHaveLength(2);
            expect(result.deleteFiles).toHaveBeenCalledTimes(1);
            expect(result.deleteFiles).toHaveBeenCalledWith(PARTIALS);
            expect(
                result.queue.list().map((job) => {
                    return job.status;
                })
            ).toEqual(['cancelled', 'cancelled', 'queued']);
        });

        it('has nothing to delete when the download had not written a file yet', async () => {
            const result = setupClosing();
            result.queue.add(URL_A);

            await result.queue.shutdown();

            expect(result.queue.getJob('job-1')?.status).toBe('cancelled');
            expect(result.deleteFiles).not.toHaveBeenCalled();
        });

        it('does not fail when the queue cannot find files', async () => {
            const { queue, runs } = setup({}, { deleteFiles: vi.fn() });
            queue.add(URL_A);
            runs[0]?.onInfo({ live: false, filePath: FILE });

            await expect(queue.shutdown()).resolves.toBeUndefined();
            expect(queue.getJob('job-1')?.status).toBe('cancelled');
        });

        it('keeps the recording of a live stream: it is asked to finish, not deleted', async () => {
            const result = setupClosing();
            result.queue.add(URL_A);
            result.runs[0]?.onInfo({ live: true, filePath: FILE });

            await result.queue.shutdown();

            expect(result.runs[0]?.stop).toHaveBeenCalledTimes(1);
            expect(result.runs[0]?.cancel).not.toHaveBeenCalled();
            expect(result.deleteFiles).not.toHaveBeenCalled();
        });

        it('leaves a download that was paused before alone: it is kept for the next run', async () => {
            const result = setupClosing({ maxConcurrent: 2 });
            startDownload(result);
            result.queue.pause('job-1');
            await flush();
            result.save.mockClear();

            await result.queue.shutdown();

            expect(result.queue.getJob('job-1')?.status).toBe('paused');
            expect(result.deleteFiles).not.toHaveBeenCalled();
            expect(result.save).not.toHaveBeenCalled();
        });
    });

    describe('shutdown while a download is being paused', () => {
        it('keeps it as paused at once, before its process has ended, so closing right after pausing does not lose it', async () => {
            const result = setupClosing();
            startDownload(result);
            result.runs[0]?.cancel.mockImplementation(() => {
                return undefined;
            });
            result.queue.pause('job-1');
            expect(result.save).not.toHaveBeenCalled();

            const shutdown = result.queue.shutdown();

            expect(result.save).toHaveBeenCalledTimes(1);
            const [saved] = result.save.mock.calls[0]?.[0] as PausedDownload[];
            expect(saved?.job).toMatchObject({ id: 'job-1', url: URL_A, status: 'paused', percent: 30 });
            expect(saved?.outputPaths).toEqual([FILE]);
            expect(result.queue.getJob('job-1')?.status).toBe('paused');

            result.runs[0]?.resolve({ status: 'cancelled' });
            await shutdown;
            expect(result.queue.getJob('job-1')?.status).toBe('paused');
            expect(result.deleteFiles).not.toHaveBeenCalled();
        });

        it('keeps the files of the download that was being paused, and deletes the ones of the others', async () => {
            const result = setupClosing({ maxConcurrent: 2 });
            startDownload(result);
            result.queue.add(URL_B);
            result.runs[1]?.onInfo({ live: false, filePath: '/dl/other.mp4' });
            result.queue.pause('job-1');

            await result.queue.shutdown();

            expect(
                result.queue.list().map((job) => {
                    return [job.id, job.status];
                })
            ).toEqual([
                ['job-1', 'paused'],
                ['job-2', 'cancelled']
            ]);
            expect(result.deleteFiles).not.toHaveBeenCalled();
        });
    });

    describe('a paused download read from the file', () => {
        function savedDownload(outputPaths: string[], extras: PausedDownload['extras'] = {}): PausedDownload {
            return {
                job: makeJob({ id: 'saved-1', url: URL_A, status: 'paused', title: 'Video A', percent: 61.5, speed: '', eta: '', createdAt: 1700000000000, pageUrl: null, customized: false }),
                extras,
                outputPaths
            };
        }

        function setupSaved(saved: PausedDownload) {
            const findPartialFiles = vi.fn((finalPath: string) => {
                return [`${finalPath}.part`];
            });
            const deleteFiles = vi.fn();
            const result = setup({}, { findPartialFiles, deleteFiles, pausedStorage: {
                    load: () => {
                        return [saved];
                    },
                    save: vi.fn()
                }
            });
            return { ...result, findPartialFiles, deleteFiles };
        }

        it('keeps the files that are in the folder of the settings and drops the ones that are anywhere else', () => {
            const { queue, deleteFiles, findPartialFiles } = setupSaved(savedDownload(['/dl/a.mp4', '/dl/sub/b.mp4', '/etc/passwd', '/dl/../etc/c.mp4', '/dlx/d.mp4', 'relative/e.mp4']));

            expect(queue.getJob('saved-1')?.hasPartial).toBe(true);
            expect(
                findPartialFiles.mock.calls
                    .map(([path]) => {
                        return path;
                    })
                    .sort()
            ).toEqual(['/dl/a.mp4', '/dl/sub/b.mp4']);

            queue.cancel('saved-1');

            expect(deleteFiles).toHaveBeenCalledTimes(1);
            expect(deleteFiles).toHaveBeenCalledWith(['/dl/a.mp4.part', '/dl/sub/b.mp4.part']);
        });

        it('uses the folder the download was given when it has one', () => {
            const { queue, findPartialFiles } = setupSaved(savedDownload(['/other/a.mp4', '/dl/b.mp4'], { downloadDir: '/other' }));

            expect(queue.getJob('saved-1')?.hasPartial).toBe(true);
            expect(findPartialFiles.mock.calls.map(([path]) => {
                return path;
            })).toEqual(['/other/a.mp4']);
        });

        it('has no partial files when none of its files is in the folder', () => {
            const { queue, deleteFiles } = setupSaved(savedDownload(['/etc/passwd']));

            expect(queue.getJob('saved-1')?.hasPartial).toBe(false);
            queue.cancel('saved-1');
            expect(deleteFiles).not.toHaveBeenCalled();
        });
    });
});
