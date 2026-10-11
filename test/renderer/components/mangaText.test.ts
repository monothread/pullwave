import { CONTENT_WARNINGS, MANGA_CHAPTER_STATUSES, MANGA_STATUSES, type MangaErrorCode } from '@shared/manga';
import type { ToolErrorCode } from '@shared/tools';
import { createTranslator } from '@shared/i18n';
import {
    ALL_LANGUAGES,
    activeJobCount,
    chapterState,
    chapterStatusKey,
    downloadedCount,
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
