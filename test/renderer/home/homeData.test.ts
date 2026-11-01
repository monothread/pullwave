import { CONTINUE_LIMIT, activeDownloads, continueReading, continueWatching } from '@renderer/home/homeData';
import { makeAnime, makeAnimeJob, makeEpisode } from '../../helpers/animeFixtures';
import { makeAnimeHistory, makeReading } from '../../helpers/homeFixtures';
import { makeMangaJob } from '../../helpers/mangaFixtures';
import { makeJob } from '../../helpers/mockApi';

describe('CONTINUE_LIMIT', () => {
    it('reads twelve titles to go on with at most', () => {
        expect(CONTINUE_LIMIT).toBe(12);
    });
});

describe('continueWatching', () => {
    const halfWay = makeEpisode({ id: 11, animeId: 1, number: '1', positionSeconds: 300, durationSeconds: 1200 });
    const second = makeEpisode({ id: 12, animeId: 1, number: '2' });
    const naruto = makeAnime([halfWay, second], { id: 1, title: 'Naruto' });

    it('offers the episode left half way, with how much of it was watched', () => {
        expect(continueWatching([naruto], [makeAnimeHistory({ title: 'Naruto', episode: '1' })])).toEqual([{ animeId: 1, episodeId: 11, title: 'Naruto', episode: '1', progress: 0.25 }]);
    });

    it('offers the next downloaded episode when the last one was watched', () => {
        const watched = makeAnime([{ ...halfWay, watched: true }, second], { id: 1, title: 'Naruto' });
        expect(continueWatching([watched], [makeAnimeHistory({ episode: '1' })])).toEqual([{ animeId: 1, episodeId: 12, title: 'Naruto', episode: '2', progress: 0 }]);
    });

    it('goes on in the next season of the series when the season is over', () => {
        const first = makeAnime([makeEpisode({ id: 11, animeId: 1, number: '12', watched: true })], { id: 1, title: 'Show', series: 'Show', season: 1 });
        const next = makeAnime([makeEpisode({ id: 21, animeId: 2, number: '1', positionSeconds: 60, durationSeconds: 600 })], { id: 2, title: 'Show 2', series: 'Show', season: 2 });
        expect(continueWatching([first, next], [makeAnimeHistory({ title: 'Show', episode: '12' })])).toEqual([{ animeId: 2, episodeId: 21, title: 'Show 2', episode: '1', progress: 0.1 }]);
    });

    it.each([
        ['the next episode is not downloaded', [{ ...halfWay, watched: true }, { ...second, status: 'idle' as const }]],
        ['the next episode was watched too', [{ ...halfWay, watched: true }, { ...second, watched: true }]],
        ['the next episode lost its file', [{ ...halfWay, watched: true }, { ...second, fileMissing: true }]],
        ['there is no next episode', [{ ...halfWay, watched: true }]]
    ])('offers nothing when %s', (_reason, episodes) => {
        expect(continueWatching([makeAnime(episodes, { id: 1, title: 'Naruto' })], [makeAnimeHistory({ episode: '1' })])).toEqual([]);
    });

    it('skips the current episode when its file is missing and goes to the next one', () => {
        const missing = makeAnime([{ ...halfWay, fileMissing: true }, second], { id: 1, title: 'Naruto' });
        expect(continueWatching([missing], [makeAnimeHistory({ episode: '1' })])).toEqual([{ animeId: 1, episodeId: 12, title: 'Naruto', episode: '2', progress: 0 }]);
    });

    it('leaves out what was only opened, what is not in the library, an episode the library does not have and another audio', () => {
        const history = [makeAnimeHistory({ episode: null }), makeAnimeHistory({ title: 'Bleach' }), makeAnimeHistory({ episode: '99' }), makeAnimeHistory({ audio: 'dub' })];
        expect(continueWatching([naruto], history)).toEqual([]);
    });

    it('keeps one tile per anime, in the order of the history', () => {
        const bleach = makeAnime([makeEpisode({ id: 31, animeId: 3, number: '4' })], { id: 3, title: 'Bleach' });
        const history = [makeAnimeHistory({ id: 3, title: 'Bleach', episode: '4' }), makeAnimeHistory({ id: 1, episode: '1' }), makeAnimeHistory({ id: 2, episode: '1' })];
        expect(
            continueWatching([naruto, bleach], history).map((item) => {
                return item.title;
            })
        ).toEqual(['Bleach', 'Naruto']);
    });

    it('stops at the limit', () => {
        const library = [1, 2, 3].map((id) => {
            return makeAnime([makeEpisode({ id: id * 10, animeId: id, number: '1' })], { id, title: `Show ${String(id)}` });
        });
        const history = library.map((anime) => {
            return makeAnimeHistory({ id: anime.id, title: anime.title, episode: '1' });
        });
        expect(continueWatching(library, history, 2)).toHaveLength(2);
    });

    it('says 0 watched for an episode whose length is not known, and never more than all of it', () => {
        const unknown = makeAnime([makeEpisode({ id: 11, positionSeconds: 30, durationSeconds: 0 })], { id: 1, title: 'Naruto' });
        expect(continueWatching([unknown], [makeAnimeHistory()])[0]?.progress).toBe(0);
        const over = makeAnime([makeEpisode({ id: 11, positionSeconds: 900, durationSeconds: 600 })], { id: 1, title: 'Naruto' });
        expect(continueWatching([over], [makeAnimeHistory()])[0]?.progress).toBe(1);
    });
});

describe('continueReading', () => {
    it('lists the mangas read last first, with how far the chapter was read', () => {
        const older = makeReading({ id: 1, readAt: 10, page: 9, pageCount: 20 });
        const newer = makeReading({ id: 2, title: 'Berserk', readAt: 20, page: 0, pageCount: 4 });
        expect(continueReading([older, newer])).toEqual([
            { entry: newer, progress: 0.25 },
            { entry: older, progress: 0.5 }
        ]);
    });

    it('says 0 for a chapter whose pages are not known, never more than all of it, and stops at the limit', () => {
        expect(continueReading([makeReading({ pageCount: 0 })])[0]?.progress).toBe(0);
        expect(continueReading([makeReading({ page: 40, pageCount: 20 })])[0]?.progress).toBe(1);
        expect(continueReading([makeReading({ id: 1 }), makeReading({ id: 2 })], 1)).toHaveLength(1);
    });

    it('does not change the list it was given', () => {
        const list = [makeReading({ id: 1, readAt: 1 }), makeReading({ id: 2, readAt: 2 })];
        continueReading(list);
        expect(
            list.map((entry) => {
                return entry.id;
            })
        ).toEqual([1, 2]);
    });
});

describe('activeDownloads', () => {
    it('gathers what is not over in the three sections: running first, then waiting, then paused', () => {
        const items = activeDownloads(
            [makeJob({ id: 'a', status: 'queued', title: 'Queued video' }), makeJob({ id: 'b', status: 'done' }), makeJob({ id: 'c', status: 'running', title: null, url: 'https://x/c', percent: 10 })],
            [makeAnimeJob({ episodeId: 7, status: 'paused', animeTitle: 'Naruto', episode: '3', percent: 50 }), makeAnimeJob({ episodeId: 8, status: 'error' })],
            [makeMangaJob({ chapterId: 9, status: 'running', mangaTitle: 'One Piece', chapterName: 'Romance Dawn', percent: 25 }), makeMangaJob({ chapterId: 10, status: 'cancelled' })]
        );
        expect(items).toEqual([
            { key: 'video-c', kind: 'video', title: 'https://x/c', detail: null, percent: 10, status: 'running' },
            { key: 'manga-9', kind: 'manga', title: 'One Piece', detail: 'Romance Dawn', percent: 25, status: 'running' },
            { key: 'video-a', kind: 'video', title: 'Queued video', detail: null, percent: makeJob().percent, status: 'queued' },
            { key: 'anime-7', kind: 'anime', title: 'Naruto', detail: '3', percent: 50, status: 'paused' }
        ]);
    });

    it('is empty when nothing goes on', () => {
        expect(activeDownloads([makeJob({ status: 'done' })], [], [])).toEqual([]);
    });
});
