import { CONTINUE_LIMIT, activeDownloads, continueReading, continueWatching } from '@renderer/home/homeData';
import { makeAnime, makeAnimeJob, makeEpisode } from '../../helpers/animeFixtures';
import { makeAnimeHistory, makeReading } from '../../helpers/homeFixtures';
import type { LibraryManga, ReadingEntry } from '@shared/manga';
import { makeChapterRecord, makeLibraryManga, makeMangaJob } from '../../helpers/mangaFixtures';
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

    it('leaves out what was only opened, what is not in the library and an episode the library does not have', () => {
        const history = [makeAnimeHistory({ episode: null }), makeAnimeHistory({ title: 'Bleach' }), makeAnimeHistory({ episode: '99' })];
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
    // One Piece in the library: chapters 1 to 3 (remote ids 11 to 13), listed out of order.
    const chapter = (number: number, overrides: Parameters<typeof makeChapterRecord>[0] = {}) => {
        return makeChapterRecord({ id: number, remoteId: 10 + number, number, name: `Chapter ${String(number)}`, pageCount: 10 + number, ...overrides });
    };
    const onePiece = makeLibraryManga([chapter(3), chapter(1), chapter(2)], { id: 1, title: 'One Piece', thumbnailUrl: 'https://img/op.jpg' });
    const atChapter = (entry: ReadingEntry, number: number, manga: LibraryManga = onePiece): ReadingEntry => {
        return {
            ...entry,
            sourceId: manga.sourceId,
            mangaRemoteId: manga.remoteId,
            title: manga.title,
            thumbnailUrl: manga.thumbnailUrl,
            libraryMangaId: manga.id,
            chapterRemoteId: 10 + number,
            chapterName: `Chapter ${String(number)}`,
            chapterNumber: number,
            page: 0,
            pageCount: 10 + number
        };
    };

    it('lists the mangas read last first, with how far the chapter was read', () => {
        const older = makeReading({ id: 1, readAt: 10, page: 9, pageCount: 20 });
        const newer = makeReading({ id: 2, title: 'Berserk', mangaRemoteId: 8, readAt: 20, page: 0, pageCount: 4 });
        expect(continueReading([older, newer], [], [])).toEqual([
            { entry: newer, progress: 0.25 },
            { entry: older, progress: 0.5 }
        ]);
    });

    it('says 0 for a chapter whose pages are not known, and stops at the limit', () => {
        expect(continueReading([makeReading({ pageCount: 0 })], [], [])).toEqual([{ entry: makeReading({ pageCount: 0 }), progress: 0 }]);
        expect(continueReading([makeReading({ id: 1, mangaRemoteId: 7 }), makeReading({ id: 2, mangaRemoteId: 8 })], [], [], 1)).toEqual([{ entry: makeReading({ id: 1, mangaRemoteId: 7 }), progress: 0.25 }]);
    });

    it('shows a manga once, where it was read last', () => {
        const last = makeReading({ id: 2, readAt: 20, page: 1, pageCount: 4 });
        expect(continueReading([makeReading({ id: 1, readAt: 10 }), last], [], [])).toEqual([{ entry: last, progress: 0.5 }]);
    });

    it('goes on with the next chapter, by its number, when the chapter was read to its last page', () => {
        const finished = makeReading({ id: 4, chapterRemoteId: 11, chapterName: 'Chapter 1', page: 10, pageCount: 11 });
        expect(continueReading([finished], [onePiece], [])).toEqual([{ entry: atChapter(finished, 2), progress: 1 / 12 }]);
    });

    it('counts a page past the last as read to the end', () => {
        const past = makeReading({ id: 4, chapterRemoteId: 11, page: 40, pageCount: 11 });
        expect(continueReading([past], [onePiece], [])).toEqual([{ entry: atChapter(past, 2), progress: 1 / 12 }]);
    });

    it('goes on with the next chapter when the chapter was marked as read, wherever it was left', () => {
        const marked = makeReading({ id: 4, chapterRemoteId: 11, page: 2, pageCount: 11 });
        expect(continueReading([marked], [onePiece], ['One Piece|11'])).toEqual([{ entry: atChapter(marked, 2), progress: 1 / 12 }]);
    });

    it('passes over the chapters after it that are read already', () => {
        const finished = makeReading({ id: 4, chapterRemoteId: 11, page: 10, pageCount: 11 });
        expect(continueReading([finished], [onePiece], ['One Piece|12'])).toEqual([{ entry: atChapter(finished, 3), progress: 1 / 13 }]);
    });

    it('leaves out a manga that is up to date: the last chapter was read to the end', () => {
        const finished = makeReading({ id: 4, chapterRemoteId: 13, page: 12, pageCount: 13 });
        expect(continueReading([finished], [onePiece], [])).toEqual([]);
    });

    it('leaves out a finished chapter of a manga that is not in the library, or whose chapter is not in it any more', () => {
        expect(continueReading([makeReading({ id: 4, libraryMangaId: null, page: 19, pageCount: 20 })], [onePiece], [])).toEqual([]);
        expect(continueReading([makeReading({ id: 4, libraryMangaId: 9, page: 19, pageCount: 20 })], [onePiece], [])).toEqual([]);
        expect(continueReading([makeReading({ id: 4, chapterRemoteId: 99, page: 19, pageCount: 20 })], [onePiece], [])).toEqual([]);
    });

    it('goes on with the first chapter not read of the next season when the season is over', () => {
        const first = makeLibraryManga([chapter(1), chapter(2)], { id: 1, title: 'One Piece', series: 'One Piece', season: 1 });
        const second = makeLibraryManga([chapter(5, { mangaId: 2 }), chapter(4, { mangaId: 2 })], { id: 2, remoteId: 70, title: 'One Piece 2', thumbnailUrl: 'https://img/op2.jpg', series: 'One Piece', season: 2 });
        const finished = makeReading({ id: 4, chapterRemoteId: 12, page: 11, pageCount: 12 });
        expect(continueReading([finished], [first, second], [])).toEqual([{ entry: atChapter(finished, 4, second), progress: 1 / 14 }]);
        expect(continueReading([finished], [first, second], ['One Piece 2|14'])).toEqual([{ entry: atChapter(finished, 5, second), progress: 1 / 15 }]);
        expect(continueReading([finished], [first, second], ['One Piece 2|14', 'One Piece 2|15'])).toEqual([]);
    });

    it('shows the next season once when it was read on its own too', () => {
        const first = makeLibraryManga([chapter(1)], { id: 1, title: 'One Piece', series: 'One Piece', season: 1 });
        const second = makeLibraryManga([chapter(4, { mangaId: 2 })], { id: 2, remoteId: 70, title: 'One Piece 2', series: 'One Piece', season: 2 });
        const finished = makeReading({ id: 4, readAt: 30, chapterRemoteId: 11, page: 10, pageCount: 11 });
        const own = makeReading({ id: 5, readAt: 20, title: 'One Piece 2', mangaRemoteId: 70, libraryMangaId: 2, chapterRemoteId: 14, page: 2, pageCount: 14 });
        expect(continueReading([finished, own], [first, second], [])).toEqual([{ entry: atChapter(finished, 4, second), progress: 1 / 14 }]);
    });

    it('does not change the list it was given', () => {
        const list = [makeReading({ id: 1, readAt: 1 }), makeReading({ id: 2, readAt: 2 })];
        continueReading(list, [], []);
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
