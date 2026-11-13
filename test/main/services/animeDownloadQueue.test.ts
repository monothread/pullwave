import { join } from 'node:path';
import type { AniDownloadProgress, AniRunResult, AnimeAddRequest, AnimeDownloadRequest, AnimeJob } from '@shared/anime';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { Settings } from '@shared/types';
import { AnimeDb } from '@main/services/animeDb';
import { ANIME_MAX_TRIES, AnimeDownloadQueue } from '@main/services/animeDownloadQueue';
import { DEFAULT_ANIME_FOLDER } from '@main/services/animeFiles';
import type { AniDownloadHandle, AniDownloadOptions } from '@main/services/aniCliService';
import type { RepairResult } from '@main/services/imageHeaderRepair';

type DownloadResult = AniRunResult<{ filePath: string | null }>;

interface Download {
    options: AniDownloadOptions;
    cancel: ReturnType<typeof vi.fn>;
    finish: (result: DownloadResult) => void;
}

const DOWNLOADS = '/home/me/Downloads';
const REQUEST: AnimeDownloadRequest = { title: 'Naruto', query: 'naruto', index: 2, episodes: ['1', '2', '3'] };

function setup(
    settings: Partial<Settings> = {},
    files: Record<string, number> = {},
    system: { platform?: NodeJS.Platform; downloads?: string; directories?: string[] } = {},
    site: { provider: string | null } = { provider: null },
    audio: {
        hasAudio?: (path: string) => Promise<boolean | null>;
        repairVideo?: (path: string) => Promise<RepairResult>;
        removeFile?: (path: string) => void;
        withoutRemoveFile?: boolean;
    } = {}
) {
    const db = new AnimeDb(':memory:', () => {
        return 1000;
    });
    const downloads: Download[] = [];
    const updates: AnimeJob[] = [];
    const heldChanges: boolean[] = [];
    const state = { settings: { ...DEFAULT_SETTINGS, ...settings }, libraryChanges: 0, directories: [] as string[], files: { ...files }, downloaded: [] as number[] };
    const ensureDirectory = vi.fn((path: string) => {
        state.directories.push(path);
    });
    const removeDirectory = vi.fn();
    const removeFile = vi.fn((path: string) => {
        if (audio.removeFile) {
            audio.removeFile(path);
        }
        delete state.files[path];
    });
    const hasAudio = audio.hasAudio ? vi.fn(audio.hasAudio) : undefined;
    const repairVideo = audio.repairVideo ? vi.fn(audio.repairVideo) : undefined;
    const queue = new AnimeDownloadQueue({
        db,
        download: (options): AniDownloadHandle => {
            let finish: (result: DownloadResult) => void = () => {
                return undefined;
            };
            const result = new Promise<DownloadResult>((resolve) => {
                finish = resolve;
            });
            const cancel = vi.fn();
            downloads.push({ options, cancel, finish });
            return { result, cancel };
        },
        getSettings: () => {
            return state.settings;
        },
        defaultDownloadDir: system.downloads ?? DOWNLOADS,
        platform: system.platform,
        sourceProvider: () => {
            return site.provider;
        },
        ensureDirectory,
        removeDirectory,
        removeFile: audio.withoutRemoveFile ? undefined : removeFile,
        hasAudio,
        repairVideo,
        fileSize: (path) => {
            return state.files[path] ?? null;
        },
        directoryExists: (path) => {
            return (system.directories ?? []).includes(path);
        },
        onEpisodeDownloaded: (episodeId) => {
            state.downloaded.push(episodeId);
        },
        onJobUpdate: (job) => {
            updates.push(job);
        },
        onLibraryChanged: () => {
            state.libraryChanges += 1;
        },
        onHeldChange: (held) => {
            heldChanges.push(held);
        }
    });
    return { db, queue, downloads, updates, state, ensureDirectory, removeDirectory, removeFile, hasAudio, repairVideo, site, heldChanges };
}

async function settleResults(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function doneAt(path: string | null): DownloadResult {
    return { status: 'done', value: { filePath: path } };
}

describe('AnimeDownloadQueue.enqueue', () => {
    it('adds the anime and its episodes to the library and queues a job for each', () => {
        const { queue, db, updates, state } = setup({ maxConcurrent: 2 });
        const anime = queue.enqueue(REQUEST);

        expect(anime).toMatchObject({ title: 'Naruto', query: 'naruto', searchIndex: 2 });
        expect(
            anime?.episodes.map((episode) => {
                return [episode.number, episode.status];
            })
        ).toEqual([
            ['1', 'downloading'],
            ['2', 'downloading'],
            ['3', 'queued']
        ]);
        expect(db.list()).toHaveLength(1);
        expect(updates[0]).toEqual({
            episodeId: 1,
            animeId: 1,
            animeTitle: 'Naruto',
            episode: '1',
            status: 'queued',
            percent: 0,
            speed: '',
            eta: '',
            error: null,
            parts: null
        });
        expect(state.libraryChanges).toBeGreaterThan(0);
    });

    it('starts as many downloads as the setting allows, in the order of the episodes', () => {
        const { queue, downloads, ensureDirectory } = setup({ maxConcurrent: 2 });
        queue.enqueue(REQUEST);

        expect(downloads).toHaveLength(2);
        expect(downloads[0]?.options).toMatchObject({
            query: 'naruto',
            index: 2,
            episode: '1',
            quality: 'best',
            downloadDir: join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 1')
        });
        expect(downloads[1]?.options.episode).toBe('2');
        expect(downloads[1]?.options.downloadDir).toBe(join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 2'));
        expect(ensureDirectory).toHaveBeenCalledTimes(2);
        expect(ensureDirectory).toHaveBeenNthCalledWith(1, join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 1'));
        expect(ensureDirectory).toHaveBeenNthCalledWith(2, join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 2'));
        expect(
            queue.list().map((job) => {
                return job.status;
            })
        ).toEqual(['running', 'running', 'queued']);
        expect(queue.pendingCount()).toBe(3);
    });

    it('uses the folder, the quality and the audio chosen', () => {
        const { queue, downloads } = setup({ animeDownloadDir: '/media/anime', animeQuality: '720p' });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        expect(downloads[0]?.options).toMatchObject({ quality: '720p', downloadDir: join('/media/anime', 'Naruto', 'Episode 1') });
    });

    it('names the folder after the anime without forbidden characters', () => {
        const { queue, downloads } = setup();
        queue.enqueue({ ...REQUEST, title: 'Re:Zero / Season 2', episodes: ['1'] });
        expect(downloads[0]?.options.downloadDir).toBe(join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Re_Zero _ Season 2', 'Episode 1'));
    });

    it('leaves downloaded episodes and episodes already waiting alone', async () => {
        const { queue, downloads, state } = setup({ maxConcurrent: 1 }, { '/a/1.mp4': 10 });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.finish(doneAt('/a/1.mp4'));
        await settleResults();

        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });
        queue.enqueue({ ...REQUEST, episodes: ['2'] });

        expect(downloads.map((download) => {
            return download.options.episode;
        })).toEqual(['1', '2']);
        expect(state.libraryChanges).toBeGreaterThan(0);
    });

    it('queues an episode that failed before again', async () => {
        const { queue, downloads } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.finish({ status: 'error', error: { code: 'NO_SOURCES', raw: 'down' } });
        await settleResults();

        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        expect(downloads).toHaveLength(2);
        expect(queue.list()).toHaveLength(1);
        expect(queue.list()[0]).toMatchObject({ status: 'running', error: null });
    });
});

describe('AnimeDownloadQueue on Windows', () => {
    const WINDOWS_DOWNLOADS = 'C:\\Users\\me\\Downloads';

    it('saves in a folder named after the anime with Windows rules, inside Downloads', () => {
        const { queue, downloads, ensureDirectory } = setup({}, {}, { platform: 'win32', downloads: WINDOWS_DOWNLOADS });
        queue.enqueue({ ...REQUEST, title: 'NUL', episodes: ['1'] });
        const folder = 'C:\\Users\\me\\Downloads\\Pullwave Anime\\_NUL\\Episode 1';
        expect(downloads[0]?.options.downloadDir).toBe(folder);
        expect(ensureDirectory).toHaveBeenCalledWith(folder);
    });

    it('uses the folder of the settings', () => {
        const { queue, downloads } = setup({ animeDownloadDir: 'D:\\Anime' }, {}, { platform: 'win32', downloads: WINDOWS_DOWNLOADS });
        queue.enqueue({ ...REQUEST, title: 'Re:Zero', episodes: ['1'] });
        expect(downloads[0]?.options.downloadDir).toBe('D:\\Anime\\Re_Zero\\Episode 1');
    });

    it('looks for the file in that folder when yt-dlp did not say where it wrote', async () => {
        const path = 'D:\\Anime\\Re_Zero\\Episode 1\\Re_Zero Episode 1.mp4';
        const { queue, db, downloads } = setup({ animeDownloadDir: 'D:\\Anime' }, { [path]: 10 }, { platform: 'win32', downloads: WINDOWS_DOWNLOADS });
        queue.enqueue({ ...REQUEST, title: 'Re:Zero', episodes: ['1'] });
        downloads[0]?.finish(doneAt(null));
        await settleResults();
        expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: path });
    });

    it('keeps the path of a long title inside the limit of Windows', () => {
        const base = `C:\\${'a'.repeat(120)}`;
        const { queue, downloads } = setup({ animeDownloadDir: base }, {}, { platform: 'win32', downloads: WINDOWS_DOWNLOADS });
        const title = 'T'.repeat(60);
        queue.enqueue({ ...REQUEST, title, episodes: ['1'] });
        const folder = downloads[0]?.options.downloadDir ?? '';
        expect(folder.endsWith('\\Episode 1')).toBe(true);
        expect(`${folder.replace('Episode 1', 'Episode 999')}\\${title} Episode 999.mp4`.length).toBeLessThanOrEqual(240);
    });
});

describe('AnimeDownloadQueue progress', () => {
    it('reports the percent, the speed and the time left', () => {
        const { queue, downloads, updates } = setup();
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        const progress: AniDownloadProgress = { percent: 12.5, totalBytes: 100, speed: '1.00MiB/s', eta: '00:30' };
        downloads[0]?.options.onProgress?.(progress);
        expect(updates.at(-1)).toMatchObject({ status: 'running', percent: 12.5, speed: '1.00MiB/s', eta: '00:30' });
    });

    it('shows empty text when ani-cli gave no speed or time left', () => {
        const { queue, downloads, updates } = setup();
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.options.onProgress?.({ percent: 5, totalBytes: null, speed: null, eta: null });
        expect(updates.at(-1)).toMatchObject({ percent: 5, speed: '', eta: '' });
    });

    it('does not report a change smaller than half a percent, but always the end', () => {
        const { queue, downloads, updates } = setup();
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        const report = (percent: number): void => {
            downloads[0]?.options.onProgress?.({ percent, totalBytes: null, speed: null, eta: null });
        };
        const before = updates.length;
        report(0.2);
        report(1);
        report(1.2);
        report(1.6);
        report(99.9);
        report(100);
        report(100);

        expect(
            updates.slice(before).map((job) => {
                return job.percent;
            })
        ).toEqual([1, 1.6, 99.9, 100, 100]);
    });
});

describe('AnimeDownloadQueue progress of an episode whose picture and audio are downloaded apart', () => {
    function report(downloads: ReturnType<typeof setup>['downloads'], percent: number): void {
        downloads[0]?.options.onProgress?.({ percent, totalBytes: null, speed: '1.00MiB/s', eta: '00:10' });
    }

    it('gives the episode a bar for each part as the first part starts, all empty, and sends them to the window', () => {
        const { queue, downloads, updates } = setup();
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        const before = updates.length;
        downloads[0]?.options.onPart?.({ kinds: ['video', 'audio'], index: 0 });
        expect(updates.slice(before)).toEqual([
            { episodeId: 1, animeId: 1, animeTitle: 'Naruto', episode: '1', status: 'running', percent: 0, speed: '', eta: '', error: null, parts: [{ kind: 'video', percent: 0 }, { kind: 'audio', percent: 0 }] }
        ]);
    });

    it('fills the bar of the picture and then the one of the audio, the picture staying full, with the percentage of the part going on', () => {
        const { queue, downloads, updates } = setup();
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.options.onPart?.({ kinds: ['video', 'audio'], index: 0 });
        report(downloads, 40);
        expect(updates.at(-1)).toMatchObject({ percent: 40, speed: '1.00MiB/s', eta: '00:10', parts: [{ kind: 'video', percent: 40 }, { kind: 'audio', percent: 0 }] });
        report(downloads, 100);
        expect(updates.at(-1)).toMatchObject({ percent: 100, parts: [{ kind: 'video', percent: 100 }, { kind: 'audio', percent: 0 }] });
        downloads[0]?.options.onPart?.({ kinds: ['video', 'audio'], index: 1 });
        expect(updates.at(-1)).toMatchObject({ parts: [{ kind: 'video', percent: 100 }, { kind: 'audio', percent: 0 }] });
        report(downloads, 25);
        expect(updates.at(-1)).toMatchObject({ percent: 25, parts: [{ kind: 'video', percent: 100 }, { kind: 'audio', percent: 25 }] });
    });

    it('takes the parts before the one that starts as complete, even when their last line was never seen', () => {
        const { queue, downloads } = setup();
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.options.onPart?.({ kinds: ['video', 'audio'], index: 0 });
        report(downloads, 60);
        downloads[0]?.options.onPart?.({ kinds: ['video', 'audio'], index: 1 });
        expect(queue.list()[0]?.parts).toEqual([
            { kind: 'video', percent: 100 },
            { kind: 'audio', percent: 0 }
        ]);
    });

    it('counts the small steps of each part from its own start, so the first lines of the audio are not held back', () => {
        const { queue, downloads, updates } = setup();
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.options.onPart?.({ kinds: ['video', 'audio'], index: 0 });
        report(downloads, 100);
        downloads[0]?.options.onPart?.({ kinds: ['video', 'audio'], index: 1 });
        const before = updates.length;
        report(downloads, 0.3);
        report(downloads, 0.6);
        expect(
            updates.slice(before).map((job) => {
                return job.parts?.[1]?.percent;
            })
        ).toEqual([0.6]);
    });

    it('keeps the bar of a part between 0 and 100 whatever yt-dlp says', () => {
        const { queue, downloads } = setup();
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.options.onPart?.({ kinds: ['video', 'audio'], index: 0 });
        report(downloads, 104);
        expect(queue.list()[0]?.parts?.[0]).toEqual({ kind: 'video', percent: 100 });
    });

    it('has no bars of parts for an episode that comes whole', () => {
        const { queue, downloads } = setup();
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        report(downloads, 30);
        expect(queue.list()[0]).toMatchObject({ percent: 30, parts: null });
    });

    it('keeps the parts of each episode apart', () => {
        const { queue, downloads } = setup({ maxConcurrent: 2 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });
        downloads[0]?.options.onPart?.({ kinds: ['video', 'audio'], index: 0 });
        downloads[1]?.options.onProgress?.({ percent: 50, totalBytes: null, speed: null, eta: null });
        expect(queue.list().map((job) => {
            return job.parts;
        })).toEqual([[{ kind: 'video', percent: 0 }, { kind: 'audio', percent: 0 }], null]);
    });

    it('keeps the bars of a paused episode, and a resumed one starts again as a new job does, until its run says which part starts', async () => {
        const { queue, downloads } = setup();
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.options.onPart?.({ kinds: ['video', 'audio'], index: 0 });
        report(downloads, 100);
        downloads[0]?.options.onPart?.({ kinds: ['video', 'audio'], index: 1 });
        report(downloads, 30);
        queue.pause(1);
        downloads[0]?.finish({ status: 'cancelled' });
        await settleResults();
        expect(queue.list()[0]).toMatchObject({ status: 'paused', parts: [{ kind: 'video', percent: 100 }, { kind: 'audio', percent: 30 }] });
        queue.resume(1);
        downloads[1]?.options.onProgress?.({ percent: 80, totalBytes: null, speed: null, eta: null });
        expect(queue.list()[0]).toMatchObject({ status: 'running', percent: 80, parts: null });
        downloads[1]?.options.onPart?.({ kinds: ['video', 'audio'], index: 1 });
        downloads[1]?.options.onProgress?.({ percent: 35, totalBytes: null, speed: null, eta: null });
        expect(queue.list()[0]?.parts).toEqual([
            { kind: 'video', percent: 100 },
            { kind: 'audio', percent: 35 }
        ]);
    });
});

describe('AnimeDownloadQueue results', () => {
    it('stores the file and size of a finished episode and starts the next one', async () => {
        const { queue, db, downloads, updates, state } = setup({ maxConcurrent: 1 }, { '/a/Naruto Episode 1.mp4': 4096 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });
        const changesBefore = state.libraryChanges;
        downloads[0]?.finish(doneAt('/a/Naruto Episode 1.mp4'));
        await settleResults();

        expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: '/a/Naruto Episode 1.mp4', sizeBytes: 4096, downloadedAt: 1000 });
        expect(updates.filter((job) => {
            return job.episodeId === 1;
        }).at(-1)).toMatchObject({ status: 'done', percent: 100, speed: '', eta: '' });
        expect(downloads).toHaveLength(2);
        expect(downloads[1]?.options.episode).toBe('2');
        expect(state.libraryChanges).toBeGreaterThan(changesBefore);
    });

    it('looks for the file where ani-cli names it when yt-dlp did not say where it wrote', async () => {
        const path = join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Re_Zero', 'Episode 1', 'Re_Zero Episode 1.mp4');
        const { queue, db, downloads } = setup({}, { [path]: 10 });
        queue.enqueue({ ...REQUEST, title: 'Re:Zero', episodes: ['1'] });
        downloads[0]?.finish(doneAt(null));
        await settleResults();
        expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: path, sizeBytes: 10 });
    });

    it('fails an episode whose file is not there', async () => {
        const { queue, db, downloads, updates } = setup();
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.finish(doneAt('/a/missing.mp4'));
        await settleResults();

        const error = { code: 'UNKNOWN', raw: 'The downloaded file was not found: /a/missing.mp4' };
        expect(db.getEpisode(1)).toMatchObject({ status: 'error', error });
        expect(updates.at(-1)).toMatchObject({ status: 'error', error });
    });

    it('records the error of a failed download and moves on', async () => {
        const { queue, db, downloads, updates } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });
        const error = { code: 'NO_SOURCES' as const, raw: 'No sources found for sub!' };
        downloads[0]?.finish({ status: 'error', error });
        await settleResults();

        expect(db.getEpisode(1)).toMatchObject({ status: 'error', error });
        expect(updates.filter((job) => {
            return job.episodeId === 1;
        }).at(-1)).toMatchObject({ status: 'error', error, speed: '', eta: '' });
        expect(downloads).toHaveLength(2);
    });

    it('records a cancelled download', async () => {
        const { queue, db, downloads, updates } = setup();
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.finish({ status: 'cancelled' });
        await settleResults();

        expect(db.getEpisode(1)).toMatchObject({ status: 'cancelled', error: null });
        expect(updates.at(-1)).toMatchObject({ status: 'cancelled' });
    });

    it('fails the job when the folder cannot be created and uses the slot for the next one', async () => {
        const { queue, db, downloads, ensureDirectory, updates } = setup({ maxConcurrent: 1 });
        ensureDirectory.mockImplementationOnce(() => {
            throw new Error('EACCES: permission denied');
        });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });

        const error = { code: 'UNKNOWN', raw: 'EACCES: permission denied' };
        expect(db.getEpisode(1)).toMatchObject({ status: 'error', error });
        expect(updates.find((job) => {
            return job.status === 'error';
        })).toMatchObject({ episodeId: 1, error });
        expect(downloads).toHaveLength(1);
        expect(downloads[0]?.options.episode).toBe('2');
    });

    it('describes a folder failure that is not an Error', () => {
        const { queue, db, ensureDirectory } = setup({ maxConcurrent: 1 });
        ensureDirectory.mockImplementationOnce(() => {
            throw 'disk full';
        });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        expect(db.getEpisode(1)?.error).toEqual({ code: 'UNKNOWN', raw: 'disk full' });
    });

    it('drops a job whose anime is gone before it starts', () => {
        const { queue, db, downloads, state } = setup({ maxConcurrent: 0 });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        db.removeAnime(1);
        state.settings = { ...state.settings, maxConcurrent: 1 };

        queue.forget([]);

        expect(queue.list()).toEqual([]);
        expect(downloads).toEqual([]);
    });
});

describe('AnimeDownloadQueue.cancel', () => {
    it('asks a running download to stop, lets its result settle the job and then deletes the folder of the episode', async () => {
        const { queue, downloads, db, removeDirectory } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        queue.cancel(1);
        expect(downloads[0]?.cancel).toHaveBeenCalledTimes(1);
        expect(queue.list()[0]?.status).toBe('running');
        expect(removeDirectory).not.toHaveBeenCalled();

        downloads[0]?.finish({ status: 'cancelled' });
        await settleResults();
        expect(queue.list()[0]?.status).toBe('cancelled');
        expect(db.getEpisode(1)?.status).toBe('cancelled');
        expect(removeDirectory.mock.calls).toEqual([[join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 1')]]);
    });

    it('cancels a waiting job on the spot, deleting the folder of the episode (a partial file of an earlier run may be there)', () => {
        const { queue, downloads, db, updates, state, removeDirectory } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });
        const changesBefore = state.libraryChanges;
        queue.cancel(2);

        expect(db.getEpisode(2)).toMatchObject({ status: 'cancelled', error: null });
        expect(updates.at(-1)).toMatchObject({ episodeId: 2, status: 'cancelled' });
        expect(downloads).toHaveLength(1);
        expect(state.libraryChanges).toBe(changesBefore + 1);
        expect(removeDirectory.mock.calls).toEqual([[join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 2')]]);
    });

    it('cancels a download whose pause was asked for and has not ended yet: the run ends as cancelled and its folder goes', async () => {
        const { queue, downloads, db, updates, removeDirectory } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        queue.pause(1);
        queue.cancel(1);
        expect(downloads[0]?.cancel).toHaveBeenCalledTimes(2);

        downloads[0]?.finish({ status: 'cancelled' });
        await settleResults();
        expect(db.getEpisode(1)).toMatchObject({ status: 'cancelled', error: null });
        expect(updates.at(-1)).toMatchObject({ episodeId: 1, status: 'cancelled' });
        expect(removeDirectory.mock.calls).toEqual([[join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 1')]]);
    });

    it('ignores a job that is unknown or already over', async () => {
        const { queue, downloads, updates } = setup({ maxConcurrent: 1 }, { '/a/1.mp4': 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.finish(doneAt('/a/1.mp4'));
        await settleResults();
        const count = updates.length;

        queue.cancel(1);
        queue.cancel(99);

        expect(updates).toHaveLength(count);
        expect(downloads[0]?.cancel).not.toHaveBeenCalled();
    });

    it('ignores a job that failed or was cancelled already', async () => {
        const { queue, downloads, removeDirectory } = setup({ maxConcurrent: 2 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });
        downloads[0]?.finish({ status: 'error', error: { code: 'NO_SOURCES', raw: 'Blocked.' } });
        queue.cancel(2);
        downloads[1]?.finish({ status: 'cancelled' });
        await settleResults();
        removeDirectory.mockClear();

        queue.cancel(1);
        queue.cancel(2);

        expect(removeDirectory).not.toHaveBeenCalled();
        expect(queue.list().map((job) => {
            return job.status;
        })).toEqual(['error', 'cancelled']);
    });
});

describe('AnimeDownloadQueue.retry', () => {
    it('queues an episode that failed again', async () => {
        const { queue, downloads, db } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.finish({ status: 'error', error: { code: 'NO_SOURCES', raw: 'Blocked by cloudflare.' } });
        await settleResults();

        queue.retry(1);

        expect(downloads).toHaveLength(2);
        expect(downloads[1]?.options.episode).toBe('1');
        expect(db.getEpisode(1)).toMatchObject({ status: 'downloading', error: null });
    });

    it('also works for an episode left unfinished by an earlier run of the app', () => {
        const { queue, downloads, db } = setup();
        const anime = db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1 });
        const episode = db.ensureEpisode(anime.id, '7');
        db.failInterrupted();

        queue.retry(episode.id);

        expect(downloads).toHaveLength(1);
        expect(downloads[0]?.options).toMatchObject({ query: 'naruto', index: 1, episode: '7' });
    });

    it('does nothing for an episode that is downloaded, already active or does not exist', async () => {
        const { queue, downloads } = setup({ maxConcurrent: 1 }, { '/a/1.mp4': 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });
        downloads[0]?.finish(doneAt('/a/1.mp4'));
        await settleResults();
        const started = downloads.length;

        queue.retry(1);
        queue.retry(2);
        queue.retry(99);

        expect(downloads).toHaveLength(started);
    });
});

describe('AnimeDownloadQueue.redownload', () => {
    const FILE = '/a/Naruto Episode 1.mp4';

    async function withDownloadedEpisode(maxConcurrent = 1) {
        const context = setup({ maxConcurrent }, { [FILE]: 4096 });
        context.queue.enqueue({ ...REQUEST, episodes: ['1'] });
        context.downloads[0]?.finish(doneAt(FILE));
        await settleResults();
        return context;
    }

    it('queues a downloaded episode again when its file is not on the disk, and downloads it with the same options as the first time', async () => {
        const { queue, downloads, db, state } = await withDownloadedEpisode();
        delete state.files[FILE];
        const libraryChanges = state.libraryChanges;

        queue.redownload(1);

        expect(downloads).toHaveLength(2);
        expect(downloads[1]?.options).toMatchObject({
            query: 'naruto',
            index: 2,
            episode: '1',
            quality: DEFAULT_SETTINGS.animeQuality,
            downloadDir: downloads[0]?.options.downloadDir
        });
        expect(db.getEpisode(1)).toMatchObject({ status: 'downloading', filePath: null, sizeBytes: null, error: null });
        expect(queue.list()).toEqual([{ episodeId: 1, animeId: 1, animeTitle: 'Naruto', episode: '1', status: 'running', percent: 0, speed: '', eta: '', error: null, parts: null }]);
        expect(state.libraryChanges).toBe(libraryChanges + 2);
    });

    it('puts the episode back in the library as downloaded once the new download finishes', async () => {
        const { queue, downloads, db, state } = await withDownloadedEpisode();
        delete state.files[FILE];
        queue.redownload(1);
        state.files[FILE] = 8192;

        downloads[1]?.finish(doneAt(FILE));
        await settleResults();

        expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: FILE, sizeBytes: 8192 });
        expect(queue.list()).toEqual([]);
        expect(state.downloaded).toEqual([1, 1]);
    });

    it('keeps the watched mark of the episode', async () => {
        const { queue, db, state } = await withDownloadedEpisode();
        db.saveProgress({ episodeId: 1, positionSeconds: 90, durationSeconds: 1420, watched: true });
        delete state.files[FILE];

        queue.redownload(1);

        expect(db.getEpisode(1)).toMatchObject({ watched: true, positionSeconds: 90, durationSeconds: 1420 });
    });

    it('queues an episode whose record has no file at all', async () => {
        const { queue, downloads, db } = await withDownloadedEpisode();
        const record = db.getEpisode(1) as NonNullable<ReturnType<AnimeDb['getEpisode']>>;
        vi.spyOn(db, 'getEpisode').mockReturnValueOnce({ ...record, filePath: null });

        queue.redownload(1);

        expect(downloads).toHaveLength(2);
        expect(downloads[1]?.options.episode).toBe('1');
        expect(db.getEpisode(1)).toMatchObject({ status: 'downloading', filePath: null });
    });

    it('does nothing for an episode whose file is on the disk, so a video that exists is never downloaded over', async () => {
        const { queue, downloads, db, updates, state } = await withDownloadedEpisode();
        const libraryChanges = state.libraryChanges;
        const updatesBefore = updates.length;

        queue.redownload(1);

        expect(downloads).toHaveLength(1);
        expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: FILE, sizeBytes: 4096 });
        expect(updates).toHaveLength(updatesBefore);
        expect(state.libraryChanges).toBe(libraryChanges);
    });

    it('does nothing for an episode that is not downloaded', async () => {
        const { queue, downloads, db, state } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });
        downloads[0]?.finish({ status: 'error', error: { code: 'NO_SOURCES', raw: 'Blocked by cloudflare.' } });
        await settleResults();
        const libraryChanges = state.libraryChanges;

        queue.redownload(1);
        queue.redownload(2);

        expect(downloads).toHaveLength(2);
        expect(db.getEpisode(1)).toMatchObject({ status: 'error', error: { code: 'NO_SOURCES', raw: 'Blocked by cloudflare.' } });
        expect(db.getEpisode(2)).toMatchObject({ status: 'downloading' });
        expect(state.libraryChanges).toBe(libraryChanges);
    });

    it('does nothing for an episode that does not exist', async () => {
        const { queue, downloads, state } = await withDownloadedEpisode();
        delete state.files[FILE];

        queue.redownload(99);

        expect(downloads).toHaveLength(1);
    });

    it('does nothing for an episode whose anime is gone', async () => {
        const { queue, downloads, db, state } = await withDownloadedEpisode();
        delete state.files[FILE];
        vi.spyOn(db, 'getAnime').mockReturnValueOnce(null);

        queue.redownload(1);

        expect(downloads).toHaveLength(1);
        expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: FILE });
    });

    it('queues the episode only once when it is asked twice', async () => {
        const { queue, downloads, state } = await withDownloadedEpisode();
        delete state.files[FILE];

        queue.redownload(1);
        queue.redownload(1);

        expect(downloads).toHaveLength(2);
        expect(queue.list()).toHaveLength(1);
    });

    it('waits its turn when the downloads that are allowed at once are running', async () => {
        const { queue, downloads, db, state } = setup({ maxConcurrent: 1 }, { [FILE]: 4096 });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.finish(doneAt(FILE));
        await settleResults();
        queue.enqueue({ ...REQUEST, episodes: ['2'] });
        delete state.files[FILE];

        queue.redownload(1);

        expect(downloads).toHaveLength(2);
        expect(db.getEpisode(1)).toMatchObject({ status: 'queued', filePath: null });
        expect(queue.list().map((job) => {
            return [job.episode, job.status];
        })).toEqual([['2', 'running'], ['1', 'queued']]);

        downloads[1]?.finish({ status: 'error', error: { code: 'NO_SOURCES', raw: 'Nothing.' } });
        await settleResults();

        expect(downloads).toHaveLength(3);
        expect(downloads[2]?.options.episode).toBe('1');
    });

    it('starts nothing in a held queue until everything goes on', async () => {
        const { queue, downloads, state } = await withDownloadedEpisode();
        delete state.files[FILE];
        queue.pauseAll();

        queue.redownload(1);

        expect(downloads).toHaveLength(1);
        expect(queue.list()).toMatchObject([{ episodeId: 1, status: 'queued' }]);

        queue.resumeAll();

        expect(downloads).toHaveLength(2);
        expect(downloads[1]?.options.episode).toBe('1');
    });
});

async function flushAudioCheck(): Promise<void> {
    await new Promise((resolve) => {
        setImmediate(resolve);
    });
}

describe('AnimeDownloadQueue looks at the audio of a video that was downloaded', () => {
    const FILE = '/a/Naruto Episode 1.mp4';

    async function download(audio: Parameters<typeof setup>[4]) {
        const context = setup({ maxConcurrent: 1 }, { [FILE]: 4096 }, {}, { provider: null }, audio);
        context.queue.enqueue({ ...REQUEST, episodes: ['1'] });
        context.downloads[0]?.finish(doneAt(FILE));
        await settleResults();
        await flushAudioCheck();
        return context;
    }

    it('marks the episode when the video has no audio, and tells the screen the library changed', async () => {
        const { db, hasAudio, state } = await download({ hasAudio: async () => { return false; } });

        expect(hasAudio).toHaveBeenCalledTimes(1);
        expect(hasAudio).toHaveBeenCalledWith(FILE);
        expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: FILE, noAudio: true });
        expect(db.episodesToCheckAudio()).toEqual([]);
        // Queueing, starting and finishing the download, and then what the check found.
        expect(state.libraryChanges).toBe(4);
    });

    it('records that the video has audio, without marking the episode', async () => {
        const { db, hasAudio } = await download({ hasAudio: async () => { return true; } });

        expect(hasAudio).toHaveBeenCalledWith(FILE);
        expect(db.getEpisode(1)).toMatchObject({ status: 'done', noAudio: false });
        expect(db.episodesToCheckAudio()).toEqual([]);
    });

    it('leaves the episode to be looked at later when the check could not tell', async () => {
        const { db, state } = await download({ hasAudio: async () => { return null; } });

        expect(db.getEpisode(1)).toMatchObject({ status: 'done', noAudio: false });
        expect(db.episodesToCheckAudio()).toMatchObject([{ id: 1 }]);
        expect(state.libraryChanges).toBe(3);
    });

    it('leaves the episode as it is when the check fails', async () => {
        const { db, queue, state } = await download({
            hasAudio: async () => {
                throw new Error('ffmpeg is not there');
            }
        });

        expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: FILE, noAudio: false });
        expect(db.episodesToCheckAudio()).toMatchObject([{ id: 1 }]);
        expect(queue.list()).toEqual([]);
        expect(state.libraryChanges).toBe(3);
    });

    it('does not look at anything when the queue was not given a way to', async () => {
        const { db, hasAudio } = await download({});

        expect(hasAudio).toBeUndefined();
        expect(db.getEpisode(1)).toMatchObject({ status: 'done', noAudio: false });
        expect(db.episodesToCheckAudio()).toMatchObject([{ id: 1 }]);
    });

    it('does not make the episode wait for the check: it is in the library at once and is marked when the check ends', async () => {
        let answer: (hasAudio: boolean) => void = () => {
            return undefined;
        };
        const pending = new Promise<boolean>((resolve) => {
            answer = resolve;
        });
        const { db, queue } = await download({ hasAudio: () => { return pending; } });

        expect(db.getEpisode(1)).toMatchObject({ status: 'done', noAudio: false });
        expect(queue.list()).toEqual([]);

        answer(false);
        await flushAudioCheck();

        expect(db.getEpisode(1)).toMatchObject({ status: 'done', noAudio: true });
    });

    it('does not look at a download that failed, or whose file was not found', async () => {
        const { queue, downloads, hasAudio } = setup({ maxConcurrent: 1 }, {}, {}, { provider: null }, { hasAudio: async () => { return false; } });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });
        downloads[0]?.finish({ status: 'error', error: { code: 'NO_SOURCES', raw: 'Blocked by cloudflare.' } });
        await settleResults();
        downloads[1]?.finish(doneAt('/a/missing.mp4'));
        await settleResults();
        await flushAudioCheck();

        expect(hasAudio).not.toHaveBeenCalled();
    });
});

describe('AnimeDownloadQueue repairs a video that was hidden behind a picture', () => {
    const FILE = '/a/Naruto Episode 1.mp4';

    async function download(options: Parameters<typeof setup>[4]) {
        const context = setup({ maxConcurrent: 1 }, { [FILE]: 4096 }, {}, { provider: null }, options);
        context.queue.enqueue({ ...REQUEST, episodes: ['1'] });
        context.downloads[0]?.finish(doneAt(FILE));
        await settleResults();
        await flushAudioCheck();
        await flushAudioCheck();
        return context;
    }

    it('repairs the file that was downloaded, saves its new size and tells the screen the library changed', async () => {
        const { db, repairVideo, state } = await download({ repairVideo: async () => { return { status: 'repaired', sizeBytes: 3000 }; } });

        expect(repairVideo).toHaveBeenCalledTimes(1);
        expect(repairVideo).toHaveBeenCalledWith(FILE);
        expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: FILE, sizeBytes: 3000 });
        // Queueing, starting and finishing the download, and then the new size.
        expect(state.libraryChanges).toBe(4);
    });

    it('looks at the audio of the file after the repair, and not before: the file the check sees is the repaired one', async () => {
        const order: string[] = [];
        const { db } = await download({
            repairVideo: async () => {
                order.push('repair start');
                await flushAudioCheck();
                order.push('repair end');
                return { status: 'repaired', sizeBytes: 3000 };
            },
            hasAudio: async () => {
                order.push('audio');
                return true;
            }
        });

        expect(order).toEqual(['repair start', 'repair end', 'audio']);
        expect(db.getEpisode(1)).toMatchObject({ sizeBytes: 3000, noAudio: false });
    });

    it.each([['needs nothing', { status: 'not-needed' }], ['could not be repaired', { status: 'failed' }]] as const)('leaves the episode as it was when the video %s, and still looks at its audio', async (_name, result) => {
        const { db, hasAudio, state } = await download({
            repairVideo: async () => {
                return result;
            },
            hasAudio: async () => {
                return false;
            }
        });

        expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: FILE, sizeBytes: 4096, noAudio: true });
        expect(hasAudio).toHaveBeenCalledWith(FILE);
        // The same three changes as with no repair, and what the check found.
        expect(state.libraryChanges).toBe(4);
    });

    it('leaves the episode as it is when the repair throws, and still looks at its audio', async () => {
        const { db, hasAudio, queue } = await download({
            repairVideo: async () => {
                throw new Error('ffmpeg is not there');
            },
            hasAudio: async () => {
                return true;
            }
        });

        expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: FILE, sizeBytes: 4096, noAudio: false });
        expect(hasAudio).toHaveBeenCalledTimes(1);
        expect(queue.list()).toEqual([]);
    });

    it('does not repair anything when the queue was not given a way to', async () => {
        const { db, repairVideo } = await download({ hasAudio: async () => { return true; } });

        expect(repairVideo).toBeUndefined();
        expect(db.getEpisode(1)).toMatchObject({ status: 'done', sizeBytes: 4096 });
    });

    it('does not make the episode wait for the repair: it is in the library at once and has its new size when the repair ends', async () => {
        let finish: (result: RepairResult) => void = () => {
            return undefined;
        };
        const pending = new Promise<RepairResult>((resolve) => {
            finish = resolve;
        });
        const { db, queue } = await download({ repairVideo: () => { return pending; } });

        expect(db.getEpisode(1)).toMatchObject({ status: 'done', sizeBytes: 4096 });
        expect(queue.list()).toEqual([]);

        finish({ status: 'repaired', sizeBytes: 3000 });
        await flushAudioCheck();

        expect(db.getEpisode(1)).toMatchObject({ status: 'done', sizeBytes: 3000 });
    });

    it('does not repair a download that failed, or whose file was not found', async () => {
        const { queue, downloads, repairVideo } = setup({ maxConcurrent: 1 }, {}, {}, { provider: null }, { repairVideo: async () => { return { status: 'repaired', sizeBytes: 1 }; } });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });
        downloads[0]?.finish({ status: 'error', error: { code: 'NO_SOURCES', raw: 'Blocked by cloudflare.' } });
        await settleResults();
        downloads[1]?.finish(doneAt('/a/missing.mp4'));
        await settleResults();
        await flushAudioCheck();

        expect(repairVideo).not.toHaveBeenCalled();
    });
});

describe('AnimeDownloadQueue.redownload of an episode whose video has no audio', () => {
    const FILE = '/a/Naruto Episode 1.mp4';

    async function withSilentEpisode(audio: Parameters<typeof setup>[4] = {}, maxConcurrent = 1) {
        const context = setup({ maxConcurrent }, { [FILE]: 4096 }, {}, { provider: null }, audio);
        context.queue.enqueue({ ...REQUEST, episodes: ['1'] });
        context.downloads[0]?.finish(doneAt(FILE));
        await settleResults();
        context.db.markAudioChecked(1, FILE, false);
        return context;
    }

    it('deletes the video, and only the video, and downloads the episode again', async () => {
        const { queue, downloads, db, removeFile, removeDirectory, state } = await withSilentEpisode();
        const libraryChanges = state.libraryChanges;

        queue.redownload(1);

        expect(removeFile).toHaveBeenCalledTimes(1);
        expect(removeFile).toHaveBeenCalledWith(FILE);
        expect(removeDirectory).not.toHaveBeenCalled();
        expect(downloads).toHaveLength(2);
        expect(downloads[1]?.options).toMatchObject({ query: 'naruto', index: 2, episode: '1' });
        expect(db.getEpisode(1)).toMatchObject({ status: 'downloading', filePath: null, sizeBytes: null, noAudio: false });
        expect(state.libraryChanges).toBe(libraryChanges + 2);
    });

    it('looks at the new video when it finishes', async () => {
        const { queue, downloads, db, state } = await withSilentEpisode({ hasAudio: async () => { return true; } });
        queue.redownload(1);
        // The new video is on the disk when the download ends.
        state.files[FILE] = 8192;

        downloads[1]?.finish(doneAt(FILE));
        await settleResults();
        await flushAudioCheck();

        expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: FILE, sizeBytes: 8192, noAudio: false });
        expect(db.episodesToCheckAudio()).toEqual([]);
    });

    it('marks the episode again, and keeps offering to download it again, when the source gives the same video with no audio', async () => {
        const { queue, downloads, db, state } = await withSilentEpisode({ hasAudio: async () => { return false; } });
        queue.redownload(1);
        state.files[FILE] = 4096;

        downloads[1]?.finish(doneAt(FILE));
        await settleResults();
        await flushAudioCheck();

        // The new video was looked at, found to have no audio again, and the episode can be downloaded again once the source is fixed.
        expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: FILE, noAudio: true });
        queue.redownload(1);
        expect(downloads).toHaveLength(3);
        expect(db.getEpisode(1)).toMatchObject({ status: 'downloading', filePath: null, noAudio: false });
    });

    it('leaves the video as it is when it cannot be deleted', async () => {
        const { queue, downloads, db, state } = await withSilentEpisode({
            removeFile: () => {
                throw new Error('EACCES: permission denied');
            }
        });
        const libraryChanges = state.libraryChanges;

        queue.redownload(1);

        expect(downloads).toHaveLength(1);
        expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: FILE, noAudio: true });
        expect(state.libraryChanges).toBe(libraryChanges);
    });

    it('leaves the video as it is when the queue has no way to delete a file', async () => {
        const { queue, downloads, db, removeFile } = await withSilentEpisode({ withoutRemoveFile: true });

        queue.redownload(1);

        expect(removeFile).not.toHaveBeenCalled();
        expect(downloads).toHaveLength(1);
        expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: FILE, noAudio: true });
    });

    it('does not delete a video that was not found to have no audio', async () => {
        const { queue, downloads, db, removeFile } = await withSilentEpisode();
        db.markForRedownload(1);
        db.markDone(1, FILE, 4096);
        db.markAudioChecked(1, FILE, true);

        queue.redownload(1);

        expect(removeFile).not.toHaveBeenCalled();
        expect(downloads).toHaveLength(1);
        expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: FILE, noAudio: false });
    });

    it('does not delete anything when the file is gone already, and downloads it again', async () => {
        const { queue, downloads, db, removeFile, state } = await withSilentEpisode();
        delete state.files[FILE];

        queue.redownload(1);

        expect(removeFile).not.toHaveBeenCalled();
        expect(downloads).toHaveLength(2);
        expect(db.getEpisode(1)).toMatchObject({ status: 'downloading', filePath: null, noAudio: false });
    });
});

describe('AnimeDownloadQueue.redownloadEpisodes', () => {
    const SILENT = '/a/Naruto Episode 1.mp4';
    const GONE = '/a/Naruto Episode 2.mp4';
    const FINE = '/a/Naruto Episode 3.mp4';

    it('queues again the ones whose file is gone or has no audio, and leaves the others as they are', async () => {
        const { queue, downloads, db, removeFile, state } = setup({ maxConcurrent: 5 }, { [SILENT]: 1, [GONE]: 2, [FINE]: 3 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2', '3'] });
        downloads[0]?.finish(doneAt(SILENT));
        downloads[1]?.finish(doneAt(GONE));
        downloads[2]?.finish(doneAt(FINE));
        await settleResults();
        db.markAudioChecked(1, SILENT, false);
        db.markAudioChecked(3, FINE, true);
        delete state.files[GONE];

        queue.redownloadEpisodes([1, 2, 3, 99]);

        expect(removeFile.mock.calls).toEqual([[SILENT]]);
        expect(downloads.slice(3).map((download) => {
            return download.options.episode;
        })).toEqual(['1', '2']);
        expect(db.getEpisode(1)).toMatchObject({ status: 'downloading', filePath: null });
        expect(db.getEpisode(2)).toMatchObject({ status: 'downloading', filePath: null });
        expect(db.getEpisode(3)).toMatchObject({ status: 'done', filePath: FINE, noAudio: false });
    });

    it('does nothing for an empty list', async () => {
        const { queue, downloads, state } = setup({ maxConcurrent: 1 });
        const libraryChanges = state.libraryChanges;

        queue.redownloadEpisodes([]);

        expect(downloads).toEqual([]);
        expect(state.libraryChanges).toBe(libraryChanges);
    });
});

describe('AnimeDownloadQueue.clearFinished', () => {
    it('removes the jobs that are over and keeps the ones that are not', async () => {
        const { queue, downloads } = setup({ maxConcurrent: 1 }, { '/a/1.mp4': 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2', '3'] });
        downloads[0]?.finish(doneAt('/a/1.mp4'));
        await settleResults();
        queue.cancel(3);

        queue.clearFinished();

        expect(
            queue.list().map((job) => {
                return [job.episode, job.status];
            })
        ).toEqual([['2', 'running']]);
    });
});

describe('AnimeDownloadQueue.forget', () => {
    it('stops what is running, drops the job, and deletes the folder and starts the next once the run has ended', async () => {
        const { queue, downloads, db, removeDirectory } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });

        queue.forget([1]);
        db.removeEpisode(1);

        expect(downloads[0]?.cancel).toHaveBeenCalledTimes(1);
        expect(
            queue.list().map((job) => {
                return job.episode;
            })
        ).toEqual(['2']);
        // The run could still write in the folder, and it still holds its place.
        expect(removeDirectory).not.toHaveBeenCalled();
        expect(downloads).toHaveLength(1);
        expect(queue.hasRunsToEnd()).toBe(true);

        downloads[0]?.finish({ status: 'cancelled' });
        await settleResults();
        expect(removeDirectory.mock.calls).toEqual([[join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 1')]]);
        expect(downloads.map((download) => {
            return download.options.episode;
        })).toEqual(['1', '2']);
        expect(queue.list()).toHaveLength(1);
    });

    it('deletes the folder of a forgotten episode whose run got to the end anyway: it is not in the library', async () => {
        const { queue, downloads, db, removeDirectory } = setup({ maxConcurrent: 1 }, { '/a/1.mp4': 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        queue.forget([1]);
        db.removeEpisode(1);
        downloads[0]?.finish(doneAt('/a/1.mp4'));
        await settleResults();
        expect(removeDirectory.mock.calls).toEqual([[join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 1')]]);
        expect(db.getEpisode(1)).toBeNull();
    });

    it('deletes at once the folder of an episode that waits, failed or was cancelled, and not of one that is downloaded', async () => {
        const { queue, downloads, db, removeDirectory } = setup({ maxConcurrent: 1 }, { '/a/4.mp4': 1 });
        const anime = queue.enqueue({ ...REQUEST, episodes: ['4', '1', '2', '3', '5'] })!;
        downloads[0]?.finish(doneAt('/a/4.mp4'));
        await settleResults();
        downloads[1]?.finish({ status: 'error', error: { code: 'NO_SOURCES', raw: 'Blocked.' } });
        await settleResults();
        queue.cancel(db.ensureEpisode(anime.id, '2').id);
        downloads[2]?.finish({ status: 'cancelled' });
        await settleResults();
        // Episode 3 runs now and episode 5 waits.
        removeDirectory.mockClear();
        const ids = ['4', '1', '2', '5'].map((number) => {
            return db.ensureEpisode(anime.id, number).id;
        });

        queue.forget(ids);

        expect(removeDirectory.mock.calls).toEqual([[join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 1')], [join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 2')], [join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 5')]]);
        expect(queue.list().map((job) => {
            return [job.episode, job.status];
        })).toEqual([['3', 'running']]);
        expect(downloads.at(-1)?.options.episode).toBe('3');
    });

    it('is harmless for an episode without a job', () => {
        const { queue } = setup();
        expect(() => {
            queue.forget([5]);
        }).not.toThrow();
    });
});

describe('AnimeDownloadQueue.shutdown', () => {
    it('cancels every running download', () => {
        const { queue, downloads } = setup({ maxConcurrent: 2 });
        queue.enqueue(REQUEST);
        queue.shutdown();
        expect(downloads[0]?.cancel).toHaveBeenCalledTimes(1);
        expect(downloads[1]?.cancel).toHaveBeenCalledTimes(1);
    });

    it('does nothing when nothing runs', () => {
        const { queue } = setup();
        expect(() => {
            queue.shutdown();
        }).not.toThrow();
        expect(queue.pendingCount()).toBe(0);
    });
});

describe('AnimeDownloadQueue folders and metadata', () => {
    const ANIME_FOLDER = join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto');

    function withDownloaded(videoPath: string, directories: string[]) {
        const context = setup({}, {}, { directories });
        const anime = context.db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 2 });
        context.db.markDone(context.db.ensureEpisode(anime.id, '1').id, videoPath, 10);
        return { ...context, anime };
    }

    it('tells that an episode was downloaded once it is in the library, and not before', async () => {
        const { queue, downloads, state } = setup({ maxConcurrent: 1 }, { '/a/Naruto Episode 1.mp4': 4096 });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        expect(state.downloaded).toEqual([]);
        downloads[0]?.finish(doneAt('/a/Naruto Episode 1.mp4'));
        await settleResults();
        expect(state.downloaded).toEqual([1]);
    });

    it('does not tell it for an episode that failed because its file is not there', async () => {
        const { queue, downloads, state } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.finish(doneAt('/a/missing.mp4'));
        await settleResults();
        expect(state.downloaded).toEqual([]);
    });

    it('puts a new episode with the others when the folder of the anime was renamed or moved', () => {
        const renamed = join('/media', 'My Naruto');
        const { queue, downloads, ensureDirectory } = withDownloaded(join(renamed, 'Episode 1', 'Naruto Episode 1.mp4'), [renamed]);
        queue.enqueue({ ...REQUEST, episodes: ['2'] });
        expect(downloads[0]?.options.downloadDir).toBe(join(renamed, 'Episode 2'));
        expect(ensureDirectory).toHaveBeenCalledWith(join(renamed, 'Episode 2'));
    });

    it('goes back to the folder named after the anime when the one it had is gone', () => {
        const { queue, downloads } = withDownloaded(join('/media', 'My Naruto', 'Episode 1', 'Naruto Episode 1.mp4'), []);
        queue.enqueue({ ...REQUEST, episodes: ['2'] });
        expect(downloads[0]?.options.downloadDir).toBe(join(ANIME_FOLDER, 'Episode 2'));
    });

    it('does not take the folder of a video that is not in the folder of an episode for the folder of the anime', () => {
        const { queue, downloads } = withDownloaded(join('/media', 'Videos', 'Naruto Episode 1.mp4'), [join('/media', 'Videos')]);
        queue.enqueue({ ...REQUEST, episodes: ['2'] });
        expect(downloads[0]?.options.downloadDir).toBe(join(ANIME_FOLDER, 'Episode 2'));
    });

    it('ignores episodes that are not downloaded when it looks for the folder of the anime', () => {
        const { queue, downloads, db, anime } = withDownloaded(join('/media', 'My Naruto', 'Episode 1', 'Naruto Episode 1.mp4'), [join('/media', 'My Naruto')]);
        db.markFailed(db.ensureEpisode(anime.id, '1').id, 'error', { code: 'UNKNOWN', raw: 'x' });
        queue.enqueue({ ...REQUEST, episodes: ['2'] });
        expect(downloads[0]?.options.downloadDir).toBe(join(ANIME_FOLDER, 'Episode 2'));
    });
});

describe('AnimeDownloadQueue series', () => {
    const SERIES_REQUEST: AnimeDownloadRequest = { title: 'Frieren Season 2', query: 'frieren', index: 2, episodes: ['1', '2'], series: 'Frieren', season: 2 };

    it('saves the series and the season with the anime', () => {
        const { queue, db } = setup();
        queue.enqueue(SERIES_REQUEST);
        expect(db.getAnime(1)).toMatchObject({ title: 'Frieren Season 2', series: 'Frieren', season: 2 });
    });

    it('downloads into the folder of the season, inside the folder of the series', () => {
        const { queue, downloads, ensureDirectory } = setup({ maxConcurrent: 2 });
        queue.enqueue(SERIES_REQUEST);
        expect(downloads[0]?.options.downloadDir).toBe(join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Frieren', 'Season 2', 'Episode 1'));
        expect(downloads[1]?.options.downloadDir).toBe(join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Frieren', 'Season 2', 'Episode 2'));
        expect(ensureDirectory).toHaveBeenNthCalledWith(1, join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Frieren', 'Season 2', 'Episode 1'));
    });

    it('joins the series with the spelling the library already has, so the folders are the same', () => {
        const { queue, downloads, db } = setup({ maxConcurrent: 2 });
        queue.enqueue({ ...SERIES_REQUEST, title: 'Frieren', season: 1, episodes: ['1'], index: 1 });
        queue.enqueue({ ...SERIES_REQUEST, series: ' FRIEREN ', episodes: ['1'] });
        expect(db.getAnime(2)).toMatchObject({ series: 'Frieren', season: 2 });
        expect(downloads[1]?.options.downloadDir).toBe(join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Frieren', 'Season 2', 'Episode 1'));
    });

    it('saves the name the anime is shown with, and keeps it when a later request does not say one', () => {
        const { queue, db } = setup();
        queue.enqueue({ ...SERIES_REQUEST, seasonName: 'The Second One', episodes: ['1'] });
        expect(db.getAnime(1)).toMatchObject({ season: 2, seasonName: 'The Second One' });
        queue.enqueue({ ...SERIES_REQUEST, episodes: ['2'] });
        expect(db.getAnime(1)?.seasonName).toBe('The Second One');
        queue.enqueue({ ...SERIES_REQUEST, seasonName: null, episodes: ['3'] });
        expect(db.getAnime(1)?.seasonName).toBeNull();
    });

    it('puts two seasons of a series side by side', () => {
        const { queue, downloads } = setup({ maxConcurrent: 2 });
        queue.enqueue({ ...SERIES_REQUEST, title: 'Frieren', season: 1, episodes: ['1'], index: 1 });
        queue.enqueue({ ...SERIES_REQUEST, episodes: ['1'] });
        expect(downloads[0]?.options.downloadDir).toBe(join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Frieren', 'Season 1', 'Episode 1'));
        expect(downloads[1]?.options.downloadDir).toBe(join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Frieren', 'Season 2', 'Episode 1'));
    });

    it('uses the folder of the series of the settings and the rules of the system the files are on', () => {
        const { queue, downloads } = setup({ animeDownloadDir: 'D:\\Anime' }, {}, { platform: 'win32', downloads: 'C:\\Users\\me\\Downloads' });
        queue.enqueue({ ...SERIES_REQUEST, series: 'Re:Zero', episodes: ['1'] });
        expect(downloads[0]?.options.downloadDir).toBe('D:\\Anime\\Re_Zero\\Season 2\\Episode 1');
    });

    it('keeps an anime that is not in a series in a folder of its own, as before', () => {
        const { queue, downloads } = setup();
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        expect(downloads[0]?.options.downloadDir).toBe(join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 1'));
    });

    it('leaves the series of an anime as it is when the request does not say one', () => {
        const { queue, db } = setup();
        queue.enqueue({ ...SERIES_REQUEST, episodes: ['1'] });
        queue.enqueue({ ...SERIES_REQUEST, series: undefined, season: undefined, episodes: ['2'] });
        expect(db.getAnime(1)).toMatchObject({ series: 'Frieren', season: 2 });
    });

    it('keeps downloading into the folder an anime already has, even after it was joined to a series', () => {
        const { queue, downloads, db } = setup({}, {}, { directories: [join('/media', 'My Naruto')] });
        const anime = db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 2 });
        db.markDone(db.ensureEpisode(anime.id, '1').id, join('/media', 'My Naruto', 'Episode 1', 'Naruto Episode 1.mp4'), 10);
        queue.enqueue({ ...REQUEST, series: 'Naruto Series', season: 1, episodes: ['2'] });
        expect(downloads[0]?.options.downloadDir).toBe(join('/media', 'My Naruto', 'Episode 2'));
    });

    it('does not join the anime when the season is taken by another anime of the series', () => {
        const { queue, db } = setup();
        queue.enqueue({ ...SERIES_REQUEST, title: 'Frieren', season: 2, episodes: ['1'] });
        queue.enqueue({ ...SERIES_REQUEST, episodes: ['1'] });
        expect(db.getAnime(2)).toMatchObject({ title: 'Frieren Season 2', series: null, season: null });
    });
});

describe('AnimeDownloadQueue pause and resume', () => {
    async function pausedEpisode(settings: Partial<Settings> = { maxConcurrent: 1 }) {
        const result = setup(settings);
        result.queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });
        result.downloads[0]?.options.onProgress?.({ percent: 40, totalBytes: 100, speed: '1MiB/s', eta: '00:05' });
        result.queue.pause(1);
        result.downloads[0]?.finish({ status: 'cancelled' });
        await settleResults();
        return result;
    }

    describe('pause', () => {
        it('asks the running download to stop, and lets its result settle the job', () => {
            const { queue, downloads } = setup({ maxConcurrent: 1 });
            queue.enqueue({ ...REQUEST, episodes: ['1'] });

            queue.pause(1);

            expect(downloads[0]?.cancel).toHaveBeenCalledTimes(1);
            expect(queue.list()[0]?.status).toBe('running');
        });

        it('leaves the episode paused, in the job and in the library, without speed or time', async () => {
            const { queue, db } = await pausedEpisode();

            expect(queue.list()[0]).toMatchObject({ episodeId: 1, status: 'paused', percent: 40, speed: '', eta: '', error: null });
            expect(db.getEpisode(1)).toMatchObject({ status: 'paused', error: null });
        });

        it('tells the screen that the job is paused, and that the library changed', async () => {
            const result = setup({ maxConcurrent: 1 });
            result.queue.enqueue({ ...REQUEST, episodes: ['1'] });
            const changes = result.state.libraryChanges;

            result.queue.pause(1);
            result.downloads[0]?.finish({ status: 'cancelled' });
            await settleResults();

            expect(result.updates.at(-1)).toMatchObject({ episodeId: 1, status: 'paused' });
            expect(result.state.libraryChanges).toBeGreaterThan(changes);
        });

        it('frees its place for the next episode', async () => {
            const { downloads } = await pausedEpisode();

            expect(downloads).toHaveLength(2);
            expect(downloads[1]?.options.episode).toBe('2');
        });

        it('does not count as a pending download', async () => {
            const { queue } = await pausedEpisode({ maxConcurrent: 2 });

            // Episode 2 started and is still going on; the paused one is not counted.
            expect(queue.pendingCount()).toBe(1);
        });

        it('does nothing for an episode that is waiting, over, paused or unknown', async () => {
            const { queue, downloads, updates } = setup({ maxConcurrent: 1 }, { '/a/1.mp4': 1 });
            queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });
            queue.pause(2);
            expect(downloads[0]?.cancel).not.toHaveBeenCalled();
            downloads[0]?.finish(doneAt('/a/1.mp4'));
            await settleResults();
            const count = updates.length;

            queue.pause(1);
            queue.pause(99);

            expect(updates).toHaveLength(count);
            expect(downloads[0]?.cancel).not.toHaveBeenCalled();
            expect(queue.list()[0]?.status).toBe('running');
        });

        it('ends as done when the download finished before the pause could end it', async () => {
            const { queue, downloads, db } = setup({ maxConcurrent: 1 }, { '/a/1.mp4': 10 });
            queue.enqueue({ ...REQUEST, episodes: ['1'] });
            queue.pause(1);

            downloads[0]?.finish(doneAt('/a/1.mp4'));
            await settleResults();

            expect(queue.list()).toEqual([]);
            expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: '/a/1.mp4' });
        });

        it('does not turn a later failure into a pause', async () => {
            const { queue, downloads, db } = setup({ maxConcurrent: 1 });
            queue.enqueue({ ...REQUEST, episodes: ['1'] });
            queue.pause(1);
            downloads[0]?.finish({ status: 'error', error: { code: 'NO_SOURCES', raw: 'offline' } });
            await settleResults();

            expect(queue.list()[0]?.status).toBe('error');
            expect(db.getEpisode(1)).toMatchObject({ status: 'error', error: { code: 'NO_SOURCES', raw: 'offline' } });
        });

        it('does not turn a cancel after a failed pause into a pause', async () => {
            const { queue, downloads } = setup({ maxConcurrent: 1 });
            queue.enqueue({ ...REQUEST, episodes: ['1'] });
            queue.pause(1);
            downloads[0]?.finish({ status: 'error', error: { code: 'NO_SOURCES', raw: 'offline' } });
            await settleResults();
            queue.retry(1);

            queue.cancel(1);
            downloads[1]?.finish({ status: 'cancelled' });
            await settleResults();

            expect(queue.list()[0]?.status).toBe('cancelled');
        });
    });

    describe('resume', () => {
        it('queues the paused episode again and starts it with the data of the anime', async () => {
            const { queue, downloads, db } = await pausedEpisode({ maxConcurrent: 2 });
            downloads[1]?.finish({ status: 'cancelled' });
            await settleResults();

            queue.resume(1);

            expect(downloads).toHaveLength(3);
            expect(downloads[2]?.options).toMatchObject({ query: 'naruto', index: 2, episode: '1' });
            expect(queue.list().find((job) => {
                return job.episodeId === 1;
            })?.status).toBe('running');
            expect(db.getEpisode(1)?.status).toBe('downloading');
        });

        it('downloads into the same folder, so the partial file is found again', async () => {
            const { queue, downloads } = await pausedEpisode({ maxConcurrent: 2 });
            const folder = downloads[0]?.options.downloadDir;

            queue.resume(1);

            expect(downloads.at(-1)?.options.downloadDir).toBe(folder);
            expect(downloads.at(-1)?.options.episode).toBe('1');
        });

        it('waits for its turn when the queue is full', async () => {
            const { queue, downloads } = await pausedEpisode({ maxConcurrent: 1 });

            queue.resume(1);

            expect(downloads).toHaveLength(2);
            expect(queue.list().find((job) => {
                return job.episodeId === 1;
            })?.status).toBe('queued');
            downloads[1]?.finish({ status: 'cancelled' });
            await settleResults();
            expect(downloads).toHaveLength(3);
        });

        it('finishes like any other episode', async () => {
            const { queue, downloads, db, state } = await pausedEpisode({ maxConcurrent: 2 });
            state.files['/a/1.mp4'] = 2048;
            queue.resume(1);

            downloads.at(-1)?.finish(doneAt('/a/1.mp4'));
            await settleResults();

            expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: '/a/1.mp4', sizeBytes: 2048 });
            expect(state.downloaded).toEqual([1]);
        });

        it('also works for an episode that was paused in an earlier run of the app', () => {
            const { queue, downloads, db } = setup();
            const anime = db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1 });
            const episode = db.ensureEpisode(anime.id, '7');
            db.markPaused(episode.id);
            db.failInterrupted();
            expect(db.getEpisode(episode.id)?.status).toBe('paused');

            queue.resume(episode.id);

            expect(downloads).toHaveLength(1);
            expect(downloads[0]?.options).toMatchObject({ query: 'naruto', index: 1, episode: '7' });
        });

        it.each(['downloading', 'queued', 'done', 'error', 'cancelled'] as const)('does nothing for an episode that is %s', (status) => {
            const { queue, downloads, db } = setup();
            const anime = db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1 });
            const episode = db.ensureEpisode(anime.id, '1');
            if (status === 'downloading') {
                db.markDownloading(episode.id);
            } else if (status === 'done') {
                db.markDone(episode.id, '/a/1.mp4', 1);
            } else if (status === 'error' || status === 'cancelled') {
                db.markFailed(episode.id, status, null);
            }

            queue.resume(episode.id);

            expect(downloads).toHaveLength(0);
        });

        it('does nothing for an episode that does not exist', () => {
            const { queue, downloads } = setup();

            queue.resume(99);

            expect(downloads).toHaveLength(0);
        });
    });

    describe('cancel, forget and shutdown on a paused episode', () => {
        it('cancels it on the spot, in the job and in the library', async () => {
            const { queue, db, updates, state } = await pausedEpisode();
            const changes = state.libraryChanges;

            queue.cancel(1);

            expect(queue.list()[0]).toMatchObject({ episodeId: 1, status: 'cancelled' });
            expect(db.getEpisode(1)).toMatchObject({ status: 'cancelled', error: null });
            expect(updates.at(-1)).toMatchObject({ episodeId: 1, status: 'cancelled' });
            expect(state.libraryChanges).toBe(changes + 1);
        });

        it('can be retried after it was cancelled', async () => {
            const { queue, downloads } = await pausedEpisode({ maxConcurrent: 2 });
            queue.cancel(1);

            queue.retry(1);

            expect(downloads.at(-1)?.options.episode).toBe('1');
        });

        it('cancels it deleting the folder of the episode with its partial file', async () => {
            const { queue, removeDirectory } = await pausedEpisode();
            removeDirectory.mockClear();

            queue.cancel(1);

            expect(removeDirectory.mock.calls).toEqual([[join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 1')]]);
        });

        it('is not cleared with the finished ones: it has no run, but it is not over, so it stays and can still be cancelled', async () => {
            const { queue, db } = await pausedEpisode();

            queue.clearFinished();

            expect(queue.list().find((job) => {
                return job.episodeId === 1;
            })).toMatchObject({ status: 'paused' });
            queue.cancel(1);
            expect(db.getEpisode(1)?.status).toBe('cancelled');
        });

        it('is forgotten when the episode is removed from the library, and its partial file goes', async () => {
            const { queue, removeDirectory } = await pausedEpisode();
            removeDirectory.mockClear();

            queue.forget([1]);

            expect(
                queue.list().some((job) => {
                    return job.episodeId === 1;
                })
            ).toBe(false);
            expect(removeDirectory.mock.calls).toEqual([[join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 1')]]);
        });

        it('is left alone when the app closes: nothing is running for it', async () => {
            const { queue, downloads, db } = await pausedEpisode({ maxConcurrent: 1 });
            downloads[1]?.finish({ status: 'cancelled' });
            await settleResults();

            queue.shutdown();

            expect(downloads[0]?.cancel).toHaveBeenCalledTimes(1);
            expect(db.getEpisode(1)?.status).toBe('paused');
        });
    });
});

describe('AnimeDownloadQueue the episodes paused when the app last closed', () => {
    function libraryWithPaused() {
        const result = setup({ maxConcurrent: 1 });
        const naruto = result.db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1 });
        const bleach = result.db.upsertAnime({ title: 'Bleach', query: 'bleach', searchIndex: 3 });
        const paused = [result.db.ensureEpisode(naruto.id, '2'), result.db.ensureEpisode(bleach.id, '5')];
        paused.forEach((episode) => {
            result.db.markPaused(episode.id);
        });
        const others = [result.db.ensureEpisode(naruto.id, '1'), result.db.ensureEpisode(naruto.id, '3')];
        result.db.markDone(others[0]!.id, '/a/1.mp4', 1);
        result.db.markFailed(others[1]!.id, 'cancelled', null);
        return { ...result, naruto, bleach, paused };
    }

    it('shows them again as paused, anime by anime, and tells nothing until something changes', () => {
        const { queue, updates, downloads, naruto, bleach, paused } = libraryWithPaused();

        queue.restore();

        expect(queue.list()).toEqual([
            { episodeId: paused[0]!.id, animeId: naruto.id, animeTitle: 'Naruto', episode: '2', status: 'paused', percent: 0, speed: '', eta: '', error: null, parts: null },
            { episodeId: paused[1]!.id, animeId: bleach.id, animeTitle: 'Bleach', episode: '5', status: 'paused', percent: 0, speed: '', eta: '', error: null, parts: null }
        ]);
        expect(updates).toEqual([]);
        expect(downloads).toEqual([]);
        expect(queue.pendingCount()).toBe(0);
    });

    it('does not show one twice when it is restored again', () => {
        const { queue } = libraryWithPaused();
        queue.restore();
        queue.restore();
        expect(queue.list()).toHaveLength(2);
    });

    it('goes on with one from the folder of its episode', () => {
        const { queue, downloads, db, paused } = libraryWithPaused();
        queue.restore();

        queue.resume(paused[0]!.id);

        expect(downloads).toHaveLength(1);
        expect(downloads[0]?.options).toMatchObject({ query: 'naruto', episode: '2', downloadDir: join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 2') });
        expect(db.getEpisode(paused[0]!.id)?.status).toBe('downloading');
    });

    it('cancels one, deleting the folder of the episode with its partial file', () => {
        const { queue, db, updates, removeDirectory, paused } = libraryWithPaused();
        queue.restore();

        queue.cancel(paused[1]!.id);

        expect(db.getEpisode(paused[1]!.id)).toMatchObject({ status: 'cancelled', error: null });
        expect(updates.at(-1)).toMatchObject({ episodeId: paused[1]!.id, status: 'cancelled' });
        expect(removeDirectory.mock.calls).toEqual([[join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Bleach', 'Episode 5')]]);
    });

    it('shows nothing when no episode is paused', () => {
        const { queue } = setup();
        queue.restore();
        expect(queue.list()).toEqual([]);
    });
});

describe('AnimeDownloadQueue closing the app with downloads going on', () => {
    const TWO_EPISODES = { ...REQUEST, episodes: ['1', '2'] };

    describe('hasRunsToEnd', () => {
        it('is false with nothing running, true while a download runs and false once it ended', async () => {
            const { queue, downloads } = setup({ maxConcurrent: 1 });
            expect(queue.hasRunsToEnd()).toBe(false);

            queue.enqueue({ ...REQUEST, episodes: ['1'] });
            expect(queue.hasRunsToEnd()).toBe(true);

            downloads[0]?.finish(doneAt(null));
            await settleResults();
            expect(queue.hasRunsToEnd()).toBe(false);
        });
    });

    describe('shutdown of a download that is running', () => {
        it('cancels it, marks it cancelled in the library and deletes the folder of its episode', async () => {
            const { queue, downloads, db, removeDirectory } = setup({ maxConcurrent: 1 });
            queue.enqueue({ ...REQUEST, episodes: ['1'] });
            const directory = downloads[0]?.options.downloadDir as string;

            const shutdown = queue.shutdown();
            downloads[0]?.finish({ status: 'cancelled' });
            await shutdown;

            expect(downloads[0]?.cancel).toHaveBeenCalledTimes(1);
            expect(directory).toBe(join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 1'));
            expect(removeDirectory).toHaveBeenCalledTimes(1);
            expect(removeDirectory).toHaveBeenCalledWith(directory);
            expect(queue.list()[0]).toMatchObject({ episodeId: 1, status: 'cancelled' });
            expect(db.getEpisode(1)?.status).toBe('cancelled');
        });

        it('deletes the folder of every running download', async () => {
            const { queue, downloads, removeDirectory } = setup({ maxConcurrent: 2 });
            queue.enqueue(TWO_EPISODES);
            const directories = downloads.map((download) => {
                return download.options.downloadDir;
            });

            const shutdown = queue.shutdown();
            downloads.forEach((download) => {
                download.finish({ status: 'cancelled' });
            });
            await shutdown;

            expect(directories).toEqual([join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 1'), join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 2')]);
            expect(removeDirectory.mock.calls).toEqual([[directories[0]], [directories[1]]]);
        });

        it('waits for the process to end before it deletes the folder, which it may still be writing to', async () => {
            const { queue, downloads, removeDirectory } = setup({ maxConcurrent: 1 });
            queue.enqueue({ ...REQUEST, episodes: ['1'] });

            const shutdown = queue.shutdown();
            await settleResults();
            expect(removeDirectory).not.toHaveBeenCalled();

            downloads[0]?.finish({ status: 'cancelled' });
            await shutdown;
            expect(removeDirectory).toHaveBeenCalledTimes(1);
        });

        it('deletes the folder even when the process does not end in time, and does not wait longer', async () => {
            vi.useFakeTimers();
            try {
                const { queue, removeDirectory } = setup({ maxConcurrent: 1 });
                queue.enqueue({ ...REQUEST, episodes: ['1'] });

                const shutdown = queue.shutdown(5000);
                await vi.advanceTimersByTimeAsync(4999);
                expect(removeDirectory).not.toHaveBeenCalled();
                await vi.advanceTimersByTimeAsync(1);
                await shutdown;

                expect(removeDirectory).toHaveBeenCalledTimes(1);
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        });

        it('does not start the episodes that wait, and leaves them as they are', async () => {
            const { queue, downloads, removeDirectory } = setup({ maxConcurrent: 1 });
            queue.enqueue(TWO_EPISODES);

            const shutdown = queue.shutdown();
            downloads[0]?.finish({ status: 'cancelled' });
            await shutdown;

            expect(downloads).toHaveLength(1);
            expect(removeDirectory).toHaveBeenCalledTimes(1);
            expect(
                queue.list().map((job) => {
                    return job.status;
                })
            ).toEqual(['cancelled', 'queued']);
        });

        it('does not fail with nothing running', async () => {
            const { queue } = setup();
            await expect(queue.shutdown()).resolves.toBeUndefined();
            expect(queue.pendingCount()).toBe(0);
        });
    });

    describe('shutdown while a download is being paused', () => {
        it('keeps the episode as paused in the library at once, and does not delete its folder', async () => {
            const { queue, downloads, db, removeDirectory } = setup({ maxConcurrent: 1 });
            queue.enqueue({ ...REQUEST, episodes: ['1'] });
            downloads[0]?.options.onProgress?.({ percent: 40, totalBytes: 100, speed: '1MiB/s', eta: '00:05' });
            queue.pause(1);

            const shutdown = queue.shutdown();
            expect(db.getEpisode(1)?.status).toBe('paused');

            downloads[0]?.finish({ status: 'cancelled' });
            await shutdown;
            expect(db.getEpisode(1)?.status).toBe('paused');
            expect(queue.list()[0]).toMatchObject({ status: 'paused' });
            expect(removeDirectory).not.toHaveBeenCalled();
        });

        it('keeps the one that was being paused and deletes the folder of the other', async () => {
            const { queue, downloads, db, removeDirectory } = setup({ maxConcurrent: 2 });
            queue.enqueue(TWO_EPISODES);
            queue.pause(1);

            const shutdown = queue.shutdown();
            downloads.forEach((download) => {
                download.finish({ status: 'cancelled' });
            });
            await shutdown;

            expect(db.getEpisode(1)?.status).toBe('paused');
            expect(removeDirectory).toHaveBeenCalledTimes(1);
            expect(removeDirectory).toHaveBeenCalledWith(downloads[1]?.options.downloadDir);
        });
    });
});

describe('AnimeDownloadQueue downloads that are complete', () => {
    it('says it is done and then leaves the list, because it is in the library', async () => {
        const { queue, downloads, updates } = setup({ maxConcurrent: 1 }, { '/a/Naruto Episode 1.mp4': 4096 });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.finish(doneAt('/a/Naruto Episode 1.mp4'));
        await settleResults();

        expect(updates.at(-1)).toEqual({ episodeId: 1, animeId: 1, animeTitle: 'Naruto', episode: '1', status: 'done', percent: 100, speed: '', eta: '', error: null, parts: null });
        expect(queue.list()).toEqual([]);
        expect(queue.pendingCount()).toBe(0);
    });

    it('leaves only the one that finished, and keeps what is running, waiting, failed or cancelled', async () => {
        const { queue, downloads } = setup({ maxConcurrent: 2 }, { '/a/1.mp4': 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2', '3', '4'] });
        downloads[0]?.finish(doneAt('/a/1.mp4'));
        await settleResults();
        downloads[1]?.finish({ status: 'error', error: { code: 'NO_SOURCES', raw: 'boom' } });
        await settleResults();
        queue.cancel(4);

        expect(
            queue.list().map((job) => {
                return [job.episode, job.status];
            })
        ).toEqual([
            ['2', 'error'],
            ['3', 'running'],
            ['4', 'running']
        ]);
    });

    it('starts the next one when one finishes', async () => {
        const { queue, downloads } = setup({ maxConcurrent: 1 }, { '/a/1.mp4': 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });
        downloads[0]?.finish(doneAt('/a/1.mp4'));
        await settleResults();
        expect(downloads).toHaveLength(2);
        expect(downloads[1]?.options.episode).toBe('2');
    });

    it('does not take the job out of the list when the download failed because its file is not there', async () => {
        const { queue, downloads } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.finish(doneAt('/a/missing.mp4'));
        await settleResults();
        expect(queue.list()).toMatchObject([{ episodeId: 1, status: 'error' }]);
    });
});

describe('AnimeDownloadQueue with the id of the source', () => {
    const FIRST = { title: 'Nisekoi: False Love', query: 'nisekoi', index: 1, audio: 'sub' as const, sourceId: 'nisekoi-false-love-603' };
    const SECOND = { title: 'Nisekoi: False Love (season 2)', query: 'nisekoi', index: 2, audio: 'sub' as const, sourceId: 'nisekoi-false-love-season-2-605' };

    it('queues the episodes of two anime that have the same title as two anime, each with its own', () => {
        const { queue, db } = setup({ maxConcurrent: 1 });
        const first = queue.enqueue({ ...FIRST, episodes: ['1', '2'] });
        const second = queue.enqueue({ ...SECOND, episodes: ['1'] });
        expect(first?.id).not.toBe(second?.id);
        expect(
            db.list().map((anime) => {
                return [anime.title, anime.sourceId, anime.searchIndex, anime.episodes.length];
            })
        ).toEqual([
            ['Nisekoi: False Love', 'nisekoi-false-love-603', 1, 2],
            ['Nisekoi: False Love (season 2)', 'nisekoi-false-love-season-2-605', 2, 1]
        ]);
    });

    it('asks ani-cli for the place of each anime in the search, so the episode of the second season is the one of the second season', () => {
        const { queue, downloads } = setup({ maxConcurrent: 2 });
        queue.enqueue({ ...FIRST, episodes: ['1'] });
        queue.enqueue({ ...SECOND, episodes: ['1'] });
        expect(
            downloads.map((download) => {
                return [download.options.index, download.options.episode];
            })
        ).toEqual([[1, '1'], [2, '1']]);
    });

    it('adds the two anime that have the same title to the library as two, with the series and the seasons each asked for', () => {
        const { queue, db } = setup();
        const request = { query: 'nisekoi', audio: 'sub' as const, episodes: ['1', '2'], seasonName: null };
        expect(queue.addToLibrary({ ...request, title: FIRST.title, index: 1, sourceId: FIRST.sourceId, series: 'Nisekoi', season: 1 }).ok).toBe(true);
        expect(queue.addToLibrary({ ...request, title: SECOND.title, index: 2, sourceId: SECOND.sourceId, series: 'Nisekoi', season: 2 }).ok).toBe(true);
        expect(
            db.list().map((anime) => {
                return [anime.title, anime.series, anime.season];
            })
        ).toEqual([
            ['Nisekoi: False Love', 'Nisekoi', 1],
            ['Nisekoi: False Love (season 2)', 'Nisekoi', 2]
        ]);
    });

    it('does not take a season that is taken for the season of the other anime with the same title', () => {
        const { queue, db } = setup();
        const request = { query: 'nisekoi', audio: 'sub' as const, episodes: ['1'], seasonName: null };
        queue.addToLibrary({ ...request, title: FIRST.title, index: 1, sourceId: FIRST.sourceId, series: 'Nisekoi', season: 1 });
        const response = queue.addToLibrary({ ...request, title: FIRST.title, index: 2, sourceId: SECOND.sourceId, series: 'Nisekoi', season: 1 });
        expect(response).toEqual({ ok: false, reason: 'season-taken', suggested: 2 });
        expect(db.list()).toHaveLength(1);
    });

    it('keeps the anime when ani-cli moves to another site: it is added again with the new id and is still one, with its episodes and its series', () => {
        const { queue, db, site } = setup();
        const request = { query: 'nisekoi', audio: 'sub' as const, seasonName: null };
        site.provider = 'hianime.at';
        queue.addToLibrary({ ...request, title: 'Nisekoi: False Love', index: 1, sourceId: 'nisekoi-false-love-603', episodes: ['1', '2'], series: 'Nisekoi', season: 1 });
        site.provider = 'allanime.day';
        const again = queue.addToLibrary({ ...request, title: 'Nisekoi: False Love', index: 4, sourceId: 'ReooPAxPMsHM4KPMY', episodes: ['1', '2', '3'], series: 'Other', season: 7 });
        expect(again.ok).toBe(true);
        expect(
            db.list().map((anime) => {
                return [anime.title, anime.sourceId, anime.searchIndex, anime.series, anime.season, anime.episodes.length];
            })
        ).toEqual([['Nisekoi: False Love', 'ReooPAxPMsHM4KPMY', 4, 'Nisekoi', 1, 3]]);
    });

    it('queues the episodes of an anime of the old site on the same anime when ani-cli moved', () => {
        const { queue, db, site } = setup({ maxConcurrent: 1 });
        site.provider = 'hianime.at';
        queue.enqueue({ ...FIRST, episodes: ['1'] });
        site.provider = 'allanime.day';
        queue.enqueue({ ...FIRST, index: 2, sourceId: 'ReooPAxPMsHM4KPMY', episodes: ['2'] });
        expect(db.list()).toHaveLength(1);
        expect(db.list()[0]).toMatchObject({ sourceId: 'ReooPAxPMsHM4KPMY', searchIndex: 2 });
    });

    it('does not take the second season for the first one on the same site', () => {
        const { queue, db, site } = setup();
        site.provider = 'hianime.at';
        queue.enqueue({ ...FIRST, episodes: ['1'] });
        queue.enqueue({ ...SECOND, title: FIRST.title, episodes: ['1'] });
        expect(db.list()).toHaveLength(2);
    });

    it('is the same anime when it is added again with the same id, and goes on with its series', () => {
        const { queue, db } = setup();
        const request = { query: 'nisekoi', audio: 'sub' as const, episodes: ['1'], seasonName: null };
        queue.addToLibrary({ ...request, title: SECOND.title, index: 2, sourceId: SECOND.sourceId, series: 'Nisekoi', season: 2 });
        const again = queue.addToLibrary({ ...request, title: SECOND.title, index: 5, sourceId: SECOND.sourceId, series: 'Other', season: 9 });
        expect(again.ok).toBe(true);
        expect(db.list()).toHaveLength(1);
        expect(db.list()[0]).toMatchObject({ series: 'Nisekoi', season: 2, searchIndex: 5 });
    });
});

describe('AnimeDownloadQueue.addToLibrary', () => {
    function addition(overrides: Partial<AnimeAddRequest> = {}): AnimeAddRequest {
        return { title: 'Naruto', query: 'naruto', index: 2, episodes: ['1', '2', '3'], series: null, season: null, seasonName: null, ...overrides };
    }

    it('puts the anime in the library with every episode idle, and downloads nothing', () => {
        const { queue, db, downloads, updates, state } = setup();
        const response = queue.addToLibrary(addition());

        expect(response).toMatchObject({ ok: true, anime: { title: 'Naruto', query: 'naruto', searchIndex: 2, series: null, season: null } });
        expect(
            db.getLibraryAnime(1)?.episodes.map((episode) => {
                return [episode.number, episode.status];
            })
        ).toEqual([
            ['1', 'idle'],
            ['2', 'idle'],
            ['3', 'idle']
        ]);
        expect(downloads).toEqual([]);
        expect(updates).toEqual([]);
        expect(queue.list()).toEqual([]);
        expect(queue.pendingCount()).toBe(0);
        expect(state.libraryChanges).toBe(1);
    });

    it('gives back the anime as the library has it, with its episodes', () => {
        const { queue } = setup();
        const response = queue.addToLibrary(addition({ episodes: ['1', '2'] }));
        expect(response.ok && response.anime.episodes.map((episode) => {
            return episode.status;
        })).toEqual(['idle', 'idle']);
    });

    it('saves the series, the season and the name shown when it is new to the library', () => {
        const { queue, db } = setup();
        queue.addToLibrary(addition({ series: 'Naruto Series', season: 2, seasonName: 'The second' }));
        expect(db.getAnime(1)).toMatchObject({ series: 'Naruto Series', season: 2, seasonName: 'The second' });
    });

    it('refuses a season the series already has for that audio, saves nothing, and says the next free one', () => {
        const { queue, db, state } = setup();
        queue.addToLibrary(addition({ title: 'Frieren', series: 'Frieren', season: 1 }));
        queue.addToLibrary(addition({ title: 'Frieren 3', series: 'frieren', season: 3 }));
        const changes = state.libraryChanges;

        const response = queue.addToLibrary(addition({ title: 'Frieren 2', series: 'FRIEREN', season: 1 }));

        expect(response).toEqual({ ok: false, reason: 'season-taken', suggested: 4 });
        expect(db.findAnime('Frieren 2')).toBeNull();
        expect(state.libraryChanges).toBe(changes);
    });

    it('allows the same season for the other audio of the series', () => {
        const { queue } = setup();
        queue.addToLibrary(addition({ title: 'Frieren', series: 'Frieren', season: 1 }));
        expect(queue.addToLibrary(addition({ title: 'Frieren', series: 'Frieren', season: 1 })).ok).toBe(true);
    });

    it('keeps the series an anime has when it is added again with another one', () => {
        const { queue, db } = setup();
        queue.addToLibrary(addition({ series: 'Naruto Series', season: 1 }));

        const response = queue.addToLibrary(addition({ series: 'Another series', season: 5, seasonName: 'Other' }));

        expect(response).toMatchObject({ ok: true });
        expect(db.getAnime(1)).toMatchObject({ series: 'Naruto Series', season: 1, seasonName: null });
    });

    it('does not give a series to an anime that is in the library on its own', () => {
        const { queue, db } = setup();
        queue.addToLibrary(addition());
        queue.addToLibrary(addition({ series: 'Naruto Series', season: 1 }));
        expect(db.getAnime(1)).toMatchObject({ series: null, season: null });
    });

    it('does not refuse a season that the anime itself already has when it is added again', () => {
        const { queue } = setup();
        queue.addToLibrary(addition({ series: 'Naruto Series', season: 1 }));
        expect(queue.addToLibrary(addition({ series: 'Naruto Series', season: 1 })).ok).toBe(true);
    });

    it('adds the episodes it did not have when it is added again, and leaves the others as they are', async () => {
        const { queue, db, downloads } = setup({ maxConcurrent: 1 }, { '/a/Naruto Episode 1.mp4': 10 });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.finish(doneAt('/a/Naruto Episode 1.mp4'));
        await settleResults();

        queue.addToLibrary(addition({ index: 3, episodes: ['1', '2', '3'] }));

        expect(
            db.getLibraryAnime(1)?.episodes.map((episode) => {
                return [episode.number, episode.status];
            })
        ).toEqual([
            ['1', 'done'],
            ['2', 'idle'],
            ['3', 'idle']
        ]);
        expect(db.getAnime(1)?.searchIndex).toBe(3);
    });

    it('keeps one anime for a title added twice', () => {
        const { queue, db } = setup();
        queue.addToLibrary(addition());
        queue.addToLibrary(addition());
        expect(db.list().map((anime) => {
            return anime.title;
        })).toEqual(['Naruto']);
    });
});

describe('AnimeDownloadQueue.downloadMissing', () => {
    function library(settings: Partial<Settings> = {}, files: Record<string, number> = {}) {
        const context = setup(settings, files);
        context.queue.addToLibrary({ title: 'Naruto', query: 'naruto', index: 2, episodes: ['1', '2', '3', '4'], series: null, season: null, seasonName: null });
        return context;
    }

    it('queues every episode that is not downloaded, and starts as many as the limit allows', () => {
        const { queue, downloads, updates, state } = library({ maxConcurrent: 2 });
        const changes = state.libraryChanges;

        queue.downloadMissing([1]);

        expect(
            queue.list().map((job) => {
                return [job.episode, job.status];
            })
        ).toEqual([
            ['1', 'running'],
            ['2', 'running'],
            ['3', 'queued'],
            ['4', 'queued']
        ]);
        expect(downloads.map((download) => {
            return download.options.episode;
        })).toEqual(['1', '2']);
        expect(updates.filter((job) => {
            return job.status === 'queued';
        })).toHaveLength(4);
        expect(state.libraryChanges).toBeGreaterThan(changes);
    });

    it('leaves out the downloaded episodes and the ones already waiting or downloading', async () => {
        const { queue, downloads } = library({ maxConcurrent: 1 }, { '/a/1.mp4': 10 });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.finish(doneAt('/a/1.mp4'));
        await settleResults();
        queue.enqueue({ ...REQUEST, episodes: ['3'] });
        const started = downloads.length;

        queue.downloadMissing([1]);

        expect(
            queue.list().map((job) => {
                return [job.episode, job.status];
            })
        ).toEqual([
            ['3', 'running'],
            ['2', 'queued'],
            ['4', 'queued']
        ]);
        expect(downloads).toHaveLength(started);
    });

    it('queues the ones that failed, were cancelled or were paused, and the ones that were never downloaded', () => {
        const { queue, db } = library({ maxConcurrent: 0 });
        db.markFailed(2, 'error', { code: 'NETWORK', raw: 'boom' });
        db.markFailed(3, 'cancelled', null);
        db.markPaused(4);

        queue.downloadMissing([1]);

        expect(
            queue.list().map((job) => {
                return [job.episode, job.status];
            })
        ).toEqual([
            ['1', 'queued'],
            ['2', 'queued'],
            ['3', 'queued'],
            ['4', 'queued']
        ]);
        expect(db.getEpisode(2)).toMatchObject({ status: 'queued', error: null });
    });

    it('does the episodes of every anime of the list, and only of the list', () => {
        const { queue, state } = library({ maxConcurrent: 0 });
        queue.addToLibrary({ title: 'Bleach', query: 'bleach', index: 3, episodes: ['1', '2'], series: null, season: null, seasonName: null });
        queue.addToLibrary({ title: 'Other', query: 'other', index: 4, episodes: ['1'], series: null, season: null, seasonName: null });
        const changes = state.libraryChanges;

        queue.downloadMissing([1, 3]);

        expect(
            queue.list().map((job) => {
                return [job.animeTitle, job.episode];
            })
        ).toEqual([
            ['Naruto', '1'],
            ['Naruto', '2'],
            ['Naruto', '3'],
            ['Naruto', '4'],
            ['Other', '1']
        ]);
        expect(state.libraryChanges).toBe(changes + 1);
    });

    it('ignores an anime that is not in the library', () => {
        const { queue, downloads } = library({ maxConcurrent: 0 });
        queue.downloadMissing([99]);
        expect(queue.list()).toEqual([]);
        expect(downloads).toEqual([]);
    });

    it('does nothing for an empty list, and for an anime whose episodes are all downloaded', async () => {
        const { queue, downloads } = setup({ maxConcurrent: 1 }, { '/a/Naruto Episode 1.mp4': 10 });
        queue.addToLibrary({ title: 'Naruto', query: 'naruto', index: 2, episodes: ['1'], series: null, season: null, seasonName: null });
        queue.downloadMissing([]);
        expect(queue.list()).toEqual([]);
        queue.downloadMissing([1]);
        downloads[0]?.finish(doneAt('/a/Naruto Episode 1.mp4'));
        await settleResults();

        queue.downloadMissing([1]);

        expect(queue.list()).toEqual([]);
        expect(downloads).toHaveLength(1);
    });

    it('does not start anything once the app is closing', async () => {
        const { queue, downloads } = library({ maxConcurrent: 2 });
        await queue.shutdown();
        queue.downloadMissing([1]);
        expect(downloads).toEqual([]);
    });
});

describe('AnimeDownloadQueue.downloadEpisodes', () => {
    function library(settings: Partial<Settings> = {}, files: Record<string, number> = {}) {
        const context = setup(settings, files);
        context.queue.addToLibrary({ title: 'Naruto', query: 'naruto', index: 2, episodes: ['1', '2', '3', '4'], series: null, season: null, seasonName: null });
        return context;
    }

    it('queues only the episodes given, and starts as many as the limit allows', () => {
        const { queue, downloads, updates, state } = library({ maxConcurrent: 1 });
        const changes = state.libraryChanges;

        queue.downloadEpisodes(1, ['3', '4']);

        expect(
            queue.list().map((job) => {
                return [job.animeTitle, job.episode, job.status];
            })
        ).toEqual([
            ['Naruto', '3', 'running'],
            ['Naruto', '4', 'queued']
        ]);
        expect(
            downloads.map((download) => {
                return download.options.episode;
            })
        ).toEqual(['3']);
        expect(
            updates.filter((job) => {
                return job.status === 'queued';
            })
        ).toHaveLength(2);
        // Once for the episodes that were queued and once more when the first one starts.
        expect(state.libraryChanges).toBe(changes + 2);
    });

    it('tells the library it changed once, when nothing starts', () => {
        const { queue, state } = library({ maxConcurrent: 0 });
        const changes = state.libraryChanges;

        queue.downloadEpisodes(1, ['3', '4']);

        expect(state.libraryChanges).toBe(changes + 1);
    });

    it('asks ani-cli for the search and the audio the anime was found by', () => {
        const { queue, downloads } = library({ maxConcurrent: 1 });

        queue.downloadEpisodes(1, ['4']);

        expect(downloads[0]?.options).toMatchObject({ query: 'naruto', index: 2, episode: '4' });
    });

    it('leaves the library episodes that were not given as they are', () => {
        const { queue, db } = library({ maxConcurrent: 0 });

        queue.downloadEpisodes(1, ['2']);

        expect(db.getEpisode(2)).toMatchObject({ number: '2', status: 'queued' });
        expect(db.getEpisode(1)).toMatchObject({ number: '1', status: 'idle' });
        expect(db.getEpisode(3)).toMatchObject({ number: '3', status: 'idle' });
    });

    it('adds an episode the library does not have yet, as queued', () => {
        const { queue, db } = library({ maxConcurrent: 0 });

        queue.downloadEpisodes(1, ['5']);

        expect(db.getEpisodeByNumber(1, '5')).toMatchObject({ status: 'queued' });
        expect(
            queue.list().map((job) => {
                return job.episode;
            })
        ).toEqual(['5']);
    });

    it('leaves out an episode that is downloaded and one that is already waiting or downloading', async () => {
        const { queue, downloads } = library({ maxConcurrent: 1 }, { '/a/1.mp4': 10 });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.finish(doneAt('/a/1.mp4'));
        await settleResults();
        queue.enqueue({ ...REQUEST, episodes: ['3'] });
        const started = downloads.length;

        queue.downloadEpisodes(1, ['1', '3', '4']);

        expect(
            queue.list().map((job) => {
                return [job.episode, job.status];
            })
        ).toEqual([
            ['3', 'running'],
            ['4', 'queued']
        ]);
        expect(downloads).toHaveLength(started);
    });

    it('ignores an anime that is not in the library, and says nothing changed', () => {
        const { queue, downloads, state } = library({ maxConcurrent: 0 });
        const changes = state.libraryChanges;

        queue.downloadEpisodes(99, ['1']);

        expect(queue.list()).toEqual([]);
        expect(downloads).toEqual([]);
        expect(state.libraryChanges).toBe(changes);
    });

    it('queues nothing for an empty list', () => {
        const { queue, downloads } = library({ maxConcurrent: 2 });

        queue.downloadEpisodes(1, []);

        expect(queue.list()).toEqual([]);
        expect(downloads).toEqual([]);
    });

    it('does not start anything once the app is closing', async () => {
        const { queue, downloads } = library({ maxConcurrent: 2 });
        await queue.shutdown();

        queue.downloadEpisodes(1, ['1']);

        expect(downloads).toEqual([]);
    });
});

describe('AnimeDownloadQueue tries again by itself', () => {
    const NETWORK_ERROR = { code: 'NETWORK' as const, raw: 'The connection dropped.' };

    it('tries an episode three times at most', () => {
        expect(ANIME_MAX_TRIES).toBe(3);
    });

    it.each(['NETWORK', 'BLOCKED', 'UNKNOWN'] as const)('queues the episode again, in the same place, when the run fails with %s', async (code) => {
        const { queue, downloads, db, updates } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });

        downloads[0]?.finish({ status: 'error', error: { code, raw: 'It failed.' } });
        await settleResults();

        // The same episode starts again before the next one (it was first in the list), in the same folder.
        expect(downloads).toHaveLength(2);
        expect(downloads[1]?.options.episode).toBe('1');
        expect(downloads[1]?.options.downloadDir).toBe(downloads[0]?.options.downloadDir);
        expect(db.getEpisode(1)).toMatchObject({ status: 'downloading', error: null });
        expect(updates.filter((job) => {
            return job.episodeId === 1;
        }).map((job) => {
            return job.status;
        })).toEqual(['queued', 'running', 'queued', 'running']);
        expect(queue.list().map((job) => {
            return [job.episode, job.status, job.error];
        })).toEqual([['1', 'running', null], ['2', 'queued', null]]);
    });

    it('leaves the episode as an error, with what went wrong, once it has failed three times, and goes on with the next one', async () => {
        const { queue, downloads, db, updates } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });

        downloads[0]?.finish({ status: 'error', error: NETWORK_ERROR });
        await settleResults();
        downloads[1]?.finish({ status: 'error', error: NETWORK_ERROR });
        await settleResults();
        expect(downloads).toHaveLength(3);
        expect(queue.list()[0]).toMatchObject({ episode: '1', status: 'running' });
        downloads[2]?.finish({ status: 'error', error: NETWORK_ERROR });
        await settleResults();

        expect(db.getEpisode(1)).toMatchObject({ status: 'error', error: NETWORK_ERROR });
        expect(updates.filter((job) => {
            return job.episodeId === 1;
        }).at(-1)).toMatchObject({ status: 'error', error: NETWORK_ERROR, speed: '', eta: '' });
        expect(downloads).toHaveLength(4);
        expect(downloads[3]?.options.episode).toBe('2');
    });

    it.each(['NO_RESULTS', 'NO_SOURCES', 'EPISODE_NOT_RELEASED', 'INVALID_SELECTION', 'BINARY_MISSING'] as const)('does not try again a failure that asking again will not fix (%s)', async (code) => {
        const { queue, downloads, db } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });

        downloads[0]?.finish({ status: 'error', error: { code, raw: 'Nothing to do.' } });
        await settleResults();

        expect(db.getEpisode(1)).toMatchObject({ status: 'error', error: { code, raw: 'Nothing to do.' } });
        expect(downloads).toHaveLength(2);
        expect(downloads[1]?.options.episode).toBe('2');
    });

    it('gives an episode three new tries when it is retried by hand, after it used its tries', async () => {
        const { queue, downloads, db } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        for (let run = 0; run < ANIME_MAX_TRIES; run += 1) {
            downloads[run]?.finish({ status: 'error', error: NETWORK_ERROR });
            await settleResults();
        }
        expect(db.getEpisode(1)?.status).toBe('error');
        expect(downloads).toHaveLength(3);

        queue.retry(1);
        for (let run = 3; run < 3 + ANIME_MAX_TRIES - 1; run += 1) {
            downloads[run]?.finish({ status: 'error', error: NETWORK_ERROR });
            await settleResults();
        }

        // Two failures after the retry still leave it running: the count started again.
        expect(downloads).toHaveLength(6);
        expect(queue.list()[0]).toMatchObject({ status: 'running', error: null });
    });

    it('finishes an episode that failed twice and then worked, which leaves the list like any other that is done', async () => {
        const { queue, downloads, db } = setup({ maxConcurrent: 1 }, { [join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 1', 'Naruto Episode 1.mkv')]: 100 });
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        downloads[0]?.finish({ status: 'error', error: NETWORK_ERROR });
        await settleResults();
        downloads[1]?.finish({ status: 'error', error: NETWORK_ERROR });
        await settleResults();
        downloads[2]?.finish(doneAt(join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 1', 'Naruto Episode 1.mkv')));
        await settleResults();
        expect(db.getEpisode(1)?.status).toBe('done');
        expect(queue.list()).toEqual([]);
    });
});

describe('AnimeDownloadQueue pause all and resume all', () => {
    function status(db: AnimeDb, number: string): string | undefined {
        return db.getLibraryAnime(1)?.episodes.find((episode) => {
            return episode.number === number;
        })?.status;
    }

    it('holds the queue, so the episodes that wait keep waiting, and ends the run of the ones that go on', async () => {
        const { queue, downloads, db, updates, heldChanges } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2', '3'] });
        expect(queue.isHeld()).toBe(false);

        queue.pauseAll();

        expect(queue.isHeld()).toBe(true);
        expect(heldChanges).toEqual([true]);
        expect(downloads[0]?.cancel).toHaveBeenCalledTimes(1);
        expect(status(db, '2')).toBe('queued');
        expect(status(db, '3')).toBe('queued');
        downloads[0]?.finish({ status: 'cancelled' });
        await settleResults();

        expect(status(db, '1')).toBe('paused');
        // The place the paused episode left is not taken: the queue is held.
        expect(downloads).toHaveLength(1);
        expect(queue.list().map((job) => {
            return [job.episode, job.status];
        })).toEqual([['1', 'paused'], ['2', 'queued'], ['3', 'queued']]);
        expect(updates.filter((job) => {
            return job.status === 'paused';
        }).map((job) => {
            return job.episode;
        })).toEqual(['1']);
    });

    it('tells the screen of the library once, does nothing with nothing in the queue, and tells the hold only when it changes', () => {
        const { queue, state, heldChanges } = setup();
        queue.pauseAll();
        expect(state.libraryChanges).toBe(1);
        expect(queue.list()).toEqual([]);
        queue.pauseAll();
        expect(heldChanges).toEqual([true]);
        queue.resumeAll();
        queue.resumeAll();
        expect(heldChanges).toEqual([true, false]);
        expect(queue.isHeld()).toBe(false);
    });

    it('starts nothing new in a held queue, a new download or a retry, until everything goes on', () => {
        const { queue, downloads } = setup({ maxConcurrent: 2 });
        queue.pauseAll();
        queue.enqueue({ ...REQUEST, episodes: ['1'] });
        queue.enqueue({ title: 'Bleach', query: 'bleach', index: 1, episodes: ['5'] });
        expect(downloads).toEqual([]);
        expect(queue.list().map((job) => {
            return job.status;
        })).toEqual(['queued', 'queued']);
        queue.cancel(1);
        queue.retry(1);
        expect(downloads).toEqual([]);

        queue.resumeAll();

        expect(downloads.map((item) => {
            return item.options.episode;
        })).toEqual(['1', '5']);
    });

    it('starts at once an episode resumed by itself in a held queue, and keeps the rest waiting', async () => {
        const { queue, downloads, db } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });
        queue.pauseAll();
        downloads[0]?.finish({ status: 'cancelled' });
        await settleResults();

        queue.resume(1);

        expect(downloads.map((item) => {
            return item.options.episode;
        })).toEqual(['1', '1']);
        expect(queue.isHeld()).toBe(true);
        downloads[1]?.finish(doneAt(null));
        await settleResults();
        // The episode that waits still waits for RESUME ALL.
        expect(downloads).toHaveLength(2);
        expect(status(db, '2')).toBe('queued');
        queue.resumeAll();
        expect(downloads.map((item) => {
            return item.options.episode;
        })).toEqual(['1', '1', '2']);
    });

    it('queues again every paused episode with RESUME ALL, and lets the queue go', async () => {
        const { queue, downloads, db, heldChanges } = setup({ maxConcurrent: 2 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2', '3'] });
        queue.pauseAll();
        downloads[0]?.finish({ status: 'cancelled' });
        downloads[1]?.finish({ status: 'cancelled' });
        await settleResults();
        expect(queue.list().map((job) => {
            return job.status;
        })).toEqual(['paused', 'paused', 'queued']);

        queue.resumeAll();

        expect(heldChanges).toEqual([true, false]);
        expect(queue.isHeld()).toBe(false);
        // The paused ones are queued again in turn and the queue is let go first: the places go to the episodes in the order of the list at
        // that moment, so the third (which never started) takes the second place before the second, which is queued last.
        expect(queue.list().map((job) => {
            return job.status;
        })).toEqual(['running', 'queued', 'running']);
        expect(status(db, '1')).toBe('downloading');
        expect(status(db, '2')).toBe('queued');
        expect(downloads.map((item) => {
            return item.options.episode;
        })).toEqual(['1', '2', '1', '3']);
    });

    it('does not start an episode paused by itself again when a held episode resumed by itself fails and is tried again', async () => {
        const { queue, downloads } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });
        queue.pauseAll();
        downloads[0]?.finish({ status: 'cancelled' });
        await settleResults();
        queue.resume(1);

        downloads[1]?.finish({ status: 'error', error: { code: 'NETWORK', raw: 'down' } });
        await settleResults();

        // The one resumed by itself keeps its permission, so its try again starts in the held queue; the other still waits.
        expect(downloads.map((item) => {
            return item.options.episode;
        })).toEqual(['1', '1', '1']);
        expect(queue.list().map((job) => {
            return [job.episode, job.status];
        })).toEqual([['1', 'running'], ['2', 'queued']]);
    });

    it('keeps the episodes that wait in a held queue as paused when the app is closed, so they are found paused when it opens again', async () => {
        const { queue, downloads, db } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2', '3'] });
        queue.pauseAll();

        const closing = queue.shutdown();
        downloads[0]?.finish({ status: 'cancelled' });
        await closing;

        expect(status(db, '1')).toBe('paused');
        expect(status(db, '2')).toBe('paused');
        expect(status(db, '3')).toBe('paused');
    });

    it('leaves the episodes that wait as they are when the app is closed without PAUSE ALL', async () => {
        const { queue, downloads, db } = setup({ maxConcurrent: 1 });
        queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });

        const closing = queue.shutdown();
        downloads[0]?.finish({ status: 'cancelled' });
        await closing;

        expect(status(db, '2')).toBe('queued');
    });
});

describe('AnimeDownloadQueue pause, resume and cancel by anime', () => {
    const BLEACH = { title: 'Bleach', query: 'bleach', index: 1, audio: 'sub' as const, episodes: ['5'] };

    function twoAnime() {
        const context = setup({ maxConcurrent: 2 });
        context.queue.enqueue({ ...REQUEST, episodes: ['1', '2'] });
        context.queue.enqueue(BLEACH);
        const naruto = context.db.list().find((anime) => {
            return anime.title === 'Naruto';
        })!.id;
        const bleach = context.db.list().find((anime) => {
            return anime.title === 'Bleach';
        })!.id;
        return { ...context, naruto, bleach };
    }

    function statuses(queue: AnimeDownloadQueue): Array<[string, string]> {
        return queue.list().map((job) => {
            return [`${job.animeTitle} ${job.episode}`, job.status];
        });
    }

    describe('pauseAnimes', () => {
        it('ends the run of the episodes that are going on and pauses the ones that wait, without holding the queue', async () => {
            const { queue, downloads, db, heldChanges, updates, naruto } = twoAnime();
            expect(statuses(queue)).toEqual([['Naruto 1', 'running'], ['Naruto 2', 'running'], ['Bleach 5', 'queued']]);

            queue.pauseAnimes([naruto]);

            expect(downloads[0]?.cancel).toHaveBeenCalledTimes(1);
            expect(downloads[1]?.cancel).toHaveBeenCalledTimes(1);
            downloads[0]?.finish({ status: 'cancelled' });
            downloads[1]?.finish({ status: 'cancelled' });
            await settleResults();

            expect(db.getLibraryAnime(naruto)?.episodes.map((episode) => {
                return [episode.number, episode.status];
            })).toEqual([['1', 'paused'], ['2', 'paused']]);
            expect(updates.filter((job) => {
                return job.status === 'paused';
            }).map((job) => {
                return job.episode;
            })).toEqual(['1', '2']);
            expect(queue.isHeld()).toBe(false);
            expect(heldChanges).toEqual([]);
            // The places the paused episodes left go to the other anime, which was waiting.
            expect(statuses(queue)).toEqual([['Naruto 1', 'paused'], ['Naruto 2', 'paused'], ['Bleach 5', 'running']]);
        });

        it('pauses where it is an episode that waits, which has nothing downloaded to keep', () => {
            const { queue, db, bleach } = twoAnime();

            queue.pauseAnimes([bleach]);

            expect(statuses(queue)).toEqual([['Naruto 1', 'running'], ['Naruto 2', 'running'], ['Bleach 5', 'paused']]);
            expect(db.getLibraryAnime(bleach)?.episodes[0]?.status).toBe('paused');
        });

        it('does nothing for an unknown id, for no ids, and for an episode that is paused or over', () => {
            const { queue, downloads, naruto } = twoAnime();
            queue.pauseAnimes([naruto]);
            const before = queue.list();

            queue.pauseAnimes([9999]);
            queue.pauseAnimes([]);

            expect(queue.list()).toEqual(before);
            expect(downloads[0]?.cancel).toHaveBeenCalledTimes(1);
        });

        it('tells the screen of the library once', () => {
            const { queue, state, naruto, bleach } = twoAnime();
            const before = state.libraryChanges;

            queue.pauseAnimes([naruto, bleach]);

            expect(state.libraryChanges).toBe(before + 1);
        });
    });

    describe('resumeAnimes', () => {
        it('queues again the paused episodes of the anime, and leaves the paused ones of another anime as they are', async () => {
            const { queue, downloads, naruto, bleach } = twoAnime();
            queue.pauseAnimes([naruto, bleach]);
            downloads[0]?.finish({ status: 'cancelled' });
            downloads[1]?.finish({ status: 'cancelled' });
            await settleResults();
            expect(statuses(queue).map(([, status]) => {
                return status;
            })).toEqual(['paused', 'paused', 'paused']);

            queue.resumeAnimes([naruto]);

            expect(statuses(queue)).toEqual([['Naruto 1', 'running'], ['Naruto 2', 'running'], ['Bleach 5', 'paused']]);
            expect(downloads).toHaveLength(4);
            expect(downloads[2]?.options.episode).toBe('1');
            expect(downloads[2]?.options.downloadDir).toBe(downloads[0]?.options.downloadDir);
        });

        it('does nothing for the episodes that are running or waiting, for an unknown id and for no ids', () => {
            const { queue, downloads, naruto, bleach } = twoAnime();
            const before = statuses(queue);

            queue.resumeAnimes([naruto, bleach]);
            queue.resumeAnimes([9999]);
            queue.resumeAnimes([]);

            expect(statuses(queue)).toEqual(before);
            expect(downloads).toHaveLength(2);
        });

        it('starts an episode resumed in a held queue, and keeps the rest waiting', async () => {
            const { queue, downloads, naruto } = twoAnime();
            queue.pauseAll();
            downloads[0]?.finish({ status: 'cancelled' });
            downloads[1]?.finish({ status: 'cancelled' });
            await settleResults();

            queue.resumeAnimes([naruto]);

            expect(queue.isHeld()).toBe(true);
            expect(downloads.map((item) => {
                return item.options.episode;
            })).toEqual(['1', '2', '1', '2']);
            expect(statuses(queue)).toEqual([['Naruto 1', 'running'], ['Naruto 2', 'running'], ['Bleach 5', 'queued']]);
        });
    });

    describe('cancelAnimes', () => {
        it('cancels the episodes that are going on, the ones that wait and the ones that are paused, and leaves the other anime alone', async () => {
            const { queue, downloads, db, removeDirectory, naruto } = twoAnime();

            queue.cancelAnimes([naruto]);

            expect(downloads[0]?.cancel).toHaveBeenCalledTimes(1);
            expect(downloads[1]?.cancel).toHaveBeenCalledTimes(1);
            downloads[0]?.finish({ status: 'cancelled' });
            downloads[1]?.finish({ status: 'cancelled' });
            await settleResults();

            expect(statuses(queue)).toEqual([['Naruto 1', 'cancelled'], ['Naruto 2', 'cancelled'], ['Bleach 5', 'running']]);
            expect(db.getLibraryAnime(naruto)?.episodes.map((episode) => {
                return episode.status;
            })).toEqual(['cancelled', 'cancelled']);
            expect(removeDirectory.mock.calls.map((call) => {
                return call[0];
            })).toEqual([downloads[0]?.options.downloadDir, downloads[1]?.options.downloadDir]);
        });

        it('cancels on the spot the episodes that wait or are paused, deleting what they kept', async () => {
            const { queue, downloads, db, removeDirectory, bleach, naruto } = twoAnime();
            queue.pauseAnimes([naruto]);
            downloads[0]?.finish({ status: 'cancelled' });
            downloads[1]?.finish({ status: 'cancelled' });
            await settleResults();
            removeDirectory.mockClear();

            queue.cancelAnimes([naruto, bleach]);
            // Bleach took the place the paused ones left, so its run ends as cancelled.
            expect(downloads[2]?.cancel).toHaveBeenCalledTimes(1);
            downloads[2]?.finish({ status: 'cancelled' });
            await settleResults();

            expect(statuses(queue).map(([, status]) => {
                return status;
            })).toEqual(['cancelled', 'cancelled', 'cancelled']);
            expect(db.getLibraryAnime(naruto)?.episodes.map((episode) => {
                return episode.status;
            })).toEqual(['cancelled', 'cancelled']);
            expect(removeDirectory).toHaveBeenCalledWith(join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 1'));
            expect(removeDirectory).toHaveBeenCalledWith(join(DOWNLOADS, DEFAULT_ANIME_FOLDER, 'Naruto', 'Episode 2'));
        });

        it('cancels every anime when all of them are given, and starts nothing after', async () => {
            const { queue, downloads, naruto, bleach } = twoAnime();

            queue.cancelAnimes([naruto, bleach]);
            downloads[0]?.finish({ status: 'cancelled' });
            downloads[1]?.finish({ status: 'cancelled' });
            await settleResults();

            expect(statuses(queue).map(([, status]) => {
                return status;
            })).toEqual(['cancelled', 'cancelled', 'cancelled']);
            expect(downloads).toHaveLength(2);
            expect(queue.pendingCount()).toBe(0);
        });

        it('keeps the episodes that were already cancelled, and does nothing for an unknown id or for no ids', async () => {
            const { queue, downloads, naruto } = twoAnime();
            queue.cancelAnimes([naruto]);
            downloads[0]?.finish({ status: 'cancelled' });
            downloads[1]?.finish({ status: 'cancelled' });
            await settleResults();
            const before = queue.list();

            queue.cancelAnimes([naruto]);
            queue.cancelAnimes([9999]);
            queue.cancelAnimes([]);

            expect(queue.list()).toEqual(before);
            expect(downloads[0]?.cancel).toHaveBeenCalledTimes(1);
        });
    });
});
