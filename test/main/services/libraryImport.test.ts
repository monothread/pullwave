import { AnimeDb } from '@main/services/animeDb';
import { importLibrary } from '@main/services/libraryImport';
import type { ScannedEpisode } from '@main/services/libraryScan';

function found(overrides: Partial<ScannedEpisode> = {}): ScannedEpisode {
    return {
        videoPath: '/lib/Naruto/Episode 1/Naruto Episode 1.mp4',
        title: 'Naruto',
        number: '1',
        audio: null,
        query: 'Naruto',
        searchIndex: 0,
        progress: null,
        series: null,
        season: null,
        seasonName: null,
        ...overrides
    };
}

function setup(sizes: Record<string, number> = {}) {
    const db = new AnimeDb(':memory:', () => {
        return 5000;
    });
    const saved: number[] = [];
    const options = {
        defaultAudio: 'sub' as const,
        fileSize: (path: string) => {
            return sizes[path] ?? null;
        },
        onEpisodeSaved: (episodeId: number) => {
            saved.push(episodeId);
        }
    };
    return { db, saved, options };
}

describe('importLibrary', () => {
    it('adds the anime and its episodes as downloaded, with the size of the files', () => {
        const { db, saved, options } = setup({ '/lib/Naruto/Episode 1/Naruto Episode 1.mp4': 4096, '/lib/Naruto/Episode 2/Naruto Episode 2.mp4': 8192 });
        const summary = importLibrary(
            db,
            {
                episodes: [found(), found({ videoPath: '/lib/Naruto/Episode 2/Naruto Episode 2.mp4', number: '2' })],
                ignored: 3
            },
            options
        );

        expect(summary).toEqual({ added: 2, relinked: 0, skipped: 0, ignored: 3 });
        const [anime] = db.list();
        expect(anime).toMatchObject({ title: 'Naruto', query: 'Naruto', searchIndex: 0, audio: 'sub' });
        expect(anime?.episodes).toEqual([
            {
                id: 1,
                animeId: 1,
                number: '1',
                status: 'done',
                filePath: '/lib/Naruto/Episode 1/Naruto Episode 1.mp4',
                sizeBytes: 4096,
                error: null,
                positionSeconds: 0,
                durationSeconds: 0,
                watched: false,
                downloadedAt: 5000,
                addedAt: null,
                fileMissing: false
            },
            {
                id: 2,
                animeId: 1,
                number: '2',
                status: 'done',
                filePath: '/lib/Naruto/Episode 2/Naruto Episode 2.mp4',
                sizeBytes: 8192,
                error: null,
                positionSeconds: 0,
                durationSeconds: 0,
                watched: false,
                downloadedAt: 5000,
                addedAt: null,
                fileMissing: false
            }
        ]);
        expect(saved).toEqual([1, 2]);
    });

    it('uses the audio it was told, or the one of the settings when nothing says it', () => {
        const { db, options } = setup();
        importLibrary(db, { episodes: [found({ audio: 'dub' }), found({ title: 'Bleach', videoPath: '/lib/Bleach/Bleach Episode 1.mp4' })], ignored: 0 }, options);
        expect(
            db.list().map((anime) => {
                return [anime.title, anime.audio];
            })
        ).toEqual([
            ['Bleach', 'sub'],
            ['Naruto', 'dub']
        ]);
        const dubbed = setup().options;
        const { db: other } = setup();
        importLibrary(other, { episodes: [found()], ignored: 0 }, { ...dubbed, defaultAudio: 'dub' });
        expect(other.list()[0]?.audio).toBe('dub');
    });

    it('brings back the position and the watched mark the metadata remembered, with the search data', () => {
        const { db, options } = setup();
        importLibrary(
            db,
            { episodes: [found({ audio: 'dub', query: 'naruto', searchIndex: 4, progress: { positionSeconds: 700, durationSeconds: 1400, watched: true } })], ignored: 0 },
            options
        );
        const [anime] = db.list();
        expect(anime).toMatchObject({ query: 'naruto', searchIndex: 4, audio: 'dub' });
        expect(anime?.episodes[0]).toMatchObject({ positionSeconds: 700, durationSeconds: 1400, watched: true });
    });

    it('leaves alone an episode that is already there with the same file', () => {
        const { db, saved, options } = setup();
        const path = '/lib/Naruto/Episode 1/Naruto Episode 1.mp4';
        importLibrary(db, { episodes: [found()], ignored: 0 }, options);
        db.saveProgress({ episodeId: 1, positionSeconds: 99, durationSeconds: 1400, watched: false });
        saved.length = 0;

        const summary = importLibrary(db, { episodes: [found({ progress: { positionSeconds: 5, durationSeconds: 5, watched: true } })], ignored: 0 }, options);

        expect(summary).toEqual({ added: 0, relinked: 0, skipped: 1, ignored: 0 });
        expect(db.getEpisode(1)).toMatchObject({ filePath: path, positionSeconds: 99, watched: false });
        expect(saved).toEqual([]);
    });

    it('points an episode that is already there to its new file, and keeps how far it was watched', () => {
        const { db, saved, options } = setup({ '/new/Naruto/Episode 1/Naruto Episode 1.mp4': 777 });
        importLibrary(db, { episodes: [found()], ignored: 0 }, options);
        db.saveProgress({ episodeId: 1, positionSeconds: 99, durationSeconds: 1400, watched: true });
        saved.length = 0;

        const summary = importLibrary(db, { episodes: [found({ videoPath: '/new/Naruto/Episode 1/Naruto Episode 1.mp4' })], ignored: 0 }, options);

        expect(summary).toEqual({ added: 0, relinked: 1, skipped: 0, ignored: 0 });
        expect(db.list()).toHaveLength(1);
        expect(db.getEpisode(1)).toMatchObject({
            status: 'done',
            filePath: '/new/Naruto/Episode 1/Naruto Episode 1.mp4',
            sizeBytes: 777,
            positionSeconds: 99,
            watched: true,
            downloadedAt: 5000
        });
        expect(saved).toEqual([1]);
    });

    it('adds an episode that was in the library but not downloaded', () => {
        const { db, options } = setup({ '/lib/Naruto/Episode 1/Naruto Episode 1.mp4': 10 });
        const anime = db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 2, audio: 'sub' });
        db.markFailed(db.ensureEpisode(anime.id, '1').id, 'error', { code: 'UNKNOWN', raw: 'x' });

        const summary = importLibrary(db, { episodes: [found()], ignored: 0 }, options);

        expect(summary).toEqual({ added: 1, relinked: 0, skipped: 0, ignored: 0 });
        expect(db.getEpisode(1)).toMatchObject({ status: 'done', error: null, filePath: '/lib/Naruto/Episode 1/Naruto Episode 1.mp4', sizeBytes: 10 });
    });

    it('never replaces the search data of an anime with data that is not known, and fills it in when it is learnt', () => {
        const { db, options } = setup();
        db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 2, audio: 'sub' });
        importLibrary(db, { episodes: [found({ query: 'Naruto Found', searchIndex: 0 })], ignored: 0 }, options);
        expect(db.getAnime(1)).toMatchObject({ query: 'naruto', searchIndex: 2 });

        const unknown = setup();
        importLibrary(unknown.db, { episodes: [found()], ignored: 0 }, unknown.options);
        importLibrary(unknown.db, { episodes: [found({ videoPath: '/x/Naruto Episode 2.mp4', number: '2', query: 'naruto', searchIndex: 6 })], ignored: 0 }, unknown.options);
        expect(unknown.db.getAnime(1)).toMatchObject({ query: 'naruto', searchIndex: 6 });
    });

    it('keeps the same title in another audio as another anime', () => {
        const { db, options } = setup();
        importLibrary(db, { episodes: [found({ audio: 'sub' }), found({ audio: 'dub', videoPath: '/lib/dub/Naruto Episode 1.mp4' })], ignored: 0 }, options);
        expect(db.list()).toHaveLength(2);
    });

    it('says what is missing for a file whose size is not known', () => {
        const { db, options } = setup();
        importLibrary(db, { episodes: [found()], ignored: 0 }, options);
        expect(db.getEpisode(1)?.sizeBytes).toBeNull();
    });

    it('joins the anime to the series the folders or the metadata say, and never replaces what the user set', () => {
        const { db, options } = setup();
        importLibrary(db, { episodes: [found({ series: 'Frieren', season: 2 })], ignored: 0 }, options);
        expect(db.getAnime(1)).toMatchObject({ series: 'Frieren', season: 2 });

        db.setSeries(1, 'My Frieren', 5);
        importLibrary(db, { episodes: [found({ videoPath: '/x/Naruto Episode 2.mp4', number: '2', series: 'Frieren', season: 2 })], ignored: 0 }, options);
        expect(db.getAnime(1)).toMatchObject({ series: 'My Frieren', season: 5 });
    });

    it('joins the series with the spelling the library already has', () => {
        const { db, options } = setup();
        importLibrary(db, { episodes: [found({ title: 'Frieren', series: 'Frieren', season: 1 })], ignored: 0 }, options);
        importLibrary(db, { episodes: [found({ title: 'Frieren 2', videoPath: '/x/Frieren 2 Episode 1.mp4', series: 'FRIEREN', season: 2 })], ignored: 0 }, options);
        expect(
            db.list().map((anime) => {
                return anime.series;
            })
        ).toEqual(['Frieren', 'Frieren']);
    });

    it('brings back the name the anime was shown with in its series', () => {
        const { db, options } = setup();
        importLibrary(db, { episodes: [found({ title: 'Bleach 4', series: 'Bleach', season: 4, seasonName: 'The Conflict' })], ignored: 0 }, options);
        expect(db.getAnime(1)).toMatchObject({ series: 'Bleach', season: 4, seasonName: 'The Conflict' });
    });

    it('leaves the anime on its own when its season is already taken in the series', () => {
        const { db, options } = setup();
        importLibrary(db, { episodes: [found({ title: 'Frieren', series: 'Frieren', season: 1 })], ignored: 0 }, options);
        importLibrary(db, { episodes: [found({ title: 'Other', videoPath: '/x/Other Episode 1.mp4', series: 'frieren', season: 1 })], ignored: 0 }, options);
        expect(
            db.list().map((anime) => {
                return [anime.title, anime.series, anime.season];
            })
        ).toEqual([
            ['Frieren', 'Frieren', 1],
            ['Other', null, null]
        ]);
    });

    it('does nothing for an empty scan, and works without being told when episodes are saved', () => {
        const { db, options } = setup();
        expect(importLibrary(db, { episodes: [], ignored: 0 }, options)).toEqual({ added: 0, relinked: 0, skipped: 0, ignored: 0 });
        expect(importLibrary(db, { episodes: [found()], ignored: 1 }, { defaultAudio: 'sub', fileSize: options.fileSize })).toEqual({ added: 1, relinked: 0, skipped: 0, ignored: 1 });
    });
});
