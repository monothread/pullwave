import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
    MANGA_CHAPTER_STATUSES,
    MANGA_STATUSES,
    type LibraryManga,
    type MangaChapter,
    type MangaChapterRecord,
    type MangaChapterStatus,
    type MangaDetails,
    type MangaError,
    type MangaErrorCode,
    type MangaRecord,
    type MangaStatus,
    type MangaSummary
} from '@shared/manga';

export const INTERRUPTED_MESSAGE = 'The app was closed before the download finished.';

// Each entry is one schema version, applied in order; `PRAGMA user_version` remembers how many were applied.
const MIGRATIONS: readonly string[] = [
    `CREATE TABLE manga (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        remote_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        thumbnail_url TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE (source_id, remote_id)
    );
    CREATE TABLE chapter (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        manga_id INTEGER NOT NULL REFERENCES manga (id) ON DELETE CASCADE,
        remote_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        number REAL,
        date_uploaded INTEGER,
        scanlator TEXT,
        source_order INTEGER NOT NULL,
        status TEXT NOT NULL,
        page_count INTEGER NOT NULL DEFAULT 0,
        file_path TEXT,
        size_bytes INTEGER,
        error_code TEXT,
        error_raw TEXT,
        downloaded_at INTEGER,
        UNIQUE (manga_id, remote_id)
    );`,
    // What the source says about a manga, kept so the chapters downloaded later (or after a restart) carry it too.
    `ALTER TABLE manga ADD COLUMN author TEXT;
    ALTER TABLE manga ADD COLUMN artist TEXT;
    ALTER TABLE manga ADD COLUMN description TEXT;
    ALTER TABLE manga ADD COLUMN genres TEXT;
    ALTER TABLE manga ADD COLUMN status TEXT;`
];

type Row = Record<string, unknown>;

function text(row: Row, column: string): string {
    const value = row[column];
    return typeof value === 'string' ? value : '';
}

function nullableText(row: Row, column: string): string | null {
    const value = row[column];
    return typeof value === 'string' ? value : null;
}

function numeric(row: Row, column: string): number {
    const value = row[column];
    return typeof value === 'number' ? value : Number(value ?? 0);
}

function nullableNumeric(row: Row, column: string): number | null {
    const value = row[column];
    return typeof value === 'number' ? value : null;
}

function genresOf(row: Row): string[] {
    try {
        const parsed: unknown = JSON.parse(nullableText(row, 'genres') ?? '[]');
        return Array.isArray(parsed)
            ? parsed.filter((genre): genre is string => {
                  return typeof genre === 'string';
              })
            : [];
    } catch {
        return [];
    }
}

function mangaStatusOf(value: string | null): MangaStatus {
    return (MANGA_STATUSES as readonly (string | null)[]).includes(value) ? (value as MangaStatus) : 'unknown';
}

function toManga(row: Row): MangaRecord {
    return {
        id: numeric(row, 'id'),
        sourceId: text(row, 'source_id'),
        remoteId: numeric(row, 'remote_id'),
        title: text(row, 'title'),
        thumbnailUrl: nullableText(row, 'thumbnail_url'),
        author: nullableText(row, 'author'),
        artist: nullableText(row, 'artist'),
        description: nullableText(row, 'description'),
        genres: genresOf(row),
        status: mangaStatusOf(nullableText(row, 'status')),
        createdAt: numeric(row, 'created_at')
    };
}

function statusOf(value: string): MangaChapterStatus {
    return (MANGA_CHAPTER_STATUSES as readonly string[]).includes(value) ? (value as MangaChapterStatus) : 'error';
}

function toError(row: Row): MangaError | null {
    const code = nullableText(row, 'error_code');
    return code === null ? null : { code: code as MangaErrorCode, message: text(row, 'error_raw') };
}

function toChapter(row: Row): MangaChapterRecord {
    return {
        id: numeric(row, 'id'),
        mangaId: numeric(row, 'manga_id'),
        remoteId: numeric(row, 'remote_id'),
        name: text(row, 'name'),
        number: nullableNumeric(row, 'number'),
        dateUploaded: nullableNumeric(row, 'date_uploaded'),
        scanlator: nullableText(row, 'scanlator'),
        sourceOrder: numeric(row, 'source_order'),
        status: statusOf(text(row, 'status')),
        pageCount: numeric(row, 'page_count'),
        filePath: nullableText(row, 'file_path'),
        sizeBytes: nullableNumeric(row, 'size_bytes'),
        error: toError(row),
        downloadedAt: nullableNumeric(row, 'downloaded_at')
    };
}

// The newest chapters first (the newest has the highest `sourceOrder`).
function compareChapters(first: MangaChapterRecord, second: MangaChapterRecord): number {
    return second.sourceOrder - first.sourceOrder || first.id - second.id;
}

export class MangaDb {
    private readonly db: DatabaseSync;

    constructor(
        path: string,
        private readonly now: () => number = Date.now
    ) {
        if (path !== ':memory:') {
            mkdirSync(dirname(path), { recursive: true });
        }
        this.db = new DatabaseSync(path);
        try {
            this.db.exec('PRAGMA foreign_keys = ON');
            this.migrate();
        } catch (error) {
            // The file must not stay open (and locked, on Windows) when the library cannot be used.
            this.db.close();
            throw error;
        }
    }

    private migrate(): void {
        const current = this.schemaVersion;
        MIGRATIONS.slice(current).forEach((migration, offset) => {
            this.db.exec('BEGIN');
            try {
                this.db.exec(migration);
                this.db.exec(`PRAGMA user_version = ${current + offset + 1}`);
                this.db.exec('COMMIT');
            } catch (error) {
                this.db.exec('ROLLBACK');
                throw error;
            }
        });
    }

    private one(sql: string, ...params: SQLInputValue[]): Row | null {
        return (this.db.prepare(sql).get(...params) as Row | undefined) ?? null;
    }

    private all(sql: string, ...params: SQLInputValue[]): Row[] {
        return this.db.prepare(sql).all(...params) as Row[];
    }

    private run(sql: string, ...params: SQLInputValue[]): void {
        this.db.prepare(sql).run(...params);
    }

    get schemaVersion(): number {
        return numeric(this.one('PRAGMA user_version') ?? {}, 'user_version');
    }

    close(): void {
        this.db.close();
    }

    // The same manga of the same source is the same entry: its title and cover are refreshed.
    upsertManga(manga: MangaSummary): MangaRecord {
        const row = this.one(
            `INSERT INTO manga (source_id, remote_id, title, thumbnail_url, created_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (source_id, remote_id) DO UPDATE SET title = excluded.title, thumbnail_url = excluded.thumbnail_url
             RETURNING *`,
            manga.sourceId,
            manga.remoteId,
            manga.title,
            manga.thumbnailUrl,
            this.now()
        );
        return toManga(row ?? {});
    }

    // What the source says about the manga (its people, its description, its genres and whether it is still going).
    saveDetails(mangaId: number, details: Pick<MangaDetails, 'author' | 'artist' | 'description' | 'genres' | 'status'>): void {
        this.run(
            'UPDATE manga SET author = ?, artist = ?, description = ?, genres = ?, status = ? WHERE id = ?',
            details.author,
            details.artist,
            details.description,
            JSON.stringify(details.genres),
            details.status,
            mangaId
        );
    }

    getManga(id: number): MangaRecord | null {
        const row = this.one('SELECT * FROM manga WHERE id = ?', id);
        return row === null ? null : toManga(row);
    }

    findManga(sourceId: string, remoteId: number): MangaRecord | null {
        const row = this.one('SELECT * FROM manga WHERE source_id = ? AND remote_id = ?', sourceId, remoteId);
        return row === null ? null : toManga(row);
    }

    getLibraryManga(id: number): LibraryManga | null {
        const manga = this.getManga(id);
        return manga === null ? null : { ...manga, chapters: this.chaptersOf(id) };
    }

    list(): LibraryManga[] {
        return this.all('SELECT * FROM manga ORDER BY title COLLATE NOCASE, id').map((row) => {
            const manga = toManga(row);
            return { ...manga, chapters: this.chaptersOf(manga.id) };
        });
    }

    chaptersOf(mangaId: number): MangaChapterRecord[] {
        return this.all('SELECT * FROM chapter WHERE manga_id = ?', mangaId).map(toChapter).sort(compareChapters);
    }

    getChapter(id: number): MangaChapterRecord | null {
        const row = this.one('SELECT * FROM chapter WHERE id = ?', id);
        return row === null ? null : toChapter(row);
    }

    findChapter(mangaId: number, remoteId: number): MangaChapterRecord | null {
        const row = this.one('SELECT * FROM chapter WHERE manga_id = ? AND remote_id = ?', mangaId, remoteId);
        return row === null ? null : toChapter(row);
    }

    // Puts the chapters of the source in the library: the new ones are `idle`, the ones it has already keep their state and get the
    // data the source gives now (a title or a number can be corrected).
    registerChapters(mangaId: number, chapters: readonly MangaChapter[]): void {
        this.db.exec('BEGIN');
        try {
            chapters.forEach((chapter) => {
                this.run(
                    `INSERT INTO chapter (manga_id, remote_id, name, number, date_uploaded, scanlator, source_order, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'idle')
                     ON CONFLICT (manga_id, remote_id) DO UPDATE SET
                        name = excluded.name, number = excluded.number, date_uploaded = excluded.date_uploaded,
                        scanlator = excluded.scanlator, source_order = excluded.source_order`,
                    mangaId,
                    chapter.remoteId,
                    chapter.name,
                    chapter.number,
                    chapter.dateUploaded,
                    chapter.scanlator,
                    chapter.sourceOrder
                );
            });
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    // The chapter in the library, put there as `idle` first if it was not.
    ensureChapter(mangaId: number, chapter: MangaChapter): MangaChapterRecord {
        this.registerChapters(mangaId, [chapter]);
        return toChapter(this.one('SELECT * FROM chapter WHERE manga_id = ? AND remote_id = ?', mangaId, chapter.remoteId) ?? {});
    }

    markQueued(chapterId: number): void {
        this.run(`UPDATE chapter SET status = 'queued', error_code = NULL, error_raw = NULL WHERE id = ?`, chapterId);
    }

    markDownloading(chapterId: number): void {
        this.run(`UPDATE chapter SET status = 'downloading', error_code = NULL, error_raw = NULL WHERE id = ?`, chapterId);
    }

    markPaused(chapterId: number): void {
        this.run(`UPDATE chapter SET status = 'paused' WHERE id = ?`, chapterId);
    }

    setPageCount(chapterId: number, pageCount: number): void {
        this.run('UPDATE chapter SET page_count = ? WHERE id = ?', pageCount, chapterId);
    }

    markDone(chapterId: number, filePath: string, sizeBytes: number | null, pageCount: number): void {
        this.run(
            `UPDATE chapter SET status = 'done', file_path = ?, size_bytes = ?, page_count = ?, error_code = NULL, error_raw = NULL, downloaded_at = ? WHERE id = ?`,
            filePath,
            sizeBytes,
            pageCount,
            this.now(),
            chapterId
        );
    }

    markFailed(chapterId: number, status: 'error' | 'cancelled', error: MangaError | null): void {
        this.run('UPDATE chapter SET status = ?, error_code = ?, error_raw = ? WHERE id = ?', status, error?.code ?? null, error?.message ?? null, chapterId);
    }

    // A download that was going on when the app closed did not finish: it is an error that can be retried.
    failInterrupted(): void {
        this.run(`UPDATE chapter SET status = 'error', error_code = 'UNKNOWN', error_raw = ? WHERE status IN ('queued', 'downloading')`, INTERRUPTED_MESSAGE);
    }

    // The chapter is no longer in the library; the file it had (if any) is for the caller to delete.
    removeChapter(chapterId: number): string | null {
        const chapter = this.getChapter(chapterId);
        this.run('DELETE FROM chapter WHERE id = ?', chapterId);
        return chapter?.filePath ?? null;
    }

    // The manga and its chapters are no longer in the library; the files they had are for the caller to delete.
    removeManga(mangaId: number): string[] {
        const paths = this.chaptersOf(mangaId).flatMap((chapter) => {
            return chapter.filePath === null ? [] : [chapter.filePath];
        });
        this.run('DELETE FROM manga WHERE id = ?', mangaId);
        return paths;
    }
}
