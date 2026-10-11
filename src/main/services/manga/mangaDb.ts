import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { matchChapters, droppedChapters } from '@shared/mangaSourceMigration';
import { sameSeries } from '@shared/series';
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
    type MangaGroup,
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
    ALTER TABLE manga ADD COLUMN status TEXT;`,
    // The page of the manga on the site of its source.
    `ALTER TABLE manga ADD COLUMN url TEXT;`,
    // The seasons of a manga are separate entries in the source: the user joins them under a series with a season number. And the groups
    // (Mangas, Manhwas...) the user makes to keep the library in order: a manga can be in several.
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
    );`
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

    // Points chapters at the files they were moved to (the folder of the library changed).
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

    // ----- Moving to another source -----

    // Makes the manga of the library the same manga in another source. It keeps its title (the folder of its chapters is named after it),
    // its series and its groups; the cover, the page on the site and what the source says come from the other one. The chapters the
    // other source has are matched with the ones of the library: those keep their state and their files and take the data of the new
    // ones; the downloaded chapters the other source lacks stay as they are; the others go; and the chapters that are new are added,
    // not downloaded.
    moveToSource(mangaId: number, target: { manga: MangaSummary; details: MangaDetails | null; chapters: readonly MangaChapter[] }): { ok: true; matched: number; added: number; dropped: number } | { ok: false; reason: 'not-found' | 'same' | 'exists' } {
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
        this.registerChapters(mangaId, matching.added);
        return { ok: true, matched: matching.matched.length, added: matching.added.length, dropped: dropped.length };
    }

    // ----- Series -----

    // Whether another manga (not the one with this id) already has this season of the series.
    seasonTaken(series: string, season: number, exceptMangaId: number): boolean {
        return this.all('SELECT * FROM manga WHERE series IS NOT NULL AND season = ? AND id != ?', season, exceptMangaId).some((row) => {
            return sameSeries(text(row, 'series'), series);
        });
    }

    // The name a series goes by: the spelling the library already has for it (the same name in another case, with other accents or extra
    // spaces is the same series), otherwise the name as it is. The manga that is being joined does not count.
    canonicalSeries(series: string, exceptMangaIds: readonly number[] = []): string {
        const known = this.all('SELECT id, series FROM manga WHERE series IS NOT NULL ORDER BY id').find((row) => {
            return !exceptMangaIds.includes(numeric(row, 'id')) && sameSeries(text(row, 'series'), series);
        });
        return known ? text(known, 'series') : series;
    }

    // The seasons a series has, without counting the mangas in `exceptMangaIds`.
    seasonsOfSeries(series: string, exceptMangaIds: readonly number[] = []): number[] {
        return this.all('SELECT * FROM manga WHERE series IS NOT NULL AND season IS NOT NULL')
            .filter((row) => {
                return !exceptMangaIds.includes(numeric(row, 'id')) && sameSeries(text(row, 'series'), series);
            })
            .map((row) => {
                return numeric(row, 'season');
            });
    }

    // The first season number a series does not have: the last one plus one (1 for a series that has none).
    firstFreeSeason(series: string, exceptMangaIds: readonly number[] = []): number {
        return Math.max(0, ...this.seasonsOfSeries(series, exceptMangaIds)) + 1;
    }

    // Joins a manga to a series with its place in it (and, if wanted, the name it is shown with), or takes it out of one. It enters the
    // groups the other seasons of the series are in. False when the manga is not there, or when the season is taken.
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

    // Gives every manga of the list the name of a series, keeping the season each one has (a manga that was on its own is the first
    // season). The spelling is the one another manga of the library already has for that series, if any. When that series has a season
    // one of them has too, nothing changes and the manga that clashes is told.
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

    // ----- Groups -----

    listGroups(): MangaGroup[] {
        return this.all('SELECT * FROM manga_group ORDER BY name COLLATE NOCASE, id').map(toGroup);
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

    // Makes a group. Null when another group has the name (the same name in another case, with other accents or extra spaces is the same).
    createGroup(name: string): MangaGroup | null {
        if (this.groupNameTaken(name, 0)) {
            return null;
        }
        return toGroup(this.one('INSERT INTO manga_group (name, created_at) VALUES (?, ?) RETURNING *', name, this.now()) ?? {});
    }

    // Null when the group is not there or another group has the name.
    renameGroup(id: number, name: string): MangaGroup | null {
        if (this.getGroup(id) === null || this.groupNameTaken(name, id)) {
            return null;
        }
        this.run('UPDATE manga_group SET name = ? WHERE id = ?', name, id);
        return this.getGroup(id);
    }

    // The mangas stay in the library: only the group goes.
    deleteGroup(id: number): void {
        this.run('DELETE FROM manga_group WHERE id = ?', id);
    }

    groupIdsOf(mangaId: number): number[] {
        return this.all('SELECT group_id FROM manga_group_member WHERE manga_id = ? ORDER BY group_id', mangaId).map((row) => {
            return numeric(row, 'group_id');
        });
    }

    // Puts mangas in a group, or takes them out of it. Mangas that are not there are ignored.
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

    // A manga that joins a series is in the groups the series is already in.
    private joinGroupsOfSeries(mangaId: number, series: string): void {
        this.all('SELECT id, series FROM manga WHERE series IS NOT NULL AND id != ?', mangaId)
            .filter((row) => {
                return sameSeries(text(row, 'series'), series);
            })
            .forEach((row) => {
                this.run('INSERT OR IGNORE INTO manga_group_member (group_id, manga_id) SELECT group_id, ? FROM manga_group_member WHERE manga_id = ?', mangaId, numeric(row, 'id'));
            });
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
