import {
    activeJobCount,
    animeErrorKey,
    animeStatusKey,
    downloadedAnime,
    downloadedCount,
    END_MARGIN_SECONDS,
    compareNames,
    groupByDay,
    groupLibrary,
    isNewEpisode,
    isWatched,
    libraryEntry,
    matchesSearch,
    MIN_RESUME_SECONDS,
    newEpisodeCount,
    nextDownloadedEpisode,
    nextFreeOrder,
    orderFor,
    previousDownloadedEpisode,
    resumePosition,
    seasonLabel,
    seriesNames,
    startOfDay,
    WATCHED_RATIO
} from '@renderer/components/animeText';
import type { AnimeEpisodeRecord } from '@shared/anime';
import { createTranslator } from '@shared/i18n';
import { makeAnime, makeAnimeJob, makeEpisode } from '../../helpers/animeFixtures';

describe('constants', () => {
    it('has the thresholds the player relies on', () => {
        expect(MIN_RESUME_SECONDS).toBe(5);
        expect(END_MARGIN_SECONDS).toBe(30);
        expect(WATCHED_RATIO).toBe(0.75);
    });
});

describe('animeErrorKey', () => {
    it.each([
        ['NO_RESULTS', 'anime.error.NO_RESULTS'],
        ['BLOCKED', 'anime.error.BLOCKED'],
        ['NETWORK', 'anime.error.NETWORK'],
        ['NO_SOURCES', 'anime.error.NO_SOURCES'],
        ['EPISODE_NOT_RELEASED', 'anime.error.EPISODE_NOT_RELEASED'],
        ['INVALID_SELECTION', 'anime.error.INVALID_SELECTION'],
        ['BINARY_MISSING', 'anime.error.BINARY_MISSING'],
        ['UNKNOWN', 'anime.error.UNKNOWN']
    ] as const)('maps %s', (code, key) => {
        expect(animeErrorKey(code)).toBe(key);
    });
});

describe('animeStatusKey', () => {
    it.each([
        ['idle', 'anime.status.idle'],
        ['queued', 'anime.status.queued'],
        ['downloading', 'anime.status.downloading'],
        ['running', 'anime.status.downloading'],
        ['paused', 'anime.status.paused'],
        ['done', 'anime.status.done'],
        ['error', 'anime.status.error'],
        ['cancelled', 'anime.status.cancelled']
    ] as const)('maps %s', (status, key) => {
        expect(animeStatusKey(status)).toBe(key);
    });
});

describe('resumePosition', () => {
    it('resumes where it stopped', () => {
        expect(resumePosition(makeEpisode({ positionSeconds: 600, durationSeconds: 1440 }))).toBe(600);
    });

    it('starts from the beginning when almost nothing was watched', () => {
        expect(resumePosition(makeEpisode({ positionSeconds: 4.9, durationSeconds: 1440 }))).toBeNull();
        expect(resumePosition(makeEpisode({ positionSeconds: 5, durationSeconds: 1440 }))).toBe(5);
    });

    it('starts from the beginning when it was watched', () => {
        expect(resumePosition(makeEpisode({ positionSeconds: 600, durationSeconds: 1440, watched: true }))).toBeNull();
    });

    it('starts from the beginning when it was stopped near the end', () => {
        expect(resumePosition(makeEpisode({ positionSeconds: 1411, durationSeconds: 1440 }))).toBeNull();
        expect(resumePosition(makeEpisode({ positionSeconds: 1410, durationSeconds: 1440 }))).toBe(1410);
    });

    it('resumes when the duration is not known yet', () => {
        expect(resumePosition(makeEpisode({ positionSeconds: 600, durationSeconds: 0 }))).toBe(600);
    });
});

describe('isWatched', () => {
    it('is true from 75 percent on', () => {
        expect(isWatched(1080, 1440)).toBe(true);
        expect(isWatched(1296, 1440)).toBe(true);
        expect(isWatched(1440, 1440)).toBe(true);
        expect(isWatched(1079, 1440)).toBe(false);
        expect(isWatched(0, 1440)).toBe(false);
    });

    it('is false when the duration is unknown', () => {
        expect(isWatched(100, 0)).toBe(false);
    });
});

describe('nextDownloadedEpisode', () => {
    const first = makeEpisode({ id: 1, number: '1' });
    const second = makeEpisode({ id: 2, number: '2' });
    const third = makeEpisode({ id: 3, number: '3', status: 'queued' });
    const anime = makeAnime([first, second, third]);

    it('gives the episode that follows when it is downloaded', () => {
        expect(nextDownloadedEpisode([anime], anime, first)).toEqual({ anime, episode: second });
    });

    it('gives null when the next one is not downloaded', () => {
        expect(nextDownloadedEpisode([anime], anime, second)).toBeNull();
    });

    it('gives null after the last episode and for an episode that is not in the anime', () => {
        expect(nextDownloadedEpisode([anime], anime, third)).toBeNull();
        expect(nextDownloadedEpisode([anime], anime, makeEpisode({ id: 99 }))).toBeNull();
    });

    describe('at the end of a season', () => {
        const seasonOne = makeAnime([makeEpisode({ id: 1, number: '1' }), makeEpisode({ id: 2, number: '2' })], { id: 10, series: 'Frieren', season: 1 });
        const emptySeason = makeAnime([makeEpisode({ id: 3, number: '1', status: 'queued' })], { id: 11, series: 'frieren', season: 2 });
        const seasonThree = makeAnime([makeEpisode({ id: 4, number: '1', status: 'error' }), makeEpisode({ id: 5, number: '2' })], { id: 12, series: 'Frieren', season: 3 });
        const library = [seasonThree, seasonOne, emptySeason];

        it('goes to the first downloaded episode of the next season that has one', () => {
            expect(nextDownloadedEpisode(library, seasonOne, seasonOne.episodes[1] as AnimeEpisodeRecord)).toEqual({ anime: seasonThree, episode: seasonThree.episodes[1] });
        });

        it('gives null after the last season', () => {
            expect(nextDownloadedEpisode(library, seasonThree, seasonThree.episodes[1] as AnimeEpisodeRecord)).toBeNull();
        });

        it('does not leave the season when the anime has no series', () => {
            const alone = makeAnime([makeEpisode({ id: 1 })], { id: 20 });
            expect(nextDownloadedEpisode([alone, seasonThree], alone, alone.episodes[0] as AnimeEpisodeRecord)).toBeNull();
        });

        it('ignores seasons of another series or another audio', () => {
            const other = makeAnime([makeEpisode({ id: 6 })], { id: 13, series: 'Naruto', season: 2 });
            const dub = makeAnime([makeEpisode({ id: 7 })], { id: 14, series: 'Frieren', season: 2, audio: 'dub' });
            expect(nextDownloadedEpisode([seasonOne, other, dub], seasonOne, seasonOne.episodes[1] as AnimeEpisodeRecord)).toBeNull();
        });
    });
});

describe('previousDownloadedEpisode', () => {
    const first = makeEpisode({ id: 1, number: '1', status: 'error' });
    const second = makeEpisode({ id: 2, number: '2' });
    const third = makeEpisode({ id: 3, number: '3' });
    const anime = makeAnime([first, second, third]);

    it('gives the episode that comes before when it is downloaded', () => {
        expect(previousDownloadedEpisode([anime], anime, third)).toEqual({ anime, episode: second });
    });

    it('gives null when the previous one is not downloaded', () => {
        expect(previousDownloadedEpisode([anime], anime, second)).toBeNull();
    });

    it('gives null before the first episode and for an episode that is not in the anime', () => {
        expect(previousDownloadedEpisode([anime], anime, first)).toBeNull();
        expect(previousDownloadedEpisode([anime], anime, makeEpisode({ id: 99 }))).toBeNull();
    });

    describe('at the start of a season', () => {
        const seasonOne = makeAnime([makeEpisode({ id: 1, number: '1' }), makeEpisode({ id: 2, number: '2' })], { id: 10, series: 'Frieren', season: 1 });
        const seasonTwo = makeAnime([makeEpisode({ id: 3, number: '1' })], { id: 11, series: 'Frieren', season: 2 });
        const library = [seasonTwo, seasonOne];

        it('goes to the last downloaded episode of the previous season', () => {
            expect(previousDownloadedEpisode(library, seasonTwo, seasonTwo.episodes[0] as AnimeEpisodeRecord)).toEqual({ anime: seasonOne, episode: seasonOne.episodes[1] });
        });

        it('gives null before the first season', () => {
            expect(previousDownloadedEpisode(library, seasonOne, seasonOne.episodes[0] as AnimeEpisodeRecord)).toBeNull();
        });
    });
});

describe('downloadedCount', () => {
    it('counts only the downloaded episodes', () => {
        const anime = makeAnime([makeEpisode({ id: 1 }), makeEpisode({ id: 2, status: 'error' }), makeEpisode({ id: 3 }), makeEpisode({ id: 4, status: 'queued' }), makeEpisode({ id: 5, status: 'idle' })]);
        expect(downloadedCount(anime)).toBe(2);
        expect(downloadedCount(makeAnime([]))).toBe(0);
    });
});

describe('downloadedAnime', () => {
    const SUB = makeAnime([makeEpisode({ id: 1 })], { id: 1, title: 'Naruto', audio: 'sub' });
    const DUB = makeAnime([makeEpisode({ id: 2, status: 'error' })], { id: 2, title: 'Naruto', audio: 'dub' });
    const EMPTY = makeAnime([], { id: 3, title: 'Bleach', audio: 'sub' });

    it('finds the anime with that title and audio when it has a downloaded episode', () => {
        expect(downloadedAnime([SUB, DUB, EMPTY], 'Naruto', 'sub')).toBe(SUB);
    });

    it('gives null when it has nothing downloaded, is in another audio or is not there', () => {
        expect(downloadedAnime([SUB, DUB, EMPTY], 'Naruto', 'dub')).toBeNull();
        expect(downloadedAnime([SUB, DUB, EMPTY], 'Bleach', 'sub')).toBeNull();
        expect(downloadedAnime([SUB], 'Naruto', 'dub')).toBeNull();
        expect(downloadedAnime([SUB], 'One Piece', 'sub')).toBeNull();
        expect(downloadedAnime([], 'Naruto', 'sub')).toBeNull();
    });
});

describe('matchesSearch', () => {
    it('matches everything when nothing is typed', () => {
        expect(matchesSearch('Naruto', '')).toBe(true);
        expect(matchesSearch('Naruto', '   ')).toBe(true);
        expect(matchesSearch('', '')).toBe(true);
    });

    it('finds a part of the title, wherever it is', () => {
        expect(matchesSearch('Cyberpunk: Edgerunners', 'cyber')).toBe(true);
        expect(matchesSearch('Cyberpunk: Edgerunners', 'runners')).toBe(true);
        expect(matchesSearch('Cyberpunk: Edgerunners', 'punk: edge')).toBe(true);
        expect(matchesSearch('Cyberpunk: Edgerunners', 'Cyberpunk: Edgerunners')).toBe(true);
    });

    it('does not mind the case, the accents or the spaces around', () => {
        expect(matchesSearch('NARUTO', 'naruto')).toBe(true);
        expect(matchesSearch('naruto', 'NARUTO')).toBe(true);
        expect(matchesSearch('Pokémon', 'pokemon')).toBe(true);
        expect(matchesSearch('Pokemon', 'POKÉMON')).toBe(true);
        expect(matchesSearch('Naruto', '  naruto  ')).toBe(true);
    });

    it('does not match what is not in the title', () => {
        expect(matchesSearch('Naruto', 'bleach')).toBe(false);
        expect(matchesSearch('Naruto', 'narutos')).toBe(false);
        expect(matchesSearch('', 'a')).toBe(false);
    });

    it('works with other alphabets', () => {
        expect(matchesSearch('進撃の巨人', '巨人')).toBe(true);
        expect(matchesSearch('進撃の巨人', '鬼滅')).toBe(false);
    });
});

describe('seriesNames', () => {
    it('lists each series once, whatever the case or the accents, in alphabetical order', () => {
        const library = [
            makeAnime([], { id: 1, title: 'Pokémon', series: 'Pokémon', season: 1 }),
            makeAnime([], { id: 2, title: 'Pokemon 2', series: 'POKEMON', season: 2 }),
            makeAnime([], { id: 3, title: 'Bleach', series: 'Bleach', season: 1 }),
            makeAnime([], { id: 4, title: 'Alone' })
        ];
        expect(seriesNames(library)).toEqual(['Bleach', 'Pokémon']);
    });

    it('is empty when nothing is in a series', () => {
        expect(seriesNames([])).toEqual([]);
        expect(seriesNames([makeAnime([])])).toEqual([]);
    });
});

describe('groupLibrary', () => {
    it('joins the seasons of a series in order and leaves the others as cards of their own', () => {
        const library = [
            makeAnime([], { id: 1, title: 'Bleach', series: 'Bleach', season: 1 }),
            makeAnime([], { id: 2, title: 'Naruto' }),
            makeAnime([], { id: 3, title: 'Bleach Season 3', series: 'bleach', season: 3 }),
            makeAnime([], { id: 4, title: 'Bleach Season 2', series: 'Bleach', season: 2 })
        ];
        expect(
            groupLibrary(library).map((group) => {
                return [group.key, group.series, group.entries.map((entry) => { return entry.id; })];
            })
        ).toEqual([
            ['series-bleach', 'Bleach', [1, 4, 3]],
            ['anime-2', 'Naruto', [2]]
        ]);
    });

    it('puts the sub and the dub of one season side by side', () => {
        const library = [
            makeAnime([], { id: 1, title: 'Bleach', audio: 'sub', series: 'Bleach', season: 1 }),
            makeAnime([], { id: 2, title: 'Bleach', audio: 'dub', series: 'Bleach', season: 1 }),
            makeAnime([], { id: 3, title: 'Bleach 2', audio: 'sub', series: 'Bleach', season: 2 })
        ];
        expect(groupLibrary(library)[0]?.entries.map((entry) => { return entry.id; })).toEqual([2, 1, 3]);
    });

    it('does not join an anime that has a series but no season, or a season but no series', () => {
        const library = [makeAnime([], { id: 1, title: 'A', series: 'S', season: null }), makeAnime([], { id: 2, title: 'B', series: null, season: 2 })];
        expect(
            groupLibrary(library).map((group) => {
                return group.series;
            })
        ).toEqual(['A', 'B']);
    });

    it('orders the cards alphabetically (a series by its name) and the seasons by their place, never by their names', () => {
        const library = [
            makeAnime([], { id: 1, title: 'Zeta' }),
            makeAnime([], { id: 2, title: 'B Two', series: 'Beta', season: 2, seasonName: 'Aaa' }),
            makeAnime([], { id: 3, title: 'alpha' }),
            makeAnime([], { id: 4, title: 'B One', series: 'Beta', season: 1, seasonName: 'Zzz' })
        ];
        expect(
            groupLibrary(library).map((group) => {
                return [group.series, group.entries.map((entry) => { return entry.id; })];
            })
        ).toEqual([
            ['alpha', [3]],
            ['Beta', [4, 2]],
            ['Zeta', [1]]
        ]);
    });

    it('keeps an anime that is alone in its series as a series of one season', () => {
        const library = [makeAnime([], { id: 1, title: 'Frieren Season 2', series: 'Frieren', season: 2 }), makeAnime([], { id: 2, title: 'Naruto' })];
        expect(
            groupLibrary(library).map((group) => {
                return [group.key, group.series, group.entries.length];
            })
        ).toEqual([
            ['series-frieren', 'Frieren', 1],
            ['anime-2', 'Naruto', 1]
        ]);
    });

    it('is empty for an empty library', () => {
        expect(groupLibrary([])).toEqual([]);
    });
});

describe('compareNames', () => {
    it('orders alphabetically without regard to case or accents, and numbers by their value', () => {
        const names = ['zebra', 'Árvore', 'apple', 'Naruto 10', 'Naruto 2', 'Banana', 'banana'];
        expect([...names].sort(compareNames)).toEqual(['apple', 'Árvore', 'Banana', 'banana', 'Naruto 2', 'Naruto 10', 'zebra']);
    });

    it('is zero for names that only differ in case or accents', () => {
        expect(compareNames('Pokémon', 'POKEMON')).toBe(0);
        expect(compareNames('a', 'b')).toBeLessThan(0);
        expect(compareNames('b', 'a')).toBeGreaterThan(0);
    });
});

describe('seasonLabel', () => {
    const t = createTranslator('en');

    it('is the name the anime was given in its series, otherwise its place in it', () => {
        expect(seasonLabel(makeAnime([], { series: 'Bleach', season: 2, seasonName: 'Blood War' }), t)).toBe('Blood War');
        expect(seasonLabel(makeAnime([], { series: 'Bleach', season: 2, seasonName: null }), t)).toBe('SEASON 2');
        expect(seasonLabel(makeAnime([], { series: null, season: null }), t)).toBe('SEASON 1');
    });

    it('is written in the language of the app', () => {
        expect(seasonLabel(makeAnime([], { series: 'Bleach', season: 3 }), createTranslator('pt'))).toBe('TEMPORADA 3');
    });
});

describe('libraryEntry', () => {
    it('finds the anime of the library with that title and audio, downloaded or not', () => {
        const sub = makeAnime([], { id: 1, title: 'Naruto', audio: 'sub' });
        const dub = makeAnime([], { id: 2, title: 'Naruto', audio: 'dub' });
        expect(libraryEntry([sub, dub], 'Naruto', 'dub')).toBe(dub);
        expect(libraryEntry([sub], 'Naruto', 'dub')).toBeNull();
        expect(libraryEntry([sub], 'Bleach', 'sub')).toBeNull();
    });
});

describe('activeJobCount', () => {
    it('counts the downloads that are running or waiting', () => {
        expect(
            activeJobCount([
                makeAnimeJob({ episodeId: 1, status: 'running' }),
                makeAnimeJob({ episodeId: 2, status: 'queued' }),
                makeAnimeJob({ episodeId: 3, status: 'done' }),
                makeAnimeJob({ episodeId: 4, status: 'error' }),
                makeAnimeJob({ episodeId: 5, status: 'cancelled' })
            ])
        ).toBe(2);
        expect(activeJobCount([])).toBe(0);
    });
});

describe('startOfDay', () => {
    it('gives the first moment of the day of the computer, whatever the time of day', () => {
        const first = new Date(2026, 9, 7, 0, 0, 0, 0).getTime();

        expect(startOfDay(new Date(2026, 9, 7, 0, 0, 0, 0).getTime())).toBe(first);
        expect(startOfDay(new Date(2026, 9, 7, 13, 45, 30, 500).getTime())).toBe(first);
        expect(startOfDay(new Date(2026, 9, 7, 23, 59, 59, 999).getTime())).toBe(first);
        expect(startOfDay(new Date(2026, 9, 8, 0, 0, 0, 0).getTime())).toBe(new Date(2026, 9, 8, 0, 0, 0, 0).getTime());
    });
});

describe('groupByDay', () => {
    const MORNING = new Date(2026, 9, 7, 9, 0, 0).getTime();
    const EVENING = new Date(2026, 9, 7, 21, 0, 0).getTime();
    const NEXT_DAY = new Date(2026, 9, 8, 8, 0, 0).getTime();

    it('splits a list by the day of each time, keeping the order and the entries of a day together', () => {
        const entries = [
            { name: 'a', at: EVENING },
            { name: 'b', at: MORNING },
            { name: 'c', at: NEXT_DAY }
        ];

        expect(
            groupByDay(entries, (entry) => {
                return entry.at;
            })
        ).toEqual([
            { day: startOfDay(MORNING), entries: [entries[0], entries[1]] },
            { day: startOfDay(NEXT_DAY), entries: [entries[2]] }
        ]);
    });

    it('makes a new group when a day comes back, as the list is only split where the day changes', () => {
        const entries = [
            { name: 'a', at: MORNING },
            { name: 'b', at: NEXT_DAY },
            { name: 'c', at: EVENING }
        ];

        expect(
            groupByDay(entries, (entry) => {
                return entry.at;
            }).map((group) => {
                return group.entries.map((entry) => {
                    return entry.name;
                });
            })
        ).toEqual([['a'], ['b'], ['c']]);
    });

    it('gives no group for an empty list', () => {
        expect(
            groupByDay([], () => {
                return 0;
            })
        ).toEqual([]);
    });
});

describe('isNewEpisode', () => {
    const NOW = new Date(2026, 9, 7, 12, 0, 0).getTime();

    it('is new when the check put it in the library today, at any time of the day', () => {
        expect(isNewEpisode({ addedAt: new Date(2026, 9, 7, 0, 0, 0).getTime() }, NOW)).toBe(true);
        expect(isNewEpisode({ addedAt: NOW }, NOW)).toBe(true);
        expect(isNewEpisode({ addedAt: new Date(2026, 9, 7, 23, 59, 59).getTime() }, NOW)).toBe(true);
    });

    it('is not new from the day after the one it arrived on', () => {
        expect(isNewEpisode({ addedAt: new Date(2026, 9, 6, 23, 59, 59).getTime() }, NOW)).toBe(false);
        expect(isNewEpisode({ addedAt: NOW - 3 * 24 * 60 * 60 * 1000 }, NOW)).toBe(false);
        expect(isNewEpisode({ addedAt: new Date(2026, 9, 8, 0, 0, 0).getTime() }, NOW)).toBe(false);
    });

    it('is not new when the library came with it', () => {
        expect(isNewEpisode({ addedAt: null }, NOW)).toBe(false);
    });

    it('takes today from the clock when no time is given', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        try {
            expect(isNewEpisode({ addedAt: NOW - 60 * 1000 })).toBe(true);
            expect(isNewEpisode({ addedAt: NOW - 24 * 60 * 60 * 1000 })).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('newEpisodeCount', () => {
    const NOW = new Date(2026, 9, 7, 12, 0, 0).getTime();

    it('counts the episodes of the anime that arrived today', () => {
        const anime = makeAnime([
            makeEpisode({ id: 1, number: '1', addedAt: null }),
            makeEpisode({ id: 2, number: '2', addedAt: NOW - 1000 }),
            makeEpisode({ id: 3, number: '3', addedAt: NOW }),
            makeEpisode({ id: 4, number: '4', addedAt: NOW - 2 * 24 * 60 * 60 * 1000 })
        ]);

        expect(newEpisodeCount(anime, NOW)).toBe(2);
    });

    it('is zero for an anime with no new episode or no episode at all', () => {
        expect(newEpisodeCount(makeAnime([makeEpisode({ addedAt: null })]), NOW)).toBe(0);
        expect(newEpisodeCount(makeAnime([]), NOW)).toBe(0);
    });

    it('takes today from the clock when no time is given', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        try {
            expect(newEpisodeCount(makeAnime([makeEpisode({ addedAt: NOW - 1000 })]))).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('nextFreeOrder', () => {
    it('is 1 for a series that uses none', () => {
        expect(nextFreeOrder([])).toBe(1);
    });

    it('is the order after the last one the series uses, whatever the order they come in', () => {
        expect(nextFreeOrder([1])).toBe(2);
        expect(nextFreeOrder([3, 1, 2])).toBe(4);
    });

    it('does not fill a gap: it goes after the last one', () => {
        expect(nextFreeOrder([1, 3])).toBe(4);
        expect(nextFreeOrder([5])).toBe(6);
    });
});

describe('orderFor', () => {
    it('keeps the order wanted when the series does not use it', () => {
        expect(orderFor([1, 3], 2)).toBe(2);
        expect(orderFor([], 1)).toBe(1);
        expect(orderFor([2], 1)).toBe(1);
    });

    it('gives the next order when the series uses the one wanted', () => {
        expect(orderFor([1], 1)).toBe(2);
        expect(orderFor([1, 3], 1)).toBe(4);
        expect(orderFor([1, 2, 3], 2)).toBe(4);
    });

    it('keeps the order wanted when there is no next one to give (the last order is the largest there is)', () => {
        expect(orderFor([99], 99)).toBe(99);
        expect(orderFor([98], 98)).toBe(99);
    });
});
