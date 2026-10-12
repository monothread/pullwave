import { CONTENT_WARNINGS, MANGA_CHAPTER_STATUSES, MANGA_STATUSES, type MangaErrorCode } from '@shared/manga';
import type { ToolErrorCode } from '@shared/tools';
import { createTranslator } from '@shared/i18n';
import {
    ALL_LANGUAGES,
    activeJobCount,
    chapterState,
    chapterStatusKey,
    compareNames,
    continueIndex,
    downloadedCount,
    downloadedTotals,
    groupLibrary,
    inGroup,
    isNewChapter,
    newChapterCount,
    matchesSearch,
    seasonLabel,
    seriesNames,
    extensionLanguages,
    filterExtensions,
    isCloudflareError,
    isListed,
    listedSources,
    jobStatusKey,
    STORE_PLACEHOLDER,
    libraryEntry,
    mangaErrorKey,
    mangaStatusKey,
    toolErrorKey
} from '@renderer/components/mangaText';
import { makeChapterRecord, makeExtension, makeLibraryManga, makeMangaJob, makeSource } from '../../helpers/mangaFixtures';

const t = createTranslator('en');

describe('the keys of the texts', () => {
    const ERROR_CODES: MangaErrorCode[] = ['SERVER_UNAVAILABLE', 'REQUEST_FAILED', 'API_ERROR', 'INVALID_RESPONSE', 'INVALID_REQUEST', 'NOT_FOUND', 'EMPTY_CHAPTER', 'IMAGE', 'DISK', 'UNKNOWN'];
    const TOOL_CODES: ToolErrorCode[] = ['UNSUPPORTED_PLATFORM', 'DOWNLOAD_FAILED', 'HASH_MISMATCH', 'EXTRACT_FAILED', 'INCOMPLETE', 'DISK'];

    it.each(ERROR_CODES)('has a text for the error %s', (code) => {
        expect(mangaErrorKey(code)).toBe(`manga.error.${code}`);
        expect(t(mangaErrorKey(code))).not.toMatch(/^manga\./);
    });

    it.each(TOOL_CODES)('has a text for the setup error %s', (code) => {
        expect(toolErrorKey(code)).toBe(`manga.setup.error.${code}`);
        expect(t(toolErrorKey(code))).not.toMatch(/^manga\./);
    });

    it.each(MANGA_CHAPTER_STATUSES)('has a text for the chapter state %s', (status) => {
        expect(chapterStatusKey(status)).toBe(`manga.chapter.status.${status}`);
        expect(t(chapterStatusKey(status)).length).toBeGreaterThan(0);
    });

    it.each(['queued', 'running', 'paused', 'done', 'error', 'cancelled'] as const)('has a text for the job state %s', (status) => {
        expect(jobStatusKey(status)).toBe(`manga.jobs.status.${status}`);
        expect(t(jobStatusKey(status)).length).toBeGreaterThan(0);
    });

    it.each(MANGA_STATUSES)('has a text for the manga status %s', (status) => {
        expect(mangaStatusKey(status)).toBe(`manga.detail.status.${status}`);
        expect(t(mangaStatusKey(status)).length).toBeGreaterThan(0);
    });

    it('knows the content warnings it can meet', () => {
        expect(CONTENT_WARNINGS).toEqual(['SAFE', 'MIXED', 'NSFW']);
    });
});

describe('library helpers', () => {
    const library = [
        makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 11, status: 'done' }), makeChapterRecord({ id: 2, remoteId: 12, status: 'error' }), makeChapterRecord({ id: 3, remoteId: 13, status: 'idle' })]),
        makeLibraryManga([], { id: 2, sourceId: '999', remoteId: 8, title: 'Bleach' })
    ];

    it('finds the manga of a source in the library', () => {
        expect(libraryEntry(library, '123', 7)?.title).toBe('One Piece');
        expect(libraryEntry(library, '999', 8)?.title).toBe('Bleach');
    });

    it('does not mix the same number of two sources, nor find what is not there', () => {
        expect(libraryEntry(library, '999', 7)).toBeNull();
        expect(libraryEntry(library, '123', 8)).toBeNull();
        expect(libraryEntry([], '123', 7)).toBeNull();
    });

    it('counts the chapters that are downloaded', () => {
        expect(downloadedCount(library[0]!)).toBe(1);
        expect(downloadedCount(library[1]!)).toBe(0);
    });

    it('finds the state of a chapter of a manga of the library', () => {
        expect(chapterState(library[0]!, 12)?.status).toBe('error');
        expect(chapterState(library[0]!, 99)).toBeNull();
        expect(chapterState(null, 11)).toBeNull();
    });

    it('counts the downloads that are waiting or going on', () => {
        const jobs = (['queued', 'running', 'paused', 'done', 'error', 'cancelled'] as const).map((status, index) => {
            return makeMangaJob({ chapterId: index + 1, status });
        });
        expect(activeJobCount(jobs)).toBe(2);
        expect(activeJobCount([])).toBe(0);
    });
});

describe('extension helpers', () => {
    const extensions = [
        makeExtension({ pkgName: 'a', name: 'Zeta', lang: 'en' }),
        makeExtension({ pkgName: 'b', name: 'Alpha', lang: 'pt', isInstalled: true }),
        makeExtension({ pkgName: 'c', name: 'Beta', lang: 'en', isInstalled: true }),
        makeExtension({ pkgName: 'd', name: 'Gamma', lang: 'ja' })
    ];
    const everything = { query: '', lang: ALL_LANGUAGES, onlyInstalled: false };

    function names(filter: Partial<typeof everything>): string[] {
        return filterExtensions(extensions, { ...everything, ...filter }, true).map((extension) => {
            return extension.name;
        });
    }

    it('puts the installed ones first, then sorts by name', () => {
        expect(names({})).toEqual(['Alpha', 'Beta', 'Gamma', 'Zeta']);
    });

    it('filters by text, ignoring case and spaces around', () => {
        expect(names({ query: '  ALP ' })).toEqual(['Alpha']);
        expect(names({ query: 'a' })).toEqual(['Alpha', 'Beta', 'Gamma', 'Zeta']);
        expect(names({ query: 'zzz' })).toEqual([]);
    });

    it('filters by language and by what is installed', () => {
        expect(names({ lang: 'en' })).toEqual(['Beta', 'Zeta']);
        expect(names({ onlyInstalled: true })).toEqual(['Alpha', 'Beta']);
        expect(names({ lang: 'en', onlyInstalled: true, query: 'bet' })).toEqual(['Beta']);
    });

    it('does not change the list it is given', () => {
        const before = extensions.map((extension) => {
            return extension.pkgName;
        });
        filterExtensions(extensions, everything, true);
        expect(
            extensions.map((extension) => {
                return extension.pkgName;
            })
        ).toEqual(before);
    });

    it('hides the extensions for adults unless they are asked for', () => {
        const withAdult = [...extensions, makeExtension({ pkgName: 'e', name: 'Adult', lang: 'en', contentWarning: 'NSFW' }), makeExtension({ pkgName: 'f', name: 'Mixed', lang: 'en', contentWarning: 'MIXED' })];
        const listed = (showAdult: boolean): string[] => {
            return filterExtensions(withAdult, everything, showAdult).map((extension) => {
                return extension.name;
            });
        };
        expect(listed(false)).toEqual(['Alpha', 'Beta', 'Gamma', 'Mixed', 'Zeta']);
        expect(listed(true)).toEqual(['Alpha', 'Beta', 'Adult', 'Gamma', 'Mixed', 'Zeta']);
    });

    it('lists the languages once each, sorted', () => {
        expect(extensionLanguages(extensions)).toEqual(['en', 'ja', 'pt']);
        expect(extensionLanguages([])).toEqual([]);
    });

    it('shows an example address that is not the one of any store', () => {
        expect(STORE_PLACEHOLDER).toBe('https://example.com/extensions/index.min.json');
    });
});

describe('isCloudflareError', () => {
    it.each([
        ['Exception while fetching data (/fetchSourceManga) : Cloudflare bypass currently disabled'],
        ['cloudflare challenge failed'],
        ['Blocked by CLOUDFLARE']
    ])('knows %j is about Cloudflare', (message) => {
        expect(isCloudflareError({ message })).toBe(true);
    });

    it.each([[''], ['Empty list doesn\'t contain element at index 0.'], ['timeout'], ['Source not found']])('knows %j is not', (message) => {
        expect(isCloudflareError({ message })).toBe(false);
    });
});

describe('content for adults', () => {
    it.each([
        ['SAFE', false, true],
        ['MIXED', false, true],
        ['NSFW', false, false],
        ['SAFE', true, true],
        ['MIXED', true, true],
        ['NSFW', true, true]
    ] as const)('lists %s content with the choice %j: %j', (warning, showAdult, expected) => {
        expect(isListed(warning, showAdult)).toBe(expected);
    });

    it('keeps the sources that are not for adults, in their order, unless the adult ones are asked for', () => {
        const sources = [makeSource({ id: '1', contentWarning: 'SAFE' }), makeSource({ id: '2', contentWarning: 'NSFW' }), makeSource({ id: '3', contentWarning: 'MIXED' })];
        expect(
            listedSources(sources, false).map((source) => {
                return source.id;
            })
        ).toEqual(['1', '3']);
        expect(listedSources(sources, true)).toEqual(sources);
        expect(listedSources([], false)).toEqual([]);
    });
});

describe('grouping the library by series', () => {
    const t = createTranslator('en');
    const one = makeLibraryManga([makeChapterRecord({ id: 1, status: 'done' })], { id: 1, title: 'Frieren', series: 'Sousou no Frieren', season: 1 });
    const two = makeLibraryManga([makeChapterRecord({ id: 2, status: 'idle' }), makeChapterRecord({ id: 3, status: 'done' })], { id: 2, title: 'Frieren Season 2', series: 'sousou  no frieren', season: 2, seasonName: 'Beyond' });
    const alone = makeLibraryManga([], { id: 3, title: 'bleach' });
    const apple = makeLibraryManga([], { id: 4, title: 'Álbum', series: 'Álbum', season: 1 });

    it('puts the seasons of a series in one card, in their order, the series written however the library has it', () => {
        const cards = groupLibrary([two, one]);
        expect(cards).toEqual([{ key: 'series-sousou no frieren', series: 'sousou  no frieren', entries: [one, two] }]);
        expect(groupLibrary([one, two])[0]?.series).toBe('Sousou no Frieren');
    });

    it('makes a card of its own for a manga that is on its own, with its title as the name', () => {
        expect(groupLibrary([alone])).toEqual([{ key: 'manga-3', series: 'bleach', entries: [alone] }]);
    });

    it('treats a manga with a series but no season as being on its own', () => {
        const odd = makeLibraryManga([], { id: 5, title: 'Odd', series: 'Odd', season: null });
        expect(groupLibrary([odd])[0]?.key).toBe('manga-5');
    });

    it('orders the cards alphabetically, without regard to case or accents, and numbers by their value', () => {
        const ten = makeLibraryManga([], { id: 6, title: 'Naruto 10' });
        const nine = makeLibraryManga([], { id: 7, title: 'Naruto 9' });
        expect(groupLibrary([ten, one, apple, alone, nine]).map((card) => {return card.series})).toEqual(['Álbum', 'bleach', 'Naruto 9', 'Naruto 10', 'Sousou no Frieren']);
    });

    it('keeps the order of the seasons even when two have the same place', () => {
        const twin = makeLibraryManga([], { id: 9, title: 'Twin', series: 'Sousou no Frieren', season: 1 });
        expect(groupLibrary([twin, one])[0]?.entries.map((manga) => {return manga.id})).toEqual([1, 9]);
    });

    it('gives nothing for an empty library, and does not change the one it is given', () => {
        expect(groupLibrary([])).toEqual([]);
        const library = [two, one];
        groupLibrary(library);
        expect(library).toEqual([two, one]);
    });

    it('labels a season by the name the user gave it, otherwise by its place', () => {
        expect(seasonLabel(two, t)).toBe('Beyond');
        expect(seasonLabel(one, t)).toBe('SEASON 1');
        expect(seasonLabel(alone, t)).toBe('SEASON 1');
        expect(seasonLabel({ season: 4, seasonName: null }, t)).toBe('SEASON 4');
    });

    it('compares names without regard to case or accents, and numbers by their value', () => {
        expect(compareNames('a', 'B')).toBeLessThan(0);
        expect(compareNames('Ábaco', 'abaco')).toBe(0);
        expect(compareNames('Naruto 2', 'Naruto 10')).toBeLessThan(0);
    });

    it('matches what was typed without regard to case or accents, and an empty search matches everything', () => {
        expect(matchesSearch('Sousou no FRIEREN', 'frieren')).toBe(true);
        expect(matchesSearch('Álbum', '  album ')).toBe(true);
        expect(matchesSearch('Bleach', 'frieren')).toBe(false);
        expect(matchesSearch('Bleach', '')).toBe(true);
        expect(matchesSearch('Bleach', '   ')).toBe(true);
    });

    it('limits the library to a group, or gives all of it', () => {
        const inside = makeLibraryManga([], { id: 1, groupIds: [1, 2] });
        const other = makeLibraryManga([], { id: 2, groupIds: [2] });
        const none = makeLibraryManga([], { id: 3, groupIds: [] });
        expect(inGroup([inside, other, none], null)).toEqual([inside, other, none]);
        expect(inGroup([inside, other, none], 1)).toEqual([inside]);
        expect(inGroup([inside, other, none], 2)).toEqual([inside, other]);
        expect(inGroup([inside, other, none], 9)).toEqual([]);
    });

    it('counts the chapters downloaded and all of them in several mangas', () => {
        expect(downloadedTotals([one, two, alone])).toEqual({ done: 2, total: 3 });
        expect(downloadedTotals([])).toEqual({ done: 0, total: 0 });
    });

    it('lists the names of the series once each, as the library spells them, in order', () => {
        expect(seriesNames([two, one, alone, apple])).toEqual(['Álbum', 'sousou  no frieren']);
        expect(seriesNames([one, two])).toEqual(['Sousou no Frieren']);
        expect(seriesNames([])).toEqual([]);
    });
});

describe('continueIndex', () => {
    const chapters = [{ remoteId: 11 }, { remoteId: 12 }, { remoteId: 13 }];
    const none = (): boolean => {
        return false;
    };
    const reading = (...read: number[]): ((remoteId: number) => boolean) => {
        return (remoteId) => {
            return read.includes(remoteId);
        };
    };

    it('is the chapter the manga was left on, when it is not read', () => {
        expect(continueIndex(chapters, none, 12)).toBe(1);
        expect(continueIndex(chapters, reading(11), 13)).toBe(2);
    });

    it('is the first chapter that is not read when the one it was left on is read, or is not there, or there is none', () => {
        expect(continueIndex(chapters, reading(11, 12), 12)).toBe(2);
        expect(continueIndex(chapters, reading(11), 99)).toBe(1);
        expect(continueIndex(chapters, reading(11), null)).toBe(1);
        expect(continueIndex(chapters, none, null)).toBe(0);
    });

    it('is the first chapter when everything is read', () => {
        expect(continueIndex(chapters, reading(11, 12, 13), 13)).toBe(0);
    });

    it('is -1 when there are no chapters', () => {
        expect(continueIndex([], none, 12)).toBe(-1);
    });
});

describe('new chapters', () => {
    const NOW = new Date(2026, 9, 11, 15, 0, 0).getTime();
    const HOUR = 3_600_000;
    const DAY = 24 * HOUR;

    it('is a chapter the source published today', () => {
        expect(isNewChapter({ addedAt: null, dateUploaded: NOW - HOUR }, NOW)).toBe(true);
        expect(isNewChapter({ addedAt: null, dateUploaded: new Date(2026, 9, 11, 0, 0, 1).getTime() }, NOW)).toBe(true);
        expect(isNewChapter({ addedAt: NOW, dateUploaded: NOW }, NOW)).toBe(true);
    });

    it('is not a chapter the source published on another day, even if it arrived in the library today', () => {
        expect(isNewChapter({ addedAt: NOW - HOUR, dateUploaded: new Date(2025, 8, 20).getTime() }, NOW)).toBe(false);
        expect(isNewChapter({ addedAt: NOW, dateUploaded: new Date(2026, 9, 10, 23, 59, 59).getTime() }, NOW)).toBe(false);
        expect(isNewChapter({ addedAt: null, dateUploaded: NOW - 3 * DAY }, NOW)).toBe(false);
        expect(isNewChapter({ addedAt: null, dateUploaded: NOW + DAY }, NOW)).toBe(false);
    });

    it('goes by the day it arrived in the library when the source gives no date', () => {
        expect(isNewChapter({ addedAt: NOW - HOUR, dateUploaded: null }, NOW)).toBe(true);
        expect(isNewChapter({ addedAt: new Date(2026, 9, 11, 0, 0, 1).getTime(), dateUploaded: null }, NOW)).toBe(true);
        expect(isNewChapter({ addedAt: new Date(2026, 9, 10, 23, 59, 59).getTime(), dateUploaded: null }, NOW)).toBe(false);
        expect(isNewChapter({ addedAt: NOW - 3 * DAY, dateUploaded: null }, NOW)).toBe(false);
        expect(isNewChapter({ addedAt: NOW + DAY, dateUploaded: null }, NOW)).toBe(false);
    });

    it('is not a chapter with neither a date of the source nor a time of arrival', () => {
        expect(isNewChapter({ addedAt: null, dateUploaded: null }, NOW)).toBe(false);
    });

    it('uses the time of now when it is not given', () => {
        expect(isNewChapter({ addedAt: null, dateUploaded: Date.now() })).toBe(true);
        expect(isNewChapter({ addedAt: null, dateUploaded: Date.now() - 3 * DAY })).toBe(false);
        expect(isNewChapter({ addedAt: Date.now(), dateUploaded: null })).toBe(true);
    });

    it('counts the new chapters of several mangas', () => {
        const one = makeLibraryManga([makeChapterRecord({ id: 1, addedAt: NOW - HOUR, dateUploaded: null }), makeChapterRecord({ id: 2, addedAt: NOW - 2 * DAY }), makeChapterRecord({ id: 3, addedAt: NOW - HOUR })]);
        const two = makeLibraryManga([makeChapterRecord({ id: 4, addedAt: NOW - HOUR }), makeChapterRecord({ id: 5, addedAt: null })], { id: 2 });
        expect(newChapterCount([one, two], NOW)).toBe(3);
        expect(newChapterCount([one], NOW)).toBe(2);
        expect(newChapterCount([two], NOW)).toBe(1);
        expect(newChapterCount([], NOW)).toBe(0);
    });
});
