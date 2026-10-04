import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AnimeAvailability, AnimeHistoryRequest, AnimeScheduleEntry } from '@shared/anime';
import { AnimeDb, INTERRUPTED_MESSAGE, MAX_HISTORY_ENTRIES, type NewAnime } from '@main/services/animeDb';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

const NARUTO: NewAnime = { title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' };
const NOW = 1_700_000_000_000;

function makeDb(): AnimeDb {
    return new AnimeDb(':memory:', () => {
        return NOW;
    });
}

afterEach(() => {
    cleanTempDirs();
});

describe('AnimeDb schema', () => {
    it('applies the migrations and remembers the version', () => {
        expect(makeDb().schemaVersion).toBe(6);
    });

    it('keeps the data and does not migrate again when the file is opened twice', () => {
        const path = join(makeTempDir(), 'nested', 'anime.db');
        const first = new AnimeDb(path, () => {
            return NOW;
        });
        const anime = first.upsertAnime(NARUTO);
        first.ensureEpisode(anime.id, '1');
        first.close();

        const second = new AnimeDb(path);
        expect(second.schemaVersion).toBe(6);
        expect(second.list()).toEqual([
            {
                id: anime.id,
                title: 'Naruto',
                query: 'naruto',
                searchIndex: 1,
                audio: 'sub',
                createdAt: NOW,
                series: null,
                season: null,
                seasonName: null,
                episodes: [
                    {
                        id: 1,
                        animeId: anime.id,
                        number: '1',
                        status: 'queued',
                        filePath: null,
                        sizeBytes: null,
                        error: null,
                        positionSeconds: 0,
                        durationSeconds: 0,
                        watched: false,
                        downloadedAt: null,
                        fileMissing: false
                    }
                ]
            }
        ]);
        second.close();
    });

    it('rolls a failed migration back and reports the error', () => {
        const path = join(makeTempDir(), 'anime.db');
        const raw = new DatabaseSync(path);
        raw.exec('CREATE TABLE anime (leftover TEXT)');
        raw.close();

        expect(() => {
            return new AnimeDb(path);
        }).toThrow(/already exists/);

        const check = new DatabaseSync(path);
        expect(check.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 });
        expect(check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([{ name: 'anime' }]);
        check.close();
    });

    it('uses the default clock when none is given', () => {
        const db = new AnimeDb(':memory:');
        const before = Date.now();
        const anime = db.upsertAnime(NARUTO);
        expect(anime.createdAt).toBeGreaterThanOrEqual(before);
        expect(anime.createdAt).toBeLessThanOrEqual(Date.now());
    });
});

describe('AnimeDb.upsertAnime', () => {
    it('creates an anime', () => {
        expect(makeDb().upsertAnime(NARUTO)).toEqual({ id: 1, title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub', createdAt: NOW, series: null, season: null, seasonName: null });
    });

    it('treats the same title and audio as the same anime and refreshes its search data', () => {
        const db = makeDb();
        const first = db.upsertAnime(NARUTO);
        const second = db.upsertAnime({ ...NARUTO, query: 'naruto shippuden', searchIndex: 3 });
        expect(second).toEqual({ id: first.id, title: 'Naruto', query: 'naruto shippuden', searchIndex: 3, audio: 'sub', createdAt: NOW, series: null, season: null, seasonName: null });
        expect(db.list()).toHaveLength(1);
    });

    it('keeps the dubbed version apart', () => {
        const db = makeDb();
        const sub = db.upsertAnime(NARUTO);
        const dub = db.upsertAnime({ ...NARUTO, audio: 'dub' });
        expect(dub.id).not.toBe(sub.id);
        expect(dub.audio).toBe('dub');
    });
});

describe('AnimeDb.ensureEpisode', () => {
    it('queues a new episode', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        expect(db.ensureEpisode(anime.id, '1')).toMatchObject({ animeId: anime.id, number: '1', status: 'queued', error: null });
    });

    it('queues a failed or cancelled episode again and clears its error', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        const failed = db.ensureEpisode(anime.id, '1');
        db.markFailed(failed.id, 'error', { code: 'NETWORK', raw: 'boom' });
        expect(db.ensureEpisode(anime.id, '1')).toMatchObject({ id: failed.id, status: 'queued', error: null });

        db.markFailed(failed.id, 'cancelled', null);
        expect(db.ensureEpisode(anime.id, '1').status).toBe('queued');
    });

    it('leaves a downloaded episode alone', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        const episode = db.ensureEpisode(anime.id, '1');
        db.markDone(episode.id, '/a/1.mp4', 100);
        expect(db.ensureEpisode(anime.id, '1')).toMatchObject({ id: episode.id, status: 'done', filePath: '/a/1.mp4', sizeBytes: 100 });
    });
});

describe('AnimeDb lookups', () => {
    it('finds an anime, an episode and the anime with its episodes by id', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        const episode = db.ensureEpisode(anime.id, '2');
        expect(db.getAnime(anime.id)).toEqual(anime);
        expect(db.getEpisode(episode.id)).toEqual(episode);
        expect(db.getLibraryAnime(anime.id)).toEqual({ ...anime, episodes: [episode] });
    });

    it('answers null for what does not exist', () => {
        const db = makeDb();
        expect(db.getAnime(99)).toBeNull();
        expect(db.getEpisode(99)).toBeNull();
        expect(db.getLibraryAnime(99)).toBeNull();
    });
});

describe('AnimeDb.list', () => {
    it('is empty at first', () => {
        expect(makeDb().list()).toEqual([]);
    });

    it('orders the animes by title, ignoring case, and the episodes by number', () => {
        const db = makeDb();
        const one = db.upsertAnime({ ...NARUTO, title: 'one piece' });
        const bleach = db.upsertAnime({ ...NARUTO, title: 'Bleach' });
        ['10', '2', '1', '1.5'].forEach((number) => {
            db.ensureEpisode(bleach.id, number);
        });
        const list = db.list();
        expect(
            list.map((anime) => {
                return anime.title;
            })
        ).toEqual(['Bleach', 'one piece']);
        expect(
            list[0]?.episodes.map((episode) => {
                return episode.number;
            })
        ).toEqual(['1', '1.5', '2', '10']);
        expect(list[1]?.id).toBe(one.id);
    });
});

describe('AnimeDb status changes', () => {
    it('marks an episode as downloading and clears the previous error', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        const episode = db.ensureEpisode(anime.id, '1');
        db.markFailed(episode.id, 'error', { code: 'BLOCKED', raw: 'Blocked by cloudflare.' });
        db.markDownloading(episode.id);
        expect(db.getEpisode(episode.id)).toMatchObject({ status: 'downloading', error: null });
    });

    it('marks an episode as done with its file and size', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        const episode = db.ensureEpisode(anime.id, '1');
        db.markDone(episode.id, '/a/Naruto Episode 1.mp4', 1234);
        expect(db.getEpisode(episode.id)).toMatchObject({
            status: 'done',
            filePath: '/a/Naruto Episode 1.mp4',
            sizeBytes: 1234,
            error: null,
            downloadedAt: NOW
        });
    });

    it('accepts an unknown size', () => {
        const db = makeDb();
        const episode = db.ensureEpisode(db.upsertAnime(NARUTO).id, '1');
        db.markDone(episode.id, '/a/1.mp4', null);
        expect(db.getEpisode(episode.id)?.sizeBytes).toBeNull();
    });

    it('records an error with its code and text', () => {
        const db = makeDb();
        const episode = db.ensureEpisode(db.upsertAnime(NARUTO).id, '1');
        db.markFailed(episode.id, 'error', { code: 'NO_SOURCES', raw: 'No sources found for sub!' });
        expect(db.getEpisode(episode.id)).toMatchObject({ status: 'error', error: { code: 'NO_SOURCES', raw: 'No sources found for sub!' } });
    });

    it('records a cancellation without an error', () => {
        const db = makeDb();
        const episode = db.ensureEpisode(db.upsertAnime(NARUTO).id, '1');
        db.markFailed(episode.id, 'cancelled', null);
        expect(db.getEpisode(episode.id)).toMatchObject({ status: 'cancelled', error: null });
    });

    it('reads an unrecognised stored error code and status as UNKNOWN and error', () => {
        const path = join(makeTempDir(), 'anime.db');
        const db = new AnimeDb(path);
        const episode = db.ensureEpisode(db.upsertAnime(NARUTO).id, '1');
        db.close();
        const raw = new DatabaseSync(path);
        raw.prepare('UPDATE episode SET status = ?, error_code = ?, error_raw = ? WHERE id = ?').run('mystery', 'FROM_THE_FUTURE', 'x', episode.id);
        raw.close();

        const reopened = new AnimeDb(path);
        expect(reopened.getEpisode(episode.id)).toMatchObject({ status: 'error', error: { code: 'UNKNOWN', raw: 'x' } });
        reopened.close();
    });
});

describe('AnimeDb.failInterrupted', () => {
    it('fails what was queued or downloading and leaves the rest', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        const queued = db.ensureEpisode(anime.id, '1');
        const downloading = db.ensureEpisode(anime.id, '2');
        const done = db.ensureEpisode(anime.id, '3');
        const cancelled = db.ensureEpisode(anime.id, '4');
        db.markDownloading(downloading.id);
        db.markDone(done.id, '/a/3.mp4', 1);
        db.markFailed(cancelled.id, 'cancelled', null);

        db.failInterrupted();

        expect(db.getEpisode(queued.id)).toMatchObject({ status: 'error', error: { code: 'UNKNOWN', raw: INTERRUPTED_MESSAGE } });
        expect(db.getEpisode(downloading.id)).toMatchObject({ status: 'error', error: { code: 'UNKNOWN', raw: INTERRUPTED_MESSAGE } });
        expect(db.getEpisode(done.id)?.status).toBe('done');
        expect(db.getEpisode(cancelled.id)?.status).toBe('cancelled');
    });
});

describe('AnimeDb.saveProgress', () => {
    it('stores the position, the duration and whether it was watched', () => {
        const db = makeDb();
        const episode = db.ensureEpisode(db.upsertAnime(NARUTO).id, '1');
        db.saveProgress({ episodeId: episode.id, positionSeconds: 61.5, durationSeconds: 1440, watched: false });
        expect(db.getEpisode(episode.id)).toMatchObject({ positionSeconds: 61.5, durationSeconds: 1440, watched: false });

        db.saveProgress({ episodeId: episode.id, positionSeconds: 1430, durationSeconds: 1440, watched: true });
        expect(db.getEpisode(episode.id)).toMatchObject({ positionSeconds: 1430, durationSeconds: 1440, watched: true });
    });
});

describe('AnimeDb removal', () => {
    it('removes an episode and gives back its file', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        const episode = db.ensureEpisode(anime.id, '1');
        db.markDone(episode.id, '/a/1.mp4', 1);
        expect(db.removeEpisode(episode.id)).toBe('/a/1.mp4');
        expect(db.getEpisode(episode.id)).toBeNull();
        expect(db.getAnime(anime.id)).not.toBeNull();
    });

    it('gives back null for an episode without a file or that does not exist', () => {
        const db = makeDb();
        const episode = db.ensureEpisode(db.upsertAnime(NARUTO).id, '1');
        expect(db.removeEpisode(episode.id)).toBeNull();
        expect(db.removeEpisode(99)).toBeNull();
    });

    it('removes an anime with its episodes and gives back the files of the downloaded ones', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        const first = db.ensureEpisode(anime.id, '1');
        const second = db.ensureEpisode(anime.id, '2');
        db.ensureEpisode(anime.id, '3');
        db.markDone(first.id, '/a/1.mp4', 1);
        db.markDone(second.id, '/a/2.mp4', 1);

        expect(db.removeAnime(anime.id)).toEqual(['/a/1.mp4', '/a/2.mp4']);
        expect(db.getAnime(anime.id)).toBeNull();
        expect(db.getEpisode(first.id)).toBeNull();
        expect(db.list()).toEqual([]);
    });

    it('does not touch other animes', () => {
        const db = makeDb();
        const other = db.upsertAnime({ ...NARUTO, title: 'Bleach' });
        db.ensureEpisode(other.id, '1');
        const anime = db.upsertAnime(NARUTO);
        db.removeAnime(anime.id);
        expect(db.getLibraryAnime(other.id)?.episodes).toHaveLength(1);
    });
});

describe('AnimeDb importing what was found on the disk', () => {
    it('adds an anime, and keeps it as it is when it is already there', () => {
        const db = makeDb();
        const added = db.importAnime({ title: 'Naruto', query: 'naruto', searchIndex: 2, audio: 'sub' });
        expect(added).toEqual({ id: 1, title: 'Naruto', query: 'naruto', searchIndex: 2, audio: 'sub', createdAt: NOW, series: null, season: null, seasonName: null });
        expect(db.importAnime({ title: 'Naruto', query: 'other', searchIndex: 9, audio: 'sub' })).toEqual(added);
        expect(db.list()).toHaveLength(1);
    });

    it('fills in the search data that was not known', () => {
        const db = makeDb();
        db.importAnime({ title: 'Naruto', query: 'Naruto', searchIndex: 0, audio: 'sub' });
        expect(db.importAnime({ title: 'Naruto', query: 'naruto', searchIndex: 4, audio: 'sub' })).toMatchObject({ query: 'naruto', searchIndex: 4 });
        expect(db.importAnime({ title: 'Naruto', query: 'again', searchIndex: 7, audio: 'sub' })).toMatchObject({ query: 'naruto', searchIndex: 4 });
    });

    it('does not mix the audios of a title', () => {
        const db = makeDb();
        db.importAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' });
        db.importAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'dub' });
        expect(db.list()).toHaveLength(2);
    });

    it('finds an episode by its number', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        const episode = db.ensureEpisode(anime.id, '1.5');
        expect(db.getEpisodeByNumber(anime.id, '1.5')).toEqual(episode);
        expect(db.getEpisodeByNumber(anime.id, '2')).toBeNull();
        expect(db.getEpisodeByNumber(99, '1.5')).toBeNull();
    });

    it('points an episode to another file, keeping the rest', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        const episode = db.ensureEpisode(anime.id, '1');
        db.markDone(episode.id, '/old/a.mp4', 10);
        db.saveProgress({ episodeId: episode.id, positionSeconds: 5, durationSeconds: 100, watched: true });
        db.relinkEpisode(episode.id, '/new/a.mp4', 20);
        expect(db.getEpisode(episode.id)).toMatchObject({ status: 'done', filePath: '/new/a.mp4', sizeBytes: 20, positionSeconds: 5, watched: true, downloadedAt: NOW });
    });

    it('points several episodes to new files all together', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        const first = db.ensureEpisode(anime.id, '1');
        const second = db.ensureEpisode(anime.id, '2');
        db.markDone(first.id, '/old/1.mp4', 10);
        db.markDone(second.id, '/old/2.mp4', 20);
        db.saveProgress({ episodeId: second.id, positionSeconds: 7, durationSeconds: 100, watched: true });

        db.relinkEpisodes([
            { episodeId: first.id, filePath: '/new/1.mp4', sizeBytes: 11 },
            { episodeId: second.id, filePath: '/new/2.mp4', sizeBytes: null }
        ]);

        expect(db.getEpisode(first.id)).toMatchObject({ status: 'done', filePath: '/new/1.mp4', sizeBytes: 11 });
        expect(db.getEpisode(second.id)).toMatchObject({ status: 'done', filePath: '/new/2.mp4', sizeBytes: null, positionSeconds: 7, watched: true });
    });

    it('changes none of the episodes when one of them cannot be pointed to a new file', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        const first = db.ensureEpisode(anime.id, '1');
        db.markDone(first.id, '/old/1.mp4', 10);

        expect(() => {
            db.relinkEpisodes([
                { episodeId: first.id, filePath: '/new/1.mp4', sizeBytes: 11 },
                { episodeId: 2, filePath: undefined as unknown as string, sizeBytes: 1 }
            ]);
        }).toThrow();

        expect(db.getEpisode(first.id)).toMatchObject({ filePath: '/old/1.mp4', sizeBytes: 10 });
        db.relinkEpisodes([{ episodeId: first.id, filePath: '/again/1.mp4', sizeBytes: 12 }]);
        expect(db.getEpisode(first.id)).toMatchObject({ filePath: '/again/1.mp4', sizeBytes: 12 });
    });

    it('does nothing when there is no episode to point', () => {
        const db = makeDb();
        expect(() => {
            db.relinkEpisodes([]);
        }).not.toThrow();
    });

    it('never says on its own that a file is missing', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        db.markDone(db.ensureEpisode(anime.id, '1').id, '/a.mp4', 1);
        expect(db.getEpisode(1)?.fileMissing).toBe(false);
    });
});

describe('AnimeDb series and seasons', () => {
    it('adds the columns by a migration that keeps what was there', () => {
        const dir = makeTempDir();
        const path = join(dir, 'anime.db');
        const old = new DatabaseSync(path);
        old.exec(
            `CREATE TABLE anime (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, query TEXT NOT NULL, search_index INTEGER NOT NULL, audio TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (title, audio));
             CREATE TABLE episode (id INTEGER PRIMARY KEY AUTOINCREMENT, anime_id INTEGER NOT NULL REFERENCES anime (id) ON DELETE CASCADE, number TEXT NOT NULL, status TEXT NOT NULL, file_path TEXT, size_bytes INTEGER, error_code TEXT, error_raw TEXT, position_seconds REAL NOT NULL DEFAULT 0, duration_seconds REAL NOT NULL DEFAULT 0, watched INTEGER NOT NULL DEFAULT 0, downloaded_at INTEGER, UNIQUE (anime_id, number));
             INSERT INTO anime (title, query, search_index, audio, created_at) VALUES ('Naruto', 'naruto', 1, 'sub', 5);
             PRAGMA user_version = 1;`
        );
        old.close();

        const db = new AnimeDb(path, () => {
            return NOW;
        });
        expect(db.schemaVersion).toBe(6);
        expect(db.list()).toEqual([{ id: 1, title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub', createdAt: 5, series: null, season: null, seasonName: null, episodes: [] }]);
        db.close();
    });

    it('starts with no series', () => {
        expect(makeDb().upsertAnime(NARUTO)).toMatchObject({ series: null, season: null });
    });

    it('joins an anime to a series with a season, and takes it out again', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        expect(db.setSeries(anime.id, 'Naruto Series', 2)).toBe(true);
        expect(db.getAnime(anime.id)).toMatchObject({ series: 'Naruto Series', season: 2 });
        expect(db.setSeries(anime.id, null, null)).toBe(true);
        expect(db.getAnime(anime.id)).toMatchObject({ series: null, season: null });
    });

    it('keeps the series when the anime is saved again', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        db.setSeries(anime.id, 'Naruto Series', 2);
        db.upsertAnime({ ...NARUTO, query: 'naruto again' });
        expect(db.getAnime(anime.id)).toMatchObject({ query: 'naruto again', series: 'Naruto Series', season: 2 });
    });

    it('refuses a season that another anime of the series and audio has, whatever the case or the accents of the name', () => {
        const db = makeDb();
        const first = db.upsertAnime(NARUTO);
        const second = db.upsertAnime({ ...NARUTO, title: 'Naruto 2', searchIndex: 2 });
        db.setSeries(first.id, 'Pokémon', 1);
        expect(db.seasonTaken('pokemon', 1, 'sub', second.id)).toBe(true);
        expect(db.setSeries(second.id, 'POKEMON', 1)).toBe(false);
        expect(db.getAnime(second.id)).toMatchObject({ series: null, season: null });
        expect(db.setSeries(second.id, 'POKEMON', 2)).toBe(true);
    });

    it('allows the same season in another series, another audio, or the anime itself', () => {
        const db = makeDb();
        const sub = db.upsertAnime(NARUTO);
        const dub = db.upsertAnime({ ...NARUTO, audio: 'dub' });
        const other = db.upsertAnime({ ...NARUTO, title: 'Other', searchIndex: 3 });
        db.setSeries(sub.id, 'Series', 1);
        expect(db.setSeries(dub.id, 'Series', 1)).toBe(true);
        expect(db.setSeries(other.id, 'Another series', 1)).toBe(true);
        expect(db.setSeries(sub.id, 'Series', 1)).toBe(true);
        expect(db.seasonTaken('Series', 1, 'sub', sub.id)).toBe(false);
    });

    it('does nothing for an anime that is not there', () => {
        expect(makeDb().setSeries(99, 'Series', 1)).toBe(false);
    });

    it('finds an anime by its title and audio', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        expect(db.findAnime('Naruto', 'sub')).toEqual(anime);
        expect(db.findAnime('Naruto', 'dub')).toBeNull();
        expect(db.findAnime('Bleach', 'sub')).toBeNull();
    });

    it('does not replace a series when an anime is imported', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        db.setSeries(anime.id, 'Series', 3);
        expect(db.importAnime(NARUTO)).toMatchObject({ series: 'Series', season: 3 });
    });

    it('keeps one spelling for a series: the same name in another case, with other accents or extra spaces joins the one that is there', () => {
        const db = makeDb();
        const first = db.upsertAnime(NARUTO);
        const second = db.upsertAnime({ ...NARUTO, title: 'Naruto 2', searchIndex: 2 });
        const third = db.upsertAnime({ ...NARUTO, title: 'Naruto 3', searchIndex: 3 });
        db.setSeries(first.id, 'Pokémon Journeys', 1);
        db.setSeries(second.id, 'POKEMON   journeys', 2);
        db.setSeries(third.id, ' pokemon journeys ', 3);
        expect(
            db.list().map((anime) => {
                return [anime.series, anime.season];
            })
        ).toEqual([
            ['Pokémon Journeys', 1],
            ['Pokémon Journeys', 2],
            ['Pokémon Journeys', 3]
        ]);
    });

    it('lets the only anime of a series spell it differently', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        db.setSeries(anime.id, 'frieren', 1);
        db.setSeries(anime.id, 'Frieren', 1);
        expect(db.getAnime(anime.id)?.series).toBe('Frieren');
    });

    it('gives the spelling of the library for a name, or the name itself when it is new', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        db.setSeries(anime.id, 'Bleach', 1);
        expect(db.canonicalSeries('BLEACH')).toBe('Bleach');
        expect(db.canonicalSeries('Bleach', anime.id)).toBe('Bleach');
        expect(db.canonicalSeries('Frieren')).toBe('Frieren');
        expect(db.canonicalSeries('bleach', anime.id)).toBe('bleach');
    });

    it('keeps the name an anime is shown with in its series, and drops it with the series', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        expect(db.setSeries(anime.id, 'Bleach', 2, 'Thousand-Year Blood War')).toBe(true);
        expect(db.getAnime(anime.id)).toMatchObject({ series: 'Bleach', season: 2, seasonName: 'Thousand-Year Blood War' });
        expect(db.setSeries(anime.id, 'Bleach', 2)).toBe(true);
        expect(db.getAnime(anime.id)?.seasonName).toBeNull();
        db.setSeries(anime.id, 'Bleach', 3, 'Arc');
        db.setSeries(anime.id, null, null, 'Ignored');
        expect(db.getAnime(anime.id)).toMatchObject({ series: null, season: null, seasonName: null });
    });

    it('does not use the name to tell the anime of a series apart: only the order counts', () => {
        const db = makeDb();
        const first = db.upsertAnime(NARUTO);
        const second = db.upsertAnime({ ...NARUTO, title: 'Naruto 2', searchIndex: 2 });
        db.setSeries(first.id, 'Naruto', 1, 'Same name');
        expect(db.setSeries(second.id, 'Naruto', 2, 'Same name')).toBe(true);
        expect(db.setSeries(second.id, 'Naruto', 1, 'Other name')).toBe(false);
    });

    it('adds the column of the name by a migration that keeps what was there', () => {
        const dir = makeTempDir();
        const path = join(dir, 'anime.db');
        const first = new AnimeDb(path, () => {
            return NOW;
        });
        const anime = first.upsertAnime(NARUTO);
        first.setSeries(anime.id, 'Series', 2);
        first.close();
        const raw = new DatabaseSync(path);
        raw.exec('ALTER TABLE anime DROP COLUMN season_name; DROP TABLE anime_history; DROP TABLE anime_cover; DROP TABLE anime_schedule_cache; DROP TABLE anime_availability; PRAGMA user_version = 2;');
        raw.close();

        const db = new AnimeDb(path);
        expect(db.schemaVersion).toBe(6);
        expect(db.getAnime(anime.id)).toMatchObject({ series: 'Series', season: 2, seasonName: null });
        db.close();
    });
});

describe('AnimeDb history', () => {
    const NARUTO_OPENED: AnimeHistoryRequest = { title: 'Naruto', query: 'naruto', index: 1, audio: 'sub', episode: null };
    const BLEACH_WATCHED: AnimeHistoryRequest = { title: 'Bleach', query: 'bleach', index: 4, audio: 'dub', episode: '12' };

    function makeClockedDb(): AnimeDb {
        let tick = NOW;
        return new AnimeDb(':memory:', () => {
            tick += 1000;
            return tick;
        });
    }

    it('is empty at first', () => {
        expect(makeDb().listHistory()).toEqual([]);
    });

    it('keeps an anime that was only opened, with no episode', () => {
        const db = makeClockedDb();
        db.recordHistory(NARUTO_OPENED);
        expect(db.listHistory()).toEqual([{ id: 1, title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub', episode: null, openedAt: NOW + 1000 }]);
    });

    it('keeps an anime that was watched, with its episode, and does not need it to be in the library', () => {
        const db = makeClockedDb();
        db.recordHistory(BLEACH_WATCHED);
        expect(db.listHistory()).toEqual([{ id: 1, title: 'Bleach', query: 'bleach', searchIndex: 4, audio: 'dub', episode: '12', openedAt: NOW + 1000 }]);
        expect(db.list()).toEqual([]);
    });

    it('lists the most recent first', () => {
        const db = makeClockedDb();
        db.recordHistory(NARUTO_OPENED);
        db.recordHistory(BLEACH_WATCHED);
        expect(
            db.listHistory().map((entry) => {
                return entry.title;
            })
        ).toEqual(['Bleach', 'Naruto']);
    });

    it('moves an anime that is opened again to the top, as one entry, refreshing its search data', () => {
        const db = makeClockedDb();
        db.recordHistory(NARUTO_OPENED);
        db.recordHistory(BLEACH_WATCHED);
        db.recordHistory({ ...NARUTO_OPENED, query: 'naruto shippuden', index: 3 });

        expect(db.listHistory()).toEqual([
            { id: 1, title: 'Naruto', query: 'naruto shippuden', searchIndex: 3, audio: 'sub', episode: null, openedAt: NOW + 3000 },
            { id: 2, title: 'Bleach', query: 'bleach', searchIndex: 4, audio: 'dub', episode: '12', openedAt: NOW + 2000 }
        ]);
    });

    it('keeps the last episode watched when the anime is opened again without one, and replaces it with a new one', () => {
        const db = makeClockedDb();
        db.recordHistory(BLEACH_WATCHED);
        db.recordHistory({ ...BLEACH_WATCHED, episode: null });
        expect(db.listHistory()[0]?.episode).toBe('12');
        db.recordHistory({ ...BLEACH_WATCHED, episode: '13' });
        expect(db.listHistory()[0]?.episode).toBe('13');
    });

    it('tells the same title apart by audio', () => {
        const db = makeClockedDb();
        db.recordHistory(NARUTO_OPENED);
        db.recordHistory({ ...NARUTO_OPENED, audio: 'dub' });
        expect(
            db.listHistory().map((entry) => {
                return `${entry.title}:${entry.audio}`;
            })
        ).toEqual(['Naruto:dub', 'Naruto:sub']);
    });

    it('keeps the 50 most recent anime and drops the oldest', () => {
        const db = makeClockedDb();
        expect(MAX_HISTORY_ENTRIES).toBe(50);
        for (let number = 1; number <= MAX_HISTORY_ENTRIES + 3; number += 1) {
            db.recordHistory({ ...NARUTO_OPENED, title: `Anime ${number}` });
        }
        const titles = db.listHistory().map((entry) => {
            return entry.title;
        });
        expect(titles).toHaveLength(MAX_HISTORY_ENTRIES);
        expect(titles[0]).toBe('Anime 53');
        expect(titles[MAX_HISTORY_ENTRIES - 1]).toBe('Anime 4');
    });

    it('removes one entry and leaves the others', () => {
        const db = makeClockedDb();
        db.recordHistory(NARUTO_OPENED);
        db.recordHistory(BLEACH_WATCHED);
        db.removeHistory(1);
        expect(
            db.listHistory().map((entry) => {
                return entry.title;
            })
        ).toEqual(['Bleach']);
        db.removeHistory(99);
        expect(db.listHistory()).toHaveLength(1);
    });

    it('clears every entry', () => {
        const db = makeClockedDb();
        db.recordHistory(NARUTO_OPENED);
        db.recordHistory(BLEACH_WATCHED);
        db.clearHistory();
        expect(db.listHistory()).toEqual([]);
    });

    it('is not touched by removing the anime from the library', () => {
        const db = makeClockedDb();
        const anime = db.upsertAnime(NARUTO);
        db.recordHistory(NARUTO_OPENED);
        db.removeAnime(anime.id);
        expect(db.listHistory()).toHaveLength(1);
    });

    it('is added to a library of the previous version without touching what it holds', () => {
        const path = join(makeTempDir(), 'anime.db');
        const old = new AnimeDb(path, () => {
            return NOW;
        });
        const anime = old.upsertAnime(NARUTO);
        old.ensureEpisode(anime.id, '1');
        old.close();
        const raw = new DatabaseSync(path);
        raw.exec('DROP TABLE anime_history; DROP TABLE anime_cover; DROP TABLE anime_schedule_cache; DROP TABLE anime_availability; PRAGMA user_version = 3;');
        raw.close();

        const db = new AnimeDb(path, () => {
            return NOW;
        });
        expect(db.schemaVersion).toBe(6);
        expect(db.listHistory()).toEqual([]);
        expect(db.list()).toHaveLength(1);
        expect(db.list()[0]?.episodes).toHaveLength(1);
        db.close();
    });
});

// The schema of the last release (0.18.0), as it was published. It must never change: the databases of the people who use that
// release are in this state, and the tests below open them with the current code.
const RELEASED_MIGRATIONS: readonly string[] = [
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
    // What is kept so the network is asked for less: the covers and the schedule of a stretch of time.
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
    );`
];


// A database as the last release left it (or as an older one did, up to `version` migrations).
function makeReleasedDatabase(path: string, version: number = RELEASED_MIGRATIONS.length): void {
    const raw = new DatabaseSync(path);
    RELEASED_MIGRATIONS.slice(0, version).forEach((migration) => {
        raw.exec(migration);
    });
    raw.exec(`PRAGMA user_version = ${version}`);
    raw.close();
}

function tablesOf(path: string): string[] {
    const raw = new DatabaseSync(path, { readOnly: true });
    const names = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    raw.close();
    return names.map((row) => {
        return String(row.name);
    });
}

function schemaOf(path: string): Array<{ name: string; sql: string }> {
    const raw = new DatabaseSync(path, { readOnly: true });
    const rows = raw.prepare("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
    raw.close();
    return rows.map((row) => {
        return { name: String(row.name), sql: String(row.sql) };
    });
}

function versionOf(path: string): number {
    const raw = new DatabaseSync(path, { readOnly: true });
    const version = Number((raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
    raw.close();
    return version;
}

// Every row of the tables the last release had, in a fixed order, to compare before and after an upgrade.
function releasedRowsOf(path: string): Record<string, unknown[]> {
    const raw = new DatabaseSync(path, { readOnly: true });
    const rows = {
        anime: raw.prepare('SELECT * FROM anime ORDER BY id').all().map((row) => {
            return { ...row };
        }),
        episode: raw.prepare('SELECT * FROM episode ORDER BY id').all().map((row) => {
            return { ...row };
        }),
        anime_history: raw.prepare('SELECT * FROM anime_history ORDER BY id').all().map((row) => {
            return { ...row };
        })
    };
    raw.close();
    return rows;
}

describe('AnimeDb upgrade of the last release', () => {
    function fillReleasedDatabase(path: string): void {
        const raw = new DatabaseSync(path);
        raw.exec(`
            INSERT INTO anime (id, title, query, search_index, audio, created_at, series, season, season_name) VALUES
                (1, 'Naruto', 'naruto', 1, 'sub', 1700000000000, NULL, NULL, NULL),
                (2, 'Frieren: Beyond Journey''s End', 'Frieren', 1, 'sub', 1700000001000, 'Frieren', 1, NULL),
                (3, 'Frieren: Beyond Journey''s End Season 2', 'Frieren', 2, 'dub', 1700000002000, 'Frieren', 2, 'The Second Season'),
                (4, 'Bleach', 'bleach', 0, 'sub', 1700000003000, NULL, NULL, NULL);
            INSERT INTO episode (id, anime_id, number, status, file_path, size_bytes, error_code, error_raw, position_seconds, duration_seconds, watched, downloaded_at) VALUES
                (1, 1, '1', 'done', '/lib/Naruto/Episode 1/Naruto Episode 1.mp4', 123456, NULL, NULL, 600.5, 1400, 1, 1700000100000),
                (2, 1, '2', 'queued', NULL, NULL, NULL, NULL, 0, 0, 0, NULL),
                (3, 2, '1', 'downloading', NULL, NULL, NULL, NULL, 0, 0, 0, NULL),
                (4, 2, '2', 'error', NULL, NULL, 'NETWORK', 'curl: (6) Could not resolve host', 0, 0, 0, NULL),
                (5, 3, '12.5', 'cancelled', NULL, NULL, NULL, NULL, 12, 1500, 0, NULL),
                (6, 4, '366', 'done', 'D:\\Anime\\Bleach\\Episode 366\\Bleach Episode 366.mp4', 99, NULL, NULL, 1400, 1400, 1, 1700000200000);
            INSERT INTO anime_history (id, title, query, search_index, audio, episode, opened_at) VALUES
                (1, 'Naruto', 'naruto', 1, 'sub', NULL, 1700000300000),
                (2, 'Frieren: Beyond Journey''s End', 'Frieren', 1, 'sub', '3', 1700000400000);
        `);
        raw.close();
    }

    it('is at version 5 as published, and the current code goes to version 6 with the table it adds', () => {
        expect(RELEASED_MIGRATIONS).toHaveLength(5);
        const path = join(makeTempDir(), 'anime.db');
        makeReleasedDatabase(path);
        expect(versionOf(path)).toBe(5);
        expect(tablesOf(path)).toEqual(['anime', 'anime_cover', 'anime_history', 'anime_schedule_cache', 'episode']);

        new AnimeDb(path).close();

        expect(versionOf(path)).toBe(6);
        expect(tablesOf(path)).toEqual(['anime', 'anime_availability', 'anime_cover', 'anime_history', 'anime_schedule_cache', 'episode']);
    });

    it('keeps every row of the last release exactly as it was', () => {
        const path = join(makeTempDir(), 'anime.db');
        makeReleasedDatabase(path);
        fillReleasedDatabase(path);
        const before = releasedRowsOf(path);

        new AnimeDb(path).close();

        expect(releasedRowsOf(path)).toEqual(before);
        expect(before.anime).toHaveLength(4);
        expect(before.episode).toHaveLength(6);
        expect(before.anime_history).toHaveLength(2);
    });

    it('reads the library, the episodes and the history of the last release with the current code', () => {
        const path = join(makeTempDir(), 'anime.db');
        makeReleasedDatabase(path);
        fillReleasedDatabase(path);

        const db = new AnimeDb(path, () => {
            return NOW;
        });

        expect(
            db.list().map((anime) => {
                return [anime.title, anime.audio, anime.series, anime.season, anime.seasonName, anime.episodes.length];
            })
        ).toEqual([
            ['Bleach', 'sub', null, null, null, 1],
            ['Frieren: Beyond Journey\'s End', 'sub', 'Frieren', 1, null, 2],
            ['Frieren: Beyond Journey\'s End Season 2', 'dub', 'Frieren', 2, 'The Second Season', 1],
            ['Naruto', 'sub', null, null, null, 2]
        ]);
        expect(db.getEpisode(1)).toMatchObject({ status: 'done', filePath: '/lib/Naruto/Episode 1/Naruto Episode 1.mp4', sizeBytes: 123456, positionSeconds: 600.5, durationSeconds: 1400, watched: true });
        expect(db.getEpisode(4)).toMatchObject({ status: 'error', error: { code: 'NETWORK', raw: 'curl: (6) Could not resolve host' } });
        expect(db.getEpisode(5)).toMatchObject({ number: '12.5', status: 'cancelled' });
        expect(db.listHistory().map((entry) => {
            return [entry.title, entry.episode];
        })).toEqual([
            ['Frieren: Beyond Journey\'s End', '3'],
            ['Naruto', null]
        ]);
        db.close();
    });

    it('fails what the last release left queued or downloading, as the app does at start, and keeps the rest', () => {
        const path = join(makeTempDir(), 'anime.db');
        makeReleasedDatabase(path);
        fillReleasedDatabase(path);
        const db = new AnimeDb(path);

        db.failInterrupted();

        expect(
            [1, 2, 3, 4, 5, 6].map((id) => {
                return db.getEpisode(id)?.status;
            })
        ).toEqual(['done', 'error', 'error', 'error', 'cancelled', 'done']);
        db.close();
    });

    it('lets the new features write to a database that was upgraded, next to what was already there', () => {
        const path = join(makeTempDir(), 'anime.db');
        makeReleasedDatabase(path);
        fillReleasedDatabase(path);
        const db = new AnimeDb(path, () => {
            return NOW;
        });

        db.saveCover('naruto', 'https://s4.anilist.co/naruto.jpg');
        db.saveScheduleCache(1_700_000_000, 1_700_086_400, [], NOW - 1);
        db.saveAvailability({ anilistId: 7, state: 'unavailable' }, 'sub');
        db.markPaused(2);

        expect(db.findAvailability(7, 'sub', NOW)).toEqual({ anilistId: 7, state: 'unavailable' });
        expect(db.getCover('naruto')).toEqual({ url: 'https://s4.anilist.co/naruto.jpg', checkedAt: NOW });
        expect(db.findScheduleCache(1_700_000_000, 1_700_086_400, NOW - 1)).toEqual([]);
        expect(db.getEpisode(2)?.status).toBe('paused');
        expect(db.list()).toHaveLength(4);
        db.close();
    });

    it('does not migrate again when the upgraded database is opened once more, and keeps what the new features saved', () => {
        const path = join(makeTempDir(), 'anime.db');
        makeReleasedDatabase(path);
        fillReleasedDatabase(path);
        const first = new AnimeDb(path, () => {
            return NOW;
        });
        first.saveCover('naruto', null);
        first.close();
        const schema = schemaOf(path);

        const second = new AnimeDb(path, () => {
            return NOW;
        });

        expect(second.schemaVersion).toBe(6);
        expect(second.getCover('naruto')).toEqual({ url: null, checkedAt: NOW });
        second.close();
        expect(schemaOf(path)).toEqual(schema);
    });

    it.each([1, 2, 3, 4, 5])('upgrades a database of version %i to the same schema a new database has', (version) => {
        const directory = makeTempDir();
        const upgraded = join(directory, 'upgraded.db');
        const fresh = join(directory, 'fresh.db');
        makeReleasedDatabase(upgraded, version);
        new AnimeDb(fresh).close();

        new AnimeDb(upgraded).close();

        expect(versionOf(upgraded)).toBe(6);
        expect(schemaOf(upgraded)).toEqual(schemaOf(fresh));
    });

    it('a migration that fails is undone, and the database stays at the version of the release', () => {
        const path = join(makeTempDir(), 'anime.db');
        makeReleasedDatabase(path);
        fillReleasedDatabase(path);
        const raw = new DatabaseSync(path);
        // Something in the way of the table of the migration.
        raw.exec('CREATE TABLE anime_availability (in_the_way INTEGER)');
        raw.close();

        expect(() => {
            return new AnimeDb(path);
        }).toThrow(/anime_availability/);

        expect(versionOf(path)).toBe(5);
        expect(tablesOf(path)).toEqual(['anime', 'anime_availability', 'anime_cover', 'anime_history', 'anime_schedule_cache', 'episode']);
        expect(releasedRowsOf(path).episode).toHaveLength(6);
    });

    it('opens a database that a newer version of the app made, as it is', () => {
        const path = join(makeTempDir(), 'anime.db');
        makeReleasedDatabase(path);
        fillReleasedDatabase(path);
        const raw = new DatabaseSync(path);
        raw.exec('CREATE TABLE from_the_future (id INTEGER); PRAGMA user_version = 9;');
        raw.close();

        const db = new AnimeDb(path);

        expect(db.schemaVersion).toBe(9);
        expect(db.list()).toHaveLength(4);
        db.close();
        expect(versionOf(path)).toBe(9);
        expect(tablesOf(path)).toContain('from_the_future');
    });
});

describe('AnimeDb covers', () => {
    it('has none for a title that was never saved', () => {
        expect(makeDb().getCover('naruto')).toBeNull();
    });

    it('keeps the address of a cover with the moment it was checked', () => {
        const db = makeDb();
        db.saveCover('naruto', 'https://s4.anilist.co/naruto.jpg');
        expect(db.getCover('naruto')).toEqual({ url: 'https://s4.anilist.co/naruto.jpg', checkedAt: NOW });
    });

    it('keeps that a title has no cover, which is not the same as not having checked it', () => {
        const db = makeDb();
        db.saveCover('unknown anime', null);
        expect(db.getCover('unknown anime')).toEqual({ url: null, checkedAt: NOW });
    });

    it('replaces the address and the moment when the same title is saved again', () => {
        let moment = NOW;
        const db = new AnimeDb(':memory:', () => {
            return moment;
        });
        db.saveCover('naruto', 'https://s4.anilist.co/old.jpg');
        moment = NOW + 5000;
        db.saveCover('naruto', 'https://s4.anilist.co/new.jpg');
        expect(db.getCover('naruto')).toEqual({ url: 'https://s4.anilist.co/new.jpg', checkedAt: NOW + 5000 });
    });

    it('keeps the titles apart', () => {
        const db = makeDb();
        db.saveCover('naruto', 'https://s4.anilist.co/naruto.jpg');
        db.saveCover('bleach', null);
        expect(db.getCover('naruto')?.url).toBe('https://s4.anilist.co/naruto.jpg');
        expect(db.getCover('bleach')?.url).toBeNull();
        expect(db.getCover('one piece')).toBeNull();
    });

    it('survives the library being removed: covers are not tied to an anime', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        db.saveCover('naruto', 'https://s4.anilist.co/naruto.jpg');
        db.removeAnime(anime.id);
        expect(db.getCover('naruto')?.url).toBe('https://s4.anilist.co/naruto.jpg');
    });
});

describe('AnimeDb availability', () => {
    const HOUR = 60 * 60 * 1000;
    const FOUND: AnimeAvailability = { anilistId: 7, state: 'available', query: 'Dandadan', index: 3, title: 'Dandadan (28 episodes)' };

    function makeClockedDb(clock: { now: number }): AnimeDb {
        return new AnimeDb(':memory:', () => {
            return clock.now;
        });
    }

    it('has nothing for an anime that was never checked', () => {
        expect(makeDb().findAvailability(7, 'sub', 0)).toBeNull();
    });

    it('gives back an anime that was found with the name that found it, the number of the result and its title', () => {
        const db = makeDb();
        db.saveAvailability(FOUND, 'sub');
        expect(db.findAvailability(7, 'sub', 0)).toEqual(FOUND);
    });

    it('gives back an anime that was not found as unavailable, with nothing else', () => {
        const db = makeDb();
        db.saveAvailability({ anilistId: 7, state: 'unavailable' }, 'sub');
        expect(db.findAvailability(7, 'sub', 0)).toEqual({ anilistId: 7, state: 'unavailable' });
    });

    it('keeps what is known for each audio apart', () => {
        const db = makeDb();
        db.saveAvailability(FOUND, 'sub');
        db.saveAvailability({ anilistId: 7, state: 'unavailable' }, 'dub');
        expect(db.findAvailability(7, 'sub', 0)).toEqual(FOUND);
        expect(db.findAvailability(7, 'dub', 0)).toEqual({ anilistId: 7, state: 'unavailable' });
    });

    it('keeps what is known for each anime apart', () => {
        const db = makeDb();
        db.saveAvailability(FOUND, 'sub');
        expect(db.findAvailability(8, 'sub', 0)).toBeNull();
    });

    it('replaces what was kept when an anime is checked again', () => {
        const db = makeDb();
        db.saveAvailability({ anilistId: 7, state: 'unavailable' }, 'sub');
        db.saveAvailability(FOUND, 'sub');
        expect(db.findAvailability(7, 'sub', 0)).toEqual(FOUND);
        db.saveAvailability({ anilistId: 7, state: 'unavailable' }, 'sub');
        expect(db.findAvailability(7, 'sub', 0)).toEqual({ anilistId: 7, state: 'unavailable' });
    });

    it('does not answer from a check made before the moment given, and does from one made exactly at it', () => {
        const clock = { now: NOW - HOUR };
        const db = makeClockedDb(clock);
        db.saveAvailability(FOUND, 'sub');
        expect(db.findAvailability(7, 'sub', NOW - HOUR + 1)).toBeNull();
        expect(db.findAvailability(7, 'sub', NOW - HOUR)).toEqual(FOUND);
    });

    it('forgets the checks made before the moment given and keeps the others', () => {
        const clock = { now: NOW - 2 * HOUR };
        const db = makeClockedDb(clock);
        db.saveAvailability(FOUND, 'sub');
        clock.now = NOW;
        db.saveAvailability({ anilistId: 8, state: 'unavailable' }, 'sub');

        db.forgetAvailabilityBefore(NOW - HOUR);

        expect(db.findAvailability(7, 'sub', 0)).toBeNull();
        expect(db.findAvailability(8, 'sub', 0)).toEqual({ anilistId: 8, state: 'unavailable' });
    });

    it('treats a row that says available but lacks what found it as unavailable', () => {
        const path = join(makeTempDir(), 'anime.db');
        new AnimeDb(path).close();
        const raw = new DatabaseSync(path);
        raw.prepare('INSERT INTO anime_availability (anilist_id, audio, available, query, result_index, result_title, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(7, 'sub', 1, null, null, null, NOW);
        raw.close();
        const db = new AnimeDb(path);

        expect(db.findAvailability(7, 'sub', 0)).toEqual({ anilistId: 7, state: 'unavailable' });
        db.close();
    });

    it('stays when the anime of the library are removed: it is about the schedule, not the library', () => {
        const db = makeDb();
        db.saveAvailability(FOUND, 'sub');
        db.removeAnime(db.upsertAnime(NARUTO).id);
        expect(db.findAvailability(7, 'sub', 0)).toEqual(FOUND);
    });
});

describe('AnimeDb schedule cache', () => {
    const FROM = 1_700_000_000;
    const TO = FROM + 86_400;
    const SINCE = NOW - 24 * 60 * 60 * 1000;

    function entry(anilistId: number, airingAt: number, overrides: Partial<AnimeScheduleEntry> = {}): AnimeScheduleEntry {
        return { anilistId, title: `Anime ${anilistId}`, english: `Anime ${anilistId}`, romaji: `Other ${anilistId}`, names: [`Anime ${anilistId}`, `Other ${anilistId}`], episode: 3, airingAt, coverUrl: `https://s4.anilist.co/${anilistId}.jpg`, ...overrides };
    }

    function makeClockedDb(clock: { now: number }): AnimeDb {
        return new AnimeDb(':memory:', () => {
            return clock.now;
        });
    }

    it('has nothing for a stretch that was never listed', () => {
        expect(makeDb().findScheduleCache(FROM, TO, SINCE)).toBeNull();
    });

    it('gives back the episodes that were saved for the stretch, as they were', () => {
        const db = makeDb();
        const entries = [entry(1, FROM + 100), entry(2, FROM + 200, { coverUrl: null, episode: 12 })];
        db.saveScheduleCache(FROM, TO, entries, SINCE);
        expect(db.findScheduleCache(FROM, TO, SINCE)).toEqual(entries);
    });

    it('gives an empty day back as empty, not as missing', () => {
        const db = makeDb();
        db.saveScheduleCache(FROM, TO, [], SINCE);
        expect(db.findScheduleCache(FROM, TO, SINCE)).toEqual([]);
    });

    it('answers a shorter stretch from one that covers it, with only the episodes inside it', () => {
        const db = makeDb();
        const week = FROM + 7 * 86_400;
        db.saveScheduleCache(FROM, week, [entry(1, FROM), entry(2, FROM + 86_399), entry(3, FROM + 86_400), entry(4, week - 1)], SINCE);
        expect(
            db.findScheduleCache(FROM, TO, SINCE)?.map((found) => {
                return found.anilistId;
            })
        ).toEqual([1, 2]);
    });

    it('does not count an episode that airs at the end of the stretch (the end is not part of it)', () => {
        const db = makeDb();
        db.saveScheduleCache(FROM, TO + 1000, [entry(1, TO), entry(2, TO - 1)], SINCE);
        expect(
            db.findScheduleCache(FROM, TO, SINCE)?.map((found) => {
                return found.anilistId;
            })
        ).toEqual([2]);
    });

    it('does not answer a longer stretch, or one that starts before or ends after what was listed', () => {
        const db = makeDb();
        db.saveScheduleCache(FROM, TO, [entry(1, FROM + 1)], SINCE);
        expect(db.findScheduleCache(FROM - 1, TO, SINCE)).toBeNull();
        expect(db.findScheduleCache(FROM, TO + 1, SINCE)).toBeNull();
        expect(db.findScheduleCache(FROM + 3600, TO + 3600, SINCE)).toBeNull();
    });

    it('does not answer from a listing that was asked before the moment given', () => {
        const clock = { now: NOW - 25 * 60 * 60 * 1000 };
        const db = makeClockedDb(clock);
        db.saveScheduleCache(FROM, TO, [entry(1, FROM + 1)], 0);
        clock.now = NOW;
        expect(db.findScheduleCache(FROM, TO, SINCE)).toBeNull();
        expect(db.findScheduleCache(FROM, TO, NOW - 26 * 60 * 60 * 1000)).toHaveLength(1);
    });

    it('answers from a listing asked exactly at the moment given', () => {
        const db = makeDb();
        db.saveScheduleCache(FROM, TO, [entry(1, FROM + 1)], 0);
        expect(db.findScheduleCache(FROM, TO, NOW)).toHaveLength(1);
        expect(db.findScheduleCache(FROM, TO, NOW + 1)).toBeNull();
    });

    it('uses the newest of the listings that cover the stretch', () => {
        const clock = { now: NOW - 3600_000 };
        const db = makeClockedDb(clock);
        db.saveScheduleCache(FROM, TO + 86_400, [entry(1, FROM + 10, { title: 'Old' })], 0);
        clock.now = NOW;
        db.saveScheduleCache(FROM, TO, [entry(1, FROM + 10, { title: 'New' })], 0);
        expect(db.findScheduleCache(FROM, TO, SINCE)?.[0]?.title).toBe('New');
    });

    it('replaces what was kept for the same stretch', () => {
        const clock = { now: NOW - 3600_000 };
        const db = makeClockedDb(clock);
        db.saveScheduleCache(FROM, TO, [entry(1, FROM + 10)], 0);
        clock.now = NOW;
        db.saveScheduleCache(FROM, TO, [entry(2, FROM + 20)], 0);
        expect(
            db.findScheduleCache(FROM, TO, NOW)?.map((found) => {
                return found.anilistId;
            })
        ).toEqual([2]);
    });

    it('forgets the listings asked before the moment given when a new one is saved', () => {
        const clock = { now: NOW - 30 * 60 * 60 * 1000 };
        const db = makeClockedDb(clock);
        db.saveScheduleCache(FROM, TO, [entry(1, FROM + 1)], 0);
        clock.now = NOW;
        db.saveScheduleCache(FROM + 86_400, TO + 86_400, [entry(2, FROM + 86_401)], SINCE);
        expect(db.findScheduleCache(FROM, TO, 0)).toBeNull();
        expect(db.findScheduleCache(FROM + 86_400, TO + 86_400, 0)).toHaveLength(1);
    });

    it('keeps the listings that are still fresh when it forgets the old ones', () => {
        const db = makeDb();
        db.saveScheduleCache(FROM, TO, [entry(1, FROM + 1)], SINCE);
        db.saveScheduleCache(FROM + 86_400, TO + 86_400, [entry(2, FROM + 86_401)], SINCE);
        expect(db.findScheduleCache(FROM, TO, SINCE)).toHaveLength(1);
        expect(db.findScheduleCache(FROM + 86_400, TO + 86_400, SINCE)).toHaveLength(1);
    });

    it('treats a listing kept by an older version, whose anime lack the two names, as missing', () => {
        const path = join(makeTempDir(), 'anime.db');
        new AnimeDb(path).close();
        const raw = new DatabaseSync(path);
        const { english, romaji, ...old } = entry(1, FROM + 1);
        void english;
        void romaji;
        raw.prepare('INSERT INTO anime_schedule_cache (from_at, to_at, fetched_at, entries) VALUES (?, ?, ?, ?)').run(FROM, TO, NOW, JSON.stringify([old]));
        raw.close();
        const db = new AnimeDb(path);

        expect(db.findScheduleCache(FROM, TO, 0)).toBeNull();
        db.close();
    });

    it('keeps the two names of each anime as they were saved', () => {
        const db = makeDb();
        db.saveScheduleCache(FROM, TO, [entry(1, FROM + 1, { english: null, romaji: 'Romaji only' })], SINCE);
        expect(db.findScheduleCache(FROM, TO, SINCE)).toEqual([entry(1, FROM + 1, { english: null, romaji: 'Romaji only' })]);
    });

    it('treats what it cannot read as missing: a row that is not JSON, and one that is not a list', () => {
        const path = join(makeTempDir(), 'anime.db');
        new AnimeDb(path).close();
        const raw = new DatabaseSync(path);
        raw.prepare('INSERT INTO anime_schedule_cache (from_at, to_at, fetched_at, entries) VALUES (?, ?, ?, ?)').run(FROM, TO, NOW, 'not json');
        raw.prepare('INSERT INTO anime_schedule_cache (from_at, to_at, fetched_at, entries) VALUES (?, ?, ?, ?)').run(FROM + 1, TO, NOW, '{"airingAt":1}');
        raw.close();
        const db = new AnimeDb(path);

        expect(db.findScheduleCache(FROM, TO, 0)).toBeNull();
        expect(db.findScheduleCache(FROM + 1, TO, 0)).toBeNull();
        db.close();
    });

    it('leaves out an item of a row that has no time to tell if it is inside the stretch', () => {
        const path = join(makeTempDir(), 'anime.db');
        new AnimeDb(path).close();
        const raw = new DatabaseSync(path);
        raw.prepare('INSERT INTO anime_schedule_cache (from_at, to_at, fetched_at, entries) VALUES (?, ?, ?, ?)').run(FROM, TO, NOW, JSON.stringify([{ anilistId: 1, english: null, romaji: null }, entry(2, FROM + 5)]));
        raw.close();
        const db = new AnimeDb(path);

        expect(
            db.findScheduleCache(FROM, TO, 0)?.map((found) => {
                return found.anilistId;
            })
        ).toEqual([2]);
        db.close();
    });
});

describe('AnimeDb paused episodes', () => {
    it('keeps an episode as paused, without the error it had', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        const episode = db.ensureEpisode(anime.id, '1');
        db.markFailed(episode.id, 'error', { code: 'NETWORK', raw: 'offline' });

        db.markPaused(episode.id);

        expect(db.getEpisode(episode.id)).toMatchObject({ status: 'paused', error: null });
    });

    it('does not fail a paused episode when the app starts, as it does with the ones that were waiting or downloading', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        const paused = db.ensureEpisode(anime.id, '1');
        const downloading = db.ensureEpisode(anime.id, '2');
        const queued = db.ensureEpisode(anime.id, '3');
        db.markPaused(paused.id);
        db.markDownloading(downloading.id);

        db.failInterrupted();

        expect(db.getEpisode(paused.id)?.status).toBe('paused');
        expect(db.getEpisode(downloading.id)?.status).toBe('error');
        expect(db.getEpisode(queued.id)?.status).toBe('error');
    });

    it('goes back to downloading, and then done, when it is resumed', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        const episode = db.ensureEpisode(anime.id, '1');
        db.markPaused(episode.id);

        db.markDownloading(episode.id);
        expect(db.getEpisode(episode.id)?.status).toBe('downloading');
        db.markDone(episode.id, '/lib/Naruto/Naruto Episode 1.mp4', 10);
        expect(db.getEpisode(episode.id)).toMatchObject({ status: 'done', sizeBytes: 10 });
    });
});

describe('AnimeDb episodes that are in the library but not downloaded', () => {
    it('reads the idle status', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        db.registerEpisodes(anime.id, ['1']);
        expect(db.getLibraryAnime(anime.id)?.episodes).toEqual([
            {
                id: 1,
                animeId: anime.id,
                number: '1',
                status: 'idle',
                filePath: null,
                sizeBytes: null,
                error: null,
                positionSeconds: 0,
                durationSeconds: 0,
                watched: false,
                downloadedAt: null,
                fileMissing: false
            }
        ]);
    });

    it('registers every episode as idle, in order, whatever the order they came in', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        db.registerEpisodes(anime.id, ['10', '2', '1', '11.5']);
        expect(
            db.getLibraryAnime(anime.id)?.episodes.map((episode) => {
                return [episode.number, episode.status];
            })
        ).toEqual([
            ['1', 'idle'],
            ['2', 'idle'],
            ['10', 'idle'],
            ['11.5', 'idle']
        ]);
    });

    it('leaves the episodes it already has as they are, whatever their status, and adds only the new ones', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        const done = db.ensureEpisode(anime.id, '1');
        db.markDone(done.id, '/a/1.mp4', 100);
        const failed = db.ensureEpisode(anime.id, '2');
        db.markFailed(failed.id, 'error', { code: 'NETWORK', raw: 'boom' });
        db.ensureEpisode(anime.id, '3');

        db.registerEpisodes(anime.id, ['1', '2', '3', '4']);

        expect(
            db.getLibraryAnime(anime.id)?.episodes.map((episode) => {
                return [episode.number, episode.status];
            })
        ).toEqual([
            ['1', 'done'],
            ['2', 'error'],
            ['3', 'queued'],
            ['4', 'idle']
        ]);
        expect(db.getEpisodeByNumber(anime.id, '1')).toMatchObject({ id: done.id, filePath: '/a/1.mp4', sizeBytes: 100 });
        expect(db.getEpisodeByNumber(anime.id, '2')).toMatchObject({ id: failed.id, error: { code: 'NETWORK', raw: 'boom' } });
    });

    it('can register the same episodes again without repeating them', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        db.registerEpisodes(anime.id, ['1', '2']);
        db.registerEpisodes(anime.id, ['1', '2']);
        expect(db.getLibraryAnime(anime.id)?.episodes).toHaveLength(2);
    });

    it('registers nothing for an empty list, and keeps the episodes of the other anime apart', () => {
        const db = makeDb();
        const first = db.upsertAnime(NARUTO);
        const second = db.upsertAnime({ ...NARUTO, title: 'Bleach', searchIndex: 2 });
        db.registerEpisodes(first.id, []);
        db.registerEpisodes(first.id, ['1']);
        db.registerEpisodes(second.id, ['1', '2']);
        expect(db.getLibraryAnime(first.id)?.episodes).toHaveLength(1);
        expect(db.getLibraryAnime(second.id)?.episodes).toHaveLength(2);
    });

    it('registers all the episodes or none: a failure leaves nothing behind', () => {
        const db = makeDb();
        expect(() => {
            db.registerEpisodes(999, ['1', '2']);
        }).toThrow();
        expect(db.list()).toEqual([]);
        const anime = db.upsertAnime(NARUTO);
        expect(db.getLibraryAnime(anime.id)?.episodes).toEqual([]);
    });

    it('queues an idle episode when it is asked to be downloaded, and the idle ones are not failed by an interruption', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        db.registerEpisodes(anime.id, ['1', '2']);
        expect(db.ensureEpisode(anime.id, '1')).toMatchObject({ number: '1', status: 'queued' });
        db.failInterrupted();
        expect(
            db.getLibraryAnime(anime.id)?.episodes.map((episode) => {
                return [episode.number, episode.status];
            })
        ).toEqual([
            ['1', 'error'],
            ['2', 'idle']
        ]);
    });

    it('removes an idle episode, which has no file to give back', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        db.registerEpisodes(anime.id, ['1']);
        const episode = db.getEpisodeByNumber(anime.id, '1');
        expect(db.removeEpisode(episode?.id ?? 0)).toBeNull();
        expect(db.getLibraryAnime(anime.id)?.episodes).toEqual([]);
    });

    it('removes an anime that has only idle episodes, giving back no files', () => {
        const db = makeDb();
        const anime = db.upsertAnime(NARUTO);
        db.registerEpisodes(anime.id, ['1', '2']);
        expect(db.removeAnime(anime.id)).toEqual([]);
        expect(db.list()).toEqual([]);
    });
});

describe('AnimeDb seasons of a series', () => {
    function withSeasons() {
        const db = makeDb();
        const first = db.upsertAnime({ ...NARUTO, title: 'Frieren', searchIndex: 1 });
        const second = db.upsertAnime({ ...NARUTO, title: 'Frieren 2', searchIndex: 2 });
        const dub = db.upsertAnime({ ...NARUTO, title: 'Frieren', audio: 'dub', searchIndex: 1 });
        const other = db.upsertAnime({ ...NARUTO, title: 'Other', searchIndex: 3 });
        db.setSeries(first.id, 'Frieren', 1);
        db.setSeries(second.id, 'Frieren', 3);
        db.setSeries(dub.id, 'Frieren', 7);
        db.setSeries(other.id, 'Another series', 9);
        return { db, first, second, dub, other };
    }

    it('lists the seasons a series has for an audio, whatever the case or the accents of its name', () => {
        const { db } = withSeasons();
        expect(db.seasonsOfSeries('FRIEREN', 'sub').sort()).toEqual([1, 3]);
        expect(db.seasonsOfSeries('frieren', 'dub')).toEqual([7]);
        expect(db.seasonsOfSeries('Another series', 'sub')).toEqual([9]);
        expect(db.seasonsOfSeries('Unknown', 'sub')).toEqual([]);
    });

    it('leaves out the anime that are asked to be left out', () => {
        const { db, first, second } = withSeasons();
        expect(db.seasonsOfSeries('Frieren', 'sub', [first.id])).toEqual([3]);
        expect(db.seasonsOfSeries('Frieren', 'sub', [first.id, second.id])).toEqual([]);
    });

    it('does not count an anime that has no series or no season', () => {
        const db = makeDb();
        db.upsertAnime(NARUTO);
        expect(db.seasonsOfSeries('Naruto', 'sub')).toEqual([]);
    });

    it('gives the last season plus one as the first free one, and 1 for a series with none', () => {
        const { db, first, second } = withSeasons();
        expect(db.firstFreeSeason('Frieren', 'sub')).toBe(4);
        expect(db.firstFreeSeason('Frieren', 'dub')).toBe(8);
        expect(db.firstFreeSeason('Frieren', 'sub', [second.id])).toBe(2);
        expect(db.firstFreeSeason('Frieren', 'sub', [first.id, second.id])).toBe(1);
        expect(db.firstFreeSeason('New series', 'sub')).toBe(1);
    });
});

describe('AnimeDb.renameSeries', () => {
    function twoSeries() {
        const db = makeDb();
        const one = db.upsertAnime({ ...NARUTO, title: 'Frieren', searchIndex: 1 });
        const two = db.upsertAnime({ ...NARUTO, title: 'Frieren 2', searchIndex: 2 });
        const alone = db.upsertAnime({ ...NARUTO, title: 'Bleach', searchIndex: 3 });
        const target = db.upsertAnime({ ...NARUTO, title: 'Pokemon', searchIndex: 4 });
        db.setSeries(one.id, 'Frieren', 1, 'The beginning');
        db.setSeries(two.id, 'Frieren', 2);
        db.setSeries(target.id, 'Journeys', 1);
        return { db, one, two, alone, target };
    }

    function seriesOf(db: AnimeDb): Array<[string, string | null, number | null, string | null]> {
        return db.list().map((anime) => {
            return [anime.title, anime.series, anime.season, anime.seasonName];
        });
    }

    it('gives all the anime of the list the new name, keeping each season and the name shown', () => {
        const { db, one, two } = twoSeries();
        expect(db.renameSeries([one.id, two.id], 'Sousou no Frieren')).toEqual({ ok: true });
        expect(seriesOf(db)).toEqual([
            ['Bleach', null, null, null],
            ['Frieren', 'Sousou no Frieren', 1, 'The beginning'],
            ['Frieren 2', 'Sousou no Frieren', 2, null],
            ['Pokemon', 'Journeys', 1, null]
        ]);
    });

    it('makes an anime that was on its own the first season of the series, with the name given', () => {
        const { db, alone } = twoSeries();
        expect(db.renameSeries([alone.id], 'Bleach: Thousand-Year Blood War')).toEqual({ ok: true });
        expect(db.getAnime(alone.id)).toMatchObject({ series: 'Bleach: Thousand-Year Blood War', season: 1, seasonName: null });
    });

    it('joins another series when the name is one it has, keeping the seasons that do not clash and the spelling the other one has', () => {
        const { db, one, two } = twoSeries();
        db.setSeries(one.id, 'Frieren', 5);
        db.setSeries(two.id, 'Frieren', 6);
        expect(db.renameSeries([one.id, two.id], 'JOURNEYS')).toEqual({ ok: true });
        expect(db.seasonsOfSeries('Journeys', 'sub').sort()).toEqual([1, 5, 6]);
        expect(db.getAnime(one.id)?.series).toBe('Journeys');
        expect(db.getAnime(two.id)?.series).toBe('Journeys');
    });

    it('refuses a name another series has when a season clashes, saying which anime, which season and the next free one, and changes nothing', () => {
        const { db, one, two } = twoSeries();
        const before = seriesOf(db);
        expect(db.renameSeries([one.id, two.id], 'journeys')).toEqual({ ok: false, anime: 'Frieren', season: 1, suggested: 2 });
        expect(seriesOf(db)).toEqual(before);
    });

    it('suggests the last season of the other series plus one', () => {
        const { db, one, two } = twoSeries();
        const third = db.upsertAnime({ ...NARUTO, title: 'Pokemon 3', searchIndex: 5 });
        db.setSeries(third.id, 'Journeys', 4);
        expect(db.renameSeries([one.id, two.id], 'Journeys')).toEqual({ ok: false, anime: 'Frieren', season: 1, suggested: 5 });
    });

    it('does not count the audio of the other: the same season in another audio does not clash', () => {
        const { db, one, two } = twoSeries();
        const dub = db.upsertAnime({ ...NARUTO, title: 'Pokemon', audio: 'dub', searchIndex: 4 });
        db.setSeries(dub.id, 'Dubbed', 1);
        expect(db.renameSeries([one.id, two.id], 'Dubbed')).toEqual({ ok: true });
    });

    it('does not clash with itself: the name written in another case or with other accents is a rename', () => {
        const { db, one, two } = twoSeries();
        expect(db.renameSeries([one.id, two.id], 'FRIEREN')).toEqual({ ok: true });
        expect(db.getAnime(one.id)?.series).toBe('FRIEREN');
        expect(db.getAnime(two.id)?.series).toBe('FRIEREN');
        expect(db.seasonsOfSeries('frieren', 'sub').sort()).toEqual([1, 2]);
    });

    it('renames the series of an anime that is not in the list only when it is the one of the others', () => {
        const { db, one, two } = twoSeries();
        db.renameSeries([one.id], 'Frieren part one');
        expect(db.getAnime(one.id)?.series).toBe('Frieren part one');
        expect(db.getAnime(two.id)?.series).toBe('Frieren');
    });

    it('ignores the ids that are not anime, and does nothing for a list with none', () => {
        const { db, one } = twoSeries();
        expect(db.renameSeries([999, one.id], 'Renamed')).toEqual({ ok: true });
        expect(db.getAnime(one.id)?.series).toBe('Renamed');
        const before = seriesOf(db);
        expect(db.renameSeries([], 'Nothing')).toEqual({ ok: true });
        expect(db.renameSeries([777], 'Nothing')).toEqual({ ok: true });
        expect(seriesOf(db)).toEqual(before);
    });
});
