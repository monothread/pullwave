import { NEWS_WINDOW_MS, SPOTLIGHT_LIMIT, LIBRARY_SORTS, animeLastSeen, animeNews, animeSpotlight, animeGroupComplete, filterGroups, isRecent, mangaLastSeen, mangaNews, mangaSpotlight, mixSpotlight, sortGroups, type SpotlightItem } from '@renderer/spotlight/spotlightData';
import { groupLibrary } from '@renderer/components/mangaText';
import { makeAnime, makeEpisode } from '../../helpers/animeFixtures';
import { makeAnimeHistory, makeReading } from '../../helpers/homeFixtures';
import { makeChapterRecord, makeLibraryManga } from '../../helpers/mangaFixtures';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function keys(items: readonly SpotlightItem[]): string[] {
    return items.map((item) => {
        return item.key;
    });
}

describe('the constants', () => {
    it('counts as new what arrived in the last seven days, shows eight highlights at most and sorts by date or by name, from A or from Z', () => {
        expect(NEWS_WINDOW_MS).toBe(7 * DAY);
        expect(SPOTLIGHT_LIMIT).toBe(8);
        expect(LIBRARY_SORTS).toEqual(['recent', 'last', 'az', 'za']);
    });
});

describe('isRecent', () => {
    it.each([
        [NOW, true],
        [NOW - DAY, true],
        [NOW - 7 * DAY + 1, true],
        [NOW - 7 * DAY, false],
        [NOW - 30 * DAY, false],
        [NOW + 1000, false],
        [null, false]
    ])('says whether something that arrived at %s is new', (addedAt, recent) => {
        expect(isRecent(addedAt, NOW)).toBe(recent);
    });
});

describe('animeNews and mangaNews', () => {
    it('count what arrived in the window and say when the last one came', () => {
        const anime = [
            makeAnime([makeEpisode({ id: 1, addedAt: NOW - DAY }), makeEpisode({ id: 2, addedAt: NOW - 3 * DAY }), makeEpisode({ id: 3, addedAt: null })], { id: 1 }),
            makeAnime([makeEpisode({ id: 4, addedAt: NOW - 10 * DAY })], { id: 2 })
        ];
        expect(animeNews(anime, NOW)).toEqual({ count: 2, latest: NOW - DAY });
        const manga = [makeLibraryManga([makeChapterRecord({ id: 1, addedAt: NOW - 2 * DAY }), makeChapterRecord({ id: 2, addedAt: null })])];
        expect(mangaNews(manga, NOW)).toEqual({ count: 1, latest: NOW - 2 * DAY });
    });

    it('are zero with nothing new', () => {
        expect(animeNews([], NOW)).toEqual({ count: 0, latest: 0 });
        expect(mangaNews([makeLibraryManga([makeChapterRecord({ addedAt: null })])], NOW)).toEqual({ count: 0, latest: 0 });
    });
});

describe('animeSpotlight', () => {
    const watching = makeAnime([makeEpisode({ id: 11, animeId: 1, number: '2', positionSeconds: 300, durationSeconds: 1200 })], { id: 1, title: 'Watching' });
    const olderNews = makeAnime([makeEpisode({ id: 21, animeId: 2, addedAt: NOW - 3 * DAY })], { id: 2, title: 'Older News' });
    const newerNews = makeAnime([makeEpisode({ id: 31, animeId: 3, addedAt: NOW - DAY }), makeEpisode({ id: 32, animeId: 3, number: '2', addedAt: NOW - DAY })], { id: 3, title: 'Newer News' });
    const quiet = makeAnime([makeEpisode({ id: 41, animeId: 4 })], { id: 4, title: 'Quiet' });

    it('puts what to go on with first, then the series with news, the newest first', () => {
        const items = animeSpotlight([watching, olderNews, newerNews, quiet], [makeAnimeHistory({ title: 'Watching', episode: '2' })], NOW);
        expect(items).toEqual([
            { key: 'anime-continue-1', kind: 'anime', reason: 'continue', title: 'Watching', coverTitle: 'Watching', animeId: 1, episodeId: 11, episode: '2', progress: 0.25 },
            { key: 'anime-news-anime-3', kind: 'anime', reason: 'news', title: 'Newer News', coverTitle: 'Newer News', groupKey: 'anime-3', count: 2 },
            { key: 'anime-news-anime-2', kind: 'anime', reason: 'news', title: 'Older News', coverTitle: 'Older News', groupKey: 'anime-2', count: 1 }
        ]);
    });

    it('does not repeat a series that is already there to go on with', () => {
        const both = makeAnime([makeEpisode({ id: 11, animeId: 1, number: '2', positionSeconds: 300, durationSeconds: 1200, addedAt: NOW - DAY })], { id: 1, title: 'Watching' });
        expect(keys(animeSpotlight([both], [makeAnimeHistory({ title: 'Watching', episode: '2' })], NOW))).toEqual(['anime-continue-1']);
    });

    it('takes the series of the seasons and the cover of its first season, and stops at the limit', () => {
        const one = makeAnime([makeEpisode({ id: 1, animeId: 5, addedAt: NOW - DAY })], { id: 5, title: 'Saga S1', series: 'Saga', season: 1 });
        const two = makeAnime([makeEpisode({ id: 2, animeId: 6, addedAt: NOW - DAY })], { id: 6, title: 'Saga S2', series: 'Saga', season: 2 });
        expect(animeSpotlight([one, two], [], NOW)).toEqual([{ key: 'anime-news-series-saga', kind: 'anime', reason: 'news', title: 'Saga', coverTitle: 'Saga S1', groupKey: 'series-saga', count: 2 }]);
        expect(animeSpotlight([olderNews, newerNews], [], NOW, 1)).toHaveLength(1);
    });

    it('is empty with nothing to go on with and nothing new', () => {
        expect(animeSpotlight([quiet], [], NOW)).toEqual([]);
    });
});

describe('mangaSpotlight', () => {
    const reading = makeLibraryManga([makeChapterRecord({ id: 1 })], { id: 1, title: 'Reading', thumbnailUrl: 'https://img/r.jpg' });
    const news = makeLibraryManga([makeChapterRecord({ id: 2, mangaId: 2, addedAt: NOW - DAY })], { id: 2, title: 'News', thumbnailUrl: 'https://img/n.jpg' });

    it('puts the mangas being read of the library first, then the ones with news', () => {
        const entry = makeReading({ id: 9, title: 'Reading', libraryMangaId: 1, page: 9, pageCount: 20, thumbnailUrl: 'https://img/r.jpg' });
        const elsewhere = makeReading({ id: 10, title: 'Elsewhere', libraryMangaId: null });
        const [group] = groupLibrary([news]);
        expect(mangaSpotlight([reading, news], [entry, elsewhere], [], NOW)).toEqual([
            { key: 'manga-continue-9', kind: 'manga', reason: 'continue', title: 'Reading', coverUrl: 'https://img/r.jpg', entry, progress: 0.5 },
            { key: 'manga-news-manga-2', kind: 'manga', reason: 'news', title: 'News', coverUrl: 'https://img/n.jpg', group, count: 1 }
        ]);
    });

    it('does not repeat a manga that is already there to go on with, and stops at the limit', () => {
        const entry = makeReading({ id: 9, libraryMangaId: 2 });
        expect(keys(mangaSpotlight([news], [entry], [], NOW))).toEqual(['manga-continue-9']);
        expect(mangaSpotlight([reading, news], [makeReading({ id: 9, libraryMangaId: 1 })], [], NOW, 1)).toHaveLength(1);
    });

    it('goes on with the next chapter not read of a manga whose chapter was read to its last page', () => {
        const manga = makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 11, number: 1 }), makeChapterRecord({ id: 2, remoteId: 12, number: 2, name: 'The Great Race', pageCount: 18 })], { id: 1, title: 'Reading', thumbnailUrl: 'https://img/r.jpg' });
        const finished = makeReading({ id: 9, title: 'Reading', libraryMangaId: 1, chapterRemoteId: 11, page: 19, pageCount: 20, thumbnailUrl: 'https://img/r.jpg' });
        expect(mangaSpotlight([manga], [finished], [], NOW)).toEqual([
            {
                key: 'manga-continue-9',
                kind: 'manga',
                reason: 'continue',
                title: 'Reading',
                coverUrl: 'https://img/r.jpg',
                entry: { ...finished, chapterRemoteId: 12, chapterName: 'The Great Race', chapterNumber: 2, page: 0, pageCount: 18 },
                progress: 1 / 18
            }
        ]);
    });

    it('leaves out a manga whose chapter was marked as read when every chapter after it is read too, and shows its news instead', () => {
        const manga = makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 11, number: 1 }), makeChapterRecord({ id: 2, remoteId: 12, number: 2, addedAt: NOW - DAY })], { id: 1, title: 'Reading', thumbnailUrl: 'https://img/r.jpg' });
        const marked = makeReading({ id: 9, title: 'Reading', libraryMangaId: 1, chapterRemoteId: 11, page: 3, pageCount: 20 });
        const [group] = groupLibrary([manga]);
        expect(mangaSpotlight([manga], [marked], ['Reading|11', 'Reading|12'], NOW)).toEqual([
            { key: 'manga-news-manga-1', kind: 'manga', reason: 'news', title: 'Reading', coverUrl: 'https://img/r.jpg', group, count: 1 }
        ]);
    });
});

describe('mixSpotlight', () => {
    const a = [{ key: 'a1' }, { key: 'a2' }, { key: 'a3' }] as SpotlightItem[];
    const m = [{ key: 'm1' }] as SpotlightItem[];

    it('takes one of each in turn, the anime first', () => {
        expect(keys(mixSpotlight(a, m))).toEqual(['a1', 'm1', 'a2', 'a3']);
    });

    it('takes the manga in turn too when there are more of them', () => {
        expect(keys(mixSpotlight(m, a))).toEqual(['m1', 'a1', 'a2', 'a3']);
        expect(keys(mixSpotlight([], a))).toEqual(['a1', 'a2', 'a3']);
    });

    it('stops at the limit and is empty with nothing', () => {
        expect(keys(mixSpotlight(a, m, 2))).toEqual(['a1', 'm1']);
        expect(mixSpotlight([], [])).toEqual([]);
    });
});

describe('sortGroups and filterGroups', () => {
    const never = (): number => {
        return 0;
    };
    const groups = [
        { series: 'beta', entries: [{ createdAt: 5 }] },
        { series: 'Alpha 10', entries: [{ createdAt: 1 }, { createdAt: 9 }] },
        { series: 'alpha 2', entries: [{ createdAt: 3 }] },
        { series: 'Same', entries: [{ createdAt: 5 }] }
    ];

    it('sorts by the newest season first, then by name', () => {
        expect(
            sortGroups(groups, 'recent', never).map((group) => {
                return group.series;
            })
        ).toEqual(['Alpha 10', 'beta', 'Same', 'alpha 2']);
    });

    it('sorts by name, whatever the case, with the numbers by their value', () => {
        expect(
            sortGroups(groups, 'az', never).map((group) => {
                return group.series;
            })
        ).toEqual(['alpha 2', 'Alpha 10', 'beta', 'Same']);
    });

    it('sorts by name from Z, whatever the case, with the numbers by their value', () => {
        expect(
            sortGroups(groups, 'za', never).map((group) => {
                return group.series;
            })
        ).toEqual(['Same', 'beta', 'Alpha 10', 'alpha 2']);
    });

    it('does not change the list it was given', () => {
        sortGroups(groups, 'za', never);
        expect(groups[0]?.series).toBe('beta');
    });

    it('does not change the list it was given, by name from A either', () => {
        sortGroups(groups, 'az', never);
        expect(groups[0]?.series).toBe('beta');
    });

    it('sorts by the one seen last first, then the ones never seen as the ones added last', () => {
        const seen: Record<string, number> = { 'alpha 2': 50, beta: 90 };
        const lastSeen = (group: { series: string }): number => {
            return seen[group.series] ?? 0;
        };
        expect(
            sortGroups(groups, 'last', lastSeen).map((group) => {
                return group.series;
            })
        ).toEqual(['beta', 'alpha 2', 'Alpha 10', 'Same']);
    });

    it('keeps everything, or only the groups with news', () => {
        const news = (group: { series: string }): number => {
            return group.series === 'beta' ? 2 : 0;
        };
        expect(filterGroups(groups, 'all', news)).toEqual(groups);
        expect(filterGroups(groups, 'all', news)).not.toBe(groups);
        expect(filterGroups(groups, 'news', news)).toEqual([groups[0]]);
    });

    it('keeps the complete groups with COMPLETE and all the others with ONGOING', () => {
        const complete = (group: { series: string }): boolean => {
            return group.series === 'beta' || group.series === 'Same';
        };
        expect(filterGroups(groups, 'complete', never, complete)).toEqual([groups[0], groups[3]]);
        expect(filterGroups(groups, 'ongoing', never, complete)).toEqual([groups[1], groups[2]]);
        expect(filterGroups(groups, 'all', never, complete)).toEqual(groups);
        expect(filterGroups(groups, 'news', never, complete)).toEqual([]);
    });

    it('calls the call of COMPLETE with each group, and keeps the filtered list apart from the one it was given', () => {
        const complete = vi.fn((group: { series: string }): boolean => {
            return group.series === 'beta';
        });
        const kept = filterGroups(groups, 'complete', never, complete);
        expect(complete.mock.calls).toEqual(groups.map((group) => {
            return [group];
        }));
        expect(kept).toEqual([groups[0]]);
        expect(kept).not.toBe(groups);
    });

    it('keeps nothing with COMPLETE and everything with ONGOING when no group can be complete, as in the manga library', () => {
        expect(filterGroups(groups, 'complete', never)).toEqual([]);
        expect(filterGroups(groups, 'ongoing', never)).toEqual(groups);
    });
});

describe('animeGroupComplete', () => {
    const finished = { status: 'finished', override: null, complete: true } as const;
    const releasing = { status: 'ongoing', override: null, complete: false } as const;
    const unknown = { status: null, override: null, complete: false } as const;
    const setComplete = { status: 'ongoing', override: 'complete', complete: true } as const;

    it('is true when every season is complete, by AniList or as the user said it', () => {
        expect(animeGroupComplete([makeAnime([], { id: 1, airing: finished })])).toBe(true);
        expect(animeGroupComplete([makeAnime([], { id: 1, airing: finished }), makeAnime([], { id: 2, airing: setComplete })])).toBe(true);
    });

    it('is false when a season is still coming out or AniList knows nothing about it', () => {
        expect(animeGroupComplete([makeAnime([], { id: 1, airing: releasing })])).toBe(false);
        expect(animeGroupComplete([makeAnime([], { id: 1, airing: unknown })])).toBe(false);
        expect(animeGroupComplete([makeAnime([], { id: 1, airing: finished }), makeAnime([], { id: 2, airing: releasing })])).toBe(false);
        expect(animeGroupComplete([makeAnime([], { id: 1, airing: finished }), makeAnime([], { id: 2, airing: unknown })])).toBe(false);
    });

    it('is false for a group with no season', () => {
        expect(animeGroupComplete([])).toBe(false);
    });
});

describe('animeLastSeen and mangaLastSeen', () => {
    it('say when an episode of a season of the group was last watched, by its title and audio, and 0 when never', () => {
        const saga = [makeAnime([], { id: 1, title: 'Saga', audio: 'sub' }), makeAnime([], { id: 2, title: 'Saga 2', audio: 'sub' })];
        const history = [makeAnimeHistory({ title: 'Saga', openedAt: 10 }), makeAnimeHistory({ title: 'Saga 2', openedAt: 30 }), makeAnimeHistory({ title: 'Saga', audio: 'dub', openedAt: 99 }), makeAnimeHistory({ title: 'Other', openedAt: 80 })];
        expect(animeLastSeen(saga, history)).toBe(30);
        expect(animeLastSeen([makeAnime([], { title: 'Never' })], history)).toBe(0);
    });

    it('count the moment an episode was watched, not the moment the anime was opened last', () => {
        const saga = [makeAnime([], { id: 1, title: 'Saga', audio: 'sub' })];
        const watchedLongAgoOpenedToday = [makeAnimeHistory({ title: 'Saga', episode: '3', openedAt: 900, watchedAt: 100 })];
        expect(animeLastSeen(saga, watchedLongAgoOpenedToday)).toBe(100);
    });

    it('count an anime that was only opened as never watched', () => {
        const saga = [makeAnime([], { id: 1, title: 'Saga', audio: 'sub' })];
        expect(animeLastSeen(saga, [makeAnimeHistory({ title: 'Saga', episode: null, openedAt: 900, watchedAt: null })])).toBe(0);
        expect(animeLastSeen(saga, [makeAnimeHistory({ title: 'Saga', episode: '2', openedAt: 900, watchedAt: null })])).toBe(0);
    });

    it('take the latest watched moment among the seasons of the group, and ignore what was opened later', () => {
        const saga = [makeAnime([], { id: 1, title: 'Saga', audio: 'sub' }), makeAnime([], { id: 2, title: 'Saga 2', audio: 'sub' })];
        const history = [
            makeAnimeHistory({ id: 1, title: 'Saga', openedAt: 500, watchedAt: 40 }),
            makeAnimeHistory({ id: 2, title: 'Saga 2', episode: null, openedAt: 800, watchedAt: null }),
            makeAnimeHistory({ id: 3, title: 'Saga 2', audio: 'dub', openedAt: 900, watchedAt: 900 })
        ];
        expect(animeLastSeen(saga, history)).toBe(40);
    });

    it('say 0 for an empty history', () => {
        expect(animeLastSeen([makeAnime([], { title: 'Saga' })], [])).toBe(0);
    });

    it('say when a manga of the group was last read, by its id in the library, and 0 when never', () => {
        const epic = [makeLibraryManga([], { id: 5 }), makeLibraryManga([], { id: 6 })];
        const history = [makeReading({ id: 1, libraryMangaId: 5, readAt: 20 }), makeReading({ id: 2, libraryMangaId: 6, readAt: 40 }), makeReading({ id: 3, libraryMangaId: null, readAt: 90 }), makeReading({ id: 4, libraryMangaId: 7, readAt: 70 })];
        expect(mangaLastSeen(epic, history)).toBe(40);
        expect(mangaLastSeen([makeLibraryManga([], { id: 9 })], history)).toBe(0);
    });
});
