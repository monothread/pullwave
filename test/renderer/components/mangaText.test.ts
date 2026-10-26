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
    activeGroup,
    checksForSource,
    sourceScope,
    type SourceScopeState,
    chapterLabel,
    groupByDay,
    nextSeason,
    takenSeasons,
    canDownload,
    downloadablePicks,
    localDetails,
    withLibraryChapters,
    newChapterCount,
    matchesSearch,
    matchesManga,
    searchMatchesByTab,
    readerChapters,
    compareChaptersAscending,
    adjacentSeason,
    neighbourChapter,
    seasonLabel,
    seriesNames,
    extensionLanguages,
    filterExtensions,
    isCloudflareError,
    isListed,
    listedSources,
    jobStatusKey,
    STORE_PLACEHOLDER,
    libraryEntriesByTitle,
    libraryEntry,
    sourceIsMissing,
    sourceLabelsOf,
    otherSourceNames,
    mangaErrorKey,
    mangaErrorTextKey,
    mangaStatusKey,
    technicalErrorText,
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

    it.each(ERROR_CODES)('uses the text of the code for the error %s when nothing more is known', (code) => {
        expect(mangaErrorTextKey({ code, message: 'something else' })).toBe(`manga.error.${code}`);
    });

    it('explains that a source handed over no pages when the extension could not find the list of pages', () => {
        const message = 'Exception while fetching data (/fetchChapterPages) : Failed to find page list. Non-English entries are not supported.';
        expect(mangaErrorTextKey({ code: 'API_ERROR', message })).toBe('manga.error.noPageList');
        expect(mangaErrorTextKey({ code: 'API_ERROR', message: message.toLowerCase() })).toBe('manga.error.noPageList');
        expect(t(mangaErrorTextKey({ code: 'API_ERROR', message }))).toBe(
            'This source did not hand over the pages of this chapter. The site may have changed how it shows them; updating the extensions may fix it.'
        );
    });

    it('does not take that text for the other codes', () => {
        expect(mangaErrorTextKey({ code: 'REQUEST_FAILED', message: 'Failed to find page list.' })).toBe('manga.error.REQUEST_FAILED');
    });

    it('puts the code and the whole message of the backend in the technical text', () => {
        expect(technicalErrorText({ code: 'API_ERROR', message: 'line one\n\tat line two' })).toBe('API_ERROR\nline one\n\tat line two');
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

    it('does not count a chapter that lacks pages as downloaded', () => {
        const manga = makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 11, status: 'done' }), makeChapterRecord({ id: 2, remoteId: 12, status: 'incomplete' })]);
        expect(downloadedCount(manga)).toBe(1);
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

    it('limits the library to a group, or to the mangas that are in no group', () => {
        const inside = makeLibraryManga([], { id: 1, groupIds: [1, 2] });
        const other = makeLibraryManga([], { id: 2, groupIds: [2] });
        const none = makeLibraryManga([], { id: 3, groupIds: [] });
        expect(inGroup([inside, other, none], null)).toEqual([none]);
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

    it('is the chapter the manga was last read in, read or not', () => {
        expect(continueIndex(chapters, none, 12)).toBe(1);
        expect(continueIndex(chapters, reading(11), 13)).toBe(2);
        expect(continueIndex(chapters, reading(11, 12), 12)).toBe(1);
        expect(continueIndex(chapters, reading(11, 12, 13), 13)).toBe(2);
        expect(continueIndex(chapters, reading(11, 12, 13), 11)).toBe(0);
    });

    it('is the first chapter that is not read when there is no last chapter, or it is not in the list', () => {
        expect(continueIndex(chapters, reading(11), 99)).toBe(1);
        expect(continueIndex(chapters, reading(11), null)).toBe(1);
        expect(continueIndex(chapters, none, null)).toBe(0);
        expect(continueIndex(chapters, none, 99)).toBe(0);
    });

    it('is the first chapter when there is no last chapter and everything is read', () => {
        expect(continueIndex(chapters, reading(11, 12, 13), null)).toBe(0);
        expect(continueIndex(chapters, reading(11, 12, 13), 99)).toBe(0);
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

describe('localDetails', () => {
    it('gives what the library knows of a manga in the shape of what the source answers', () => {
        const manga = makeLibraryManga(
            [makeChapterRecord({ id: 5, remoteId: 11, name: 'One', number: 1, dateUploaded: 1700000000000, scanlator: 'Group', sourceOrder: 3, status: 'done', filePath: '/m/1.cbz' }), makeChapterRecord({ id: 6, remoteId: 12, name: 'Two', number: null, dateUploaded: null, scanlator: null, sourceOrder: 4 })],
            { author: 'Oda', artist: null, description: 'Text', genres: ['Action', 'Drama'], status: 'completed', url: 'https://dex.example/m', thumbnailUrl: 'pullwave-manga://cover/1?v=abc', series: 'Pirates', season: 2, seasonName: 'Second' }
        );
        expect(localDetails(manga)).toEqual({
            details: { remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: 'pullwave-manga://cover/1?v=abc', url: 'https://dex.example/m', author: 'Oda', artist: null, description: 'Text', genres: ['Action', 'Drama'], status: 'completed' },
            chapters: [
                { remoteId: 11, name: 'One', number: 1, dateUploaded: 1700000000000, scanlator: 'Group', sourceOrder: 3 },
                { remoteId: 12, name: 'Two', number: null, dateUploaded: null, scanlator: null, sourceOrder: 4 }
            ]
        });
    });

    it('gives a manga with no chapters an empty list', () => {
        expect(localDetails(makeLibraryManga([])).chapters).toEqual([]);
    });
});

describe('withLibraryChapters', () => {
    const LISTED = [
        { remoteId: 11, name: 'One', number: 1, dateUploaded: null, scanlator: null, sourceOrder: 1 },
        { remoteId: 12, name: 'Two', number: 2, dateUploaded: 1700000000000, scanlator: 'Group', sourceOrder: 2 }
    ];

    it('gives what the source lists when the manga is not in the library', () => {
        const result = withLibraryChapters(LISTED, null);
        expect(result).toEqual(LISTED);
        expect(result).not.toBe(LISTED);
    });

    it('gives what the source lists when the library has no other chapter', () => {
        const saved = makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 11, name: 'One' }), makeChapterRecord({ id: 2, remoteId: 12, name: 'Two' })]);
        expect(withLibraryChapters(LISTED, saved)).toEqual(LISTED);
    });

    it('adds the chapters of the library that the source no longer lists, in the shape the source gives', () => {
        const saved = makeLibraryManga([
            makeChapterRecord({ id: 1, remoteId: 11, name: 'One' }),
            makeChapterRecord({ id: 3, remoteId: 99, name: 'Chapter', number: null, dateUploaded: 1600000000000, scanlator: 'Old group', sourceOrder: 1, status: 'done', filePath: '/m/Chapter.cbz' })
        ]);
        expect(withLibraryChapters(LISTED, saved)).toEqual([...LISTED, { remoteId: 99, name: 'Chapter', number: null, dateUploaded: 1600000000000, scanlator: 'Old group', sourceOrder: 1 }]);
    });

    it('gives every chapter of the library when the source lists none', () => {
        const saved = makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 11, name: 'One', number: 1, sourceOrder: 4 })]);
        expect(withLibraryChapters([], saved)).toEqual([{ remoteId: 11, name: 'One', number: 1, dateUploaded: null, scanlator: null, sourceOrder: 4 }]);
    });

    it('gives an empty list when there is nothing in the source and nothing in the library', () => {
        expect(withLibraryChapters([], makeLibraryManga([]))).toEqual([]);
        expect(withLibraryChapters([], null)).toEqual([]);
    });

    it('does not change the list of the source', () => {
        const saved = makeLibraryManga([makeChapterRecord({ id: 3, remoteId: 99, name: 'Chapter' })]);
        const source = [...LISTED];
        withLibraryChapters(source, saved);
        expect(source).toEqual(LISTED);
    });
});

describe('what a download does something for', () => {
    it.each([
        ['idle', true],
        ['error', true],
        ['cancelled', true],
        ['done', false],
        ['incomplete', false],
        ['queued', false],
        ['downloading', false],
        ['paused', false]
    ] as const)('says a chapter that is %s can be downloaded: %s', (status, expected) => {
        expect(canDownload({ status })).toBe(expected);
    });

    it('says a chapter the library does not have can be downloaded', () => {
        expect(canDownload(null)).toBe(true);
    });

    it('keeps of the chapters picked only the ones that can be downloaded, in the order they were picked', () => {
        const manga = makeLibraryManga([
            makeChapterRecord({ id: 1, remoteId: 11, status: 'done' }),
            makeChapterRecord({ id: 2, remoteId: 12, status: 'queued' }),
            makeChapterRecord({ id: 3, remoteId: 13, status: 'error' }),
            makeChapterRecord({ id: 4, remoteId: 14, status: 'idle' })
        ]);
        expect(downloadablePicks(manga, [14, 11, 12, 13, 99])).toEqual([14, 13, 99]);
        expect(downloadablePicks(manga, [])).toEqual([]);
        expect(downloadablePicks(manga, [11, 12])).toEqual([]);
    });

    it('keeps every chapter picked when the manga is not in the library', () => {
        expect(downloadablePicks(null, [11, 12])).toEqual([11, 12]);
    });
});

describe('the group the library shows', () => {
    const GROUPS = [{ id: 4, name: 'Mangas' }, { id: 5, name: 'Manhwas' }];
    const grouped = makeLibraryManga([], { id: 1, groupIds: [5] });
    const alone = makeLibraryManga([], { id: 2, groupIds: [] });

    it('is the one chosen', () => {
        expect(activeGroup([grouped, alone], GROUPS, 5)).toBe(5);
        expect(activeGroup([grouped], GROUPS, 4)).toBe(4);
    });

    it('is the tab of all (no group) while a manga is in no group', () => {
        expect(activeGroup([grouped, alone], GROUPS, null)).toBeNull();
    });

    it('is the first group when every manga is in a group, since the tab of all is not there', () => {
        expect(activeGroup([grouped], GROUPS, null)).toBe(4);
    });

    it('is the tab of all when there are no groups at all, or no mangas', () => {
        expect(activeGroup([alone], [], null)).toBeNull();
        expect(activeGroup([grouped], [], null)).toBeNull();
        expect(activeGroup([], GROUPS, null)).toBe(4);
    });
});

describe('the orders of a series', () => {
    const SERIES = [
        makeLibraryManga([], { id: 1, series: 'Sousou no Frieren', season: 1 }),
        makeLibraryManga([], { id: 2, series: 'sousou no frieren', season: 3 }),
        makeLibraryManga([], { id: 3, series: 'Bleach', season: 2 }),
        makeLibraryManga([], { id: 4, series: null, season: null })
    ];

    it('gives the orders the other mangas of the series have, whatever the case or the accents of its name', () => {
        expect(takenSeasons(SERIES, 'SOUSOU NO FRIEREN', 99)).toEqual([1, 3]);
        expect(takenSeasons(SERIES, 'Bleach', 99)).toEqual([2]);
    });

    it('leaves out the manga that is being edited', () => {
        expect(takenSeasons(SERIES, 'Sousou no Frieren', 1)).toEqual([3]);
    });

    it('gives none for a series that is new, an empty name, or mangas with no series', () => {
        expect(takenSeasons(SERIES, 'Naruto', 99)).toEqual([]);
        expect(takenSeasons(SERIES, '   ', 99)).toEqual([]);
        expect(takenSeasons([makeLibraryManga([], { id: 5, series: 'X', season: null })], 'X', 99)).toEqual([]);
    });

    it('gives the order after the last one, as the library does when the order wanted is taken', () => {
        expect(nextSeason([])).toBe(1);
        expect(nextSeason([1])).toBe(2);
        expect(nextSeason([1, 3])).toBe(4);
        expect(nextSeason([2])).toBe(3);
    });
});

describe('chapterLabel', () => {
    it('is the name, or the number when there is none, or nothing', () => {
        expect(chapterLabel('Romance Dawn', 1)).toBe('Romance Dawn');
        expect(chapterLabel('', 7)).toBe('#7');
        expect(chapterLabel('', 7.5)).toBe('#7.5');
        expect(chapterLabel('', null)).toBe('');
    });
});

describe('groupByDay', () => {
    const at = (day: number, hour: number): number => {
        return new Date(2026, 9, day, hour, 30).getTime();
    };

    it('splits a list in the order it comes by the day of each time, with the start of the day', () => {
        const entries = [{ id: 'a', time: at(11, 22) }, { id: 'b', time: at(11, 9) }, { id: 'c', time: at(10, 23) }, { id: 'd', time: at(8, 1) }];
        expect(
            groupByDay(entries, (entry) => {
                return entry.time;
            })
        ).toEqual([
            { day: new Date(2026, 9, 11).getTime(), entries: [entries[0], entries[1]] },
            { day: new Date(2026, 9, 10).getTime(), entries: [entries[2]] },
            { day: new Date(2026, 9, 8).getTime(), entries: [entries[3]] }
        ]);
    });

    it('does not join the same day when it comes apart in the list', () => {
        const entries = [{ time: at(11, 22) }, { time: at(10, 9) }, { time: at(11, 1) }];
        expect(
            groupByDay(entries, (entry) => {
                return entry.time;
            }).map((group) => {
                return group.entries.length;
            })
        ).toEqual([1, 1, 1]);
    });

    it('gives nothing for an empty list', () => {
        expect(groupByDay([], () => {
            return 0;
        })).toEqual([]);
    });
});

describe('sourceScope', () => {
    const STATE: SourceScopeState = {
        view: 'library',
        browse: { sourceId: null, status: 'idle', filtersStatus: 'idle', loadingMore: false },
        sourceSettings: { status: 'idle' },
        selection: null,
        selectionRefresh: { loading: false },
        reader: { status: 'closed' }
    };

    it('is no source in the screens that are not about one', () => {
        for (const view of ['library', 'updates', 'history', 'settings', 'extensions', 'downloads']) {
            expect(sourceScope({ ...STATE, view })).toEqual({ sourceId: null, loading: false });
        }
        expect(sourceScope({ ...STATE, view: 'browse' })).toEqual({ sourceId: null, loading: false });
    });

    it('is the source being browsed, and whether its list, its filters, more of its list or its settings are being read', () => {
        const browsing = { ...STATE, view: 'browse', browse: { ...STATE.browse, sourceId: '7' } };
        expect(sourceScope(browsing)).toEqual({ sourceId: '7', loading: false });
        expect(sourceScope({ ...browsing, browse: { ...browsing.browse, status: 'loading' } })).toEqual({ sourceId: '7', loading: true });
        expect(sourceScope({ ...browsing, browse: { ...browsing.browse, filtersStatus: 'loading' } })).toEqual({ sourceId: '7', loading: true });
        expect(sourceScope({ ...browsing, browse: { ...browsing.browse, loadingMore: true } })).toEqual({ sourceId: '7', loading: true });
        expect(sourceScope({ ...browsing, sourceSettings: { status: 'loading' } })).toEqual({ sourceId: '7', loading: true });
    });

    it('is the source of the manga that is open, whatever screen it was opened from, and not the one that was browsed', () => {
        const open = { ...STATE, view: 'browse', browse: { ...STATE.browse, sourceId: '7' }, selection: { manga: { sourceId: '9' }, status: 'ready' } };
        expect(sourceScope(open)).toEqual({ sourceId: '9', loading: false });
        expect(sourceScope({ ...open, selection: { manga: { sourceId: '9' }, status: 'loading' } })).toEqual({ sourceId: '9', loading: true });
        expect(sourceScope({ ...open, selectionRefresh: { loading: true } })).toEqual({ sourceId: '9', loading: true });
        expect(sourceScope({ ...open, view: 'library' })).toEqual({ sourceId: '9', loading: false });
    });

    it('is the source of the manga being read, before the one that is open, and loading while its pages are asked for', () => {
        const reading = { ...STATE, selection: { manga: { sourceId: '9' }, status: 'ready' }, reader: { status: 'ready', manga: { sourceId: '4' } } };
        expect(sourceScope(reading)).toEqual({ sourceId: '4', loading: false });
        expect(sourceScope({ ...reading, reader: { status: 'loading', manga: { sourceId: '4' } } })).toEqual({ sourceId: '4', loading: true });
        expect(sourceScope({ ...reading, reader: { status: 'loading', manga: null } })).toEqual({ sourceId: '9', loading: true });
        expect(sourceScope({ ...STATE, reader: { status: 'loading' } })).toEqual({ sourceId: null, loading: true });
    });
});

describe('checksForSource', () => {
    const CHECK = { id: 1, host: 'manganato.com', startedAt: 1 };
    const OTHER = { id: 2, host: 'manhwaread.com', startedAt: 2 };
    const LIBRARY = [makeLibraryManga([], { id: 1, sourceId: '7', url: 'https://www.manganato.com/manga/a' }), makeLibraryManga([], { id: 2, sourceId: '9', url: 'https://manhwaread.com/manhwa/b' }), makeLibraryManga([], { id: 3, sourceId: '9', url: null }), makeLibraryManga([], { id: 4, sourceId: '9', url: 'not an address' })];

    it('gives none when the user is in no source', () => {
        expect(checksForSource([CHECK, OTHER], { sourceId: null, loading: true }, LIBRARY, null)).toEqual([]);
    });

    it('gives the checks of the sites of the source, which the library knows by the page of its mangas on the site, with or without www', () => {
        expect(checksForSource([CHECK, OTHER], { sourceId: '7', loading: false }, LIBRARY, null)).toEqual([CHECK]);
        expect(checksForSource([CHECK, OTHER], { sourceId: '9', loading: true }, LIBRARY, null)).toEqual([OTHER]);
        expect(checksForSource([{ ...CHECK, host: 'WWW.Manganato.com' }], { sourceId: '7', loading: false }, LIBRARY, null)).toHaveLength(1);
    });

    it('takes a site that is not known for the source when it is being asked for something, and not otherwise', () => {
        const unknown = { id: 3, host: 'new.example', startedAt: 3 };
        expect(checksForSource([unknown], { sourceId: '7', loading: true }, LIBRARY, null)).toEqual([unknown]);
        expect(checksForSource([unknown], { sourceId: '7', loading: false }, LIBRARY, null)).toEqual([]);
        expect(checksForSource([{ id: 4, host: '', startedAt: 4 }], { sourceId: '7', loading: true }, [], null)).toHaveLength(1);
    });

    it('learns the site of the manga that is open from its page, which beats what the library says', () => {
        expect(checksForSource([OTHER], { sourceId: '7', loading: false }, LIBRARY, 'https://manhwaread.com/manhwa/c')).toEqual([OTHER]);
        expect(checksForSource([CHECK], { sourceId: '7', loading: false }, [], 'https://manganato.com/manga/z')).toEqual([CHECK]);
        expect(checksForSource([CHECK], { sourceId: '7', loading: false }, [], 'nonsense')).toEqual([]);
    });

    it('does not take a site of the library for another source when a manga of both sources is on the same site', () => {
        const shared = [makeLibraryManga([], { id: 1, sourceId: '7', url: 'https://same.example/a' }), makeLibraryManga([], { id: 2, sourceId: '9', url: 'https://same.example/b' })];
        const check = { id: 1, host: 'same.example', startedAt: 1 };
        expect(checksForSource([check], { sourceId: '9', loading: false }, shared, null)).toEqual([check]);
        expect(checksForSource([check], { sourceId: '7', loading: false }, shared, null)).toEqual([]);
    });
});

describe('the same title from another source', () => {
    const library = [
        makeLibraryManga([], { id: 1, sourceId: '123', remoteId: 7, title: 'One Piece' }),
        makeLibraryManga([], { id: 2, sourceId: '999', remoteId: 8, title: 'Re:Zero − Começando' }),
        makeLibraryManga([], { id: 3, sourceId: '555', remoteId: 9, title: 'one  PIECE!' }),
        makeLibraryManga([], { id: 4, sourceId: '999', remoteId: 10, title: '!!!' })
    ];

    it('finds the mangas that have the title, whatever the case, the accents or the punctuation', () => {
        expect(
            libraryEntriesByTitle(library, 'ONE piece', '777').map((manga) => {
                return manga.id;
            })
        ).toEqual([1, 3]);
        expect(
            libraryEntriesByTitle(library, 'Re Zero Comecando', '777').map((manga) => {
                return manga.id;
            })
        ).toEqual([2]);
    });

    it('leaves out the mangas of the source being asked about', () => {
        expect(
            libraryEntriesByTitle(library, 'One Piece', '123').map((manga) => {
                return manga.id;
            })
        ).toEqual([3]);
    });

    it('finds nothing for another title, an empty one, or one made of punctuation only', () => {
        expect(libraryEntriesByTitle(library, 'Bleach', '777')).toEqual([]);
        expect(libraryEntriesByTitle(library, '', '777')).toEqual([]);
        expect(libraryEntriesByTitle(library, '!!!', '777')).toEqual([]);
        expect(libraryEntriesByTitle([], 'One Piece', '777')).toEqual([]);
    });

    it('names the sources once each, and falls back to the id of a source that is not listed', () => {
        const sources = [makeSource({ id: '123', name: 'MangaDex' }), makeSource({ id: '999', name: 'Site B' })];
        expect(otherSourceNames([library[0]!, library[1]!, library[3]!], sources)).toEqual(['MangaDex', 'Site B']);
        expect(otherSourceNames([library[2]!], sources)).toEqual(['555']);
        expect(otherSourceNames([], sources)).toEqual([]);
    });
});

describe('sourceLabelsOf', () => {
    const sources = [makeSource({ id: '123', name: 'MangaDex', lang: 'en' }), makeSource({ id: '456', name: 'Leitor', lang: 'pt' })];

    it('gives the name and the language of the source of each manga', () => {
        expect(sourceLabelsOf(sources, [{ sourceId: '123' }, { sourceId: '456' }])).toEqual(['MangaDex · EN', 'Leitor · PT']);
    });

    it('gives each source once, in the order the mangas come', () => {
        expect(sourceLabelsOf(sources, [{ sourceId: '456' }, { sourceId: '123' }, { sourceId: '456' }])).toEqual(['Leitor · PT', 'MangaDex · EN']);
    });

    it('leaves out a source the list does not have, and gives nothing with no mangas or no list', () => {
        expect(sourceLabelsOf(sources, [{ sourceId: '999' }, { sourceId: '123' }])).toEqual(['MangaDex · EN']);
        expect(sourceLabelsOf(sources, [])).toEqual([]);
        expect(sourceLabelsOf([], [{ sourceId: '123' }])).toEqual([]);
    });
});

describe('sourceIsMissing', () => {
    const sources = [makeSource({ id: '123' }), makeSource({ id: '456', name: 'Other' })];

    it('is true for a source that is not in the list, once the list was read', () => {
        expect(sourceIsMissing(sources, 'ready', '999')).toBe(true);
        expect(sourceIsMissing([], 'ready', '123')).toBe(true);
    });

    it('is false for a source that is in the list', () => {
        expect(sourceIsMissing(sources, 'ready', '123')).toBe(false);
        expect(sourceIsMissing(sources, 'ready', '456')).toBe(false);
    });

    it('is false for the local source, which is never listed', () => {
        expect(sourceIsMissing(sources, 'ready', '0')).toBe(false);
        expect(sourceIsMissing([], 'ready', '0')).toBe(false);
    });

    it.each(['idle', 'loading', 'error'] as const)('is false while the list of sources is %s: nothing is known yet', (status) => {
        expect(sourceIsMissing([], status, '999')).toBe(false);
        expect(sourceIsMissing(sources, status, '999')).toBe(false);
    });
});

describe('matchesManga', () => {
    it('matches by the title or by the name of the series, without regard to case or accents', () => {
        const manga = { title: 'Frieren 2', series: 'Sōusou no Fríeren' };
        expect(matchesManga(manga, 'FRIEREN 2')).toBe(true);
        expect(matchesManga(manga, 'sousou')).toBe(true);
        expect(matchesManga(manga, 'bleach')).toBe(false);
    });

    it('matches everything for an empty search and does not look at a series that is not there', () => {
        expect(matchesManga({ title: 'Bleach', series: null }, '  ')).toBe(true);
        expect(matchesManga({ title: 'Bleach', series: null }, 'frieren')).toBe(false);
    });
});

describe('searchMatchesByTab', () => {
    const FRIEREN = makeLibraryManga([], { id: 1, remoteId: 1, title: 'Frieren', series: 'Frieren', season: 1, groupIds: [1] });
    const FRIEREN_2 = makeLibraryManga([], { id: 2, remoteId: 2, title: 'Frieren 2', series: 'Frieren', season: 2, groupIds: [1] });
    const AFTER_SCHOOL = makeLibraryManga([], { id: 3, remoteId: 3, title: 'After School', groupIds: [2] });
    const LOOSE = makeLibraryManga([], { id: 4, remoteId: 4, title: 'After Hours', groupIds: [] });
    const library = [FRIEREN, FRIEREN_2, AFTER_SCHOOL, LOOSE];

    it('counts the cards that match in each tab, and leaves out the tabs with no match', () => {
        expect(searchMatchesByTab(library, [null, 1, 2], 'after')).toEqual(
            new Map([
                [null, 1],
                [2, 1]
            ])
        );
    });

    it('counts a series of several seasons as one card', () => {
        expect(searchMatchesByTab(library, [null, 1, 2], 'frieren')).toEqual(new Map([[1, 1]]));
    });

    it('is empty when nothing was typed', () => {
        expect(searchMatchesByTab(library, [null, 1, 2], '')).toEqual(new Map());
        expect(searchMatchesByTab(library, [null, 1, 2], '   ')).toEqual(new Map());
    });
});

describe('readerChapters', () => {
    it('gives the chapters in reading order as the reader takes them', () => {
        const manga = makeLibraryManga([
            makeChapterRecord({ id: 2, remoteId: 22, name: 'Two', number: 2, sourceOrder: 2 }),
            makeChapterRecord({ id: 1, remoteId: 21, name: 'One', number: null, sourceOrder: 1 })
        ]);
        expect(readerChapters(manga)).toEqual([
            { remoteId: 21, libraryChapterId: 1, name: 'One', number: null },
            { remoteId: 22, libraryChapterId: 2, name: 'Two', number: 2 }
        ]);
    });
});

describe('compareChaptersAscending', () => {
    const chapter = (remoteId: number, number: number | null, sourceOrder: number) => {
        return { remoteId, number, sourceOrder };
    };

    const numberOf = (item: { number: number | null }) => {
        return item.number;
    };
    const idOf = (item: { remoteId: number }) => {
        return item.remoteId;
    };

    it('orders the numbered chapters by number, whatever the order of the source', () => {
        const chapters = [chapter(1, 3, 1), chapter(2, 1, 3), chapter(3, 2, 2)];
        expect(chapters.sort(compareChaptersAscending).map(numberOf)).toEqual([1, 2, 3]);
    });

    it('puts a decimal number between its neighbours', () => {
        const chapters = [chapter(1, 5, 6), chapter(2, 4.1, 5), chapter(3, 4, 4), chapter(4, 6, 7), chapter(5, 1, 1)];
        expect(chapters.sort(compareChaptersAscending).map(numberOf)).toEqual([1, 4, 4.1, 5, 6]);
    });

    it('puts the chapters with no number before the numbered ones', () => {
        const chapters = [chapter(1, 1, 1), chapter(2, null, 5), chapter(3, 0, 2)];
        expect(chapters.sort(compareChaptersAscending).map(idOf)).toEqual([2, 3, 1]);
    });

    it('orders the chapters with no number by the order of the source, then by id', () => {
        const chapters = [chapter(9, null, 2), chapter(8, null, 2), chapter(7, null, 1)];
        expect(chapters.sort(compareChaptersAscending).map(idOf)).toEqual([7, 8, 9]);
    });

    it('orders the chapters with the same number by the order of the source, then by id', () => {
        const chapters = [chapter(4, 2, 3), chapter(3, 2, 3), chapter(2, 2, 1)];
        expect(chapters.sort(compareChaptersAscending).map(idOf)).toEqual([2, 3, 4]);
    });

    it('gives a negative, positive or zero result as a comparison does', () => {
        expect(compareChaptersAscending(chapter(1, 1, 1), chapter(2, 2, 2))).toBeLessThan(0);
        expect(compareChaptersAscending(chapter(1, 2, 2), chapter(2, 1, 1))).toBeGreaterThan(0);
        expect(compareChaptersAscending(chapter(1, null, 1), chapter(2, 1, 2))).toBe(-1);
        expect(compareChaptersAscending(chapter(1, 1, 1), chapter(2, null, 2))).toBe(1);
        expect(compareChaptersAscending(chapter(1, 1, 1), chapter(1, 1, 1))).toBe(0);
    });

    it('keeps an empty list and a list with one chapter as they are', () => {
        expect([].sort(compareChaptersAscending)).toEqual([]);
        expect([chapter(1, 7, 1)].sort(compareChaptersAscending)).toEqual([chapter(1, 7, 1)]);
    });
});

describe('adjacentSeason', () => {
    const chapter = [makeChapterRecord({ id: 1 })];
    const ONE = makeLibraryManga(chapter, { id: 1, remoteId: 11, title: 'One', series: 'Show', season: 1 });
    const TWO = makeLibraryManga([], { id: 2, remoteId: 12, title: 'Two', series: 'show', season: 2 });
    const THREE = makeLibraryManga(chapter, { id: 3, remoteId: 13, title: 'Three', series: 'Show', season: 3 });
    const OTHER = makeLibraryManga(chapter, { id: 4, remoteId: 14, title: 'Other', series: 'Other', season: 2 });
    const library = [THREE, OTHER, TWO, ONE];
    const key = (manga: { sourceId: string; remoteId: number }) => {
        return { sourceId: manga.sourceId, remoteId: manga.remoteId };
    };

    it('gives the next season that has chapters, skipping the empty ones', () => {
        expect(adjacentSeason(library, key(ONE), 1)).toBe(THREE);
    });

    it('gives the previous season that has chapters, skipping the empty ones', () => {
        expect(adjacentSeason(library, key(THREE), -1)).toBe(ONE);
    });

    it('gives null after the last season and before the first one', () => {
        expect(adjacentSeason(library, key(THREE), 1)).toBeNull();
        expect(adjacentSeason(library, key(ONE), -1)).toBeNull();
    });

    it('gives null for a manga with no series, one that is not in the library and when nothing is being read', () => {
        const alone = makeLibraryManga(chapter, { id: 5, remoteId: 15, title: 'Alone' });
        expect(adjacentSeason([...library, alone], key(alone), 1)).toBeNull();
        expect(adjacentSeason(library, { sourceId: '123', remoteId: 999 }, 1)).toBeNull();
        expect(adjacentSeason(library, null, 1)).toBeNull();
        expect(adjacentSeason(library, undefined, -1)).toBeNull();
    });

    it('does not mix up the seasons of another series', () => {
        expect(adjacentSeason(library, key(OTHER), 1)).toBeNull();
        expect(adjacentSeason(library, key(OTHER), -1)).toBeNull();
    });
});

describe('neighbourChapter', () => {
    const ONE = makeLibraryManga([makeChapterRecord({ id: 1, remoteId: 101, name: 'A', number: 1, sourceOrder: 1 }), makeChapterRecord({ id: 2, remoteId: 102, name: 'B', number: 2, sourceOrder: 2 })], { id: 1, remoteId: 11, title: 'One', series: 'Show', season: 1 });
    const TWO = makeLibraryManga([makeChapterRecord({ id: 3, remoteId: 103, name: 'C', number: 1, sourceOrder: 1 }), makeChapterRecord({ id: 4, remoteId: 104, name: 'D', number: 2, sourceOrder: 2 })], { id: 2, remoteId: 12, title: 'Two', series: 'Show', season: 2 });
    const library = [TWO, ONE];
    const reading = (manga: typeof ONE, index: number) => {
        return { chapters: readerChapters(manga), index, manga: { remoteId: manga.remoteId, sourceId: manga.sourceId, title: manga.title, thumbnailUrl: null } };
    };

    it('gives the chapter next to the current one inside the season', () => {
        expect(neighbourChapter(library, reading(ONE, 0), 1)).toEqual({ remoteId: 102, libraryChapterId: 2, name: 'B', number: 2 });
        expect(neighbourChapter(library, reading(ONE, 1), -1)).toEqual({ remoteId: 101, libraryChapterId: 1, name: 'A', number: 1 });
    });

    it('gives the first chapter of the next season at the end of a season, and the last of the previous one at the start', () => {
        expect(neighbourChapter(library, reading(ONE, 1), 1)).toEqual({ remoteId: 103, libraryChapterId: 3, name: 'C', number: 1 });
        expect(neighbourChapter(library, reading(TWO, 0), -1)).toEqual({ remoteId: 102, libraryChapterId: 2, name: 'B', number: 2 });
    });

    it('gives undefined past the last season and before the first one', () => {
        expect(neighbourChapter(library, reading(TWO, 1), 1)).toBeUndefined();
        expect(neighbourChapter(library, reading(ONE, 0), -1)).toBeUndefined();
    });
});
