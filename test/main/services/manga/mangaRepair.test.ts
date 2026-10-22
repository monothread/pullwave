import type { MangaChapter, MangaSummary } from '@shared/manga';
import type { ChapterDownloadResult, ChapterRepairOptions, ChapterRunResult } from '@main/services/manga/mangaChapterDownloader';
import { MangaDb } from '@main/services/manga/mangaDb';
import { MangaRepair } from '@main/services/manga/mangaRepair';

const MANGA: MangaSummary = { remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: 'http://127.0.0.1:1/t.jpg' };
const CHAPTER: MangaChapter = { remoteId: 11, name: 'Romance Dawn', number: 1, dateUploaded: 1700000000000, scanlator: 'G', sourceOrder: 1 };
const FILE = '/m/One Piece/Romance Dawn.cbz';
const DETAILS = { author: 'Oda', artist: 'Oda', description: 'Pirates', genres: ['Action'], url: null, status: 'ongoing' as const };

type RepairResult = ChapterRunResult<ChapterDownloadResult>;

function setup(options: { status?: 'incomplete' | 'done' | 'idle'; filePath?: string | null; exists?: boolean; result?: RepairResult | Promise<RepairResult> } = {}) {
    const db = new MangaDb(':memory:', () => {
        return 5000;
    });
    const manga = db.upsertManga(MANGA);
    db.saveDetails(manga.id, { ...DETAILS, url: 'https://example.org/op' });
    const chapter = db.ensureChapter(manga.id, CHAPTER);
    if (options.status === 'incomplete' || options.status === undefined) {
        db.markIncomplete(chapter.id, options.filePath === undefined ? FILE : (options.filePath ?? ''), 100, 5);
    } else if (options.status === 'done') {
        db.markDone(chapter.id, FILE, 100, 5);
    }
    if (options.filePath === null) {
        (db as unknown as { run: (sql: string, ...params: unknown[]) => void }).run('UPDATE chapter SET file_path = NULL WHERE id = ?', chapter.id);
    }
    const repairs: ChapterRepairOptions[] = [];
    const signals: AbortSignal[] = [];
    const repair = vi.fn((repairOptions: ChapterRepairOptions, signal: AbortSignal): Promise<RepairResult> => {
        repairs.push(repairOptions);
        signals.push(signal);
        return Promise.resolve(options.result ?? { status: 'done', value: { filePath: FILE, sizeBytes: 300, pageCount: 5, missingPages: [] } });
    });
    const pathExists = vi.fn(() => {
        return options.exists ?? true;
    });
    const changes = { count: 0 };
    const service = new MangaRepair({
        db,
        repair,
        pathExists,
        onLibraryChanged: () => {
            changes.count += 1;
        }
    });
    return { service, db, manga, chapter, repair, repairs, signals, pathExists, changes };
}

describe('MangaRepair', () => {
    it('downloads again the missing pages with what the chapter and its manga are, and makes the chapter whole when none is lacking', async () => {
        const { service, db, chapter, repairs, pathExists, changes } = setup();
        const before = db.getChapter(chapter.id);
        await expect(service.repair(chapter.id, null)).resolves.toEqual({ ok: true, value: { missing: [] } });
        expect(pathExists).toHaveBeenCalledWith(FILE);
        expect(repairs).toEqual([
            {
                chapterRemoteId: 11,
                seriesTitle: 'One Piece',
                chapter: before,
                details: { author: 'Oda', artist: 'Oda', description: 'Pirates', genres: ['Action'] },
                filePath: FILE,
                pageCount: 5,
                pageIndex: null
            }
        ]);
        expect(db.getChapter(chapter.id)).toMatchObject({ status: 'done', filePath: FILE, sizeBytes: 300, pageCount: 5, error: null });
        expect(changes.count).toBe(1);
    });

    it('asks for the one page the reader is on', async () => {
        const { service, repairs, chapter } = setup();
        await service.repair(chapter.id, 3);
        expect(repairs[0]).toMatchObject({ pageIndex: 3 });
    });

    it('keeps the chapter incomplete, with its new size, when some pages are still lacking', async () => {
        const { service, db, chapter, changes } = setup({ result: { status: 'done', value: { filePath: FILE, sizeBytes: 250, pageCount: 5, missingPages: [1, 4] } } });
        await expect(service.repair(chapter.id, null)).resolves.toEqual({ ok: true, value: { missing: [1, 4] } });
        expect(db.getChapter(chapter.id)).toMatchObject({ status: 'incomplete', filePath: FILE, sizeBytes: 250, pageCount: 5 });
        expect(changes.count).toBe(1);
    });

    it('gives the error when the pages could not be downloaded, and leaves the chapter as it was', async () => {
        const error = { code: 'REQUEST_FAILED' as const, message: 'The server answered 500 for a page' };
        const { service, db, chapter, changes } = setup({ result: { status: 'error', error } });
        await expect(service.repair(chapter.id, 2)).resolves.toEqual({ ok: false, error });
        expect(db.getChapter(chapter.id)).toMatchObject({ status: 'incomplete', sizeBytes: 100 });
        expect(changes.count).toBe(0);
    });

    it('reports a run that was cancelled as an error', async () => {
        const { service, chapter, changes } = setup({ result: { status: 'cancelled' } });
        await expect(service.repair(chapter.id, null)).resolves.toEqual({ ok: false, error: { code: 'UNKNOWN', message: 'The pages were not downloaded.' } });
        expect(changes.count).toBe(0);
    });

    it.each([
        ['a chapter that is whole', { status: 'done' as const }],
        ['a chapter that is not downloaded', { status: 'idle' as const }],
        ['a chapter with no file', { filePath: null }],
        ['a chapter whose file is gone', { exists: false }]
    ])('refuses %s', async (_label, options) => {
        const { service, chapter, repair, changes } = setup(options);
        await expect(service.repair(chapter.id, null)).resolves.toEqual({ ok: false, error: { code: 'INVALID_REQUEST', message: 'The chapter has no pages to download again.' } });
        expect(repair).not.toHaveBeenCalled();
        expect(changes.count).toBe(0);
    });

    it('refuses a chapter that is not in the library', async () => {
        const { service, repair } = setup();
        await expect(service.repair(999, null)).resolves.toEqual({ ok: false, error: { code: 'INVALID_REQUEST', message: 'The chapter has no pages to download again.' } });
        expect(repair).not.toHaveBeenCalled();
    });

    it('does not run two downloads of the same chapter together, and allows another one once the first ends', async () => {
        let finish: (result: RepairResult) => void = () => {
            return undefined;
        };
        const pending = new Promise<RepairResult>((resolve) => {
            finish = resolve;
        });
        const { service, chapter, repair } = setup({ result: pending });
        const first = service.repair(chapter.id, null);
        await expect(service.repair(chapter.id, 1)).resolves.toEqual({ ok: false, error: { code: 'INVALID_REQUEST', message: 'The pages of the chapter are being downloaded already.' } });
        expect(repair).toHaveBeenCalledTimes(1);
        finish({ status: 'done', value: { filePath: FILE, sizeBytes: 300, pageCount: 5, missingPages: [] } });
        await expect(first).resolves.toEqual({ ok: true, value: { missing: [] } });
        await expect(service.repair(chapter.id, null)).resolves.toEqual({ ok: false, error: { code: 'INVALID_REQUEST', message: 'The chapter has no pages to download again.' } });
    });

    it('allows another try after the first one failed', async () => {
        const { service, chapter, repair } = setup({ result: { status: 'error', error: { code: 'UNKNOWN', message: 'x' } } });
        await service.repair(chapter.id, null);
        await service.repair(chapter.id, null);
        expect(repair).toHaveBeenCalledTimes(2);
    });
});

describe('MangaRepair the pages of every incomplete chapter', () => {
    // One Piece with chapters 1 to 5 (the oldest has the lowest order) and Bleach with chapter 1; chapters 1, 3 and 4 of One Piece and the
    // one of Bleach are incomplete, 2 is whole and 5 is not downloaded.
    function library(results: Record<number, RepairResult> = {}) {
        const db = new MangaDb(':memory:', () => {
            return 5000;
        });
        const onePiece = db.upsertManga(MANGA);
        const bleach = db.upsertManga({ remoteId: 8, sourceId: '123', title: 'Bleach', thumbnailUrl: null });
        const chapters = [1, 2, 3, 4, 5].map((number) => {
            return db.ensureChapter(onePiece.id, { ...CHAPTER, remoteId: 10 + number, name: `Chapter ${number}`, number, sourceOrder: number });
        });
        const other = db.ensureChapter(bleach.id, { ...CHAPTER, remoteId: 80, name: 'Chapter 1', number: 1, sourceOrder: 1 });
        [chapters[0]!, chapters[2]!, chapters[3]!, other].forEach((item) => {
            db.markIncomplete(item.id, `/m/${item.name}-${String(item.mangaId)}.cbz`, 100, 5);
        });
        db.markDone(chapters[1]!.id, '/m/Chapter 2.cbz', 100, 5);
        const order: number[] = [];
        const signals: AbortSignal[] = [];
        const repair = vi.fn((repairOptions: ChapterRepairOptions, signal: AbortSignal): Promise<RepairResult> => {
            order.push(repairOptions.chapterRemoteId);
            signals.push(signal);
            return Promise.resolve(results[repairOptions.chapterRemoteId] ?? { status: 'done', value: { filePath: repairOptions.filePath, sizeBytes: 300, pageCount: 5, missingPages: [] } });
        });
        const changes = { count: 0 };
        const service = new MangaRepair({
            db,
            repair,
            pathExists: () => {
                return true;
            },
            onLibraryChanged: () => {
                changes.count += 1;
            }
        });
        return { service, db, onePiece, bleach, chapters, other, order, signals, repair, changes };
    }

    it('repairs the incomplete chapters of the mangas it is given, the oldest first, and only them', async () => {
        const { service, db, onePiece, bleach, chapters, other, order, changes } = library();
        await service.repairMissing([onePiece.id, bleach.id, 999]);
        expect(order).toEqual([11, 13, 14, 80]);
        expect(db.getChapter(chapters[0]!.id)).toMatchObject({ status: 'done', sizeBytes: 300 });
        expect(db.getChapter(chapters[1]!.id)).toMatchObject({ status: 'done', filePath: '/m/Chapter 2.cbz', sizeBytes: 100 });
        expect(db.getChapter(chapters[4]!.id)).toMatchObject({ status: 'idle', filePath: null });
        expect(db.getChapter(other.id)).toMatchObject({ status: 'done' });
        expect(changes.count).toBe(4);
    });

    it('does one chapter at a time', async () => {
        const { service, onePiece, repair } = library();
        let running = 0;
        let most = 0;
        repair.mockImplementation((repairOptions) => {
            running += 1;
            most = Math.max(most, running);
            return new Promise<RepairResult>((resolve) => {
                setTimeout(() => {
                    running -= 1;
                    resolve({ status: 'done', value: { filePath: repairOptions.filePath, sizeBytes: 1, pageCount: 5, missingPages: [] } });
                }, 1);
            });
        });
        await service.repairMissing([onePiece.id]);
        expect(repair).toHaveBeenCalledTimes(3);
        expect(most).toBe(1);
    });

    it('goes on with the next chapter when one cannot be repaired, which stays incomplete', async () => {
        const { service, db, onePiece, chapters, order } = library({ 11: { status: 'error', error: { code: 'REQUEST_FAILED', message: 'down' } }, 13: { status: 'done', value: { filePath: '/m/Chapter 3-1.cbz', sizeBytes: 250, pageCount: 5, missingPages: [2] } } });
        await expect(service.repairMissing([onePiece.id])).resolves.toBeUndefined();
        expect(order).toEqual([11, 13, 14]);
        expect(db.getChapter(chapters[0]!.id)).toMatchObject({ status: 'incomplete', sizeBytes: 100 });
        expect(db.getChapter(chapters[2]!.id)).toMatchObject({ status: 'incomplete', sizeBytes: 250 });
        expect(db.getChapter(chapters[3]!.id)).toMatchObject({ status: 'done' });
    });

    it('does nothing for mangas that have no incomplete chapter', async () => {
        const { service, repair } = library();
        await service.repairMissing([]);
        await service.repairMissing([999]);
        expect(repair).not.toHaveBeenCalled();
    });

    it('gives the same signal to every chapter, not aborted while the app runs', async () => {
        const { service, onePiece, signals } = library();
        await service.repairMissing([onePiece.id]);
        expect(signals).toHaveLength(3);
        expect(new Set(signals).size).toBe(1);
        expect(signals[0]!.aborted).toBe(false);
    });
});

describe('MangaRepair when the app closes', () => {
    it('aborts the download that is going on, waits for it to end and refuses new ones', async () => {
        let finish: (result: RepairResult) => void = () => {
            return undefined;
        };
        const { service, chapter, repair, signals, changes } = setup({
            result: new Promise<RepairResult>((resolve) => {
                finish = resolve;
            })
        });
        const running = service.repair(chapter.id, null);
        expect(signals[0]!.aborted).toBe(false);
        const closing = service.shutdown();
        expect(signals[0]!.aborted).toBe(true);
        let closed = false;
        void closing.then(() => {
            closed = true;
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(closed).toBe(false);
        finish({ status: 'cancelled' });
        await closing;
        await expect(running).resolves.toEqual({ ok: false, error: { code: 'UNKNOWN', message: 'The pages were not downloaded.' } });
        expect(changes.count).toBe(0);
        await expect(service.repair(chapter.id, null)).resolves.toEqual({ ok: false, error: { code: 'INVALID_REQUEST', message: 'The app is closing.' } });
        expect(repair).toHaveBeenCalledTimes(1);
    });

    it('ends at once when nothing is going on', async () => {
        const { service } = setup();
        await expect(service.shutdown()).resolves.toBeUndefined();
    });

    it('does not start the next chapters of a repair of many', async () => {
        const db = new MangaDb(':memory:');
        const manga = db.upsertManga(MANGA);
        const ids = [1, 2, 3].map((number) => {
            const saved = db.ensureChapter(manga.id, { ...CHAPTER, remoteId: 10 + number, name: `Chapter ${number}`, number, sourceOrder: number });
            db.markIncomplete(saved.id, `/m/${number}.cbz`, 1, 5);
            return saved.id;
        });
        const holder: { service: MangaRepair | null } = { service: null };
        const order: number[] = [];
        const service = new MangaRepair({
            db,
            repair: (repairOptions) => {
                order.push(repairOptions.chapterRemoteId);
                void holder.service?.shutdown();
                return Promise.resolve<RepairResult>({ status: 'cancelled' });
            },
            pathExists: () => {
                return true;
            },
            onLibraryChanged: () => {
                return undefined;
            }
        });
        holder.service = service;
        await service.repairMissing([manga.id]);
        expect(order).toEqual([11]);
        expect(ids.map((id) => {
            return db.getChapter(id)?.status;
        })).toEqual(['incomplete', 'incomplete', 'incomplete']);
    });
});
