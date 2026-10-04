import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type {
    AniError,
    AniErrorCode,
    AnimeAudio,
    AnimeAvailability,
    AnimeEpisodeRecord,
    AnimeEpisodeStatus,
    AnimeHistoryEntry,
    AnimeHistoryRequest,
    AnimeProgressUpdate,
    AnimeRecord,
    AnimeScheduleEntry,
    LibraryAnime
} from '@shared/anime';
import { sameSeries } from '@shared/series';

export const INTERRUPTED_MESSAGE = 'The app was closed before the download finished.';

// Each entry is one schema version, applied in order; `PRAGMA user_version` remembers how many were applied.
const MIGRATIONS: readonly string[] = [
    `CREATE TABLE anime (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        query TEXT NOT NULL,
        search_index INTEGER NOT NULL,
        audio TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (title, audio)
    );
    CREATE TABLE episode (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        anime_id INTEGER NOT NULL REFERENCES anime (id) ON DELETE CASCADE,
        number TEXT NOT NULL,
        status TEXT NOT NULL,
        file_path TEXT,
        size_bytes INTEGER,
        error_code TEXT,
        error_raw TEXT,
        position_seconds REAL NOT NULL DEFAULT 0,
        duration_seconds REAL NOT NULL DEFAULT 0,
        watched INTEGER NOT NULL DEFAULT 0,
        downloaded_at INTEGER,
        UNIQUE (anime_id, number)
    );`,
    // The seasons of an anime are separate entries in the source; the user joins them under a series with a season number.
    `ALTER TABLE anime ADD COLUMN series TEXT;
    ALTER TABLE anime ADD COLUMN season INTEGER;`,
    // The name an anime is shown with inside its series (the season number only orders them).
    `ALTER TABLE anime ADD COLUMN season_name TEXT;`,
    // What the viewer opened or watched, apart from the library (it also covers anime that were only searched or streamed).
    `CREATE TABLE anime_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        query TEXT NOT NULL,
        search_index INTEGER NOT NULL,
        audio TEXT NOT NULL,
        episode TEXT,
        opened_at INTEGER NOT NULL,
        UNIQUE (title, audio)
    );`,
    // What is kept so the network is asked for less: the cover found for an anime by its title (the url is empty where AniList has none) with
    // when it was last checked, and what AniList said the schedule of a stretch of time was with when it was asked (the entries as JSON).
    `CREATE TABLE anime_cover (
        key TEXT PRIMARY KEY,
        url TEXT,
        checked_at INTEGER NOT NULL
    );
    CREATE TABLE anime_schedule_cache (
        from_at INTEGER NOT NULL,
        to_at INTEGER NOT NULL,
        fetched_at INTEGER NOT NULL,
        entries TEXT NOT NULL,
        PRIMARY KEY (from_at, to_at)
    );`,
    // Whether the source has an anime of the schedule, by audio, with the name that found it and the result (all empty where none did) and when
    // it was checked.
    `CREATE TABLE anime_availability (
        anilist_id INTEGER NOT NULL,
        audio TEXT NOT NULL,
        available INTEGER NOT NULL,
        query TEXT,
        result_index INTEGER,
        result_title TEXT,
        checked_at INTEGER NOT NULL,
        PRIMARY KEY (anilist_id, audio)
    );`
];

// The history keeps the most recent anime only.
export const MAX_HISTORY_ENTRIES = 50;

const EPISODE_STATUSES: readonly AnimeEpisodeStatus[] = ['idle', 'queued', 'downloading', 'paused', 'done', 'error', 'cancelled'];
const ERROR_CODES: readonly AniErrorCode[] = [
    'NO_RESULTS',
    'BLOCKED',
    'NETWORK',
    'NO_SOURCES',
    'EPISODE_NOT_RELEASED',
    'INVALID_SELECTION',
    'BINARY_MISSING',
    'UNKNOWN'
];

export interface NewAnime {
    title: string;
    query: string;
    searchIndex: number;
    audio: AnimeAudio;
}

// What is kept of the cover of an anime: its address (null where AniList has none) and when it was last checked, in milliseconds.
export interface StoredCover {
    url: string | null;
    checkedAt: number;
}

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

function pick<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
    return allowed.find((candidate) => {
        return candidate === value;
    }) ?? fallback;
}

function toAnime(row: Row): AnimeRecord {
    return {
        id: numeric(row, 'id'),
        title: text(row, 'title'),
        query: text(row, 'query'),
        searchIndex: numeric(row, 'search_index'),
        audio: text(row, 'audio') === 'dub' ? 'dub' : 'sub',
        createdAt: numeric(row, 'created_at'),
        series: nullableText(row, 'series'),
        season: nullableNumeric(row, 'season'),
        seasonName: nullableText(row, 'season_name')
    };
}

function toError(row: Row): AniError | null {
    const raw = nullableText(row, 'error_raw');
    if (raw === null) {
        return null;
    }
    return { code: pick(text(row, 'error_code'), ERROR_CODES, 'UNKNOWN'), raw };
}

function toEpisode(row: Row): AnimeEpisodeRecord {
    return {
        id: numeric(row, 'id'),
        animeId: numeric(row, 'anime_id'),
        number: text(row, 'number'),
        status: pick(text(row, 'status'), EPISODE_STATUSES, 'error'),
        filePath: nullableText(row, 'file_path'),
        sizeBytes: nullableNumeric(row, 'size_bytes'),
        error: toError(row),
        positionSeconds: numeric(row, 'position_seconds'),
        durationSeconds: numeric(row, 'duration_seconds'),
        watched: numeric(row, 'watched') === 1,
        downloadedAt: nullableNumeric(row, 'downloaded_at'),
        fileMissing: false
    };
}

function toHistoryEntry(row: Row): AnimeHistoryEntry {
    return {
        id: numeric(row, 'id'),
        title: text(row, 'title'),
        query: text(row, 'query'),
        searchIndex: numeric(row, 'search_index'),
        audio: text(row, 'audio') === 'dub' ? 'dub' : 'sub',
        episode: nullableText(row, 'episode'),
        openedAt: numeric(row, 'opened_at')
    };
}

// Episodes are numbered with text ("12", "12.5"), so they are ordered as numbers.
function compareEpisodes(first: AnimeEpisodeRecord, second: AnimeEpisodeRecord): number {
    return Number(first.number) - Number(second.number);
}

export class AnimeDb {
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
        const current = numeric(this.one('PRAGMA user_version') ?? {}, 'user_version');
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

    // The same title and audio is the same anime: its search data is refreshed, because the position can change.
    upsertAnime(input: NewAnime): AnimeRecord {
        const row = this.one(
            `INSERT INTO anime (title, query, search_index, audio, created_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (title, audio) DO UPDATE SET query = excluded.query, search_index = excluded.search_index
             RETURNING *`,
            input.title,
            input.query,
            input.searchIndex,
            input.audio,
            this.now()
        );
        return toAnime(row ?? {});
    }

    // An anime found on the disk: it is added, or kept as it is when it is already there, except that search data that is not
    // known (position 0) is filled in when it is learnt.
    importAnime(input: NewAnime): AnimeRecord {
        const row = this.one(
            `INSERT INTO anime (title, query, search_index, audio, created_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (title, audio) DO UPDATE SET
                query = CASE WHEN anime.search_index < 1 THEN excluded.query ELSE anime.query END,
                search_index = CASE WHEN anime.search_index < 1 THEN excluded.search_index ELSE anime.search_index END
             RETURNING *`,
            input.title,
            input.query,
            input.searchIndex,
            input.audio,
            this.now()
        );
        return toAnime(row ?? {});
    }

    // Whether another anime (not the one with this id) of the same audio already has this season of the series.
    seasonTaken(series: string, season: number, audio: AnimeAudio, exceptAnimeId: number): boolean {
        return this.all('SELECT * FROM anime WHERE season = ? AND audio = ? AND id != ?', season, audio, exceptAnimeId).some((row) => {
            const other = nullableText(row, 'series');
            return other !== null && sameSeries(other, series);
        });
    }

    // The name a series goes by: the spelling the library already has for it (the same name in another case, with other accents or
    // extra spaces is the same series), otherwise the name as it is. The anime that is being joined does not count: it is the only
    // one that has the series, it can spell it differently.
    canonicalSeries(series: string, exceptAnimeId = 0): string {
        const known = this.all('SELECT series FROM anime WHERE series IS NOT NULL AND id != ? ORDER BY id', exceptAnimeId).find((row) => {
            return sameSeries(text(row, 'series'), series);
        });
        return known ? text(known, 'series') : series;
    }

    // Joins an anime to a series with its place in it (and, if wanted, the name it is shown with), or takes it out of one. False when
    // that place is already taken.
    setSeries(animeId: number, series: string | null, season: number | null, seasonName: string | null = null): boolean {
        const anime = this.getAnime(animeId);
        if (!anime) {
            return false;
        }
        if (series !== null && season !== null && this.seasonTaken(series, season, anime.audio, animeId)) {
            return false;
        }
        this.run(
            'UPDATE anime SET series = ?, season = ?, season_name = ? WHERE id = ?',
            series === null ? null : this.canonicalSeries(series, animeId),
            season,
            series === null ? null : seasonName,
            animeId
        );
        return true;
    }

    getEpisodeByNumber(animeId: number, number: string): AnimeEpisodeRecord | null {
        const row = this.one('SELECT * FROM episode WHERE anime_id = ? AND number = ?', animeId, number);
        return row ? toEpisode(row) : null;
    }

    // A video that is somewhere else now: only where it is changes.
    relinkEpisode(episodeId: number, filePath: string, sizeBytes: number | null): void {
        this.run('UPDATE episode SET file_path = ?, size_bytes = ? WHERE id = ?', filePath, sizeBytes, episodeId);
    }

    // Points several episodes to new files all together: either all of them change or none does.
    relinkEpisodes(updates: ReadonlyArray<{ episodeId: number; filePath: string; sizeBytes: number | null }>): void {
        this.db.exec('BEGIN');
        try {
            updates.forEach((update) => {
                this.relinkEpisode(update.episodeId, update.filePath, update.sizeBytes);
            });
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    // The episodes an anime has, none of them downloaded: the ones the library does not know are added as `idle`, the others (whatever
    // their status) are left as they are. All of them or none.
    registerEpisodes(animeId: number, numbers: readonly string[]): void {
        this.db.exec('BEGIN');
        try {
            numbers.forEach((number) => {
                this.run(`INSERT INTO episode (anime_id, number, status) VALUES (?, ?, 'idle') ON CONFLICT (anime_id, number) DO NOTHING`, animeId, number);
            });
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    // The seasons a series has for an audio, without counting the anime in `exceptAnimeIds`.
    seasonsOfSeries(series: string, audio: AnimeAudio, exceptAnimeIds: readonly number[] = []): number[] {
        return this.all('SELECT * FROM anime WHERE series IS NOT NULL AND season IS NOT NULL AND audio = ?', audio)
            .filter((row) => {
                return !exceptAnimeIds.includes(numeric(row, 'id')) && sameSeries(text(row, 'series'), series);
            })
            .map((row) => {
                return numeric(row, 'season');
            });
    }

    // The first season number a series does not have: the last one plus one (1 for a series that has none).
    firstFreeSeason(series: string, audio: AnimeAudio, exceptAnimeIds: readonly number[] = []): number {
        return Math.max(0, ...this.seasonsOfSeries(series, audio, exceptAnimeIds)) + 1;
    }

    // Gives every anime of the list the name of a series, keeping the season each one has (an anime that was on its own is the first season).
    // The spelling is the one another anime of the library already has for that series, if any. When that series has a season one of them
    // has too, nothing changes and the one that clashes is told, with the season number it could take.
    renameSeries(animeIds: readonly number[], series: string): { ok: true } | { ok: false; anime: string; season: number; suggested: number } {
        const animes = animeIds.flatMap((id) => {
            const anime = this.getAnime(id);
            return anime === null ? [] : [anime];
        });
        const known = this.all('SELECT id, series FROM anime WHERE series IS NOT NULL ORDER BY id').find((row) => {
            return !animeIds.includes(numeric(row, 'id')) && sameSeries(text(row, 'series'), series);
        });
        const name = known ? text(known, 'series') : series;
        const moves = animes.map((anime) => {
            return { anime, season: anime.season ?? 1 };
        });
        const clash = moves.find(({ anime, season }) => {
            return this.seasonsOfSeries(name, anime.audio, animeIds).includes(season);
        });
        if (clash) {
            return { ok: false, anime: clash.anime.title, season: clash.season, suggested: this.firstFreeSeason(name, clash.anime.audio, animeIds) };
        }
        this.db.exec('BEGIN');
        try {
            moves.forEach(({ anime, season }) => {
                this.run('UPDATE anime SET series = ?, season = ?, season_name = ? WHERE id = ?', name, season, anime.seasonName, anime.id);
            });
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
        return { ok: true };
    }

    // A new episode is queued. One that is already downloaded stays as it is; any other one is queued again.
    ensureEpisode(animeId: number, number: string): AnimeEpisodeRecord {
        const row = this.one(
            `INSERT INTO episode (anime_id, number, status) VALUES (?, ?, 'queued')
             ON CONFLICT (anime_id, number) DO UPDATE SET
                status = CASE WHEN status = 'done' THEN status ELSE 'queued' END,
                error_code = CASE WHEN status = 'done' THEN error_code ELSE NULL END,
                error_raw = CASE WHEN status = 'done' THEN error_raw ELSE NULL END
             RETURNING *`,
            animeId,
            number
        );
        return toEpisode(row ?? {});
    }

    findAnime(title: string, audio: AnimeAudio): AnimeRecord | null {
        const row = this.one('SELECT * FROM anime WHERE title = ? AND audio = ?', title, audio);
        return row ? toAnime(row) : null;
    }

    getAnime(id: number): AnimeRecord | null {
        const row = this.one('SELECT * FROM anime WHERE id = ?', id);
        return row ? toAnime(row) : null;
    }

    getEpisode(id: number): AnimeEpisodeRecord | null {
        const row = this.one('SELECT * FROM episode WHERE id = ?', id);
        return row ? toEpisode(row) : null;
    }

    getLibraryAnime(id: number): LibraryAnime | null {
        const anime = this.getAnime(id);
        return anime ? { ...anime, episodes: this.episodesOf(id) } : null;
    }

    private episodesOf(animeId: number): AnimeEpisodeRecord[] {
        return this.all('SELECT * FROM episode WHERE anime_id = ?', animeId).map(toEpisode).sort(compareEpisodes);
    }

    list(): LibraryAnime[] {
        return this.all('SELECT * FROM anime ORDER BY title COLLATE NOCASE, audio').map((row) => {
            const anime = toAnime(row);
            return { ...anime, episodes: this.episodesOf(anime.id) };
        });
    }

    markDownloading(episodeId: number): void {
        this.run(`UPDATE episode SET status = 'downloading', error_code = NULL, error_raw = NULL WHERE id = ?`, episodeId);
    }

    // A paused episode keeps its partial file and goes on from it when resumed; unlike the ones that were waiting or downloading it is not
    // failed when the app is closed.
    markPaused(episodeId: number): void {
        this.run(`UPDATE episode SET status = 'paused', error_code = NULL, error_raw = NULL WHERE id = ?`, episodeId);
    }

    markDone(episodeId: number, filePath: string, sizeBytes: number | null): void {
        this.run(
            `UPDATE episode SET status = 'done', file_path = ?, size_bytes = ?, error_code = NULL, error_raw = NULL, downloaded_at = ? WHERE id = ?`,
            filePath,
            sizeBytes,
            this.now(),
            episodeId
        );
    }

    markFailed(episodeId: number, status: 'error' | 'cancelled', error: AniError | null): void {
        this.run(`UPDATE episode SET status = ?, error_code = ?, error_raw = ? WHERE id = ?`, status, error?.code ?? null, error?.raw ?? null, episodeId);
    }

    // The queue lives in memory: whatever was waiting or downloading when the app closed will not continue by itself.
    failInterrupted(): void {
        this.run(
            `UPDATE episode SET status = 'error', error_code = 'UNKNOWN', error_raw = ? WHERE status IN ('queued', 'downloading')`,
            INTERRUPTED_MESSAGE
        );
    }

    saveProgress(update: AnimeProgressUpdate): void {
        this.run(
            `UPDATE episode SET position_seconds = ?, duration_seconds = ?, watched = ? WHERE id = ?`,
            update.positionSeconds,
            update.durationSeconds,
            update.watched ? 1 : 0,
            update.episodeId
        );
    }

    // The anime goes to the top of the history. Opening it without an episode keeps the last episode watched; the oldest entries beyond
    // the limit are dropped.
    recordHistory(request: AnimeHistoryRequest): void {
        this.run(
            `INSERT INTO anime_history (title, query, search_index, audio, episode, opened_at) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (title, audio) DO UPDATE SET
                query = excluded.query,
                search_index = excluded.search_index,
                episode = COALESCE(excluded.episode, anime_history.episode),
                opened_at = excluded.opened_at`,
            request.title,
            request.query,
            request.index,
            request.audio,
            request.episode,
            this.now()
        );
        this.run(
            `DELETE FROM anime_history WHERE id NOT IN (SELECT id FROM anime_history ORDER BY opened_at DESC, id DESC LIMIT ?)`,
            MAX_HISTORY_ENTRIES
        );
    }

    listHistory(): AnimeHistoryEntry[] {
        return this.all('SELECT * FROM anime_history ORDER BY opened_at DESC, id DESC').map(toHistoryEntry);
    }

    removeHistory(id: number): void {
        this.run('DELETE FROM anime_history WHERE id = ?', id);
    }

    clearHistory(): void {
        this.run('DELETE FROM anime_history');
    }

    // The episodes of the stretch, if a listing that covers it was asked for at `since` or later (in milliseconds); null when there is none.
    findScheduleCache(from: number, to: number, since: number): AnimeScheduleEntry[] | null {
        const row = this.one(
            'SELECT entries FROM anime_schedule_cache WHERE from_at <= ? AND to_at >= ? AND fetched_at >= ? ORDER BY fetched_at DESC LIMIT 1',
            from,
            to,
            since
        );
        if (!row) {
            return null;
        }
        try {
            const entries: unknown = JSON.parse(text(row, 'entries'));
            if (!Array.isArray(entries)) {
                return null;
            }
            const listed = entries as AnimeScheduleEntry[];
            // A listing kept by an older version lacks the two names of each anime: it is as if it were not there, and it is asked for again.
            if (
                listed.some((entry) => {
                    return !('english' in entry) || !('romaji' in entry);
                })
            ) {
                return null;
            }
            return listed.filter((entry) => {
                return typeof entry.airingAt === 'number' && entry.airingAt >= from && entry.airingAt < to;
            });
        } catch {
            return null;
        }
    }

    // Keeps the listing of the stretch, asked now, and forgets the ones asked before `since` (in milliseconds).
    saveScheduleCache(from: number, to: number, entries: readonly AnimeScheduleEntry[], since: number): void {
        this.run(
            `INSERT INTO anime_schedule_cache (from_at, to_at, fetched_at, entries) VALUES (?, ?, ?, ?)
             ON CONFLICT (from_at, to_at) DO UPDATE SET fetched_at = excluded.fetched_at, entries = excluded.entries`,
            from,
            to,
            this.now(),
            JSON.stringify(entries)
        );
        this.run('DELETE FROM anime_schedule_cache WHERE fetched_at < ?', since);
    }

    // What was found out about an anime of the schedule for an audio, if it was checked at `since` or later (in milliseconds).
    findAvailability(anilistId: number, audio: AnimeAudio, since: number): AnimeAvailability | null {
        const row = this.one('SELECT * FROM anime_availability WHERE anilist_id = ? AND audio = ? AND checked_at >= ?', anilistId, audio, since);
        if (!row) {
            return null;
        }
        const query = nullableText(row, 'query');
        const title = nullableText(row, 'result_title');
        const index = row.result_index;
        if (numeric(row, 'available') === 1 && query !== null && title !== null && typeof index === 'number') {
            return { anilistId, state: 'available', query, index, title };
        }
        return { anilistId, state: 'unavailable' };
    }

    saveAvailability(availability: AnimeAvailability, audio: AnimeAudio): void {
        const found = availability.state === 'available' ? availability : null;
        this.run(
            `INSERT INTO anime_availability (anilist_id, audio, available, query, result_index, result_title, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (anilist_id, audio) DO UPDATE SET available = excluded.available, query = excluded.query, result_index = excluded.result_index,
             result_title = excluded.result_title, checked_at = excluded.checked_at`,
            availability.anilistId,
            audio,
            found === null ? 0 : 1,
            found?.query ?? null,
            found?.index ?? null,
            found?.title ?? null,
            this.now()
        );
    }

    // Forgets what was checked before `since` (in milliseconds).
    forgetAvailabilityBefore(since: number): void {
        this.run('DELETE FROM anime_availability WHERE checked_at < ?', since);
    }

    getCover(key: string): StoredCover | null {
        const row = this.one('SELECT * FROM anime_cover WHERE key = ?', key);
        return row ? { url: nullableText(row, 'url'), checkedAt: numeric(row, 'checked_at') } : null;
    }

    // Keeps the cover (null: none) of the title and the moment it was checked, now.
    saveCover(key: string, url: string | null): void {
        this.run(
            `INSERT INTO anime_cover (key, url, checked_at) VALUES (?, ?, ?)
             ON CONFLICT (key) DO UPDATE SET url = excluded.url, checked_at = excluded.checked_at`,
            key,
            url,
            this.now()
        );
    }

    // Both remove the records and give back the files they pointed at, so the caller can delete them if asked to.
    removeEpisode(episodeId: number): string | null {
        const filePath = this.getEpisode(episodeId)?.filePath ?? null;
        this.run('DELETE FROM episode WHERE id = ?', episodeId);
        return filePath;
    }

    removeAnime(animeId: number): string[] {
        const files = this.episodesOf(animeId).flatMap((episode) => {
            return episode.filePath === null ? [] : [episode.filePath];
        });
        this.run('DELETE FROM anime WHERE id = ?', animeId);
        return files;
    }
}
