import type { MangaChapter, MangaDetails, MangaDownloadRequest, MangaJob, MangaOutputFormat } from '@shared/manga';
import type { ChapterDownloadHandle, ChapterDownloadOptions, ChapterRunResult, ChapterDownloadResult } from '@main/services/manga/mangaChapterDownloader';
import { MangaDb } from '@main/services/manga/mangaDb';
import { MANGA_DOWNLOAD_LIMITS, MAX_TRIES, MangaDownloadQueue, type MangaDownloadLimits, type MangaQueueSettings } from '@main/services/manga/mangaDownloadQueue';

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

function setup(
    settings: Partial<MangaQueueSettings> = {},
    system: { platform?: NodeJS.Platform; existing?: string[]; failDirectory?: boolean; pages?: Record<string, number>; db?: MangaDb; limits?: MangaDownloadLimits | null } = {}
) {
    const db =
        system.db ??
        new MangaDb(':memory:', () => {
            return 1000;
        });
    const counted: string[] = [];
    const downloads: Download[] = [];
    const updates: MangaJob[] = [];
    const removed: string[] = [];
    const ensured: string[] = [];
    const state = { settings: { mangaDirectory: '', mangaFormat: 'cbz' as MangaOutputFormat, ...settings }, libraryChanges: 0, existing: [...(system.existing ?? [])] };
    const heldChanges: boolean[] = [];
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
        countCompletePages: (workDirectory) => {
            counted.push(workDirectory);
            return system.pages?.[workDirectory] ?? 0;
        },
        onJobUpdate: (job) => {
            updates.push(job);
        },
        onLibraryChanged: () => {
            state.libraryChanges += 1;
        },
        onHeldChange: (held) => {
            heldChanges.push(held);
        },
        // Two sources, one chapter each, unless the test says otherwise (null: the fixed limits of the app).
        ...(system.limits === null ? {} : { limits: system.limits ?? { sources: 2, perSource: 1 } })
    });
    return { db, queue, downloads, updates, removed, ensured, state, counted, heldChanges };
}

// A library with One Piece and its chapters as the app left them (the queue of the app that opens again starts from it).
function libraryWith(chapters: MangaChapter[]): { db: MangaDb; mangaId: number } {
    const db = new MangaDb(':memory:', () => {
        return 1000;
    });
    const manga = db.upsertManga({ remoteId: 7, sourceId: 'src-a', title: 'One Piece', thumbnailUrl: null });
    db.registerChapters(manga.id, chapters);
    return { db, mangaId: manga.id };
}

const ONE_PIECE = `${DOWNLOADS}/Pullwave Manga/One Piece`;

async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

const DONE = (filePath: string): Result => {
    return { status: 'done', value: { filePath, sizeBytes: 4096, pageCount: 20 } };
};

describe('MangaDownloadQueue the order of what is queued', () => {
    it('starts with the oldest chapter and goes on to the next ones, whatever order they were sent in', async () => {
        const { queue, downloads } = setup({}, { limits: { sources: 5, perSource: 1 } });
        queue.enqueue(request([chapter(3), chapter(1), chapter(2)]));
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([1]);
        downloads[0]?.finish(DONE('/m/1.cbz'));
        await flush();
        downloads[1]?.finish(DONE('/m/2.cbz'));
        await flush();
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([1, 2, 3]);
    });
});

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
        const { queue, downloads } = setup({}, { limits: { sources: 5, perSource: 1 }, existing: [`${DOWNLOADS}/Pullwave Manga/One Piece/Chapter 1.cbz`] });
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
        const { queue, downloads } = setup({}, { limits: { sources: 2, perSource: 1 } });
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
        const { queue, downloads } = setup({}, { limits: { sources: 1, perSource: 1 } });
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
        const { queue, db, downloads } = setup({}, { limits: { sources: 1, perSource: 1 } });
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

describe('MangaDownloadQueue pause all and resume all', () => {
    function byRemote(db: MangaDb, remoteId: number) {
        return db.chaptersOf(1).find((item) => {
            return item.remoteId === remoteId;
        })!;
    }

    it('holds the queue, so the chapters that wait keep waiting, and ends the run of the ones that go on', async () => {
        const { queue, downloads, db, updates, heldChanges } = setup({}, { limits: { sources: 1, perSource: 1 } });
        queue.enqueue(request([chapter(1), chapter(2), chapter(3)]));
        expect(downloads).toHaveLength(1);
        expect(queue.isHeld()).toBe(false);

        queue.pauseAll();

        expect(queue.isHeld()).toBe(true);
        expect(heldChanges).toEqual([true]);
        expect(db.getChapter(byRemote(db, 2).id)?.status).toBe('queued');
        expect(db.getChapter(byRemote(db, 3).id)?.status).toBe('queued');
        expect(downloads[0]?.cancel).toHaveBeenCalledTimes(1);
        downloads[0]?.finish({ status: 'cancelled' });
        await flush();
        expect(db.getChapter(byRemote(db, 1).id)?.status).toBe('paused');
        // The place the paused chapter left is not taken: the queue is held.
        expect(downloads).toHaveLength(1);
        expect(queue.list().map((job) => {
            return [job.chapterName, job.status];
        })).toEqual([['Chapter 1', 'paused'], ['Chapter 2', 'queued'], ['Chapter 3', 'queued']]);
        expect(updates.filter((job) => {
            return job.status === 'paused';
        }).map((job) => {
            return job.chapterName;
        })).toEqual(['Chapter 1']);
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

    it('starts nothing new in a held queue, a new download or a retry, until everything goes on', async () => {
        const { queue, downloads, db } = setup({}, { limits: { sources: 2, perSource: 1 } });
        queue.pauseAll();
        queue.enqueue(request([chapter(1)]));
        queue.enqueue(request([chapter(5)], { manga: { remoteId: 8, sourceId: 'src-b', title: 'Bleach', thumbnailUrl: null } }));
        expect(downloads).toEqual([]);
        expect(queue.list().map((job) => {
            return job.status;
        })).toEqual(['queued', 'queued']);
        const failed = db.chaptersOf(2)[0]!.id;
        queue.cancel(failed);
        queue.retry(failed);
        expect(downloads).toEqual([]);
        queue.resumeAll();
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([1, 5]);
    });

    it('starts at once a chapter resumed by itself in a held queue, and keeps the rest waiting', async () => {
        const { queue, downloads, db } = setup({}, { limits: { sources: 1, perSource: 1 } });
        queue.enqueue(request([chapter(1), chapter(2)]));
        queue.pauseAll();
        downloads[0]?.finish({ status: 'cancelled' });
        await flush();
        const first = byRemote(db, 1).id;

        queue.resume(first);

        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([1, 1]);
        expect(downloads[1]?.options.outputPath).toBe(downloads[0]?.options.outputPath);
        expect(queue.isHeld()).toBe(true);
        downloads[1]?.finish(DONE('/m/1.cbz'));
        await flush();
        // The chapter that waits still waits for RESUME ALL.
        expect(downloads).toHaveLength(2);
        expect(db.getChapter(byRemote(db, 2).id)?.status).toBe('queued');
        queue.resumeAll();
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([1, 1, 2]);
    });

    it('tries again in a held queue a chapter resumed by itself whose run failed for a while', async () => {
        const { queue, downloads, db } = setup({}, { limits: { sources: 1, perSource: 1 } });
        queue.enqueue(request([chapter(1)]));
        queue.pauseAll();
        downloads[0]?.finish({ status: 'cancelled' });
        await flush();
        queue.resume(byRemote(db, 1).id);
        downloads[1]?.finish({ status: 'error', error: { code: 'REQUEST_FAILED', message: 'timeout' } });
        await flush();
        expect(downloads).toHaveLength(3);
        expect(db.getChapter(byRemote(db, 1).id)?.status).toBe('downloading');
    });

    it('forgets that a chapter was resumed by itself once it is cancelled, or the queue is paused again', async () => {
        const { queue, downloads, db } = setup({}, { limits: { sources: 1, perSource: 1 } });
        queue.enqueue(request([chapter(1), chapter(2), chapter(3), chapter(4)]));
        const [first, second, third, fourth] = [1, 2, 3, 4].map((remoteId) => {
            return byRemote(db, remoteId).id;
        });
        queue.pauseAll();
        downloads[0]?.finish({ status: 'cancelled' });
        await flush();
        // More paused chapters; the first goes on by itself and takes the only place, the next two wait for it.
        [second, third, fourth].forEach((id) => {
            queue.cancel(id!);
            db.markPaused(id!);
        });
        [first, second, third].forEach((id) => {
            queue.resume(id!);
        });
        expect(queue.list().map((job) => {
            return [job.chapterName, job.status];
        })).toEqual([['Chapter 1', 'running'], ['Chapter 2', 'queued'], ['Chapter 3', 'queued'], ['Chapter 4', 'cancelled']]);

        // A cancelled chapter tried again waits for RESUME ALL; the other one resumed by itself starts.
        queue.cancel(third!);
        queue.retry(third!);
        downloads[1]?.finish(DONE('/m/1.cbz'));
        await flush();
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([1, 1, 2]);
        expect(db.getChapter(third!)?.status).toBe('queued');

        // One more is resumed by itself while the second runs; PAUSE ALL again forgets it.
        db.markPaused(fourth!);
        queue.resume(fourth!);
        queue.pauseAll();
        downloads[2]?.finish({ status: 'cancelled' });
        await flush();
        expect(downloads).toHaveLength(3);
        expect(queue.list().map((job) => {
            return [job.chapterName, job.status];
        })).toEqual([['Chapter 2', 'paused'], ['Chapter 3', 'queued'], ['Chapter 4', 'queued']]);
    });

    it('leaves the chapters that are over as they are', async () => {
        const { queue, downloads, db } = setup({}, { limits: { sources: 1, perSource: 1 } });
        queue.enqueue(request([chapter(1), chapter(2)]));
        downloads[0]?.finish(DONE('/m/1.cbz'));
        await flush();
        queue.cancel(byRemote(db, 2).id);
        downloads[1]?.finish({ status: 'cancelled' });
        await flush();
        queue.pauseAll();
        expect(db.getChapter(byRemote(db, 1).id)?.status).toBe('done');
        expect(db.getChapter(byRemote(db, 2).id)?.status).toBe('cancelled');
    });

    it('goes on with every paused chapter, as many at once as the limit allows, each source one at a time', async () => {
        const { queue, downloads, db, heldChanges } = setup({}, { limits: { sources: 2, perSource: 1 } });
        queue.enqueue(request([chapter(1), chapter(2), chapter(3)]));
        queue.enqueue(request([chapter(1)], { manga: { remoteId: 8, sourceId: 'src-b', title: 'Naruto', thumbnailUrl: null } }));
        queue.pauseAll();
        downloads.forEach((item) => {
            item.finish({ status: 'cancelled' });
        });
        await flush();
        const started = downloads.length;

        queue.resumeAll();

        expect(heldChanges).toEqual([true, false]);
        expect(downloads.length - started).toBe(2);
        const running = queue.list().filter((job) => {
            return job.status === 'running';
        });
        expect(running.map((job) => {
            return job.sourceId;
        }).sort()).toEqual(['src-a', 'src-b']);
        expect(queue.list().filter((job) => {
            return job.status === 'queued';
        })).toHaveLength(2);
        expect(db.getChapter(byRemote(db, 1).id)?.status).toBe('downloading');
    });

    it('does not start anything when nothing is paused', () => {
        const { queue, downloads, heldChanges } = setup({}, { limits: { sources: 1, perSource: 1 } });
        queue.enqueue(request([chapter(1), chapter(2)]));
        queue.resumeAll();
        expect(downloads).toHaveLength(1);
        expect(downloads[0]?.cancel).not.toHaveBeenCalled();
        expect(heldChanges).toEqual([]);
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
        const { queue, downloads, db } = setup({}, { limits: { sources: 1, perSource: 1 } });
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
        const { queue, downloads, db, updates } = setup({}, { limits: { sources: 1, perSource: 1 } });
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

    it('cancels a chapter whose pause was asked for and has not ended yet: the run ends as cancelled and its pages go', async () => {
        const { queue, downloads, db, removed, updates } = setup();
        queue.enqueue(request([chapter(1)]));
        const id = db.findChapter(1, 1)!.id;
        queue.pause(id);
        queue.cancel(id);
        expect(downloads[0]?.cancel).toHaveBeenCalledTimes(2);
        downloads[0]?.finish({ status: 'cancelled' });
        await flush();
        expect(db.getChapter(id)).toMatchObject({ status: 'cancelled', error: null });
        expect(db.outputPathOf(id)).toBeNull();
        expect(updates.at(-1)).toMatchObject({ chapterName: 'Chapter 1', status: 'cancelled' });
        expect(removed).toEqual([`${ONE_PIECE}/Chapter 1.cbz.part`]);
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
        const { queue, downloads, db } = setup({}, { limits: { sources: 5, perSource: 1 } });
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

    it('queues the chapters that are named, the oldest first, and tells the screen', async () => {
        const { queue, downloads, db, state } = setup({}, { limits: { sources: 5, perSource: 1 } });
        const manga = db.upsertManga({ remoteId: 7, sourceId: 'src-a', title: 'One Piece', thumbnailUrl: null });
        db.registerChapters(manga.id, [chapter(1), chapter(2), chapter(3), chapter(4)]);
        const before = state.libraryChanges;
        queue.downloadChapters(manga.id, [4, 2, 99]);
        // One chapter at a time for a source, the oldest first.
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([2]);
        expect(queue.list().map((job) => {
            return [job.chapterName, job.status];
        })).toEqual([
            ['Chapter 2', 'running'],
            ['Chapter 4', 'queued']
        ]);
        // Once for the chapters that were queued, once for the download that started.
        expect(state.libraryChanges).toBe(before + 2);
        downloads[0]?.finish(DONE('/m/2.cbz'));
        await flush();
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([2, 4]);
    });

    it('does not queue again a chapter of the ones named that is downloaded or already waiting, and ignores a manga that is not there', async () => {
        const { queue, downloads, db } = setup({}, { limits: { sources: 5, perSource: 1 } });
        const manga = db.upsertManga({ remoteId: 7, sourceId: 'src-a', title: 'One Piece', thumbnailUrl: null });
        db.registerChapters(manga.id, [chapter(1), chapter(2)]);
        db.markDone(db.findChapter(manga.id, 1)!.id, '/m/1.cbz', 1, 1);
        queue.downloadChapters(manga.id, [1, 2]);
        queue.downloadChapters(manga.id, [2]);
        queue.downloadChapters(999, [1]);
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([2]);
    });

    it('keeps a paused chapter when it clears what is over, so it can still be cancelled', async () => {
        const { queue, downloads, db, removed } = setup({}, { limits: { sources: 1, perSource: 1 } });
        queue.enqueue(request([chapter(1), chapter(2)]));
        const paused = db.findChapter(1, 1)!.id;
        const waiting = db.findChapter(1, 2)!.id;
        queue.pause(paused);
        downloads[0]?.finish({ status: 'cancelled' });
        await flush();
        // The paused chapter left its place to the next one, which is cancelled.
        queue.cancel(waiting);
        downloads[1]?.finish({ status: 'cancelled' });
        await flush();
        queue.clearFinished();
        expect(queue.list().map((job) => {
            return [job.chapterName, job.status];
        })).toEqual([['Chapter 1', 'paused']]);
        queue.cancel(paused);
        expect(db.getChapter(paused)?.status).toBe('cancelled');
        expect(removed).toEqual([`${ONE_PIECE}/Chapter 2.cbz.part`, `${ONE_PIECE}/Chapter 1.cbz.part`]);
    });

    it('clears what is over and keeps what is going on', async () => {
        const { queue, downloads, db } = setup({}, { limits: { sources: 1, perSource: 1 } });
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

    it('forgets chapters that left the library: stops them, and deletes their pages and starts the next once the run has ended', async () => {
        const { queue, downloads, db, removed, state } = setup();
        queue.enqueue(request([chapter(1), chapter(2)]));
        const running = db.chaptersOf(1).find((item) => {
            return item.remoteId === 1;
        })!;
        queue.forget([running.id]);
        expect(downloads[0]?.cancel).toHaveBeenCalledTimes(1);
        // The run could still write a page: nothing is deleted and nothing takes its place yet.
        expect(removed).toEqual([]);
        expect(queue.list().map((job) => {
            return job.chapterName;
        })).toEqual(['Chapter 2']);
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([1]);
        expect(queue.hasRunsToEnd()).toBe(true);
        const changes = state.libraryChanges;
        downloads[0]?.finish({ status: 'cancelled' });
        await flush();
        expect(removed).toEqual([`${ONE_PIECE}/Chapter 1.cbz.part`]);
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([1, 2]);
        // The forgotten chapter is not settled: it is gone from the library.
        expect(db.getChapter(running.id)?.status).toBe('downloading');
        expect(state.libraryChanges).toBe(changes + 1);
    });

    it('forgets a chapter that waits or is paused at once, deleting the pages a paused one kept', async () => {
        const { queue, downloads, db, removed } = setup({}, { limits: { sources: 1, perSource: 1 } });
        queue.enqueue(request([chapter(1), chapter(2)]));
        const first = db.findChapter(1, 1)!.id;
        const second = db.findChapter(1, 2)!.id;
        queue.pause(first);
        downloads[0]?.finish({ status: 'cancelled' });
        await flush();
        queue.forget([first]);
        expect(removed).toEqual([`${ONE_PIECE}/Chapter 1.cbz.part`]);
        queue.forget([second]);
        expect(queue.list()).toEqual([]);
        expect(downloads[1]?.cancel).toHaveBeenCalledTimes(1);
    });
});

describe('MangaDownloadQueue the downloads at the same time', () => {
    function sourceRequest(sourceId: string, remoteId: number, chapters: MangaChapter[]): MangaDownloadRequest {
        return request(chapters, { manga: { remoteId, sourceId, title: `Manga ${sourceId}`, thumbnailUrl: null } });
    }

    function runningBySource(queue: MangaDownloadQueue): Record<string, number> {
        return queue.list().reduce<Record<string, number>>((runs, job) => {
            if (job.status === 'running') {
                runs[job.sourceId] = (runs[job.sourceId] ?? 0) + 1;
            }
            return runs;
        }, {});
    }

    it('are three sources with three chapters each, fixed', () => {
        expect(MANGA_DOWNLOAD_LIMITS).toEqual({ sources: 3, perSource: 3 });
    });

    it('downloads three chapters of a source at once, the chapters of one manga included, the oldest first', () => {
        const { queue, downloads } = setup({}, { limits: null });
        queue.enqueue(request([chapter(5), chapter(4), chapter(3), chapter(2), chapter(1)]));
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([1, 2, 3]);
        expect(queue.list().filter((job) => {
            return job.status === 'queued';
        }).map((job) => {
            return job.chapterName;
        })).toEqual(['Chapter 4', 'Chapter 5']);
    });

    it('downloads from three sources at once, nine chapters at most, and gives a free place to the next of the same source', async () => {
        const { queue, downloads } = setup({}, { limits: null });
        ['src-a', 'src-b', 'src-c', 'src-d'].forEach((sourceId, index) => {
            queue.enqueue(sourceRequest(sourceId, index + 1, [chapter(1), chapter(2), chapter(3), chapter(4)]));
        });
        expect(downloads).toHaveLength(9);
        expect(runningBySource(queue)).toEqual({ 'src-a': 3, 'src-b': 3, 'src-c': 3 });

        downloads[0]?.finish(DONE('/m/a1.cbz'));
        await flush();
        expect(downloads).toHaveLength(10);
        expect(downloads[9]?.options).toMatchObject({ chapterRemoteId: 4, seriesTitle: 'Manga src-a' });
        expect(runningBySource(queue)).toEqual({ 'src-a': 3, 'src-b': 3, 'src-c': 3 });
    });

    it('lets a fourth source in once one of the three has nothing more to download', async () => {
        const { queue, downloads } = setup({}, { limits: null });
        queue.enqueue(sourceRequest('src-a', 1, [chapter(1)]));
        queue.enqueue(sourceRequest('src-b', 2, [chapter(1)]));
        queue.enqueue(sourceRequest('src-c', 3, [chapter(1)]));
        queue.enqueue(sourceRequest('src-d', 4, [chapter(1), chapter(2)]));
        expect(runningBySource(queue)).toEqual({ 'src-a': 1, 'src-b': 1, 'src-c': 1 });
        downloads[0]?.finish(DONE('/m/a1.cbz'));
        await flush();
        expect(runningBySource(queue)).toEqual({ 'src-b': 1, 'src-c': 1, 'src-d': 2 });
    });

    it('counts a run that is ending for a forgotten chapter until it has ended', async () => {
        const { queue, downloads, db } = setup({}, { limits: { sources: 1, perSource: 1 } });
        queue.enqueue(request([chapter(1)]));
        queue.enqueue(request([chapter(5)], { manga: { remoteId: 8, sourceId: 'src-b', title: 'Bleach', thumbnailUrl: null } }));
        queue.forget([db.findChapter(1, 1)!.id]);
        expect(downloads).toHaveLength(1);
        downloads[0]?.finish({ status: 'cancelled' });
        await flush();
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([1, 5]);
    });
});

describe('MangaDownloadQueue where a chapter is made', () => {
    it('remembers in the library where a chapter is being made', () => {
        const { queue, db } = setup();
        queue.enqueue(request([chapter(1)]));
        expect(db.outputPathOf(db.findChapter(1, 1)!.id)).toBe(`${ONE_PIECE}/Chapter 1.cbz`);
    });

    it('goes on at the place a chapter had when the app was closed in the middle of it, from the pages it left', () => {
        const { db, mangaId } = libraryWith([chapter(1)]);
        const id = db.findChapter(mangaId, 1)!.id;
        db.markDownloading(id, `${ONE_PIECE}/Chapter 1 (2).cbz`);
        db.failInterrupted();
        const { queue, downloads } = setup({}, { db });
        queue.retry(id);
        expect(downloads[0]?.options).toMatchObject({ outputPath: `${ONE_PIECE}/Chapter 1 (2).cbz`, format: 'cbz' });
    });

    it('makes a chapter in the format of the place it had, even when the setting changed since', () => {
        const { db, mangaId } = libraryWith([chapter(1)]);
        const id = db.findChapter(mangaId, 1)!.id;
        db.markDownloading(id, `${ONE_PIECE}/Chapter 1.cbz`);
        db.markPaused(id);
        const { queue, downloads } = setup({ mangaFormat: 'folder' }, { db });
        queue.resume(id);
        expect(downloads[0]?.options).toMatchObject({ outputPath: `${ONE_PIECE}/Chapter 1.cbz`, format: 'cbz' });
    });

    it('does not go on at a place where the chapter is already, and takes a free one in the format of the settings', () => {
        const { db, mangaId } = libraryWith([chapter(1)]);
        const id = db.findChapter(mangaId, 1)!.id;
        db.markDownloading(id, `${ONE_PIECE}/Chapter 1.cbz`);
        db.failInterrupted();
        const { queue, downloads } = setup({ mangaFormat: 'folder' }, { db, existing: [`${ONE_PIECE}/Chapter 1.cbz`] });
        queue.retry(id);
        expect(downloads[0]?.options).toMatchObject({ outputPath: `${ONE_PIECE}/Chapter 1`, format: 'folder' });
        expect(db.outputPathOf(id)).toBe(`${ONE_PIECE}/Chapter 1`);
    });

    it('does not go on at a place another chapter claims, nor give a new chapter a place another one claims', () => {
        const { db, mangaId } = libraryWith([chapter(1), chapter(2, { name: 'Chapter 1', number: 1, scanlator: 'Other' })]);
        const first = db.findChapter(mangaId, 1)!.id;
        const second = db.findChapter(mangaId, 2)!.id;
        db.markDownloading(first, `${ONE_PIECE}/Chapter 1.cbz`);
        db.markPaused(first);
        db.setOutputPath(second, `${ONE_PIECE}/Chapter 1.cbz`);
        const { queue, downloads } = setup({}, { db });
        queue.retry(second);
        expect(downloads[0]?.options.outputPath).toBe(`${ONE_PIECE}/Chapter 1 (2).cbz`);
    });
});

describe('MangaDownloadQueue the chapters paused when the app last closed', () => {
    it('shows them again as paused, with the pages they kept, and tells nothing until something changes', () => {
        const { db, mangaId } = libraryWith([chapter(1), chapter(2), chapter(3)]);
        const first = db.findChapter(mangaId, 1)!.id;
        const second = db.findChapter(mangaId, 2)!.id;
        db.markDownloading(first, `${ONE_PIECE}/Chapter 1.cbz`);
        db.setPageCount(first, 20);
        db.markPaused(first);
        db.markDownloading(second, `${ONE_PIECE}/Chapter 2.cbz`);
        db.setPageCount(second, 10);
        db.markPaused(second);
        const { queue, updates, counted, downloads } = setup({}, { db, pages: { [`${ONE_PIECE}/Chapter 1.cbz.part`]: 5, [`${ONE_PIECE}/Chapter 2.cbz.part`]: 12 } });
        queue.restore();
        expect(queue.list()).toEqual([
            { chapterId: first, mangaId, mangaTitle: 'One Piece', chapterName: 'Chapter 1', sourceId: 'src-a', status: 'paused', pagesDone: 5, pageCount: 20, percent: 25, error: null },
            // More pages than the chapter has are not counted past its end.
            { chapterId: second, mangaId, mangaTitle: 'One Piece', chapterName: 'Chapter 2', sourceId: 'src-a', status: 'paused', pagesDone: 10, pageCount: 10, percent: 100, error: null }
        ]);
        expect(counted).toEqual([`${ONE_PIECE}/Chapter 1.cbz.part`, `${ONE_PIECE}/Chapter 2.cbz.part`]);
        expect(updates).toEqual([]);
        expect(downloads).toEqual([]);
        expect(queue.pendingCount()).toBe(0);
    });

    it('goes on with one from the place it had', () => {
        const { db, mangaId } = libraryWith([chapter(1)]);
        const id = db.findChapter(mangaId, 1)!.id;
        db.markDownloading(id, `${ONE_PIECE}/Chapter 1 (2).cbz`);
        db.markPaused(id);
        const { queue, downloads } = setup({}, { db, existing: [`${ONE_PIECE}/Chapter 1 (2).cbz.part`] });
        queue.restore();
        queue.resume(id);
        expect(downloads[0]?.options).toMatchObject({ outputPath: `${ONE_PIECE}/Chapter 1 (2).cbz`, format: 'cbz' });
        expect(db.getChapter(id)?.status).toBe('downloading');
    });

    it('goes on with all of them at once', () => {
        const { db, mangaId } = libraryWith([chapter(1)]);
        const id = db.findChapter(mangaId, 1)!.id;
        db.markPaused(id);
        const { queue, downloads } = setup({}, { db });
        queue.restore();
        queue.resumeAll();
        expect(downloads.map((item) => {
            return item.options.chapterRemoteId;
        })).toEqual([1]);
    });

    it('cancels one, deleting the pages it kept', () => {
        const { db, mangaId } = libraryWith([chapter(1)]);
        const id = db.findChapter(mangaId, 1)!.id;
        db.markDownloading(id, `${ONE_PIECE}/Chapter 1.cbz`);
        db.markPaused(id);
        const { queue, removed, updates } = setup({}, { db });
        queue.restore();
        queue.cancel(id);
        expect(db.getChapter(id)).toMatchObject({ status: 'cancelled', error: null });
        expect(db.outputPathOf(id)).toBeNull();
        expect(removed).toEqual([`${ONE_PIECE}/Chapter 1.cbz.part`]);
        expect(updates.at(-1)).toMatchObject({ chapterId: id, status: 'cancelled' });
    });

    it('finds the pages of one paused before its place was remembered, and remembers the place', () => {
        const { db, mangaId } = libraryWith([chapter(1)]);
        const id = db.findChapter(mangaId, 1)!.id;
        db.setPageCount(id, 8);
        db.markPaused(id);
        const work = `${ONE_PIECE}/Chapter 1.cbz.part`;
        const { queue, downloads } = setup({}, { db, existing: [work], pages: { [work]: 4 } });
        queue.restore();
        expect(queue.list()[0]).toMatchObject({ status: 'paused', pagesDone: 4, pageCount: 8, percent: 50 });
        expect(db.outputPathOf(id)).toBe(`${ONE_PIECE}/Chapter 1.cbz`);
        queue.resume(id);
        expect(downloads[0]?.options.outputPath).toBe(`${ONE_PIECE}/Chapter 1.cbz`);
    });

    it('skips, when it looks for those pages, a place that is downloaded or claimed by another chapter', () => {
        const { db, mangaId } = libraryWith([chapter(1), chapter(2, { name: 'Chapter 1', number: 1, scanlator: 'Other' })]);
        const id = db.findChapter(mangaId, 1)!.id;
        const other = db.findChapter(mangaId, 2)!.id;
        db.markPaused(id);
        db.markDownloading(other, `${ONE_PIECE}/Chapter 1 (2).cbz`);
        db.failInterrupted();
        const existing = [
            `${ONE_PIECE}/Chapter 1.cbz`,
            `${ONE_PIECE}/Chapter 1.cbz.part`,
            `${ONE_PIECE}/Chapter 1 (2).cbz.part`,
            `${ONE_PIECE}/Chapter 1 (3).cbz.part`
        ];
        const { queue } = setup({}, { db, existing });
        queue.restore();
        expect(db.outputPathOf(id)).toBe(`${ONE_PIECE}/Chapter 1 (3).cbz`);
    });

    it('starts over one whose pages are not found, at a free place', () => {
        const { db, mangaId } = libraryWith([chapter(1)]);
        const id = db.findChapter(mangaId, 1)!.id;
        db.setPageCount(id, 8);
        db.markPaused(id);
        const { queue, downloads, counted } = setup({}, { db, existing: [`${ONE_PIECE}/Chapter 1.cbz`] });
        queue.restore();
        expect(queue.list()[0]).toMatchObject({ status: 'paused', pagesDone: 0, pageCount: 8, percent: 0 });
        expect(counted).toEqual([]);
        expect(db.outputPathOf(id)).toBeNull();
        queue.resume(id);
        expect(downloads[0]?.options.outputPath).toBe(`${ONE_PIECE}/Chapter 1 (2).cbz`);
    });

    it('cancels one whose pages are not found without deleting anything', () => {
        const { db, mangaId } = libraryWith([chapter(1)]);
        const id = db.findChapter(mangaId, 1)!.id;
        db.markPaused(id);
        const { queue, removed } = setup({}, { db });
        queue.restore();
        queue.cancel(id);
        expect(db.getChapter(id)?.status).toBe('cancelled');
        expect(removed).toEqual([]);
    });

    it('gives a percent of 0 to one whose number of pages is not known', () => {
        const { db, mangaId } = libraryWith([chapter(1)]);
        const id = db.findChapter(mangaId, 1)!.id;
        db.markDownloading(id, `${ONE_PIECE}/Chapter 1.cbz`);
        db.markPaused(id);
        const { queue } = setup({}, { db, pages: { [`${ONE_PIECE}/Chapter 1.cbz.part`]: 3 } });
        queue.restore();
        expect(queue.list()[0]).toMatchObject({ pagesDone: 0, pageCount: 0, percent: 0 });
    });

    it('does not show a chapter twice when it is restored again', () => {
        const { db, mangaId } = libraryWith([chapter(1)]);
        db.markPaused(db.findChapter(mangaId, 1)!.id);
        const { queue } = setup({}, { db });
        queue.restore();
        queue.restore();
        expect(queue.list()).toHaveLength(1);
    });

    it('leaves out the chapters that are not paused', () => {
        const { db, mangaId } = libraryWith([chapter(1), chapter(2), chapter(3)]);
        db.markFailed(db.findChapter(mangaId, 1)!.id, 'cancelled', null);
        db.markDone(db.findChapter(mangaId, 2)!.id, '/m/2.cbz', 1, 1);
        const { queue } = setup({}, { db });
        queue.restore();
        expect(queue.list()).toEqual([]);
    });
});

describe('MangaDownloadQueue shutdown', () => {
    it('cancels what runs and deletes its pages, but keeps the pages of a paused one', async () => {
        const { queue, downloads, db, removed } = setup({}, { limits: { sources: 2, perSource: 1 } });
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
        // The paused one goes on from the same place when the app opens again.
        expect(db.outputPathOf(db.chaptersOf(1)[0]!.id)).toBe(`${ONE_PIECE}/Chapter 1.cbz`);
        expect(removed).toEqual([`${DOWNLOADS}/Pullwave Manga/Bleach/Chapter 10.cbz.part`]);
    });

    it('keeps as paused, for the next time the app opens, the chapters that wait in a held queue', async () => {
        const { queue, downloads, db } = setup({}, { limits: { sources: 1, perSource: 1 } });
        queue.enqueue(request([chapter(1), chapter(2)]));
        queue.pauseAll();
        downloads[0]?.finish({ status: 'cancelled' });
        await flush();
        await queue.shutdown(10);
        expect(db.chaptersOf(1).map((item) => {
            return [item.remoteId, item.status];
        })).toEqual([[2, 'paused'], [1, 'paused']]);
    });

    it('leaves the chapters that wait in a queue that is not held for the app to fail when it opens again', async () => {
        const { queue, downloads, db } = setup({}, { limits: { sources: 1, perSource: 1 } });
        queue.enqueue(request([chapter(1), chapter(2)]));
        const closing = queue.shutdown(50);
        downloads[0]?.finish({ status: 'cancelled' });
        await closing;
        expect(db.findChapter(1, 2)?.status).toBe('queued');
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
