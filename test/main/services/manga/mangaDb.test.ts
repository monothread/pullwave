import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { MangaChapter, MangaSummary } from '@shared/manga';
import { INTERRUPTED_MESSAGE, MangaDb } from '@main/services/manga/mangaDb';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';

const MANGA: MangaSummary = { remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: 'http://127.0.0.1:1/t.jpg' };

function chapter(remoteId: number, overrides: Partial<MangaChapter> = {}): MangaChapter {
    return { remoteId, name: `Chapter ${remoteId}`, number: remoteId, dateUploaded: 1700000000000, scanlator: null, sourceOrder: remoteId, ...overrides };
}

function setup() {
    const db = new MangaDb(':memory:', () => {
        return 5000;
    });
    return { db, manga: db.upsertManga(MANGA) };
}

afterEach(() => {
    cleanTempDirs();
});

describe('MangaDb schema', () => {
    it('applies the migrations and remembers the version', () => {
        expect(new MangaDb(':memory:').schemaVersion).toBe(3);
    });

    it('keeps the library in a file and reads it again', () => {
        const path = join(makeTempDir(), 'sub', 'manga.db');
        const first = new MangaDb(path);
        const saved = first.upsertManga(MANGA);
        first.close();
        expect(existsSync(path)).toBe(true);
        const second = new MangaDb(path);
        expect(second.schemaVersion).toBe(3);
        expect(second.getManga(saved.id)).toEqual(saved);
        second.close();
    });
});

describe('MangaDb mangas', () => {
    it('adds a manga to the library', () => {
        const { manga } = setup();
        expect(manga).toEqual({
            id: 1,
            sourceId: '123',
            remoteId: 7,
            title: 'One Piece',
            thumbnailUrl: 'http://127.0.0.1:1/t.jpg',
            url: null,
            author: null,
            artist: null,
            description: null,
            genres: [],
            status: 'unknown',
            createdAt: 5000
        });
    });

    it('is the same entry when the same manga of the same source is added again, with its title and cover refreshed', () => {
        const { db, manga } = setup();
        const again = db.upsertManga({ ...MANGA, title: 'One Piece (new)', thumbnailUrl: null });
        expect(again).toEqual({ ...manga, title: 'One Piece (new)', thumbnailUrl: null });
        expect(db.list()).toHaveLength(1);
    });

    it('keeps the same number of two sources apart', () => {
        const { db } = setup();
        const other = db.upsertManga({ ...MANGA, sourceId: '999' });
        expect(other.id).toBe(2);
        expect(db.list()).toHaveLength(2);
    });

    it('keeps what the source says about a manga, and keeps it when the manga is added again', () => {
        const { db, manga } = setup();
        db.saveDetails(manga.id, { url: 'https://dex.example/one-piece', author: 'Oda', artist: 'Oda E.', description: 'Pirates', genres: ['Action', 'Adventure'], status: 'ongoing' });
        const expected = { url: 'https://dex.example/one-piece', author: 'Oda', artist: 'Oda E.', description: 'Pirates', genres: ['Action', 'Adventure'], status: 'ongoing' };
        expect(db.getManga(manga.id)).toMatchObject(expected);
        expect(db.upsertManga({ ...MANGA, title: 'One Piece 2' })).toMatchObject({ ...expected, title: 'One Piece 2' });
    });

    it('reads damaged details as empty', () => {
        const { db, manga } = setup();
        const raw = db as unknown as { run: (sql: string, ...params: unknown[]) => void };
        raw.run("UPDATE manga SET genres = 'not json', status = 'weird' WHERE id = ?", manga.id);
        expect(db.getManga(manga.id)).toMatchObject({ genres: [], status: 'unknown' });
        raw.run("UPDATE manga SET genres = '{\"a\":1}' WHERE id = ?", manga.id);
        expect(db.getManga(manga.id)?.genres).toEqual([]);
        raw.run("UPDATE manga SET genres = '[\"x\", 5, \"y\"]' WHERE id = ?", manga.id);
        expect(db.getManga(manga.id)?.genres).toEqual(['x', 'y']);
    });

    it('finds a manga by id and by source', () => {
        const { db, manga } = setup();
        expect(db.getManga(manga.id)).toEqual(manga);
        expect(db.findManga('123', 7)).toEqual(manga);
        expect(db.getManga(99)).toBeNull();
        expect(db.findManga('123', 8)).toBeNull();
        expect(db.findManga('other', 7)).toBeNull();
    });

    it('lists the library by title, ignoring case', () => {
        const { db } = setup();
        db.upsertManga({ ...MANGA, remoteId: 8, title: 'bleach' });
        db.upsertManga({ ...MANGA, remoteId: 9, title: 'Akira' });
        expect(db.list().map((manga) => {
            return manga.title;
        })).toEqual(['Akira', 'bleach', 'One Piece']);
    });

    it('gives a manga with its chapters, and null for one that is not there', () => {
        const { db, manga } = setup();
        db.registerChapters(manga.id, [chapter(1)]);
        expect(db.getLibraryManga(manga.id)).toMatchObject({ id: manga.id, title: 'One Piece', chapters: [{ remoteId: 1 }] });
        expect(db.getLibraryManga(99)).toBeNull();
    });
});

describe('MangaDb chapters', () => {
    it('registers the chapters as idle, newest first', () => {
        const { db, manga } = setup();
        db.registerChapters(manga.id, [chapter(1), chapter(3), chapter(2)]);
        const chapters = db.chaptersOf(manga.id);
        expect(chapters.map((item) => {
            return item.remoteId;
        })).toEqual([3, 2, 1]);
        expect(chapters[0]).toEqual({
            id: 2,
            mangaId: manga.id,
            remoteId: 3,
            name: 'Chapter 3',
            number: 3,
            dateUploaded: 1700000000000,
            scanlator: null,
            sourceOrder: 3,
            status: 'idle',
            pageCount: 0,
            filePath: null,
            sizeBytes: null,
            error: null,
            downloadedAt: null
        });
    });

    it('keeps the state of a chapter it has already and updates what the source says now', () => {
        const { db, manga } = setup();
        db.registerChapters(manga.id, [chapter(1)]);
        const first = db.chaptersOf(manga.id)[0]!;
        db.markDone(first.id, '/m/Chapter 1.cbz', 100, 20);
        db.registerChapters(manga.id, [chapter(1, { name: 'Corrected', number: 1.5, scanlator: 'G', sourceOrder: 5 })]);
        expect(db.chaptersOf(manga.id)).toHaveLength(1);
        expect(db.getChapter(first.id)).toMatchObject({ name: 'Corrected', number: 1.5, scanlator: 'G', sourceOrder: 5, status: 'done', filePath: '/m/Chapter 1.cbz' });
    });

    it('registers nothing and keeps the library when a chapter cannot be saved', () => {
        const { db, manga } = setup();
        expect(() => {
            db.registerChapters(manga.id, [chapter(1), { ...chapter(2), name: undefined as unknown as string }]);
        }).toThrow();
        expect(db.chaptersOf(manga.id)).toEqual([]);
    });

    it('puts one chapter in the library and gives it back', () => {
        const { db, manga } = setup();
        const ensured = db.ensureChapter(manga.id, chapter(4));
        expect(ensured).toMatchObject({ remoteId: 4, status: 'idle' });
        expect(db.ensureChapter(manga.id, chapter(4)).id).toBe(ensured.id);
    });

    it('finds a chapter by id and by its number on the server', () => {
        const { db, manga } = setup();
        const saved = db.ensureChapter(manga.id, chapter(4));
        expect(db.getChapter(saved.id)).toEqual(saved);
        expect(db.findChapter(manga.id, 4)).toEqual(saved);
        expect(db.getChapter(99)).toBeNull();
        expect(db.findChapter(manga.id, 5)).toBeNull();
    });

    it('orders chapters with the same position by when they were added', () => {
        const { db, manga } = setup();
        db.registerChapters(manga.id, [chapter(1, { sourceOrder: 0 }), chapter(2, { sourceOrder: 0 })]);
        expect(db.chaptersOf(manga.id).map((item) => {
            return item.remoteId;
        })).toEqual([1, 2]);
    });

    it('reads an unknown stored status as an error', () => {
        const { db, manga } = setup();
        const saved = db.ensureChapter(manga.id, chapter(1));
        (db as unknown as { run: (sql: string, ...params: unknown[]) => void }).run("UPDATE chapter SET status = 'weird' WHERE id = ?", saved.id);
        expect(db.getChapter(saved.id)?.status).toBe('error');
    });
});

describe('MangaDb states of a download', () => {
    function withChapter() {
        const { db, manga } = setup();
        const saved = db.ensureChapter(manga.id, chapter(1));
        return { db, manga, id: saved.id };
    }

    it('goes queued, downloading, paused and done', () => {
        const { db, id } = withChapter();
        db.markQueued(id);
        expect(db.getChapter(id)?.status).toBe('queued');
        db.markDownloading(id);
        expect(db.getChapter(id)?.status).toBe('downloading');
        db.setPageCount(id, 30);
        expect(db.getChapter(id)?.pageCount).toBe(30);
        db.markPaused(id);
        expect(db.getChapter(id)?.status).toBe('paused');
        db.markDone(id, '/m/Chapter 1.cbz', 4096, 30);
        expect(db.getChapter(id)).toMatchObject({ status: 'done', filePath: '/m/Chapter 1.cbz', sizeBytes: 4096, pageCount: 30, error: null, downloadedAt: 5000 });
    });

    it('keeps the error of a failure and clears it when the download starts again', () => {
        const { db, id } = withChapter();
        db.markFailed(id, 'error', { code: 'IMAGE', message: 'page 3 is not an image' });
        expect(db.getChapter(id)).toMatchObject({ status: 'error', error: { code: 'IMAGE', message: 'page 3 is not an image' } });
        db.markDownloading(id);
        expect(db.getChapter(id)).toMatchObject({ status: 'downloading', error: null });
        db.markFailed(id, 'error', { code: 'DISK', message: 'full' });
        db.markQueued(id);
        expect(db.getChapter(id)?.error).toBeNull();
    });

    it('records a cancellation without an error', () => {
        const { db, id } = withChapter();
        db.markFailed(id, 'cancelled', null);
        expect(db.getChapter(id)).toMatchObject({ status: 'cancelled', error: null });
    });

    it('turns what was queued or downloading when the app closed into an error, and leaves the rest', () => {
        const { db, manga } = setup();
        const ids = [1, 2, 3, 4, 5].map((number) => {
            return db.ensureChapter(manga.id, chapter(number)).id;
        });
        db.markQueued(ids[0]!);
        db.markDownloading(ids[1]!);
        db.markPaused(ids[2]!);
        db.markDone(ids[3]!, '/m/4.cbz', 1, 1);
        db.failInterrupted();
        const states = ids.map((id) => {
            return db.getChapter(id);
        });
        expect(states[0]).toMatchObject({ status: 'error', error: { code: 'UNKNOWN', message: INTERRUPTED_MESSAGE } });
        expect(states[1]).toMatchObject({ status: 'error', error: { code: 'UNKNOWN', message: INTERRUPTED_MESSAGE } });
        expect(states.slice(2).map((state) => {
            return state?.status;
        })).toEqual(['paused', 'done', 'idle']);
    });
});

describe('MangaDb the page of the manga on its site', () => {
    it('is kept with the details, replaced when the source says another one, and cleared when it says none', () => {
        const { db, manga } = setup();
        const details = { url: 'https://dex.example/one-piece', author: null, artist: null, description: null, genres: [], status: 'unknown' as const };
        db.saveDetails(manga.id, details);
        expect(db.getManga(manga.id)?.url).toBe('https://dex.example/one-piece');
        db.saveDetails(manga.id, { ...details, url: 'https://other.example/op' });
        expect(db.getLibraryManga(manga.id)?.url).toBe('https://other.example/op');
        db.saveDetails(manga.id, { ...details, url: null });
        expect(db.getManga(manga.id)?.url).toBeNull();
    });

    it('is added to a library made before it existed, keeping what was in it', () => {
        const path = join(makeTempDir(), 'old.db');
        const old = new DatabaseSync(path);
        old.exec(`CREATE TABLE manga (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, remote_id INTEGER NOT NULL, title TEXT NOT NULL, thumbnail_url TEXT, created_at INTEGER NOT NULL, UNIQUE (source_id, remote_id));
            CREATE TABLE chapter (id INTEGER PRIMARY KEY AUTOINCREMENT, manga_id INTEGER NOT NULL REFERENCES manga (id) ON DELETE CASCADE, remote_id INTEGER NOT NULL, name TEXT NOT NULL, number REAL, date_uploaded INTEGER, scanlator TEXT, source_order INTEGER NOT NULL, status TEXT NOT NULL, page_count INTEGER NOT NULL DEFAULT 0, file_path TEXT, size_bytes INTEGER, error_code TEXT, error_raw TEXT, downloaded_at INTEGER, UNIQUE (manga_id, remote_id));
            ALTER TABLE manga ADD COLUMN author TEXT; ALTER TABLE manga ADD COLUMN artist TEXT; ALTER TABLE manga ADD COLUMN description TEXT; ALTER TABLE manga ADD COLUMN genres TEXT; ALTER TABLE manga ADD COLUMN status TEXT;
            INSERT INTO manga (source_id, remote_id, title, thumbnail_url, created_at, author) VALUES ('s', 1, 'Old', NULL, 3, 'Someone');
            PRAGMA user_version = 2;`);
        old.close();
        const db = new MangaDb(path);
        expect(db.schemaVersion).toBe(3);
        expect(db.list()).toEqual([{ id: 1, sourceId: 's', remoteId: 1, title: 'Old', thumbnailUrl: null, url: null, author: 'Someone', artist: null, description: null, genres: [], status: 'unknown', createdAt: 3, chapters: [] }]);
        db.close();
    });
});

describe('MangaDb moving the files', () => {
    it('points chapters at the files they were moved to, with their new size, and touches no other', () => {
        const { db, manga } = setup();
        const first = db.ensureChapter(manga.id, chapter(1));
        const second = db.ensureChapter(manga.id, chapter(2));
        const third = db.ensureChapter(manga.id, chapter(3));
        db.markDone(first.id, '/old/1.cbz', 10, 3);
        db.markDone(second.id, '/old/2.cbz', 20, 3);
        db.markDone(third.id, '/old/3.cbz', 30, 3);
        db.relinkChapters([
            { chapterId: first.id, filePath: '/new/1.cbz', sizeBytes: 11 },
            { chapterId: second.id, filePath: '/new/2', sizeBytes: null }
        ]);
        expect(db.getChapter(first.id)).toMatchObject({ filePath: '/new/1.cbz', sizeBytes: 11, status: 'done' });
        expect(db.getChapter(second.id)).toMatchObject({ filePath: '/new/2', sizeBytes: null, status: 'done' });
        expect(db.getChapter(third.id)).toMatchObject({ filePath: '/old/3.cbz', sizeBytes: 30 });
    });

    it('changes nothing when one of them fails', () => {
        const { db, manga } = setup();
        const first = db.ensureChapter(manga.id, chapter(1));
        db.markDone(first.id, '/old/1.cbz', 10, 3);
        expect(() => {
            db.relinkChapters([
                { chapterId: first.id, filePath: '/new/1.cbz', sizeBytes: 11 },
                { chapterId: 1, filePath: undefined as unknown as string, sizeBytes: 1 }
            ]);
        }).toThrow();
        expect(db.getChapter(first.id)?.filePath).toBe('/old/1.cbz');
    });

    it('does nothing for no chapters', () => {
        const { db } = setup();
        expect(() => {
            db.relinkChapters([]);
        }).not.toThrow();
    });
});

describe('MangaDb removal', () => {
    it('removes a chapter and gives the file it had', () => {
        const { db, manga } = setup();
        const saved = db.ensureChapter(manga.id, chapter(1));
        db.markDone(saved.id, '/m/Chapter 1.cbz', 1, 1);
        expect(db.removeChapter(saved.id)).toBe('/m/Chapter 1.cbz');
        expect(db.getChapter(saved.id)).toBeNull();
    });

    it('gives nothing for a chapter without a file or one that is not there', () => {
        const { db, manga } = setup();
        const saved = db.ensureChapter(manga.id, chapter(1));
        expect(db.removeChapter(saved.id)).toBeNull();
        expect(db.removeChapter(99)).toBeNull();
    });

    it('removes a manga with all its chapters and gives the files they had', () => {
        const { db, manga } = setup();
        const first = db.ensureChapter(manga.id, chapter(1));
        db.ensureChapter(manga.id, chapter(2));
        const third = db.ensureChapter(manga.id, chapter(3));
        db.markDone(first.id, '/m/1.cbz', 1, 1);
        db.markDone(third.id, '/m/3.cbz', 1, 1);
        expect(db.removeManga(manga.id).sort()).toEqual(['/m/1.cbz', '/m/3.cbz']);
        expect(db.getManga(manga.id)).toBeNull();
        expect(db.chaptersOf(manga.id)).toEqual([]);
    });

    it('does not touch the other mangas', () => {
        const { db, manga } = setup();
        const other = db.upsertManga({ ...MANGA, remoteId: 8, title: 'Other' });
        db.ensureChapter(other.id, chapter(1));
        db.removeManga(manga.id);
        expect(db.getLibraryManga(other.id)?.chapters).toHaveLength(1);
    });
});
