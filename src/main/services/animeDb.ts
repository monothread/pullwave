import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type {
    AniError,
    AniErrorCode,
    AnimeAiringOverride,
    AnimeAiringStatus,
    AnimeArrivalOrigin,
    AnimeEpisodeRecord,
    AnimeEpisodeStatus,
    AnimeHistoryEntry,
    AnimeHistoryRequest,
    AnimeProgressUpdate,
    AnimeRecord,
    AnimeScheduleEntry,
    AnimeUpdateEntry,
    LibraryAnime
} from '@shared/anime';
import { ANIME_AIRING_OVERRIDES, ANIME_AIRING_STATUSES, isAnimeComplete } from '@shared/anime';
import { sameSeries } from '@shared/series';
import { sourceIdNumber, sourceQualifier } from '@shared/animeSource';
import { parseErrorDetails, serializeErrorDetails } from './errorDetails';

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
    );`,
    // The availability of the schedule is not checked by itself any more: the user looks an anime up when they want it.
    `DROP TABLE anime_availability;`,
    // The check for new episodes: when the list of episodes of an anime was first read (what it lists then is not new), when an episode
    // got into the library by the check, and a line for each one that did (what the screen of updates lists).
    `ALTER TABLE anime ADD COLUMN episodes_baseline_at INTEGER;
    ALTER TABLE episode ADD COLUMN added_at INTEGER;
    CREATE TABLE episode_update (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        anime_id INTEGER NOT NULL REFERENCES anime (id) ON DELETE CASCADE,
        episode_id INTEGER NOT NULL REFERENCES episode (id) ON DELETE CASCADE,
        found_at INTEGER NOT NULL,
        origin TEXT NOT NULL
    );
    CREATE INDEX episode_update_found ON episode_update (found_at DESC, id DESC);`,
    // Whether the releases of an anime are over: the anime of AniList it was matched to, what AniList said about its releases and when it was
    // asked (all empty until the first look for new episodes), and what the user said about it, which wins over AniList.
    `ALTER TABLE anime ADD COLUMN anilist_id INTEGER;
    ALTER TABLE anime ADD COLUMN airing_status TEXT;
    ALTER TABLE anime ADD COLUMN airing_checked_at INTEGER;
    ALTER TABLE anime ADD COLUMN airing_override TEXT;`,
    // Everything known about the error of an episode (the exit code, the stack...), as JSON.
    `ALTER TABLE episode ADD COLUMN error_details TEXT;`,
    // The id the source gives an anime (the seasons of an anime can have the same title and only differ by it) and the site that gave it: when
    // ani-cli moves to another site the ids are not comparable any more, and an anime with the same title is the same anime.
    `ALTER TABLE anime ADD COLUMN source_id TEXT;
    ALTER TABLE anime ADD COLUMN source_provider TEXT;
    CREATE INDEX anime_source_id ON anime (source_id, audio);`,
    // When the viewer last watched an episode of an anime of the history, apart from when it was last opened (`opened_at` moves when the anime is
    // only opened too). It is empty until an episode is watched: what the history already had is not guessed.
    `ALTER TABLE anime_history ADD COLUMN watched_at INTEGER;`,
    // Whether the video of a downloaded episode has no audio (1) or has it (0), which is looked at once, when it is downloaded or when the user
    // asks for the library to be checked. Empty (NULL) until then: the episodes that were downloaded before are not looked at by themselves.
    `ALTER TABLE episode ADD COLUMN no_audio INTEGER;`
];

// The history keeps the most recent anime only.
export const MAX_HISTORY_ENTRIES = 50;
// The list of updates keeps the most recent episodes only.
export const MAX_UPDATES_KEPT = 1000;
const ARRIVAL_ORIGINS: readonly AnimeArrivalOrigin[] = ['auto', 'manual'];

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

// What the library knows about the releases of an anime and when AniList was last asked about it.
export interface AnimeAiringState {
    id: number;
    title: string;
    anilistId: number | null;
    status: AnimeAiringStatus | null;
    checkedAt: number | null;
}

// The audio every new anime is kept with: the app only has the subtitled ones (the dubbed ones were taken out). The column stays (it is part
// of the keys of the tables). An anime of a library kept before may still say "dub": it is the same anime as any other with its title or its
// id, so every look for an anime (and for an entry of the history) takes it whatever its audio, the subtitled one first when there are both.
export const STORED_AUDIO = 'sub';
// The order that puts the subtitled anime first, among the ones that are the same.
const SUBTITLED_FIRST = `audio = '${STORED_AUDIO}' DESC, id`;

export interface NewAnime {
    title: string;
    query: string;
    searchIndex: number;
    // The id the source gives it, when it is known, and the site that gave it.
    sourceId?: string | null;
    sourceProvider?: string | null;
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

function pick<T extends string, F extends T | null = T>(value: string, allowed: readonly T[], fallback: F): T | F {
    return allowed.find((candidate) => {
        return candidate === value;
    }) ?? fallback;
}

function toAnime(row: Row): AnimeRecord {
    const status = pick(text(row, 'airing_status'), ANIME_AIRING_STATUSES, null);
    const override = pick(text(row, 'airing_override'), ANIME_AIRING_OVERRIDES, null);
    return {
        id: numeric(row, 'id'),
        title: text(row, 'title'),
        query: text(row, 'query'),
        searchIndex: numeric(row, 'search_index'),
        sourceId: nullableText(row, 'source_id'),
        createdAt: numeric(row, 'created_at'),
        series: nullableText(row, 'series'),
        season: nullableNumeric(row, 'season'),
        seasonName: nullableText(row, 'season_name'),
        airing: { status, override, complete: isAnimeComplete(status, override) }
    };
}

function toError(row: Row): AniError | null {
    const raw = nullableText(row, 'error_raw');
    if (raw === null) {
        return null;
    }
    const details = parseErrorDetails(nullableText(row, 'error_details'));
    return { code: pick(text(row, 'error_code'), ERROR_CODES, 'UNKNOWN'), raw, ...(details === undefined ? {} : { details }) };
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
        addedAt: nullableNumeric(row, 'added_at'),
        fileMissing: false,
        noAudio: nullableNumeric(row, 'no_audio') === 1
    };
}

function toHistoryEntry(row: Row): AnimeHistoryEntry {
    return {
        id: numeric(row, 'id'),
        title: text(row, 'title'),
        query: text(row, 'query'),
        searchIndex: numeric(row, 'search_index'),
        episode: nullableText(row, 'episode'),
        openedAt: numeric(row, 'opened_at'),
        watchedAt: nullableNumeric(row, 'watched_at')
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

    // A database that exists is brought up one migration at a time, each one undone alone if it fails. A new one has nothing to keep, so
    // all of them go in one transaction: it is written to the disk once, not once for each (slow where the disk is, as on Windows).
    private migrate(): void {
        const current = numeric(this.one('PRAGMA user_version') ?? {}, 'user_version');
        if (current === 0) {
            this.applyMigrations(MIGRATIONS, 0);
            return;
        }
        MIGRATIONS.slice(current).forEach((migration, offset) => {
            this.applyMigrations([migration], current + offset);
        });
    }

    // Runs the migrations, which start at the version `from`, in one transaction that also sets the version they end at.
    private applyMigrations(migrations: readonly string[], from: number): void {
        this.db.exec('BEGIN');
        try {
            migrations.forEach((migration) => {
                this.db.exec(migration);
            });
            this.db.exec(`PRAGMA user_version = ${from + migrations.length}`);
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
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

    // The same title is the same anime: its search data is refreshed, because the position can change.
    upsertAnime(input: NewAnime): AnimeRecord {
        if (input.sourceId !== undefined && input.sourceId !== null && input.sourceId !== '') {
            return this.upsertBySourceId(input, input.sourceId);
        }
        const known = this.byTitle(input.title);
        if (known !== null) {
            return this.updateAnime(known, 'query = ?, search_index = ?', input.query, input.searchIndex);
        }
        return this.insertAnime(input.title, input.query, input.searchIndex);
    }

    // The anime with this title, whatever its audio (the subtitled one first).
    private byTitle(title: string): Row | null {
        return this.one(`SELECT * FROM anime WHERE title = ? ORDER BY ${SUBTITLED_FIRST} LIMIT 1`, title);
    }

    private insertAnime(title: string, query: string, searchIndex: number, sourceId: string | null = null, sourceProvider: string | null = null): AnimeRecord {
        const row = this.one(
            'INSERT INTO anime (title, query, search_index, audio, created_at, source_id, source_provider) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
            title,
            query,
            searchIndex,
            STORED_AUDIO,
            this.now(),
            sourceId,
            sourceProvider
        );
        return toAnime(row ?? {});
    }

    // Changes one anime (the one of the row) and gives it as it is now.
    private updateAnime(row: Row, assignments: string, ...values: SQLInputValue[]): AnimeRecord {
        const updated = this.one(`UPDATE anime SET ${assignments} WHERE id = ? RETURNING *`, ...values, numeric(row, 'id'));
        return toAnime(updated ?? row);
    }

    // An anime whose source id is known is the one that has that id, whatever it is called: another anime with the same title is another
    // anime (the second season of the same name). When ani-cli has moved to another site, the ids it gave before are not comparable with the
    // new ones: the anime that has the title and an id of another site is this one, and takes the new id, with nothing to do for the user.
    // One added before the ids were known, with its title and at the place it has now, is this one and gets the id. A title that is taken by
    // another anime of the same site is made different by what the id says.
    private upsertBySourceId(input: NewAnime, sourceId: string): AnimeRecord {
        const provider = input.sourceProvider ?? null;
        const known = this.one(
            `SELECT * FROM anime WHERE source_id = ? AND (source_provider IS NULL OR ? IS NULL OR source_provider = ?) ORDER BY ${SUBTITLED_FIRST} LIMIT 1`,
            sourceId,
            provider,
            provider
        );
        if (known) {
            return this.updateAnime(known, 'query = ?, search_index = ?, source_provider = COALESCE(source_provider, ?)', input.query, input.searchIndex, provider);
        }
        const legacy = this.one(`SELECT * FROM anime WHERE title = ? AND source_id IS NULL AND search_index = ? ORDER BY ${SUBTITLED_FIRST} LIMIT 1`, input.title, input.searchIndex);
        if (legacy) {
            return this.updateAnime(legacy, 'source_id = ?, source_provider = ?, query = ?', sourceId, provider, input.query);
        }
        if (provider !== null) {
            const moved = this.one(
                `SELECT * FROM anime WHERE title = ? AND source_provider IS NOT NULL AND source_provider != ? ORDER BY ${SUBTITLED_FIRST} LIMIT 1`,
                input.title,
                provider
            );
            if (moved) {
                return this.updateAnime(moved, 'source_id = ?, source_provider = ?, query = ?, search_index = ?', sourceId, provider, input.query, input.searchIndex);
            }
        }
        return this.insertAnime(this.freeTitle(input.title, sourceId), input.query, input.searchIndex, sourceId, provider);
    }

    // The title when no anime has it; otherwise the title with what the id says (and, if that is taken too, its number).
    private freeTitle(title: string, sourceId: string): string {
        const taken = (candidate: string): boolean => {
            return this.one('SELECT 1 AS found FROM anime WHERE title = ?', candidate) !== null;
        };
        if (!taken(title)) {
            return title;
        }
        const qualifier = sourceQualifier(title, sourceId);
        const qualified = qualifier === null ? title : `${title} (${qualifier})`;
        if (!taken(qualified)) {
            return qualified;
        }
        const numbered = `${qualified} (${sourceIdNumber(sourceId)})`;
        return taken(numbered) ? `${numbered} (${this.now()})` : numbered;
    }

    // An anime found on the disk: it is added, or kept as it is when it is already there, except that search data that is not
    // known (position 0) is filled in when it is learnt.
    importAnime(input: NewAnime): AnimeRecord {
        const known = this.byTitle(input.title);
        if (known === null) {
            return this.insertAnime(input.title, input.query, input.searchIndex);
        }
        if (numeric(known, 'search_index') < 1) {
            return this.updateAnime(known, 'query = ?, search_index = ?', input.query, input.searchIndex);
        }
        return toAnime(known);
    }

    // Whether another anime (not the one with this id) already has this season of the series.
    seasonTaken(series: string, season: number, exceptAnimeId: number): boolean {
        return this.all('SELECT * FROM anime WHERE season = ? AND id != ?', season, exceptAnimeId).some((row) => {
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
        if (series !== null && season !== null && this.seasonTaken(series, season, animeId)) {
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

    // Whether the list of episodes of the anime was read before by the check for new episodes: what a first reading lists is not new.
    hasEpisodesBaseline(animeId: number): boolean {
        return nullableNumeric(this.one('SELECT episodes_baseline_at FROM anime WHERE id = ?', animeId) ?? {}, 'episodes_baseline_at') !== null;
    }

    // The first reading of the episodes an anime has: they are put in the library as `idle`, none of them counts as new, and from then on
    // what the source lists beyond them does.
    registerEpisodesBaseline(animeId: number, numbers: readonly string[]): void {
        this.db.exec('BEGIN');
        try {
            numbers.forEach((number) => {
                this.run(`INSERT INTO episode (anime_id, number, status) VALUES (?, ?, 'idle') ON CONFLICT (anime_id, number) DO NOTHING`, animeId, number);
            });
            this.run('UPDATE anime SET episodes_baseline_at = ? WHERE id = ?', this.now(), animeId);
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    // The episodes the source lists that the anime does not have yet are put in the library as `idle`, each with the time it arrived and a
    // line in the list of updates. Gives back the numbers of the ones that were new, in the order they were given.
    registerNewEpisodes(animeId: number, numbers: readonly string[], origin: AnimeArrivalOrigin): string[] {
        const arrived: string[] = [];
        this.db.exec('BEGIN');
        try {
            const foundAt = this.now();
            numbers.forEach((number) => {
                const row = this.one(
                    `INSERT INTO episode (anime_id, number, status, added_at) VALUES (?, ?, 'idle', ?) ON CONFLICT (anime_id, number) DO NOTHING RETURNING id`,
                    animeId,
                    number,
                    foundAt
                );
                if (row !== null) {
                    arrived.push(number);
                    this.run('INSERT INTO episode_update (anime_id, episode_id, found_at, origin) VALUES (?, ?, ?, ?)', animeId, numeric(row, 'id'), foundAt, origin);
                }
            });
            this.run('DELETE FROM episode_update WHERE id NOT IN (SELECT id FROM episode_update ORDER BY found_at DESC, id DESC LIMIT ?)', MAX_UPDATES_KEPT);
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
        return arrived;
    }

    // What is known about the releases of the anime of the library, to keep it up to date with AniList (see animeAiring.ts).
    airingStates(): AnimeAiringState[] {
        return this.all('SELECT id, title, anilist_id, airing_status, airing_checked_at FROM anime ORDER BY id').map((row) => {
            return {
                id: numeric(row, 'id'),
                title: text(row, 'title'),
                anilistId: nullableNumeric(row, 'anilist_id'),
                status: pick(text(row, 'airing_status'), ANIME_AIRING_STATUSES, null),
                checkedAt: nullableNumeric(row, 'airing_checked_at')
            };
        });
    }

    // What AniList said about the releases of an anime now: the anime it was matched to (null: none) and the status (null: not sure).
    saveAiring(animeId: number, anilistId: number | null, status: AnimeAiringStatus | null): void {
        this.run('UPDATE anime SET anilist_id = ?, airing_status = ?, airing_checked_at = ? WHERE id = ?', anilistId, status, this.now(), animeId);
    }

    // What the user says about the releases of the anime, which wins over AniList (null: follow AniList).
    setAiringOverride(animeId: number, override: AnimeAiringOverride | null): void {
        this.run('UPDATE anime SET airing_override = ? WHERE id = ?', override, animeId);
    }

    // The place of the anime in the search of its name, when the source lists it somewhere else now.
    updateSearchIndex(animeId: number, searchIndex: number): void {
        this.run('UPDATE anime SET search_index = ? WHERE id = ?', searchIndex, animeId);
    }

    // The episodes that arrived in the library after their anime was in it, the newest first.
    updates(limit = 200): AnimeUpdateEntry[] {
        return this.all(
            `SELECT u.id AS id, u.anime_id AS anime_id, u.episode_id AS episode_id, u.found_at AS found_at, u.origin AS origin,
                    a.title AS title, a.audio AS audio, e.number AS number, e.status AS status
             FROM episode_update u
             JOIN anime a ON a.id = u.anime_id
             JOIN episode e ON e.id = u.episode_id
             ORDER BY u.found_at DESC, u.id DESC LIMIT ?`,
            limit
        ).map((row) => {
            return {
                id: numeric(row, 'id'),
                animeId: numeric(row, 'anime_id'),
                animeTitle: text(row, 'title'),
                        episodeId: numeric(row, 'episode_id'),
                episodeNumber: text(row, 'number'),
                foundAt: numeric(row, 'found_at'),
                origin: pick(text(row, 'origin'), ARRIVAL_ORIGINS, 'auto'),
                status: pick(text(row, 'status'), EPISODE_STATUSES, 'error')
            };
        });
    }

    clearUpdates(): void {
        this.run('DELETE FROM episode_update');
    }

    // The seasons a series has, without counting the anime in `exceptAnimeIds`.
    seasonsOfSeries(series: string, exceptAnimeIds: readonly number[] = []): number[] {
        return this.all('SELECT * FROM anime WHERE series IS NOT NULL AND season IS NOT NULL')
            .filter((row) => {
                return !exceptAnimeIds.includes(numeric(row, 'id')) && sameSeries(text(row, 'series'), series);
            })
            .map((row) => {
                return numeric(row, 'season');
            });
    }

    // The first season number a series does not have: the last one plus one (1 for a series that has none).
    firstFreeSeason(series: string, exceptAnimeIds: readonly number[] = []): number {
        return Math.max(0, ...this.seasonsOfSeries(series, exceptAnimeIds)) + 1;
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
        const clash = moves.find(({ season }) => {
            return this.seasonsOfSeries(name, animeIds).includes(season);
        });
        if (clash) {
            return { ok: false, anime: clash.anime.title, season: clash.season, suggested: this.firstFreeSeason(name, animeIds) };
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
                error_raw = CASE WHEN status = 'done' THEN error_raw ELSE NULL END,
                error_details = CASE WHEN status = 'done' THEN error_details ELSE NULL END
             RETURNING *`,
            animeId,
            number
        );
        return toEpisode(row ?? {});
    }

    // The anime with that source id when it is given, or else with that title. With an id, the title only finds an anime that has no id yet
    // (one added before the ids were known) or whose id is from another site (ani-cli moved): an anime with the same title and another id of
    // the same site is another anime.
    findAnime(title: string, sourceId?: string | null, sourceProvider?: string | null): AnimeRecord | null {
        if (sourceId !== undefined && sourceId !== null && sourceId !== '') {
            const provider = sourceProvider ?? null;
            const row = this.one(
                `SELECT * FROM anime WHERE (
                    (source_id = ? AND (source_provider IS NULL OR ? IS NULL OR source_provider = ?))
                    OR (title = ? AND source_id IS NULL)
                    OR (title = ? AND ? IS NOT NULL AND source_provider IS NOT NULL AND source_provider != ?)
                 ) ORDER BY (source_id = ?) DESC, ${SUBTITLED_FIRST} LIMIT 1`,
                sourceId,
                provider,
                provider,
                title,
                title,
                provider,
                provider,
                sourceId
            );
            return row ? toAnime(row) : null;
        }
        const row = this.byTitle(title);
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
        // The subtitled anime first among the ones of a title (a library kept before may also have a dubbed one): it is the one the screen
        // finds by the title, as every look of the library does.
        return this.all(`SELECT * FROM anime ORDER BY title COLLATE NOCASE, ${SUBTITLED_FIRST}`).map((row) => {
            const anime = toAnime(row);
            return { ...anime, episodes: this.episodesOf(anime.id) };
        });
    }

    markDownloading(episodeId: number): void {
        this.run(`UPDATE episode SET status = 'downloading', error_code = NULL, error_raw = NULL, error_details = NULL WHERE id = ?`, episodeId);
    }

    // A paused episode keeps its partial file and goes on from it when resumed; unlike the ones that were waiting or downloading it is not
    // failed when the app is closed.
    markPaused(episodeId: number): void {
        this.run(`UPDATE episode SET status = 'paused', error_code = NULL, error_raw = NULL, error_details = NULL WHERE id = ?`, episodeId);
    }

    // A downloaded episode whose file is gone goes back to the queue: it forgets the file that is not there (the watched mark and the
    // position are kept, the video is the same).
    markForRedownload(episodeId: number): void {
        this.run(`UPDATE episode SET status = 'queued', file_path = NULL, size_bytes = NULL, no_audio = NULL, error_code = NULL, error_raw = NULL, error_details = NULL WHERE id = ? AND status = 'done'`, episodeId);
    }

    // What is known about the audio of the episode is kept: the import points an episode to its file in a new place with this too.
    markDone(episodeId: number, filePath: string, sizeBytes: number | null): void {
        this.run(
            `UPDATE episode SET status = 'done', file_path = ?, size_bytes = ?, error_code = NULL, error_raw = NULL, error_details = NULL, downloaded_at = ? WHERE id = ?`,
            filePath,
            sizeBytes,
            this.now(),
            episodeId
        );
    }

    // The size of the file of a downloaded episode after the file was repaired in place (see imageHeaderRepair.ts). It only counts for the file
    // that was repaired: an episode that was downloaded again meanwhile (another file) is left as it is.
    updateFileSize(episodeId: number, filePath: string, sizeBytes: number): void {
        this.run(`UPDATE episode SET size_bytes = ? WHERE id = ? AND status = 'done' AND file_path = ?`, sizeBytes, episodeId, filePath);
    }

    // What looking at the audio of the video found. It only counts for the file that was looked at: an episode that was downloaded again
    // meanwhile (another file) or is not in the library any more is left as it is.
    markAudioChecked(episodeId: number, filePath: string, hasAudio: boolean): void {
        this.run(`UPDATE episode SET no_audio = ? WHERE id = ? AND status = 'done' AND file_path = ?`, hasAudio ? 0 : 1, episodeId, filePath);
    }

    // The downloaded episodes whose audio was never looked at (the ones that were downloaded before it was, or that could not be read).
    episodesToCheckAudio(): AnimeEpisodeRecord[] {
        return this.all(`SELECT * FROM episode WHERE status = 'done' AND file_path IS NOT NULL AND no_audio IS NULL ORDER BY anime_id, id`).map(toEpisode);
    }

    markFailed(episodeId: number, status: 'error' | 'cancelled', error: AniError | null): void {
        this.run(
            `UPDATE episode SET status = ?, error_code = ?, error_raw = ?, error_details = ? WHERE id = ?`,
            status,
            error?.code ?? null,
            error?.raw ?? null,
            serializeErrorDetails(error?.details),
            episodeId
        );
    }

    // The episodes that are paused, anime by anime, in the order they were put in the library.
    pausedEpisodes(): AnimeEpisodeRecord[] {
        return this.all(`SELECT * FROM episode WHERE status = 'paused' ORDER BY anime_id, id`).map(toEpisode);
    }

    // The queue lives in memory: whatever was waiting or downloading when the app closed will not continue by itself.
    failInterrupted(): void {
        this.run(
            `UPDATE episode SET status = 'error', error_code = 'UNKNOWN', error_raw = ?, error_details = NULL WHERE status IN ('queued', 'downloading')`,
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
        const now = this.now();
        // Only watching an episode is watching: opening the anime leaves the moment it was last watched as it was.
        const watchedAt = request.episode === null ? null : now;
        // The entry of the title, whatever its audio (one kept as dubbed by an earlier version of the app is the same anime); any other entry of
        // the title goes, so the history has one entry for it.
        const known = this.one(`SELECT id FROM anime_history WHERE title = ? ORDER BY ${SUBTITLED_FIRST} LIMIT 1`, request.title);
        if (known === null) {
            this.run(
                'INSERT INTO anime_history (title, query, search_index, audio, episode, opened_at, watched_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                request.title,
                request.query,
                request.index,
                STORED_AUDIO,
                request.episode,
                now,
                watchedAt
            );
        } else {
            const id = numeric(known, 'id');
            this.run(
                `UPDATE anime_history SET query = ?, search_index = ?, episode = COALESCE(?, episode), opened_at = ?, watched_at = COALESCE(?, watched_at)
                 WHERE id = ?`,
                request.query,
                request.index,
                request.episode,
                now,
                watchedAt,
                id
            );
            this.run('DELETE FROM anime_history WHERE title = ? AND id != ?', request.title, id);
        }
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
        // The same: a file another episode still points at is kept.
        return filePath !== null && this.one('SELECT 1 AS found FROM episode WHERE file_path = ?', filePath) === null ? filePath : null;
    }

    removeAnime(animeId: number): string[] {
        const files = this.episodesOf(animeId).flatMap((episode) => {
            return episode.filePath === null ? [] : [episode.filePath];
        });
        this.run('DELETE FROM anime WHERE id = ?', animeId);
        // A file another episode still points at (two anime of the same title from a library kept before) is not given back to be deleted.
        return files.filter((path) => {
            return this.one('SELECT 1 AS found FROM episode WHERE file_path = ?', path) === null;
        });
    }
}
