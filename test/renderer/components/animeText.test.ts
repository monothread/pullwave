import {
    activeJobCount,
    animeErrorKey,
    animeStatusKey,
    downloadedAnime,
    downloadedCount,
    END_MARGIN_SECONDS,
    compareNames,
    groupLibrary,
    isWatched,
    libraryEntry,
    matchesSearch,
    MIN_RESUME_SECONDS,
    nextDownloadedEpisode,
    previousDownloadedEpisode,
    resumePosition,
    seasonLabel,
    seriesNames,
    WATCHED_RATIO
} from '@renderer/components/animeText';
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
        expect(nextDownloadedEpisode(anime, first)).toBe(second);
    });

    it('gives null when the next one is not downloaded', () => {
        expect(nextDownloadedEpisode(anime, second)).toBeNull();
    });

    it('gives null after the last episode and for an episode that is not in the anime', () => {
        expect(nextDownloadedEpisode(anime, third)).toBeNull();
        expect(nextDownloadedEpisode(anime, makeEpisode({ id: 99 }))).toBeNull();
    });
});

describe('previousDownloadedEpisode', () => {
    const first = makeEpisode({ id: 1, number: '1', status: 'error' });
    const second = makeEpisode({ id: 2, number: '2' });
    const third = makeEpisode({ id: 3, number: '3' });
    const anime = makeAnime([first, second, third]);

    it('gives the episode that comes before when it is downloaded', () => {
        expect(previousDownloadedEpisode(anime, third)).toBe(second);
    });

    it('gives null when the previous one is not downloaded', () => {
        expect(previousDownloadedEpisode(anime, second)).toBeNull();
    });

    it('gives null before the first episode and for an episode that is not in the anime', () => {
        expect(previousDownloadedEpisode(anime, first)).toBeNull();
        expect(previousDownloadedEpisode(anime, makeEpisode({ id: 99 }))).toBeNull();
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
