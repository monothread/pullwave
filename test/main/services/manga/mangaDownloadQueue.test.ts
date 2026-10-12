import type { MangaChapter, MangaDetails, MangaDownloadRequest, MangaJob, MangaOutputFormat } from '@shared/manga';
import type { ChapterDownloadHandle, ChapterDownloadOptions, ChapterRunResult, ChapterDownloadResult } from '@main/services/manga/mangaChapterDownloader';
import { MangaDb } from '@main/services/manga/mangaDb';
import { MAX_TRIES, MangaDownloadQueue, type MangaQueueSettings } from '@main/services/manga/mangaDownloadQueue';

type Result = ChapterRunResult<ChapterDownloadResult>;

interface Download {
    options: ChapterDownloadOptions;
    cancel: ReturnType<typeof vi.fn>;
    finish: (result: Result) => void;
}

const DOWNLOADS = '/home/me/Downloads';
const DETAILS: MangaDetails = {
    remoteId: 7,
    sourceId: 'src-a',
    title: 'One Piece',
    thumbnailUrl: null,
    url: null,
    author: 'Oda',
    artist: null,
    description: 'Pirates',
    genres: ['Action'],
    status: 'ongoing'
};

function chapter(remoteId: number, overrides: Partial<MangaChapter> = {}): MangaChapter {
    return { remoteId, name: `Chapter ${remoteId}`, number: remoteId, dateUploaded: null, scanlator: null, sourceOrder: remoteId, ...overrides };
}

function request(chapters: MangaChapter[], overrides: Partial<MangaDownloadRequest> = {}): MangaDownloadRequest {
    return { manga: { remoteId: 7, sourceId: 'src-a', title: 'One Piece', thumbnailUrl: null }, details: null, chapters, ...overrides };
}

function setup(settings: Partial<MangaQueueSettings> = {}, system: { platform?: NodeJS.Platform; existing?: string[]; failDirectory?: boolean } = {}) {
    const db = new MangaDb(':memory:', () => {
        return 1000;
    });
    const downloads: Download[] = [];
    const updates: MangaJob[] = [];
    const removed: string[] = [];
    const ensured: string[] = [];
    const state = { settings: { maxConcurrent: 2, mangaDirectory: '', mangaFormat: 'cbz' as MangaOutputFormat, ...settings }, libraryChanges: 0, existing: [...(system.existing ?? [])] };
    const queue = new MangaDownloadQueue({
        db,
        download: (options): ChapterDownloadHandle => {
            let finish: (result: Result) => void = () => {
                return undefined;
            };
            const result = new Promise<Result>((resolve) => {
                finish = resolve;
            });
            const cancel = vi.fn();
            downloads.push({ options, cancel, finish });
            return { result, cancel };
        },
        getSettings: () => {
            return state.settings;
        },
        defaultDownloadDir: DOWNLOADS,
        platform: system.platform ?? 'linux',
        ensureDirectory: (path) => {
            if (system.failDirectory === true) {
                throw new Error('EACCES: permission denied');
            }
            ensured.push(path);
        },
        pathExists: (path) => {
            return state.existing.includes(path);
        },
        removePath: (path) => {
            removed.push(path);
        },
        onJobUpdate: (job) => {
            updates.push(job);
        },
        onLibraryChanged: () => {
            state.libraryChanges += 1;
        }
    });
    return { db, queue, downloads, updates, removed, ensured, state };
}

async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

const DONE = (filePath: string): Result => {
    return { status: 'done', value: { filePath, sizeBytes: 4096, pageCount: 20 } };
};

describe('MangaDownloadQueue enqueue', () => {
    it('puts the manga and the chapters in the library, starts the first one and tells how it goes', () => {
        const { queue, db, downloads, updates, state } = setup();
        const library = queue.enqueue(request([chapter(1), chapter(2)], { details: DETAILS }));
        expect(library).toMatchObject({ title: 'One Piece', author: 'Oda', genres: ['Action'], status: 'ongoing' });
        expect(library?.chapters.map((item) => {
            return [item.remoteId, item.status];
        })).toEqual([[2, 'queued'], [1, 'downloading']]);
        expect(downloads).toHaveLength(1);
        expect(downloads[0]?.options).toMatchObject({
            chapterRemoteId: 1,
            seriesTitle: 'One Piece',
            chapter: expect.objectContaining({ remoteId: 1, name: 'Chapter 1', number: 1, scanlator: null }),
            details: { author: 'Oda', artist: null, description: 'Pirates', genres: ['Action'] },
            format: 'cbz',
            outputPath: `${DOWNLOADS}/Pullwave Manga/One Piece/Chapter 1.cbz`
        });
        expect(updates.map((job) => {
            return [job.chapterName, job.status];
        })).toEqual([['Chapter 1', 'queued'], ['Chapter 2', 'queued'], ['Chapter 1', 'running']]);
        expect(state.libraryChanges).toBeGreaterThan(0);
        expect(queue.pendingCount()).toBe(2);
        expect(queue.hasRunsToEnd()).toBe(true);
        expect(db.list()).toHaveLength(1);
    });

    it('does not save details it was not given', () => {
        const { queue, db } = setup();
        queue.enqueue(request([chapter(1)]));
        expect(db.list()[0]).toMatchObject({ author: null, genres: [] });
    });

    it('leaves a chapter that is downloaded, or already waiting, as it is', () => {
        const { queue, db, downloads } = setup();
        queue.enqueue(request([chapter(1)]));
        downloads[0]?.finish(DONE('/m/1.cbz'));
        return flush().then(() => {
            queue.enqueue(request([chapter(1), chapter(2)]));
            queue.enqueue(request([chapter(2)]));
            expect(downloads.map((item) => {
                return item.options.chapterRemoteId;
            })).toEqual([1, 2]);
            expect(db.chaptersOf(1)).toHaveLength(2);
        });
    });

    it('names a chapter without a name after its number', () => {
        const { queue, updates } = setup();
        queue.enqueue(request([chapter(5, { name: '', number: 5 })]));
        expect(updates[0]?.chapterName).toBe('Chapter 5');
    });

    it('uses the folder and the format of the settings', () => {
        const { queue, downloads } = setup({ mangaDirectory: '/mnt/manga', mangaFormat: 'folder' });
        queue.enqueue(request([chapter(3)]));
        expect(downloads[0]?.options).toMatchObject({ format: 'folder', outputPath: '/mnt/manga/One Piece/Chapter 3' });
    });

    it('creates the folder of the manga before it starts', () => {
        const { queue, ensured } = setup();
        queue.enqueue(request([chapter(1)]));
        expect(ensured).toEqual([`${DOWNLOADS}/Pullwave Manga/One Piece`]);
    });

    it('gives another name to a chapter whose place is taken, also by one that is being made', () => {
        const { queue, downloads } = setup({ maxConcurrent: 5 }, { existing: [`${DOWNLOADS}/Pullwave Manga/One Piece/Chapter 1.cbz`] });
        queue.enqueue(request([chapter(1), chapter(1, { remoteId: 2, scanlator: 'B' })]));
        queue.enqueue(request([chapter(1, { remoteId: 3 })], { manga: { remoteId: 8, sourceId: 'src-b', title: 'One Piece', thumbnailUrl: null } }));
        expect(downloads.map((item) => {
            return item.options.outputPath;
        })).toEqual([`${DOWNLOADS}/Pullwave Manga/One Piece/Chapter 1 (2).cbz`, `${DOWNLOADS}/Pullwave Manga/One Piece/Chapter 1 (3).cbz`]);
    });

    it('treats a work folder left by an earlier run as taking the place', () => {
        const { queue, downloads } = setup({}, { existing: [`${DOWNLOADS}/Pullwave Manga/One Piece/Chapter 1.cbz.part`] });
        queue.enqueue(request([chapter(1)]));
        expect(downloads[0]?.options.outputPath).toBe(`${DOWNLOADS}/Pullwave Manga/One Piece/Chapter 1 (2).cbz`);
    });

    it('uses the rules of Windows for the names when the files are there', () => {
        const { queue, downloads } = setup({ mangaDirectory: 'C:\\Manga' }, { platform: 'win32' });
        queue.enqueue(request([chapter(1)], { manga: { remoteId: 7, sourceId: 'src-a', title: 'CON', thumbnailUrl: null } }));
        expect(downloads[0]?.options.outputPath).toBe('C:\\Manga\\_CON\\Chapter 1.cbz');
    });
});

describe('MangaDownloadQueue concurrency', () => {
    it('downloads one chapter at a time for a source and a few sources together', () => {
        const { queue, downloads } = setup({ maxConcurrent: 2 });
        queue.enqueue(request([chapter(1), chapter(2)]));
        queue.enqueue(request([chapter(10)], { manga: { remoteId: 8, sourceId: 'src-b', title: 'Bleach', thumbnailUrl: null } }));
        queue.enqueue(request([chapter(20)], { manga: { remoteId: 9, sourceId: 'src-c', title: 'Naruto', thumbnailUrl: null } }));
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([1, 10]);
    });

    it('starts the next chapter of the source as soon as the one before ends', async () => {
        const { queue, downloads } = setup();
        queue.enqueue(request([chapter(1), chapter(2)]));
        downloads[0]?.finish(DONE('/m/1.cbz'));
        await flush();
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([1, 2]);
    });

    it('does not run more than the limit', () => {
        const { queue, downloads } = setup({ maxConcurrent: 1 });
        queue.enqueue(request([chapter(1)]));
        queue.enqueue(request([chapter(10)], { manga: { remoteId: 8, sourceId: 'src-b', title: 'Bleach', thumbnailUrl: null } }));
        expect(downloads).toHaveLength(1);
    });
});

describe('MangaDownloadQueue progress and results', () => {
    it('records the number of pages and reports the progress, skipping changes too small to see', () => {
        const { queue, downloads, updates, db } = setup();
        queue.enqueue(request([chapter(1)]));
        downloads[0]?.options.onPageCount(400);
        downloads[0]?.options.onProgress(1, 400);
        downloads[0]?.options.onProgress(2, 400);
        downloads[0]?.options.onProgress(200, 400);
        downloads[0]?.options.onProgress(400, 400);
        expect(db.chaptersOf(1)[0]?.pageCount).toBe(400);
        // One page of 400 is a quarter of one percent: too small to tell the screen.
        const progress = updates.filter((job) => {
            return job.pagesDone > 0;
        });
        expect(progress.map((job) => {
            return [job.pagesDone, job.pageCount, job.percent];
        })).toEqual([[2, 400, 0.5], [200, 400, 50], [400, 400, 100]]);
        expect(progress.at(-1)).toMatchObject({ pagesDone: 400, pageCount: 400, percent: 100, status: 'running' });
    });

    it('keeps a finished chapter in the library and out of the downloads', async () => {
        const { queue, downloads, updates, db, state } = setup();
        queue.enqueue(request([chapter(1)]));
        const before = state.libraryChanges;
        downloads[0]?.finish(DONE('/m/Chapter 1.cbz'));
        await flush();
        expect(db.chaptersOf(1)[0]).toMatchObject({ status: 'done', filePath: '/m/Chapter 1.cbz', sizeBytes: 4096, pageCount: 20, downloadedAt: 1000 });
        expect(updates.at(-1)).toMatchObject({ status: 'done', percent: 100, pagesDone: 20, pageCount: 20 });
        expect(queue.list()).toEqual([]);
        expect(state.libraryChanges).toBeGreaterThan(before);
        expect(queue.hasRunsToEnd()).toBe(false);
    });

    it('tries a chapter again when it fails, and leaves it as an error after the last try', async () => {
        const { queue, downloads, updates, db, removed } = setup();
        queue.enqueue(request([chapter(1)]));
        for (let attempt = 1; attempt <= MAX_TRIES; attempt += 1) {
            expect(downloads).toHaveLength(attempt);
            downloads[attempt - 1]?.finish({ status: 'error', error: { code: 'REQUEST_FAILED', message: 'site down' } });
            await flush();
        }
        expect(downloads).toHaveLength(MAX_TRIES);
        expect(updates.at(-1)).toMatchObject({ status: 'error', error: { code: 'REQUEST_FAILED', message: 'site down' } });
        expect(db.chaptersOf(1)[0]).toMatchObject({ status: 'error', error: { code: 'REQUEST_FAILED', message: 'site down' } });
        expect(removed).toEqual([`${DOWNLOADS}/Pullwave Manga/One Piece/Chapter 1.cbz.part`]);
        expect(downloads.map((item) => {
            return item.options.outputPath;
        })).toEqual(new Array(MAX_TRIES).fill(`${DOWNLOADS}/Pullwave Manga/One Piece/Chapter 1.cbz`));
    });

    it.each([['EMPTY_CHAPTER'], ['DISK']] as const)('does not try again after %s', async (code) => {
        const { queue, downloads, db } = setup();
        queue.enqueue(request([chapter(1)]));
        downloads[0]?.finish({ status: 'error', error: { code, message: 'no' } });
        await flush();
        expect(downloads).toHaveLength(1);
        expect(db.chaptersOf(1)[0]).toMatchObject({ status: 'error', error: { code, message: 'no' } });
    });

    it('lets the next chapter of the source go while a failed one waits for its next try', async () => {
        const { queue, downloads } = setup();
        queue.enqueue(request([chapter(1), chapter(2)]));
        downloads[0]?.finish({ status: 'error', error: { code: 'REQUEST_FAILED', message: 'x' } });
        await flush();
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([1, 1]);
    });

    it('resets the tries once a chapter is downloaded', async () => {
        const { queue, downloads } = setup();
        queue.enqueue(request([chapter(1)]));
        downloads[0]?.finish({ status: 'error', error: { code: 'REQUEST_FAILED', message: 'x' } });
        await flush();
        downloads[1]?.finish(DONE('/m/1.cbz'));
        await flush();
        expect(queue.list()).toEqual([]);
    });

    it('leaves a chapter as an error when its folder cannot be made', () => {
        const { queue, downloads, db, updates } = setup({}, { failDirectory: true });
        queue.enqueue(request([chapter(1)]));
        expect(downloads).toHaveLength(0);
        expect(updates.at(-1)).toMatchObject({ status: 'error', error: { code: 'DISK', message: 'EACCES: permission denied' } });
        expect(db.chaptersOf(1)[0]?.status).toBe('error');
    });

    it('drops a job whose chapter is no longer in the library', () => {
        const { queue, db, downloads } = setup({ maxConcurrent: 1 });
        queue.enqueue(request([chapter(1)], { manga: { remoteId: 7, sourceId: 'src-a', title: 'One Piece', thumbnailUrl: null } }));
        queue.enqueue(request([chapter(5)], { manga: { remoteId: 8, sourceId: 'src-b', title: 'Bleach', thumbnailUrl: null } }));
        db.removeManga(2);
        downloads[0]?.finish(DONE('/m/1.cbz'));
        return flush().then(() => {
            expect(downloads).toHaveLength(1);
            expect(queue.list()).toEqual([]);
        });
    });
});

describe('MangaDownloadQueue pause, resume and cancel', () => {
    it('pauses a running chapter keeping its pages, and goes on from the same place', async () => {
        const { queue, downloads, db, removed, updates } = setup();
        queue.enqueue(request([chapter(1)]));
        queue.pause(db.chaptersOf(1)[0]!.id);
        expect(downloads[0]?.cancel).toHaveBeenCalledTimes(1);
        downloads[0]?.finish({ status: 'cancelled' });
        await flush();
        expect(db.chaptersOf(1)[0]?.status).toBe('paused');
        expect(updates.at(-1)?.status).toBe('paused');
        expect(removed).toEqual([]);
        queue.resume(db.chaptersOf(1)[0]!.id);
        expect(downloads).toHaveLength(2);
        expect(downloads[1]?.options.outputPath).toBe(downloads[0]?.options.outputPath);
        expect(db.chaptersOf(1)[0]?.status).toBe('downloading');
    });

    it('lets a paused chapter leave its place to the next one', async () => {
        const { queue, downloads, db } = setup();
        queue.enqueue(request([chapter(1), chapter(2)]));
        queue.pause(db.chaptersOf(1).find((item) => {
            return item.remoteId === 1;
        })!.id);
        downloads[0]?.finish({ status: 'cancelled' });
        await flush();
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([1, 2]);
    });

    it('ignores a pause for a chapter that is not running, and a resume for one that is not paused', () => {
        const { queue, downloads, db } = setup({ maxConcurrent: 1 });
        queue.enqueue(request([chapter(1), chapter(2)]));
        const waiting = db.chaptersOf(1).find((item) => {
            return item.remoteId === 2;
        })!;
        queue.pause(waiting.id);
        queue.pause(999);
        queue.resume(waiting.id);
        expect(downloads).toHaveLength(1);
        expect(downloads[0]?.cancel).not.toHaveBeenCalled();
    });

    it('cancels a running chapter and deletes its pages', async () => {
        const { queue, downloads, db, removed, updates } = setup();
        queue.enqueue(request([chapter(1)]));
        queue.cancel(db.chaptersOf(1)[0]!.id);
        expect(downloads[0]?.cancel).toHaveBeenCalledTimes(1);
        downloads[0]?.finish({ status: 'cancelled' });
        await flush();
        expect(db.chaptersOf(1)[0]).toMatchObject({ status: 'cancelled', error: null });
        expect(updates.at(-1)?.status).toBe('cancelled');
        expect(removed).toEqual([`${DOWNLOADS}/Pullwave Manga/One Piece/Chapter 1.cbz.part`]);
    });

    it('cancels a chapter that waits, without a run to end', () => {
        const { queue, downloads, db, updates } = setup({ maxConcurrent: 1 });
        queue.enqueue(request([chapter(1), chapter(2)]));
        const waiting = db.chaptersOf(1).find((item) => {
            return item.remoteId === 2;
        })!;
        queue.cancel(waiting.id);
        expect(db.getChapter(waiting.id)).toMatchObject({ status: 'cancelled' });
        expect(updates.at(-1)).toMatchObject({ chapterName: 'Chapter 2', status: 'cancelled' });
        expect(downloads).toHaveLength(1);
    });

    it('cancels a paused chapter and deletes its pages', async () => {
        const { queue, downloads, db, removed } = setup();
        queue.enqueue(request([chapter(1)]));
        const id = db.chaptersOf(1)[0]!.id;
        queue.pause(id);
        downloads[0]?.finish({ status: 'cancelled' });
        await flush();
        queue.cancel(id);
        expect(db.getChapter(id)?.status).toBe('cancelled');
        expect(removed).toEqual([`${DOWNLOADS}/Pullwave Manga/One Piece/Chapter 1.cbz.part`]);
    });

    it('ignores a cancel for a chapter it does not know', () => {
        const { queue, downloads } = setup();
        queue.cancel(999);
        expect(downloads).toEqual([]);
    });
});

describe('MangaDownloadQueue retry, missing and housekeeping', () => {
    it('queues a chapter that failed again, with its tries counted anew', async () => {
        const { queue, downloads, db } = setup();
        queue.enqueue(request([chapter(1)]));
        downloads[0]?.finish({ status: 'error', error: { code: 'EMPTY_CHAPTER', message: 'none' } });
        await flush();
        queue.retry(db.chaptersOf(1)[0]!.id);
        expect(downloads).toHaveLength(2);
        expect(db.chaptersOf(1)[0]?.status).toBe('downloading');
    });

    it('does not queue a chapter that is downloaded, is already active or is not known', async () => {
        const { queue, downloads, db } = setup();
        queue.enqueue(request([chapter(1)]));
        const id = db.chaptersOf(1)[0]!.id;
        queue.retry(id);
        queue.retry(999);
        downloads[0]?.finish(DONE('/m/1.cbz'));
        await flush();
        queue.retry(id);
        expect(downloads).toHaveLength(1);
    });

    it('queues every chapter of a manga that is not downloaded, and skips the ones that are', async () => {
        const { queue, downloads, db } = setup({ maxConcurrent: 5 });
        const manga = db.upsertManga({ remoteId: 7, sourceId: 'src-a', title: 'One Piece', thumbnailUrl: null });
        db.registerChapters(manga.id, [chapter(1), chapter(2), chapter(3)]);
        db.markDone(db.chaptersOf(manga.id).find((item) => {
            return item.remoteId === 2;
        })!.id, '/m/2.cbz', 1, 1);
        queue.downloadMissing([manga.id, 999]);
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([1]);
        downloads[0]?.finish(DONE('/m/1.cbz'));
        await flush();
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([1, 3]);
    });

    it('clears what is over and keeps what is going on', async () => {
        const { queue, downloads, db } = setup({ maxConcurrent: 1 });
        queue.enqueue(request([chapter(1), chapter(2), chapter(3)]));
        queue.cancel(db.chaptersOf(1).find((item) => {
            return item.remoteId === 3;
        })!.id);
        expect(queue.list().map((job) => {
            return job.status;
        }).sort()).toEqual(['cancelled', 'queued', 'running']);
        queue.clearFinished();
        expect(queue.list().map((job) => {
            return job.status;
        }).sort()).toEqual(['queued', 'running']);
        expect(downloads).toHaveLength(1);
    });

    it('forgets chapters that left the library: stops them, deletes their pages and starts the next', async () => {
        const { queue, downloads, db, removed } = setup();
        queue.enqueue(request([chapter(1), chapter(2)]));
        const running = db.chaptersOf(1).find((item) => {
            return item.remoteId === 1;
        })!;
        queue.forget([running.id]);
        expect(downloads[0]?.cancel).toHaveBeenCalledTimes(1);
        expect(removed).toEqual([`${DOWNLOADS}/Pullwave Manga/One Piece/Chapter 1.cbz.part`]);
        expect(queue.list().map((job) => {
            return job.chapterName;
        })).toEqual(['Chapter 2']);
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([1, 2]);
        downloads[0]?.finish({ status: 'cancelled' });
        await flush();
        expect(db.getChapter(running.id)?.status).toBe('downloading');
    });
});

describe('MangaDownloadQueue shutdown', () => {
    it('cancels what runs and deletes its pages, but keeps the pages of a paused one', async () => {
        const { queue, downloads, db, removed } = setup({ maxConcurrent: 2 });
        queue.enqueue(request([chapter(1)]));
        queue.enqueue(request([chapter(10)], { manga: { remoteId: 8, sourceId: 'src-b', title: 'Bleach', thumbnailUrl: null } }));
        queue.pause(db.chaptersOf(1)[0]!.id);
        const closing = queue.shutdown(50);
        downloads.forEach((item) => {
            item.finish({ status: 'cancelled' });
        });
        await closing;
        expect(downloads[0]?.cancel).toHaveBeenCalled();
        expect(downloads[1]?.cancel).toHaveBeenCalled();
        expect(db.chaptersOf(1)[0]?.status).toBe('paused');
        expect(removed).toEqual([`${DOWNLOADS}/Pullwave Manga/Bleach/Chapter 10.cbz.part`]);
    });

    it('does not wait forever for a download that does not end', async () => {
        vi.useFakeTimers();
        try {
            const { queue, removed } = setup();
            queue.enqueue(request([chapter(1)]));
            const closing = queue.shutdown(100);
            await vi.advanceTimersByTimeAsync(100);
            await closing;
            expect(removed).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('starts nothing once it is closing', async () => {
        const { queue, downloads } = setup();
        await queue.shutdown(10);
        queue.enqueue(request([chapter(1)]));
        expect(downloads).toHaveLength(0);
        expect(queue.pendingCount()).toBe(1);
    });

    it('does nothing when nothing runs', async () => {
        const { queue, removed } = setup();
        await queue.shutdown(10);
        expect(removed).toEqual([]);
    });
});

describe('MangaDownloadQueue which chapters are new', () => {
    it('gives no time of arrival to the chapters a manga comes with, whether it is added or downloaded', () => {
        const { queue, db } = setup();
        const added = queue.addToLibrary(request([chapter(1), chapter(2)]));
        expect(added?.chapters.map((item) => {return item.addedAt})).toEqual([null, null]);
        const other = queue.enqueue(request([chapter(5)], { manga: { remoteId: 8, sourceId: 'src-a', title: 'Bleach', thumbnailUrl: null } }));
        expect(other?.chapters.map((item) => {return item.addedAt})).toEqual([null]);
        expect(db.list().flatMap((manga) => {return manga.chapters.map((item) => {return item.addedAt})})).toEqual([null, null, null]);
    });

    it('gives a time of arrival to the chapters added to a manga that was in the library already', () => {
        const { queue } = setup();
        queue.addToLibrary(request([chapter(1)]));
        const later = queue.addToLibrary(request([chapter(1), chapter(2), chapter(3)]));
        const byRemote = new Map(
            (later?.chapters ?? []).map((item) => {
                return [item.remoteId, item.addedAt];
            })
        );
        expect(byRemote.get(1)).toBeNull();
        expect(byRemote.get(2)).toBe(1000);
        expect(byRemote.get(3)).toBe(1000);
    });

    it('does the same when the chapters are added by downloading them', () => {
        const { queue } = setup();
        queue.addToLibrary(request([chapter(1)]));
        const later = queue.enqueue(request([chapter(4)]));
        expect(later?.chapters.find((item) => {return item.remoteId === 4})?.addedAt).toBe(1000);
    });
});
