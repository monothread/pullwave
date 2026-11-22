import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { JOURNAL_PRAGMAS } from '../sqliteJournal';
import { matchChapters, droppedChapters } from '@shared/mangaSourceMigration';
import { sameSeries } from '@shared/series';
import { parseErrorDetails, serializeErrorDetails } from '../errorDetails';
import {
    ARRIVAL_ORIGINS,
    hasChapterFile,
    LOCAL_MANGA_SOURCE_ID,
    MANGA_CHAPTER_STATUSES,
    MANGA_STATUSES,
    MAX_READING_KEPT,
    type ArrivalOrigin,
    type LibraryManga,
    type MangaChapter,
    type MangaChapterMove,
    type MangaChapterRecord,
    type MangaChapterStatus,
    type MangaDetails,
    type MangaError,
    type MangaErrorCode,
    type MangaGroup,
    type MangaGroupDirection,
    type MangaRecord,
    type MangaStatus,
    type MangaSummary,
    type MangaUpdateEntry,
    type ReadingEntry,
    type ReadingRecord
} from '@shared/manga';

export const MAX_UPDATES_KEPT = 1000;

export { LOCAL_MANGA_SOURCE_ID, MAX_READING_KEPT };

export const INTERRUPTED_MESSAGE = 'The app was closed before the download finished.';

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
    `ALTER TABLE manga ADD COLUMN author TEXT;
    ALTER TABLE manga ADD COLUMN artist TEXT;
    ALTER TABLE manga ADD COLUMN description TEXT;
    ALTER TABLE manga ADD COLUMN genres TEXT;
    ALTER TABLE manga ADD COLUMN status TEXT;`,
    `ALTER TABLE manga ADD COLUMN url TEXT;`,
    `ALTER TABLE manga ADD COLUMN series TEXT;
    ALTER TABLE manga ADD COLUMN season INTEGER;
    ALTER TABLE manga ADD COLUMN season_name TEXT;
    CREATE TABLE manga_group (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE manga_group_member (
        group_id INTEGER NOT NULL REFERENCES manga_group (id) ON DELETE CASCADE,
        manga_id INTEGER NOT NULL REFERENCES manga (id) ON DELETE CASCADE,
        PRIMARY KEY (group_id, manga_id)
    );`,
    `ALTER TABLE chapter ADD COLUMN added_at INTEGER;`,
    `ALTER TABLE manga ADD COLUMN cover_hash TEXT;`,
    `CREATE TABLE chapter_update (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        manga_id INTEGER NOT NULL REFERENCES manga (id) ON DELETE CASCADE,
        chapter_id INTEGER NOT NULL REFERENCES chapter (id) ON DELETE CASCADE,
        found_at INTEGER NOT NULL,
        origin TEXT NOT NULL
    );
    CREATE INDEX chapter_update_found ON chapter_update (found_at DESC, id DESC);
    CREATE TABLE reading_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        manga_remote_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        thumbnail_url TEXT,
        chapter_remote_id INTEGER NOT NULL,
        chapter_name TEXT NOT NULL,
        chapter_number REAL,
        page INTEGER NOT NULL,
        page_count INTEGER NOT NULL,
        read_at INTEGER NOT NULL,
        UNIQUE (source_id, manga_remote_id)
    );`,
    `ALTER TABLE manga_group ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
    UPDATE manga_group SET position = (
        SELECT COUNT(*) FROM manga_group other
        WHERE other.name COLLATE NOCASE < manga_group.name COLLATE NOCASE
            OR (other.name COLLATE NOCASE = manga_group.name COLLATE NOCASE AND other.id < manga_group.id)
    );`,
    `ALTER TABLE chapter ADD COLUMN output_path TEXT;`,
    `ALTER TABLE chapter ADD COLUMN error_details TEXT;`,
    `CREATE INDEX chapter_output_path ON chapter (output_path) WHERE output_path IS NOT NULL;`
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

function arrivalOriginOf(value: string | null): ArrivalOrigin {
    return (ARRIVAL_ORIGINS as readonly (string | null)[]).includes(value) ? (value as ArrivalOrigin) : 'manual';
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
        url: nullableText(row, 'url'),
        author: nullableText(row, 'author'),
        artist: nullableText(row, 'artist'),
        description: nullableText(row, 'description'),
        genres: genresOf(row),
        status: mangaStatusOf(nullableText(row, 'status')),
        createdAt: numeric(row, 'created_at'),
        series: nullableText(row, 'series'),
        season: nullableNumeric(row, 'season'),
        seasonName: nullableText(row, 'season_name')
    };
}

function toGroup(row: Row): MangaGroup {
    return { id: numeric(row, 'id'), name: text(row, 'name') };
}

function statusOf(value: string): MangaChapterStatus {
    return (MANGA_CHAPTER_STATUSES as readonly string[]).includes(value) ? (value as MangaChapterStatus) : 'error';
}

function toError(row: Row): MangaError | null {
    const code = nullableText(row, 'error_code');
    if (code === null) {
        return null;
    }
    const details = parseErrorDetails(nullableText(row, 'error_details'));
    return { code: code as MangaErrorCode, message: text(row, 'error_raw'), ...(details === undefined ? {} : { details }) };
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
        downloadedAt: nullableNumeric(row, 'downloaded_at'),
        addedAt: nullableNumeric(row, 'added_at')
    };
}

function compareChapters(first: MangaChapterRecord, second: MangaChapterRecord): number {
    return second.sourceOrder - first.sourceOrder || first.id - second.id;
}

export interface ImportMangaInput {
    sourceId: string | null;
    remoteId: number | null;
    title: string;
    thumbnailUrl: string | null;
    url: string | null;
    author: string | null;
    artist: string | null;
    description: string | null;
    genres: string[];
    status: MangaStatus;
}

export class MangaDb {
    private readonly db: DatabaseSync;
    private readonly statements = new Map<string, StatementSync>();
    private transactionDepth = 0;

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
            this.db.exec(JOURNAL_PRAGMAS);
            this.migrate();
        } catch (error) {
            this.db.close();
            throw error;
        }
    }

    transaction<T>(work: () => T): T {
        const outer = this.transactionDepth === 0;
        if (outer) {
            this.db.exec('BEGIN');
        }
        this.transactionDepth += 1;
        try {
            const result = work();
            if (outer) {
                this.db.exec('COMMIT');
            }
            return result;
        } catch (error) {
            if (outer) {
                try {
                    this.db.exec('ROLLBACK');
                } catch {
                    throw error;
                }
            }
            throw error;
        } finally {
            this.transactionDepth -= 1;
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

    private statement(sql: string): StatementSync {
        let prepared = this.statements.get(sql);
        if (prepared === undefined) {
            prepared = this.db.prepare(sql);
            this.statements.set(sql, prepared);
        }
        return prepared;
    }

    private one(sql: string, ...params: SQLInputValue[]): Row | null {
        return (this.statement(sql).get(...params) as Row | undefined) ?? null;
    }

    private all(sql: string, ...params: SQLInputValue[]): Row[] {
        return this.statement(sql).all(...params) as Row[];
    }

    private run(sql: string, ...params: SQLInputValue[]): void {
        this.statement(sql).run(...params);
    }

    checkpoint(): void {
        this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    }

    get schemaVersion(): number {
        return numeric(this.one('PRAGMA user_version') ?? {}, 'user_version');
    }

    close(): void {
        this.db.close();
    }

    get wasUsed(): boolean {
        const row = this.one('SELECT EXISTS (SELECT 1 FROM manga) OR EXISTS (SELECT 1 FROM reading_history) AS used');
        return row !== null && numeric(row, 'used') === 1;
    }

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

    saveDetails(mangaId: number, details: Pick<MangaDetails, 'url' | 'author' | 'artist' | 'description' | 'genres' | 'status'>): void {
        this.run(
            'UPDATE manga SET url = ?, author = ?, artist = ?, description = ?, genres = ?, status = ? WHERE id = ?',
            details.url,
            details.author,
            details.artist,
            details.description,
            JSON.stringify(details.genres),
            details.status,
            mangaId
        );
    }

    coverHash(mangaId: number): string | null {
        return nullableText(this.one('SELECT cover_hash FROM manga WHERE id = ?', mangaId) ?? {}, 'cover_hash');
    }

    setCoverHash(mangaId: number, hash: string | null): void {
        this.run('UPDATE manga SET cover_hash = ? WHERE id = ?', hash, mangaId);
    }

    coverless(): MangaRecord[] {
        return this.all('SELECT * FROM manga WHERE cover_hash IS NULL ORDER BY id').map(toManga);
    }

    setThumbnail(mangaId: number, thumbnailUrl: string | null): void {
        this.run('UPDATE manga SET thumbnail_url = ? WHERE id = ?', thumbnailUrl, mangaId);
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
        return manga === null ? null : { ...manga, chapters: this.chaptersOf(id), groupIds: this.groupIdsOf(id) };
    }

    list(): LibraryManga[] {
        return this.all('SELECT * FROM manga ORDER BY title COLLATE NOCASE, id').map((row) => {
            const manga = toManga(row);
            return { ...manga, chapters: this.chaptersOf(manga.id), groupIds: this.groupIdsOf(manga.id) };
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

    registerChapters(mangaId: number, chapters: readonly MangaChapter[], arrived: boolean | ArrivalOrigin = false): void {
        const origin: ArrivalOrigin | null = arrived === false ? null : arrived === true ? 'manual' : arrived;
        this.transaction(() => {
            chapters.forEach((chapter) => {
                const existed = origin !== null && this.findChapter(mangaId, chapter.remoteId) !== null;
                this.run(
                    `INSERT INTO chapter (manga_id, remote_id, name, number, date_uploaded, scanlator, source_order, status, added_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', ?)
                     ON CONFLICT (manga_id, remote_id) DO UPDATE SET
                        name = excluded.name, number = excluded.number, date_uploaded = excluded.date_uploaded,
                        scanlator = excluded.scanlator, source_order = excluded.source_order`,
                    mangaId,
                    chapter.remoteId,
                    chapter.name,
                    chapter.number,
                    chapter.dateUploaded,
                    chapter.scanlator,
                    chapter.sourceOrder,
                    origin === null ? null : this.now()
                );
                if (origin !== null && !existed) {
                    const saved = this.findChapter(mangaId, chapter.remoteId);
                    if (saved !== null) {
                        this.run('INSERT INTO chapter_update (manga_id, chapter_id, found_at, origin) VALUES (?, ?, ?, ?)', mangaId, saved.id, this.now(), origin);
                    }
                }
            });
            this.run('DELETE FROM chapter_update WHERE id NOT IN (SELECT id FROM chapter_update ORDER BY found_at DESC, id DESC LIMIT ?)', MAX_UPDATES_KEPT);
        });
    }

    ensureChapter(mangaId: number, chapter: MangaChapter, arrived = false): MangaChapterRecord {
        this.registerChapters(mangaId, [chapter], arrived);
        return toChapter(this.one('SELECT * FROM chapter WHERE manga_id = ? AND remote_id = ?', mangaId, chapter.remoteId) ?? {});
    }

    markQueued(chapterId: number): void {
        this.run(`UPDATE chapter SET status = 'queued', error_code = NULL, error_raw = NULL, error_details = NULL WHERE id = ?`, chapterId);
    }

    markDownloading(chapterId: number, outputPath: string): void {
        this.run(`UPDATE chapter SET status = 'downloading', output_path = ?, error_code = NULL, error_raw = NULL, error_details = NULL WHERE id = ?`, outputPath, chapterId);
    }

    markPaused(chapterId: number): void {
        this.run(`UPDATE chapter SET status = 'paused' WHERE id = ?`, chapterId);
    }

    setPageCount(chapterId: number, pageCount: number): void {
        this.run('UPDATE chapter SET page_count = ? WHERE id = ?', pageCount, chapterId);
    }

    markDone(chapterId: number, filePath: string, sizeBytes: number | null, pageCount: number): void {
        this.markDownloaded('done', chapterId, filePath, sizeBytes, pageCount);
    }

    markIncomplete(chapterId: number, filePath: string, sizeBytes: number | null, pageCount: number): void {
        this.markDownloaded('incomplete', chapterId, filePath, sizeBytes, pageCount);
    }

    private markDownloaded(status: 'done' | 'incomplete', chapterId: number, filePath: string, sizeBytes: number | null, pageCount: number): void {
        this.run(
            `UPDATE chapter SET status = ?, file_path = ?, size_bytes = ?, page_count = ?, output_path = NULL, error_code = NULL, error_raw = NULL, error_details = NULL, downloaded_at = ? WHERE id = ?`,
            status,
            filePath,
            sizeBytes,
            pageCount,
            this.now(),
            chapterId
        );
    }

    markFailed(chapterId: number, status: 'error' | 'cancelled', error: MangaError | null): void {
        this.run('UPDATE chapter SET status = ?, output_path = NULL, error_code = ?, error_raw = ?, error_details = ? WHERE id = ?',
            status,
            error?.code ?? null,
            error?.message ?? null,
            serializeErrorDetails(error?.details),
            chapterId
        );
    }

    outputPathOf(chapterId: number): string | null {
        const row = this.one('SELECT output_path FROM chapter WHERE id = ?', chapterId);
        return row === null ? null : nullableText(row, 'output_path');
    }

    setOutputPath(chapterId: number, outputPath: string): void {
        this.run('UPDATE chapter SET output_path = ? WHERE id = ?', outputPath, chapterId);
    }

    relinkFolder(links: { chapters: ReadonlyArray<{ chapterId: number; filePath: string; sizeBytes: number | null }>; outputs: ReadonlyArray<{ chapterId: number; outputPath: string }> }): void {
        this.db.exec('BEGIN');
        try {
            links.chapters.forEach((update) => {
                this.run('UPDATE chapter SET file_path = ?, size_bytes = ? WHERE id = ?', update.filePath, update.sizeBytes, update.chapterId);
            });
            links.outputs.forEach((update) => {
                this.run('UPDATE chapter SET output_path = ? WHERE id = ?', update.outputPath, update.chapterId);
            });
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    isOutputPathClaimed(outputPath: string, exceptChapterId: number): boolean {
        return this.one('SELECT 1 AS claimed FROM chapter WHERE output_path = ? AND id != ? LIMIT 1', outputPath, exceptChapterId) !== null;
    }

    pausedChapters(): MangaChapterRecord[] {
        return this.all(`SELECT * FROM chapter WHERE status = 'paused' ORDER BY manga_id, source_order, id`).map(toChapter);
    }

    failInterrupted(): void {
        this.run(`UPDATE chapter SET status = 'error', error_code = 'UNKNOWN', error_raw = ?, error_details = NULL WHERE status IN ('queued', 'downloading')`, INTERRUPTED_MESSAGE);
    }

    relinkChapters(updates: ReadonlyArray<{ chapterId: number; filePath: string; sizeBytes: number | null }>): void {
        this.db.exec('BEGIN');
        try {
            updates.forEach((update) => {
                this.run('UPDATE chapter SET file_path = ?, size_bytes = ? WHERE id = ?', update.filePath, update.sizeBytes, update.chapterId);
            });
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    relinkChapter(chapterId: number, filePath: string, sizeBytes: number | null, pageCount?: number): void {
        if (pageCount !== undefined && pageCount > 0) {
            this.run('UPDATE chapter SET file_path = ?, size_bytes = ?, page_count = ? WHERE id = ?', filePath, sizeBytes, pageCount, chapterId);
            return;
        }
        this.run('UPDATE chapter SET file_path = ?, size_bytes = ? WHERE id = ?', filePath, sizeBytes, chapterId);
    }

    importManga(input: ImportMangaInput): MangaRecord {
        if (input.sourceId !== null && input.remoteId !== null) {
            const existing = this.findManga(input.sourceId, input.remoteId);
            if (existing !== null) {
                return existing;
            }
            const inserted = toManga(
                this.one(
                    'INSERT INTO manga (source_id, remote_id, title, thumbnail_url, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *',
                    input.sourceId,
                    input.remoteId,
                    input.title,
                    input.thumbnailUrl,
                    this.now()
                ) ?? {}
            );
            this.saveDetails(inserted.id, {
                url: input.url,
                author: input.author,
                artist: input.artist,
                description: input.description,
                genres: input.genres,
                status: input.status
            });
            return this.getManga(inserted.id) ?? inserted;
        }
        const existingRow = this.one('SELECT * FROM manga WHERE source_id = ? AND LOWER(title) = LOWER(?) ORDER BY id LIMIT 1', LOCAL_MANGA_SOURCE_ID, input.title);
        if (existingRow !== null) {
            return toManga(existingRow);
        }
        const minRow = this.one('SELECT MIN(remote_id) AS min_id FROM manga WHERE source_id = ?', LOCAL_MANGA_SOURCE_ID);
        const nextRemoteId = Math.min(0, nullableNumeric(minRow ?? {}, 'min_id') ?? 0) - 1;
        const inserted = toManga(
            this.one(
                'INSERT INTO manga (source_id, remote_id, title, thumbnail_url, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *',
                LOCAL_MANGA_SOURCE_ID,
                nextRemoteId,
                input.title,
                input.thumbnailUrl,
                this.now()
            ) ?? {}
        );
        this.saveDetails(inserted.id, {
            url: input.url,
            author: input.author,
            artist: input.artist,
            description: input.description,
            genres: input.genres,
            status: input.status
        });
        return this.getManga(inserted.id) ?? inserted;
    }

    findChapterByNumberOrName(mangaId: number, number: number | null, name: string): MangaChapterRecord | null {
        if (number !== null) {
            const byNumber = this.one('SELECT * FROM chapter WHERE manga_id = ? AND number = ? ORDER BY id LIMIT 1', mangaId, number);
            if (byNumber !== null) {
                return toChapter(byNumber);
            }
        }
        const byName = this.one('SELECT * FROM chapter WHERE manga_id = ? AND LOWER(name) = LOWER(?) ORDER BY id LIMIT 1', mangaId, name);
        return byName === null ? null : toChapter(byName);
    }

    nextLocalChapterRemoteId(mangaId: number): number {
        const minRow = this.one('SELECT MIN(remote_id) AS min_id FROM chapter WHERE manga_id = ?', mangaId);
        return Math.min(0, nullableNumeric(minRow ?? {}, 'min_id') ?? 0) - 1;
    }

    moveToSource(
        mangaId: number,
        target: { manga: MangaSummary; details: MangaDetails | null; chapters: readonly MangaChapter[] }
    ): { ok: true; previousTitle: string; chapterMoves: MangaChapterMove[]; matched: number; added: number; dropped: number } | { ok: false; reason: 'not-found' | 'same' | 'exists' } {
        const current = this.getManga(mangaId);
        if (current === null) {
            return { ok: false, reason: 'not-found' };
        }
        if (current.sourceId === target.manga.sourceId && current.remoteId === target.manga.remoteId) {
            return { ok: false, reason: 'same' };
        }
        if (this.findManga(target.manga.sourceId, target.manga.remoteId) !== null) {
            return { ok: false, reason: 'exists' };
        }
        const matching = matchChapters(this.chaptersOf(mangaId), target.chapters);
        const dropped = droppedChapters(matching);
        this.db.exec('BEGIN');
        try {
            this.run('DELETE FROM reading_history WHERE source_id = ? AND manga_remote_id = ?', current.sourceId, current.remoteId);
            this.run('UPDATE manga SET source_id = ?, remote_id = ?, thumbnail_url = ? WHERE id = ?', target.manga.sourceId, target.manga.remoteId, target.manga.thumbnailUrl, mangaId);
            if (target.details !== null) {
                this.saveDetails(mangaId, target.details);
            }
            dropped.forEach((record) => {
                this.run('DELETE FROM chapter WHERE id = ?', record.id);
            });
            matching.matched.forEach(({ record, incoming }) => {
                this.run(
                    'UPDATE chapter SET remote_id = ?, name = ?, number = ?, date_uploaded = ?, scanlator = ?, source_order = ? WHERE id = ?',
                    incoming.remoteId,
                    incoming.name,
                    incoming.number,
                    incoming.dateUploaded,
                    incoming.scanlator,
                    incoming.sourceOrder,
                    record.id
                );
            });
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
        this.registerChapters(mangaId, matching.added, 'move');
        const chapterMoves = matching.matched.map(({ record, incoming }) => {
            return { from: record.remoteId, to: incoming.remoteId };
        });
        return { ok: true, previousTitle: current.title, chapterMoves, matched: matching.matched.length, added: matching.added.length, dropped: dropped.length };
    }

    renameManga(mangaId: number, title: string): boolean {
        const manga = this.getManga(mangaId);
        if (manga === null) {
            return false;
        }
        this.db.exec('BEGIN');
        try {
            this.run('UPDATE manga SET title = ? WHERE id = ?', title, mangaId);
            this.run('UPDATE reading_history SET title = ? WHERE source_id = ? AND manga_remote_id = ?', title, manga.sourceId, manga.remoteId);
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
        return true;
    }

    seasonTaken(series: string, season: number, exceptMangaId: number): boolean {
        return this.all('SELECT * FROM manga WHERE series IS NOT NULL AND season = ? AND id != ?', season, exceptMangaId).some((row) => {
            return sameSeries(text(row, 'series'), series);
        });
    }

    canonicalSeries(series: string, exceptMangaIds: readonly number[] = []): string {
        const known = this.all('SELECT id, series FROM manga WHERE series IS NOT NULL ORDER BY id').find((row) => {
            return !exceptMangaIds.includes(numeric(row, 'id')) && sameSeries(text(row, 'series'), series);
        });
        return known ? text(known, 'series') : series;
    }

    seasonsOfSeries(series: string, exceptMangaIds: readonly number[] = []): number[] {
        return this.all('SELECT * FROM manga WHERE series IS NOT NULL AND season IS NOT NULL')
            .filter((row) => {
                return !exceptMangaIds.includes(numeric(row, 'id')) && sameSeries(text(row, 'series'), series);
            })
            .map((row) => {
                return numeric(row, 'season');
            });
    }

    firstFreeSeason(series: string, exceptMangaIds: readonly number[] = []): number {
        return Math.max(0, ...this.seasonsOfSeries(series, exceptMangaIds)) + 1;
    }

    setSeries(mangaId: number, series: string | null, season: number | null, seasonName: string | null = null): boolean {
        if (this.getManga(mangaId) === null) {
            return false;
        }
        if (series !== null && season !== null && this.seasonTaken(series, season, mangaId)) {
            return false;
        }
        const name = series === null ? null : this.canonicalSeries(series, [mangaId]);
        this.run('UPDATE manga SET series = ?, season = ?, season_name = ? WHERE id = ?', name, series === null ? null : season, series === null ? null : seasonName, mangaId);
        if (name !== null) {
            this.joinGroupsOfSeries(mangaId, name);
        }
        return true;
    }

    renameSeries(mangaIds: readonly number[], series: string): { ok: true } | { ok: false; manga: string; season: number; suggested: number } {
        const mangas = mangaIds.flatMap((id) => {
            const manga = this.getManga(id);
            return manga === null ? [] : [manga];
        });
        const name = this.canonicalSeries(series, mangaIds);
        const taken = this.seasonsOfSeries(name, mangaIds);
        for (const manga of mangas) {
            const season = manga.season ?? 1;
            if (taken.includes(season)) {
                return { ok: false, manga: manga.title, season, suggested: this.firstFreeSeason(name, mangaIds) };
            }
        }
        this.db.exec('BEGIN');
        try {
            mangas.forEach((manga) => {
                this.run('UPDATE manga SET series = ?, season = ?, season_name = ? WHERE id = ?', name, manga.season ?? 1, manga.seasonName, manga.id);
            });
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
        mangas.forEach((manga) => {
            this.joinGroupsOfSeries(manga.id, name);
        });
        return { ok: true };
    }

    listGroups(): MangaGroup[] {
        return this.all('SELECT * FROM manga_group ORDER BY position, id').map(toGroup);
    }

    getGroup(id: number): MangaGroup | null {
        const row = this.one('SELECT * FROM manga_group WHERE id = ?', id);
        return row === null ? null : toGroup(row);
    }

    private groupNameTaken(name: string, exceptGroupId: number): boolean {
        return this.listGroups().some((group) => {
            return group.id !== exceptGroupId && sameSeries(group.name, name);
        });
    }

    createGroup(name: string): MangaGroup | null {
        if (this.groupNameTaken(name, 0)) {
            return null;
        }
        return toGroup(
            this.one('INSERT INTO manga_group (name, created_at, position) VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM manga_group)) RETURNING *', name, this.now()) ?? {}
        );
    }

    moveGroup(id: number, direction: MangaGroupDirection): boolean {
        const groups = this.all('SELECT id, position FROM manga_group ORDER BY position, id');
        const index = groups.findIndex((row) => {
            return numeric(row, 'id') === id;
        });
        const other = groups[index + (direction === 'up' ? -1 : 1)];
        const group = groups[index];
        if (index === -1 || other === undefined || group === undefined) {
            return false;
        }
        this.run('UPDATE manga_group SET position = ? WHERE id = ?', numeric(other, 'position'), id);
        this.run('UPDATE manga_group SET position = ? WHERE id = ?', numeric(group, 'position'), numeric(other, 'id'));
        return true;
    }

    renameGroup(id: number, name: string): MangaGroup | null {
        if (this.getGroup(id) === null || this.groupNameTaken(name, id)) {
            return null;
        }
        this.run('UPDATE manga_group SET name = ? WHERE id = ?', name, id);
        return this.getGroup(id);
    }

    deleteGroup(id: number): void {
        this.run('DELETE FROM manga_group WHERE id = ?', id);
    }

    groupIdsOf(mangaId: number): number[] {
        return this.all('SELECT group_id FROM manga_group_member WHERE manga_id = ? ORDER BY group_id', mangaId).map((row) => {
            return numeric(row, 'group_id');
        });
    }

    setGroupMembers(groupId: number, mangaIds: readonly number[], member: boolean): void {
        if (this.getGroup(groupId) === null) {
            return;
        }
        this.db.exec('BEGIN');
        try {
            mangaIds.forEach((mangaId) => {
                if (member) {
                    this.run('INSERT OR IGNORE INTO manga_group_member (group_id, manga_id) SELECT ?, id FROM manga WHERE id = ?', groupId, mangaId);
                } else {
                    this.run('DELETE FROM manga_group_member WHERE group_id = ? AND manga_id = ?', groupId, mangaId);
                }
            });
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    private joinGroupsOfSeries(mangaId: number, series: string): void {
        this.all('SELECT id, series FROM manga WHERE series IS NOT NULL AND id != ?', mangaId)
            .filter((row) => {
                return sameSeries(text(row, 'series'), series);
            })
            .forEach((row) => {
                this.run('INSERT OR IGNORE INTO manga_group_member (group_id, manga_id) SELECT group_id, ? FROM manga_group_member WHERE manga_id = ?', mangaId, numeric(row, 'id'));
            });
    }

    removeDownload(chapterId: number): string | null {
        const chapter = this.getChapter(chapterId);
        if (chapter === null || !hasChapterFile(chapter.status)) {
            return null;
        }
        this.run(`UPDATE chapter SET status = 'idle', file_path = NULL, size_bytes = NULL, downloaded_at = NULL, error_code = NULL, error_raw = NULL, error_details = NULL WHERE id = ?`, chapterId);
        return chapter.filePath;
    }

    updates(limit = 200): MangaUpdateEntry[] {
        return this.all(
            `SELECT u.id AS id, u.manga_id AS manga_id, u.chapter_id AS chapter_id, u.found_at AS found_at, u.origin AS origin,
                    m.title AS title, m.thumbnail_url AS thumbnail_url,
                    c.remote_id AS remote_id, c.name AS name, c.number AS number, c.date_uploaded AS date_uploaded, c.status AS status
             FROM chapter_update u
             JOIN manga m ON m.id = u.manga_id
             JOIN chapter c ON c.id = u.chapter_id
             ORDER BY u.found_at DESC, u.id DESC LIMIT ?`,
            limit
        ).map((row) => {
            return {
                id: numeric(row, 'id'),
                mangaId: numeric(row, 'manga_id'),
                mangaTitle: text(row, 'title'),
                thumbnailUrl: nullableText(row, 'thumbnail_url'),
                chapterId: numeric(row, 'chapter_id'),
                chapterRemoteId: numeric(row, 'remote_id'),
                chapterName: text(row, 'name'),
                chapterNumber: nullableNumeric(row, 'number'),
                dateUploaded: nullableNumeric(row, 'date_uploaded'),
                foundAt: numeric(row, 'found_at'),
                origin: arrivalOriginOf(nullableText(row, 'origin')),
                status: statusOf(text(row, 'status'))
            };
        });
    }

    clearUpdates(): void {
        this.run('DELETE FROM chapter_update');
    }

    recordReading(record: ReadingRecord): ReadingEntry {
        const manga = this.findManga(record.sourceId, record.mangaRemoteId);
        const title = manga?.title ?? record.title;
        const row = this.one(
            `INSERT INTO reading_history (source_id, manga_remote_id, title, thumbnail_url, chapter_remote_id, chapter_name, chapter_number, page, page_count, read_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (source_id, manga_remote_id) DO UPDATE SET
                title = excluded.title, thumbnail_url = excluded.thumbnail_url, chapter_remote_id = excluded.chapter_remote_id,
                chapter_name = excluded.chapter_name, chapter_number = excluded.chapter_number, page = excluded.page,
                page_count = excluded.page_count, read_at = excluded.read_at
             RETURNING *`,
            record.sourceId,
            record.mangaRemoteId,
            title,
            record.thumbnailUrl,
            record.chapterRemoteId,
            record.chapterName,
            record.chapterNumber,
            record.page,
            record.pageCount,
            this.now()
        );
        this.run('DELETE FROM reading_history WHERE id NOT IN (SELECT id FROM reading_history ORDER BY read_at DESC, id DESC LIMIT ?)', MAX_READING_KEPT);
        const saved = row ?? {};
        return {
            id: numeric(saved, 'id'),
            sourceId: text(saved, 'source_id'),
            mangaRemoteId: numeric(saved, 'manga_remote_id'),
            title: text(saved, 'title'),
            thumbnailUrl: nullableText(saved, 'thumbnail_url'),
            chapterRemoteId: numeric(saved, 'chapter_remote_id'),
            chapterName: text(saved, 'chapter_name'),
            chapterNumber: nullableNumeric(saved, 'chapter_number'),
            page: numeric(saved, 'page'),
            pageCount: numeric(saved, 'page_count'),
            readAt: numeric(saved, 'read_at'),
            libraryMangaId: manga?.id ?? null
        };
    }

    readingHistory(limit = MAX_READING_KEPT): ReadingEntry[] {
        return this.all(
            `SELECT r.*, (SELECT m.id FROM manga m WHERE m.source_id = r.source_id AND m.remote_id = r.manga_remote_id) AS library_id
             FROM reading_history r ORDER BY r.read_at DESC, r.id DESC LIMIT ?`,
            limit
        ).map((row) => {
            return {
                id: numeric(row, 'id'),
                sourceId: text(row, 'source_id'),
                mangaRemoteId: numeric(row, 'manga_remote_id'),
                title: text(row, 'title'),
                thumbnailUrl: nullableText(row, 'thumbnail_url'),
                chapterRemoteId: numeric(row, 'chapter_remote_id'),
                chapterName: text(row, 'chapter_name'),
                chapterNumber: nullableNumeric(row, 'chapter_number'),
                page: numeric(row, 'page'),
                pageCount: numeric(row, 'page_count'),
                readAt: numeric(row, 'read_at'),
                libraryMangaId: nullableNumeric(row, 'library_id')
            };
        });
    }

    removeReading(id: number): void {
        this.run('DELETE FROM reading_history WHERE id = ?', id);
    }

    clearReading(): void {
        this.run('DELETE FROM reading_history');
    }

    removeManga(mangaId: number): string[] {
        const paths = this.chaptersOf(mangaId).flatMap((chapter) => {
            return chapter.filePath === null ? [] : [chapter.filePath];
        });
        this.run('DELETE FROM manga WHERE id = ?', mangaId);
        return paths;
    }
}
