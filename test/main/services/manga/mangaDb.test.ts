import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { MangaChapter, MangaDetails, MangaSummary } from '@shared/manga';
import { INTERRUPTED_MESSAGE, MAX_READING_KEPT, MAX_UPDATES_KEPT, MangaDb } from '@main/services/manga/mangaDb';
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
        expect(new MangaDb(':memory:').schemaVersion).toBe(7);
    });

    it('keeps the library in a file and reads it again', () => {
        const path = join(makeTempDir(), 'sub', 'manga.db');
        const first = new MangaDb(path);
        const saved = first.upsertManga(MANGA);
        first.close();
        expect(existsSync(path)).toBe(true);
        const second = new MangaDb(path);
        expect(second.schemaVersion).toBe(7);
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
            createdAt: 5000,
            series: null,
            season: null,
            seasonName: null
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
        expect(db.schemaVersion).toBe(7);
        expect(db.list()).toEqual([{ id: 1, sourceId: 's', remoteId: 1, title: 'Old', thumbnailUrl: null, url: null, author: 'Someone', artist: null, description: null, genres: [], status: 'unknown', createdAt: 3, series: null, season: null, seasonName: null, groupIds: [], chapters: [] }]);
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

describe('MangaDb series', () => {
    function addManga(db: MangaDb, remoteId: number, title: string) {
        return db.upsertManga({ remoteId, sourceId: '123', title, thumbnailUrl: null });
    }

    it('starts with no series', () => {
        const { manga } = setup();
        expect(manga).toMatchObject({ series: null, season: null, seasonName: null });
    });

    it('joins a manga to a series with its place and its name in it, and takes it out again', () => {
        const { db, manga } = setup();
        expect(db.setSeries(manga.id, 'Frieren', 2, 'Beyond Journey')).toBe(true);
        expect(db.getManga(manga.id)).toMatchObject({ series: 'Frieren', season: 2, seasonName: 'Beyond Journey' });
        expect(db.setSeries(manga.id, null, null)).toBe(true);
        expect(db.getManga(manga.id)).toMatchObject({ series: null, season: null, seasonName: null });
    });

    it('forgets the season and its name when the series is taken away', () => {
        const { db, manga } = setup();
        db.setSeries(manga.id, 'Frieren', 2, 'Name');
        db.setSeries(manga.id, null, 5, 'Name');
        expect(db.getManga(manga.id)).toMatchObject({ series: null, season: null, seasonName: null });
    });

    it('says no for a manga that is not there', () => {
        const { db } = setup();
        expect(db.setSeries(999, 'Frieren', 1)).toBe(false);
    });

    it('refuses a season another manga of the series has, the same series written another way too', () => {
        const { db, manga } = setup();
        const other = addManga(db, 8, 'Frieren 2');
        db.setSeries(manga.id, 'Frieren', 1);
        expect(db.setSeries(other.id, '  FRIEREN ', 1)).toBe(false);
        expect(db.getManga(other.id)?.series).toBeNull();
        expect(db.setSeries(other.id, 'Frieren', 2)).toBe(true);
        expect(db.setSeries(manga.id, 'Frieren', 1)).toBe(true);
    });

    it('uses the spelling the library already has for a series', () => {
        const { db, manga } = setup();
        const other = addManga(db, 8, 'Frieren 2');
        db.setSeries(manga.id, 'Sousou no Frieren', 1);
        db.setSeries(other.id, 'sousou  no frieren', 2);
        expect(db.getManga(other.id)?.series).toBe('Sousou no Frieren');
        expect(db.canonicalSeries('SOUSOU NO FRIEREN')).toBe('Sousou no Frieren');
        expect(db.canonicalSeries('Another')).toBe('Another');
        expect(db.canonicalSeries('Sousou no Frieren', [manga.id, other.id])).toBe('Sousou no Frieren');
    });

    it('gives the seasons a series has and the first free one', () => {
        const { db, manga } = setup();
        const other = addManga(db, 8, 'Frieren 2');
        db.setSeries(manga.id, 'Frieren', 1);
        db.setSeries(other.id, 'Frieren', 3);
        expect(db.seasonsOfSeries('frieren').sort()).toEqual([1, 3]);
        expect(db.seasonsOfSeries('Frieren', [other.id])).toEqual([1]);
        expect(db.firstFreeSeason('Frieren')).toBe(4);
        expect(db.firstFreeSeason('Nothing')).toBe(1);
        expect(db.seasonTaken('Frieren', 3, manga.id)).toBe(true);
        expect(db.seasonTaken('Frieren', 3, other.id)).toBe(false);
    });

    it('renames a series for all the mangas in it, keeping each season', () => {
        const { db, manga } = setup();
        const other = addManga(db, 8, 'Frieren 2');
        const alone = addManga(db, 9, 'Alone');
        db.setSeries(manga.id, 'Frieren', 1, 'First');
        db.setSeries(other.id, 'Frieren', 2);
        expect(db.renameSeries([manga.id, other.id, alone.id], 'Sousou no Frieren')).toEqual({ ok: true });
        expect(db.getManga(manga.id)).toMatchObject({ series: 'Sousou no Frieren', season: 1, seasonName: 'First' });
        expect(db.getManga(other.id)).toMatchObject({ series: 'Sousou no Frieren', season: 2 });
        // A manga that was on its own becomes the first season, but the season 1 is taken in this series.
        expect(db.getManga(alone.id)).toMatchObject({ series: 'Sousou no Frieren', season: 1 });
    });

    it('joins two series when the name is the one the other has, unless a season is in both, and then changes nothing', () => {
        const { db, manga } = setup();
        const two = addManga(db, 8, 'Two');
        const three = addManga(db, 9, 'Three');
        db.setSeries(manga.id, 'A', 1);
        db.setSeries(two.id, 'B', 1);
        db.setSeries(three.id, 'B', 2);
        expect(db.renameSeries([two.id, three.id], 'a')).toEqual({ ok: false, manga: 'Two', season: 1, suggested: 2 });
        expect(db.getManga(two.id)?.series).toBe('B');
        expect(db.getManga(three.id)?.series).toBe('B');
        db.setSeries(manga.id, 'A', 7);
        expect(db.renameSeries([two.id, three.id], 'a')).toEqual({ ok: true });
        expect(db.getManga(two.id)).toMatchObject({ series: 'A', season: 1 });
        expect(db.getManga(three.id)).toMatchObject({ series: 'A', season: 2 });
    });

    it('ignores the mangas of a rename that are not in the library', () => {
        const { db, manga } = setup();
        expect(db.renameSeries([manga.id, 999], 'X')).toEqual({ ok: true });
        expect(db.getManga(manga.id)).toMatchObject({ series: 'X', season: 1 });
    });

    it('keeps the series when the manga is added to the library again', () => {
        const { db, manga } = setup();
        db.setSeries(manga.id, 'Frieren', 2, 'Name');
        expect(db.upsertManga({ ...MANGA, title: 'Frieren 2' })).toMatchObject({ series: 'Frieren', season: 2, seasonName: 'Name' });
    });
});

describe('MangaDb groups', () => {
    function addManga(db: MangaDb, remoteId: number, title: string) {
        return db.upsertManga({ remoteId, sourceId: '123', title, thumbnailUrl: null });
    }

    it('makes groups, lists them by name and finds each by its id', () => {
        const { db } = setup();
        const manhwas = db.createGroup('Manhwas');
        const mangas = db.createGroup('mangas');
        expect(manhwas).toEqual({ id: 1, name: 'Manhwas' });
        expect(db.listGroups()).toEqual([mangas, manhwas]);
        expect(db.getGroup(1)).toEqual(manhwas);
        expect(db.getGroup(99)).toBeNull();
    });

    it('does not make two groups with the same name, whatever the case or the accents', () => {
        const { db } = setup();
        db.createGroup('Mangás');
        expect(db.createGroup('MANGAS')).toBeNull();
        expect(db.listGroups()).toHaveLength(1);
    });

    it('renames a group, but not to the name of another one, nor a group that is not there', () => {
        const { db } = setup();
        const first = db.createGroup('Mangas')!;
        db.createGroup('Manhwas');
        expect(db.renameGroup(first.id, 'Shonen')).toEqual({ id: first.id, name: 'Shonen' });
        expect(db.renameGroup(first.id, 'manhwas')).toBeNull();
        expect(db.renameGroup(first.id, 'SHONEN')).toEqual({ id: first.id, name: 'SHONEN' });
        expect(db.renameGroup(99, 'X')).toBeNull();
    });

    it('puts mangas in a group, in several groups, and takes them out', () => {
        const { db, manga } = setup();
        const other = addManga(db, 8, 'Bleach');
        const mangas = db.createGroup('Mangas')!;
        const favorites = db.createGroup('Favorites')!;
        db.setGroupMembers(mangas.id, [manga.id, other.id], true);
        db.setGroupMembers(favorites.id, [manga.id], true);
        db.setGroupMembers(favorites.id, [manga.id], true);
        expect(db.groupIdsOf(manga.id)).toEqual([mangas.id, favorites.id]);
        expect(db.groupIdsOf(other.id)).toEqual([mangas.id]);
        expect(db.getLibraryManga(manga.id)?.groupIds).toEqual([mangas.id, favorites.id]);
        expect(db.list().map((item) => {return item.groupIds})).toEqual([[mangas.id], [mangas.id, favorites.id]]);
        db.setGroupMembers(mangas.id, [manga.id], false);
        expect(db.groupIdsOf(manga.id)).toEqual([favorites.id]);
    });

    it('ignores mangas that are not there and groups that are not there', () => {
        const { db, manga } = setup();
        const group = db.createGroup('Mangas')!;
        db.setGroupMembers(group.id, [999], true);
        db.setGroupMembers(99, [manga.id], true);
        expect(db.groupIdsOf(manga.id)).toEqual([]);
    });

    it('deletes a group but not its mangas, and a manga that is removed leaves its groups', () => {
        const { db, manga } = setup();
        const other = addManga(db, 8, 'Bleach');
        const group = db.createGroup('Mangas')!;
        db.setGroupMembers(group.id, [manga.id, other.id], true);
        db.removeManga(other.id);
        expect(db.groupIdsOf(other.id)).toEqual([]);
        db.deleteGroup(group.id);
        expect(db.listGroups()).toEqual([]);
        expect(db.getManga(manga.id)).not.toBeNull();
        expect(db.groupIdsOf(manga.id)).toEqual([]);
        expect(() => {
            db.deleteGroup(99);
        }).not.toThrow();
    });

    it('puts a manga that joins a series in the groups the series is in', () => {
        const { db, manga } = setup();
        const second = addManga(db, 8, 'Frieren 2');
        const third = addManga(db, 9, 'Frieren 3');
        const mangas = db.createGroup('Mangas')!;
        const favorites = db.createGroup('Favorites')!;
        db.setSeries(manga.id, 'Frieren', 1);
        db.setGroupMembers(mangas.id, [manga.id], true);
        db.setSeries(second.id, 'Frieren', 2);
        expect(db.groupIdsOf(second.id)).toEqual([mangas.id]);
        db.setGroupMembers(favorites.id, [second.id], true);
        db.setSeries(third.id, 'frieren', 3);
        expect(db.groupIdsOf(third.id)).toEqual([mangas.id, favorites.id]);
    });

    it('does that for a series that is renamed to the name of another one too', () => {
        const { db, manga } = setup();
        const second = addManga(db, 8, 'Other');
        const mangas = db.createGroup('Mangas')!;
        db.setSeries(manga.id, 'A', 5);
        db.setGroupMembers(mangas.id, [manga.id], true);
        db.setSeries(second.id, 'B', 1);
        db.renameSeries([second.id], 'a');
        expect(db.getManga(second.id)?.series).toBe('A');
        expect(db.groupIdsOf(second.id)).toEqual([mangas.id]);
    });
});

describe('MangaDb moving a manga to another source', () => {
    const TARGET = { remoteId: 70, sourceId: '999', title: 'One Piece (other)', thumbnailUrl: 'http://127.0.0.1:1/other.jpg' };

    function details(overrides: Partial<MangaDetails> = {}): MangaDetails {
        return { ...TARGET, url: 'https://other.example/op', author: 'Oda', artist: null, description: 'D', genres: ['Action'], status: 'completed', ...overrides };
    }

    function inLibrary() {
        const context = setup();
        const one = context.db.ensureChapter(context.manga.id, chapter(1));
        const two = context.db.ensureChapter(context.manga.id, chapter(2));
        const three = context.db.ensureChapter(context.manga.id, chapter(3));
        const four = context.db.ensureChapter(context.manga.id, chapter(4));
        context.db.markDone(one.id, '/m/One Piece/Chapter 1.cbz', 10, 3);
        context.db.markDone(three.id, '/m/One Piece/Chapter 3.cbz', 30, 3);
        context.db.markFailed(four.id, 'error', { code: 'IMAGE', message: 'x' });
        return { ...context, one, two, three, four };
    }

    it('makes the manga the one of the other source, keeping its title, its series, its groups and its folder', () => {
        const { db, manga, one } = inLibrary();
        db.setSeries(manga.id, 'One Piece', 1, 'Arc');
        const group = db.createGroup('Mangas')!;
        db.setGroupMembers(group.id, [manga.id], true);
        const result = db.moveToSource(manga.id, { manga: TARGET, details: details(), chapters: [chapter(1, { remoteId: 701 }), chapter(2, { remoteId: 702 }), chapter(5, { remoteId: 705 })] });
        expect(result).toEqual({ ok: true, matched: 2, added: 1, dropped: 1 });
        expect(db.getManga(manga.id)).toMatchObject({
            id: manga.id,
            sourceId: '999',
            remoteId: 70,
            title: 'One Piece',
            thumbnailUrl: 'http://127.0.0.1:1/other.jpg',
            url: 'https://other.example/op',
            author: 'Oda',
            genres: ['Action'],
            status: 'completed',
            series: 'One Piece',
            season: 1,
            seasonName: 'Arc'
        });
        expect(db.groupIdsOf(manga.id)).toEqual([group.id]);
        expect(db.findManga('123', 7)).toBeNull();
        expect(db.findManga('999', 70)?.id).toBe(manga.id);
        expect(db.getChapter(one.id)).toMatchObject({ remoteId: 701, status: 'done', filePath: '/m/One Piece/Chapter 1.cbz', sizeBytes: 10 });
    });

    it('keeps the state and the file of the chapters that match, and takes the data of the new ones', () => {
        const { db, manga, one, two } = inLibrary();
        db.moveToSource(manga.id, {
            manga: TARGET,
            details: null,
            chapters: [chapter(1, { remoteId: 701, name: 'Romance Dawn', scanlator: 'G', dateUploaded: 5, sourceOrder: 11 }), chapter(2, { remoteId: 702 })]
        });
        expect(db.getChapter(one.id)).toMatchObject({ remoteId: 701, name: 'Romance Dawn', scanlator: 'G', dateUploaded: 5, sourceOrder: 11, status: 'done', pageCount: 3 });
        expect(db.getChapter(two.id)).toMatchObject({ remoteId: 702, status: 'idle', filePath: null });
    });

    it('marks the chapters that are new in the other source as arrived now, and not the ones that matched', () => {
        const { db, manga, one } = inLibrary();
        db.moveToSource(manga.id, { manga: TARGET, details: null, chapters: [chapter(1, { remoteId: 701 }), chapter(9, { remoteId: 709 })] });
        expect(db.getChapter(one.id)?.addedAt).toBeNull();
        expect(db.findChapter(manga.id, 709)?.addedAt).toBe(5000);
    });

    it('keeps a downloaded chapter the other source lacks, removes the others, and adds the new ones as not downloaded', () => {
        const { db, manga, three, four } = inLibrary();
        db.moveToSource(manga.id, { manga: TARGET, details: null, chapters: [chapter(1, { remoteId: 701 }), chapter(9, { remoteId: 709 })] });
        expect(db.getChapter(three.id)).toMatchObject({ remoteId: three.remoteId, status: 'done', filePath: '/m/One Piece/Chapter 3.cbz' });
        expect(db.getChapter(four.id)).toBeNull();
        const byRemote = db.chaptersOf(manga.id).map((item) => {return [item.remoteId, item.status]}).sort();
        expect(byRemote).toEqual([[3, 'done'], [701, 'done'], [709, 'idle']]);
    });

    it('keeps the cover and what the source says when the other one gives no details', () => {
        const { db, manga } = inLibrary();
        db.saveDetails(manga.id, { url: 'https://old.example/op', author: 'Old', artist: null, description: null, genres: [], status: 'ongoing' });
        db.moveToSource(manga.id, { manga: TARGET, details: null, chapters: [chapter(1, { remoteId: 701 })] });
        expect(db.getManga(manga.id)).toMatchObject({ url: 'https://old.example/op', author: 'Old', thumbnailUrl: 'http://127.0.0.1:1/other.jpg' });
    });

    it('says why it does not happen, and changes nothing', () => {
        const { db, manga } = inLibrary();
        const other = db.upsertManga({ remoteId: 70, sourceId: '999', title: 'Already here', thumbnailUrl: null });
        expect(db.moveToSource(999, { manga: TARGET, details: null, chapters: [] })).toEqual({ ok: false, reason: 'not-found' });
        expect(db.moveToSource(manga.id, { manga: { ...TARGET, sourceId: '123', remoteId: 7 }, details: null, chapters: [] })).toEqual({ ok: false, reason: 'same' });
        expect(db.moveToSource(manga.id, { manga: TARGET, details: null, chapters: [chapter(1, { remoteId: 701 })] })).toEqual({ ok: false, reason: 'exists' });
        expect(db.getManga(manga.id)).toMatchObject({ sourceId: '123', remoteId: 7 });
        expect(db.chaptersOf(manga.id)).toHaveLength(4);
        expect(db.getManga(other.id)?.title).toBe('Already here');
    });

    it('changes nothing when it fails half way', () => {
        const { db, manga, one } = inLibrary();
        expect(() => {
            db.moveToSource(manga.id, { manga: { ...TARGET, sourceId: undefined as unknown as string }, details: null, chapters: [chapter(1, { remoteId: 701 })] });
        }).toThrow();
        expect(db.getManga(manga.id)).toMatchObject({ sourceId: '123', remoteId: 7 });
        expect(db.getChapter(one.id)?.remoteId).toBe(1);
    });
});

describe('MangaDb when a chapter was put in the library', () => {
    it('has no time for the chapters a manga comes with', () => {
        const { db, manga } = setup();
        expect(db.ensureChapter(manga.id, chapter(1)).addedAt).toBeNull();
        db.registerChapters(manga.id, [chapter(2), chapter(3)]);
        expect(db.chaptersOf(manga.id).map((item) => {return item.addedAt})).toEqual([null, null, null]);
    });

    it('keeps the time a chapter arrived later, and does not change it when the source gives it again', () => {
        let clock = 1000;
        const db = new MangaDb(':memory:', () => {
            return clock;
        });
        const manga = db.upsertManga(MANGA);
        db.registerChapters(manga.id, [chapter(1)]);
        clock = 9000;
        db.registerChapters(manga.id, [chapter(1, { name: 'Renamed' }), chapter(2)], true);
        expect(db.findChapter(manga.id, 1)).toMatchObject({ name: 'Renamed', addedAt: null });
        expect(db.findChapter(manga.id, 2)?.addedAt).toBe(9000);
        clock = 20000;
        db.registerChapters(manga.id, [chapter(2, { name: 'Again' })], true);
        expect(db.findChapter(manga.id, 2)).toMatchObject({ name: 'Again', addedAt: 9000 });
    });

    it('gives a chapter that arrived later when it is ensured', () => {
        const { db, manga } = setup();
        expect(db.ensureChapter(manga.id, chapter(1), true).addedAt).toBe(5000);
    });

    it('is not known for the chapters of a library made before it was kept', () => {
        const path = join(makeTempDir(), 'old.db');
        const old = new DatabaseSync(path);
        old.exec(`CREATE TABLE manga (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, remote_id INTEGER NOT NULL, title TEXT NOT NULL, thumbnail_url TEXT, created_at INTEGER NOT NULL, UNIQUE (source_id, remote_id));
            CREATE TABLE chapter (id INTEGER PRIMARY KEY AUTOINCREMENT, manga_id INTEGER NOT NULL REFERENCES manga (id) ON DELETE CASCADE, remote_id INTEGER NOT NULL, name TEXT NOT NULL, number REAL, date_uploaded INTEGER, scanlator TEXT, source_order INTEGER NOT NULL, status TEXT NOT NULL, page_count INTEGER NOT NULL DEFAULT 0, file_path TEXT, size_bytes INTEGER, error_code TEXT, error_raw TEXT, downloaded_at INTEGER, UNIQUE (manga_id, remote_id));
            ALTER TABLE manga ADD COLUMN author TEXT; ALTER TABLE manga ADD COLUMN artist TEXT; ALTER TABLE manga ADD COLUMN description TEXT; ALTER TABLE manga ADD COLUMN genres TEXT; ALTER TABLE manga ADD COLUMN status TEXT; ALTER TABLE manga ADD COLUMN url TEXT;
            ALTER TABLE manga ADD COLUMN series TEXT; ALTER TABLE manga ADD COLUMN season INTEGER; ALTER TABLE manga ADD COLUMN season_name TEXT;
            CREATE TABLE manga_group (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at INTEGER NOT NULL);
            CREATE TABLE manga_group_member (group_id INTEGER NOT NULL REFERENCES manga_group (id) ON DELETE CASCADE, manga_id INTEGER NOT NULL REFERENCES manga (id) ON DELETE CASCADE, PRIMARY KEY (group_id, manga_id));
            INSERT INTO manga (source_id, remote_id, title, created_at) VALUES ('s', 1, 'Old', 3);
            INSERT INTO chapter (manga_id, remote_id, name, source_order, status) VALUES (1, 5, 'Chapter 5', 5, 'idle');
            PRAGMA user_version = 4;`);
        old.close();
        const db = new MangaDb(path);
        expect(db.schemaVersion).toBe(7);
        expect(db.chaptersOf(1)[0]).toMatchObject({ remoteId: 5, addedAt: null });
        db.close();
    });
});

describe('MangaDb removal', () => {
    it('removes the download of a chapter: gives the file it had and keeps the chapter as one that is not downloaded', () => {
        const { db, manga } = setup();
        const saved = db.ensureChapter(manga.id, chapter(1));
        db.markDone(saved.id, '/m/Chapter 1.cbz', 1, 1);
        expect(db.removeDownload(saved.id)).toBe('/m/Chapter 1.cbz');
        expect(db.getChapter(saved.id)).toMatchObject({ id: saved.id, remoteId: 1, name: 'Chapter 1', status: 'idle', filePath: null, sizeBytes: null, downloadedAt: null, error: null });
    });

    it('gives nothing, and changes nothing, for a chapter that is not downloaded or not there', () => {
        const { db, manga } = setup();
        const saved = db.ensureChapter(manga.id, chapter(1));
        db.markFailed(saved.id, 'error', { code: 'IMAGE', message: 'x' });
        expect(db.removeDownload(saved.id)).toBeNull();
        expect(db.getChapter(saved.id)).toMatchObject({ status: 'error', error: { code: 'IMAGE', message: 'x' } });
        expect(db.removeDownload(99)).toBeNull();
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

describe('MangaDb the cover that is kept', () => {
    it('has no cover kept at first, and remembers the fingerprint of the one that is', () => {
        const { db, manga } = setup();
        expect(db.coverHash(manga.id)).toBeNull();
        db.setCoverHash(manga.id, 'a'.repeat(64));
        expect(db.coverHash(manga.id)).toBe('a'.repeat(64));
        db.setCoverHash(manga.id, null);
        expect(db.coverHash(manga.id)).toBeNull();
    });

    it('has no fingerprint for a manga that is not there', () => {
        expect(new MangaDb(':memory:').coverHash(99)).toBeNull();
    });

    it('lists the mangas that have a cover on the source and none kept', () => {
        const { db, manga } = setup();
        const other = db.upsertManga({ remoteId: 8, sourceId: '123', title: 'Bleach', thumbnailUrl: '/api/v1/manga/8/thumbnail' });
        db.upsertManga({ remoteId: 9, sourceId: '123', title: 'No cover', thumbnailUrl: null });
        expect(db.coverless().map((item) => {
            return item.id;
        })).toEqual([manga.id, other.id]);
        db.setCoverHash(manga.id, 'b'.repeat(64));
        expect(db.coverless().map((item) => {
            return item.id;
        })).toEqual([other.id]);
    });

    it('changes where the cover is on the source, keeping the cover that is kept', () => {
        const { db, manga } = setup();
        db.setCoverHash(manga.id, 'c'.repeat(64));
        db.setThumbnail(manga.id, '/api/v1/manga/7/thumbnail?new');
        expect(db.getManga(manga.id)?.thumbnailUrl).toBe('/api/v1/manga/7/thumbnail?new');
        expect(db.coverHash(manga.id)).toBe('c'.repeat(64));
        db.setThumbnail(manga.id, null);
        expect(db.getManga(manga.id)?.thumbnailUrl).toBeNull();
    });

    it('adds the column to a library made before the covers were kept', () => {
        const path = join(makeTempDir(), 'old.db');
        const old = new DatabaseSync(path);
        old.exec(`CREATE TABLE manga (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, remote_id INTEGER NOT NULL, title TEXT NOT NULL, thumbnail_url TEXT, created_at INTEGER NOT NULL, UNIQUE (source_id, remote_id));
            CREATE TABLE chapter (id INTEGER PRIMARY KEY AUTOINCREMENT, manga_id INTEGER NOT NULL REFERENCES manga (id) ON DELETE CASCADE, remote_id INTEGER NOT NULL, name TEXT NOT NULL, number REAL, date_uploaded INTEGER, scanlator TEXT, source_order INTEGER NOT NULL, status TEXT NOT NULL, page_count INTEGER NOT NULL DEFAULT 0, file_path TEXT, size_bytes INTEGER, error_code TEXT, error_raw TEXT, downloaded_at INTEGER, UNIQUE (manga_id, remote_id));
            ALTER TABLE manga ADD COLUMN author TEXT; ALTER TABLE manga ADD COLUMN artist TEXT; ALTER TABLE manga ADD COLUMN description TEXT; ALTER TABLE manga ADD COLUMN genres TEXT; ALTER TABLE manga ADD COLUMN status TEXT; ALTER TABLE manga ADD COLUMN url TEXT;
            ALTER TABLE manga ADD COLUMN series TEXT; ALTER TABLE manga ADD COLUMN season INTEGER; ALTER TABLE manga ADD COLUMN season_name TEXT;
            CREATE TABLE manga_group (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at INTEGER NOT NULL);
            CREATE TABLE manga_group_member (group_id INTEGER NOT NULL REFERENCES manga_group (id) ON DELETE CASCADE, manga_id INTEGER NOT NULL REFERENCES manga (id) ON DELETE CASCADE, PRIMARY KEY (group_id, manga_id));
            ALTER TABLE chapter ADD COLUMN added_at INTEGER;
            INSERT INTO manga (source_id, remote_id, title, thumbnail_url, created_at) VALUES ('s', 1, 'Old', '/api/v1/manga/1/thumbnail', 3);
            PRAGMA user_version = 5;`);
        old.close();
        const db = new MangaDb(path);
        expect(db.schemaVersion).toBe(7);
        expect(db.coverHash(1)).toBeNull();
        expect(db.coverless().map((item) => {
            return item.title;
        })).toEqual(['Old']);
        db.close();
    });
});

describe('MangaDb the history of new chapters', () => {
    function updatesSetup() {
        let clock = 1000;
        const db = new MangaDb(':memory:', () => {
            clock += 10;
            return clock;
        });
        return { db, manga: db.upsertManga(MANGA) };
    }

    it('writes nothing for the chapters a manga comes with', () => {
        const { db, manga } = updatesSetup();
        db.registerChapters(manga.id, [chapter(1), chapter(2)]);
        expect(db.updates()).toEqual([]);
    });

    it('writes the chapters that arrive later, each with how it came, and not the ones it had', () => {
        const { db, manga } = updatesSetup();
        db.registerChapters(manga.id, [chapter(1), chapter(2)]);
        db.registerChapters(manga.id, [chapter(1), chapter(2), chapter(3)], 'auto');
        db.registerChapters(manga.id, [chapter(4)], true);
        db.registerChapters(manga.id, [chapter(5)], 'move');
        expect(
            db.updates().map((entry) => {
                return [entry.chapterRemoteId, entry.origin];
            })
        ).toEqual([
            [5, 'move'],
            [4, 'manual'],
            [3, 'auto']
        ]);
    });

    it('does not write again a chapter that was written already, even if it arrives again with another origin', () => {
        const { db, manga } = updatesSetup();
        db.registerChapters(manga.id, [chapter(1)]);
        db.registerChapters(manga.id, [chapter(2)], 'auto');
        db.registerChapters(manga.id, [chapter(2)], 'manual');
        expect(db.updates()).toHaveLength(1);
        expect(db.updates()[0]?.origin).toBe('auto');
    });

    it('gives the manga, the chapter and the times of each entry, the newest first', () => {
        const { db, manga } = updatesSetup();
        db.registerChapters(manga.id, [chapter(1)]);
        db.registerChapters(manga.id, [chapter(2, { name: 'Second', number: 2, dateUploaded: 1700000000000, sourceOrder: 2 })], 'auto');
        const saved = db.findChapter(manga.id, 2)!;
        db.markDone(saved.id, '/m/2.cbz', 1, 1);
        expect(db.updates()).toEqual([
            {
                id: expect.any(Number),
                mangaId: manga.id,
                mangaTitle: 'One Piece',
                thumbnailUrl: 'http://127.0.0.1:1/t.jpg',
                chapterId: saved.id,
                chapterRemoteId: 2,
                chapterName: 'Second',
                chapterNumber: 2,
                dateUploaded: 1700000000000,
                foundAt: saved.addedAt! + 10,
                origin: 'auto',
                status: 'done'
            }
        ]);
    });

    it('lists the newest of several mangas first, and only as many as asked', () => {
        const { db, manga } = updatesSetup();
        const other = db.upsertManga({ remoteId: 8, sourceId: '123', title: 'Bleach', thumbnailUrl: null });
        db.registerChapters(manga.id, [chapter(1)]);
        db.registerChapters(other.id, [chapter(1)]);
        db.registerChapters(manga.id, [chapter(2)], 'auto');
        db.registerChapters(other.id, [chapter(2)], 'auto');
        db.registerChapters(manga.id, [chapter(3)], 'auto');
        expect(
            db.updates().map((entry) => {
                return `${entry.mangaTitle} ${entry.chapterRemoteId}`;
            })
        ).toEqual(['One Piece 3', 'Bleach 2', 'One Piece 2']);
        expect(db.updates(2)).toHaveLength(2);
    });

    it('keeps only the latest ones', () => {
        const { db, manga } = updatesSetup();
        db.registerChapters(manga.id, [chapter(1)]);
        const many = Array.from({ length: MAX_UPDATES_KEPT + 20 }, (_item, index) => {
            return chapter(100 + index);
        });
        db.registerChapters(manga.id, many, 'auto');
        expect(db.updates(MAX_UPDATES_KEPT + 50)).toHaveLength(MAX_UPDATES_KEPT);
    });

    it('forgets the entries of a manga that leaves the library, and of a chapter that goes in a move to another source', () => {
        const { db, manga } = updatesSetup();
        db.registerChapters(manga.id, [chapter(1)]);
        db.registerChapters(manga.id, [chapter(2)], 'auto');
        db.moveToSource(manga.id, { manga: { remoteId: 70, sourceId: '999', title: 'One Piece', thumbnailUrl: null }, details: null, chapters: [chapter(1)] });
        expect(db.updates()).toEqual([]);
        db.registerChapters(manga.id, [chapter(9)], 'auto');
        db.removeManga(manga.id);
        expect(db.updates()).toEqual([]);
    });

    it('writes the chapters a move to another source brings as having come with the move', () => {
        const { db, manga } = updatesSetup();
        db.registerChapters(manga.id, [chapter(1)]);
        db.moveToSource(manga.id, { manga: { remoteId: 70, sourceId: '999', title: 'One Piece', thumbnailUrl: null }, details: null, chapters: [chapter(1), chapter(2)] });
        expect(
            db.updates().map((entry) => {
                return [entry.chapterRemoteId, entry.origin];
            })
        ).toEqual([[2, 'move']]);
    });

    it('clears the list', () => {
        const { db, manga } = updatesSetup();
        db.registerChapters(manga.id, [chapter(1)]);
        db.registerChapters(manga.id, [chapter(2)], 'auto');
        db.clearUpdates();
        expect(db.updates()).toEqual([]);
        expect(db.chaptersOf(manga.id)).toHaveLength(2);
    });

    it('reads an origin it does not know as manual', () => {
        const { db, manga } = updatesSetup();
        db.registerChapters(manga.id, [chapter(1)]);
        db.registerChapters(manga.id, [chapter(2)], 'auto');
        const raw = (db as unknown as { db: { exec: (sql: string) => void } }).db;
        raw.exec(`UPDATE chapter_update SET origin = 'weird'`);
        expect(db.updates()[0]?.origin).toBe('manual');
    });
});

describe('MangaDb the history of reading', () => {
    const RECORD = { sourceId: '123', mangaRemoteId: 7, title: 'One Piece', thumbnailUrl: '/api/v1/manga/7/thumbnail', chapterRemoteId: 11, chapterName: 'Romance Dawn', chapterNumber: 1, page: 3, pageCount: 20 };

    function readingSetup() {
        let clock = 5000;
        const db = new MangaDb(':memory:', () => {
            clock += 10;
            return clock;
        });
        return db;
    }

    it('keeps where the user is in a manga, for a manga that is not in the library too', () => {
        const db = readingSetup();
        db.recordReading(RECORD);
        expect(db.readingHistory()).toEqual([{ ...RECORD, id: expect.any(Number), readAt: 5010, libraryMangaId: null }]);
    });

    it('says the manga is in the library when it is, by its source and number', () => {
        const db = readingSetup();
        const manga = db.upsertManga({ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: null });
        db.recordReading(RECORD);
        db.recordReading({ ...RECORD, mangaRemoteId: 8, title: 'Bleach' });
        expect(
            db.readingHistory().map((entry) => {
                return [entry.title, entry.libraryMangaId];
            })
        ).toEqual([
            ['Bleach', null],
            ['One Piece', manga.id]
        ]);
    });

    it('has one line for each manga, which follows the chapter and the page, and goes to the top', () => {
        const db = readingSetup();
        db.recordReading(RECORD);
        db.recordReading({ ...RECORD, mangaRemoteId: 8, title: 'Bleach', chapterRemoteId: 1 });
        db.recordReading({ ...RECORD, chapterRemoteId: 12, chapterName: 'Second', chapterNumber: 2, page: 0, pageCount: 18, title: 'One Piece (new title)', thumbnailUrl: null });
        expect(db.readingHistory()).toEqual([
            { id: expect.any(Number), sourceId: '123', mangaRemoteId: 7, title: 'One Piece (new title)', thumbnailUrl: null, chapterRemoteId: 12, chapterName: 'Second', chapterNumber: 2, page: 0, pageCount: 18, readAt: 5030, libraryMangaId: null },
            expect.objectContaining({ title: 'Bleach', readAt: 5020 })
        ]);
    });

    it('keeps the same manga of two sources apart', () => {
        const db = readingSetup();
        db.recordReading(RECORD);
        db.recordReading({ ...RECORD, sourceId: '999' });
        expect(db.readingHistory()).toHaveLength(2);
    });

    it('lists only as many as asked, and keeps only the latest', () => {
        const db = readingSetup();
        for (let index = 1; index <= MAX_READING_KEPT + 10; index += 1) {
            db.recordReading({ ...RECORD, mangaRemoteId: index, title: `Manga ${String(index)}` });
        }
        expect(db.readingHistory(MAX_READING_KEPT + 50)).toHaveLength(MAX_READING_KEPT);
        expect(db.readingHistory(3)).toHaveLength(3);
        expect(db.readingHistory()[0]?.title).toBe(`Manga ${String(MAX_READING_KEPT + 10)}`);
    });

    it('removes a line, or all of them', () => {
        const db = readingSetup();
        db.recordReading(RECORD);
        db.recordReading({ ...RECORD, mangaRemoteId: 8, title: 'Bleach' });
        db.removeReading(db.readingHistory()[0]!.id);
        expect(
            db.readingHistory().map((entry) => {
                return entry.title;
            })
        ).toEqual(['One Piece']);
        db.removeReading(9999);
        expect(db.readingHistory()).toHaveLength(1);
        db.clearReading();
        expect(db.readingHistory()).toEqual([]);
    });

    it('keeps the lines of a manga that leaves the library', () => {
        const db = readingSetup();
        const manga = db.upsertManga({ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: null });
        db.recordReading(RECORD);
        db.removeManga(manga.id);
        expect(db.readingHistory()[0]?.libraryMangaId).toBeNull();
        expect(db.readingHistory()).toHaveLength(1);
    });

    it('forgets the line of a manga when it moves to another source, whose chapters are numbered differently', () => {
        const db = readingSetup();
        const manga = db.upsertManga({ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: null });
        db.registerChapters(manga.id, [chapter(11)]);
        db.recordReading(RECORD);
        db.recordReading({ ...RECORD, mangaRemoteId: 8, title: 'Bleach' });
        db.moveToSource(manga.id, { manga: { remoteId: 70, sourceId: '999', title: 'One Piece', thumbnailUrl: null }, details: null, chapters: [chapter(11)] });
        expect(
            db.readingHistory().map((entry) => {
                return entry.title;
            })
        ).toEqual(['Bleach']);
    });
});

describe('MangaDb the tables of the histories in a library made before them', () => {
    it('adds them, empty, to a library of the version before', () => {
        const path = join(makeTempDir(), 'before.db');
        const old = new DatabaseSync(path);
        old.exec(`CREATE TABLE manga (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, remote_id INTEGER NOT NULL, title TEXT NOT NULL, thumbnail_url TEXT, created_at INTEGER NOT NULL, UNIQUE (source_id, remote_id));
            CREATE TABLE chapter (id INTEGER PRIMARY KEY AUTOINCREMENT, manga_id INTEGER NOT NULL REFERENCES manga (id) ON DELETE CASCADE, remote_id INTEGER NOT NULL, name TEXT NOT NULL, number REAL, date_uploaded INTEGER, scanlator TEXT, source_order INTEGER NOT NULL, status TEXT NOT NULL, page_count INTEGER NOT NULL DEFAULT 0, file_path TEXT, size_bytes INTEGER, error_code TEXT, error_raw TEXT, downloaded_at INTEGER, UNIQUE (manga_id, remote_id));
            ALTER TABLE manga ADD COLUMN author TEXT; ALTER TABLE manga ADD COLUMN artist TEXT; ALTER TABLE manga ADD COLUMN description TEXT; ALTER TABLE manga ADD COLUMN genres TEXT; ALTER TABLE manga ADD COLUMN status TEXT; ALTER TABLE manga ADD COLUMN url TEXT;
            ALTER TABLE manga ADD COLUMN series TEXT; ALTER TABLE manga ADD COLUMN season INTEGER; ALTER TABLE manga ADD COLUMN season_name TEXT;
            CREATE TABLE manga_group (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at INTEGER NOT NULL);
            CREATE TABLE manga_group_member (group_id INTEGER NOT NULL REFERENCES manga_group (id) ON DELETE CASCADE, manga_id INTEGER NOT NULL REFERENCES manga (id) ON DELETE CASCADE, PRIMARY KEY (group_id, manga_id));
            ALTER TABLE chapter ADD COLUMN added_at INTEGER;
            ALTER TABLE manga ADD COLUMN cover_hash TEXT;
            INSERT INTO manga (source_id, remote_id, title, created_at) VALUES ('s', 1, 'Old', 3);
            PRAGMA user_version = 6;`);
        old.close();
        const db = new MangaDb(path);
        expect(db.schemaVersion).toBe(7);
        expect(db.updates()).toEqual([]);
        expect(db.readingHistory()).toEqual([]);
        db.recordReading({ sourceId: 's', mangaRemoteId: 1, title: 'Old', thumbnailUrl: null, chapterRemoteId: 2, chapterName: '', chapterNumber: null, page: 0, pageCount: 1 });
        expect(db.readingHistory()[0]?.libraryMangaId).toBe(1);
        db.close();
    });
});
