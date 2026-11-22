import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LibraryManga, MangaChapterRecord } from '@shared/manga';
import {
    defaultMangaMetadataFiles,
    MANGA_METADATA_FILE,
    MANGA_METADATA_VERSION,
    mangaMetadataPath,
    metadataOfManga,
    parseMangaMetadata,
    readMangaMetadata,
    refreshMangaMetadata,
    writeMangaMetadata
} from '@main/services/manga/mangaMetadata';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

function makeChapter(overrides: Partial<MangaChapterRecord> = {}): MangaChapterRecord {
    return {
        id: 1,
        mangaId: 10,
        remoteId: 101,
        name: 'Chapter 1',
        number: 1,
        dateUploaded: 1700000000000,
        scanlator: 'ScanGroup',
        sourceOrder: 1,
        status: 'done',
        pageCount: 24,
        filePath: '/manga/One Piece/Chapter 1.cbz',
        sizeBytes: 4096,
        error: null,
        downloadedAt: 1700000001000,
        addedAt: null,
        ...overrides
    };
}

function makeManga(overrides: Partial<LibraryManga> = {}): LibraryManga {
    return {
        id: 10,
        sourceId: '4242',
        remoteId: 77,
        title: 'One Piece',
        thumbnailUrl: '/api/v1/manga/77/thumbnail',
        url: 'https://site.example/op',
        author: 'Oda',
        artist: 'Oda E.',
        description: 'Pirates',
        genres: ['Action', 'Adventure'],
        status: 'ongoing',
        createdAt: 1000,
        series: null,
        season: null,
        seasonName: null,
        chapters: [makeChapter()],
        groupIds: [],
        ...overrides
    };
}

describe('mangaMetadata', () => {
    it('builds metadata with downloaded and incomplete chapters and omits idle chapters', () => {
        const done = makeChapter({ id: 1, remoteId: 101, filePath: '/manga/One Piece/Chapter 1.cbz', status: 'done', pageCount: 20 });
        const incomplete = makeChapter({ id: 2, remoteId: 102, name: 'Chapter 2', number: 2, sourceOrder: 2, filePath: '/manga/One Piece/Chapter 2.cbz', status: 'incomplete', pageCount: 18 });
        const idle = makeChapter({ id: 3, remoteId: 103, name: 'Chapter 3', number: 3, sourceOrder: 3, filePath: null, status: 'idle', pageCount: 0 });
        const manga = makeManga({ series: 'Grand Line', season: 1, seasonName: 'East Blue', chapters: [done, incomplete, idle] });

        expect(metadataOfManga(manga, manga.chapters, 'linux')).toEqual({
            version: MANGA_METADATA_VERSION,
            sourceId: '4242',
            remoteId: 77,
            title: 'One Piece',
            thumbnailUrl: '/api/v1/manga/77/thumbnail',
            url: 'https://site.example/op',
            author: 'Oda',
            artist: 'Oda E.',
            description: 'Pirates',
            genres: ['Action', 'Adventure'],
            status: 'ongoing',
            series: 'Grand Line',
            season: 1,
            seasonName: 'East Blue',
            chapters: [
                {
                    fileName: 'Chapter 1.cbz',
                    remoteId: 101,
                    name: 'Chapter 1',
                    number: 1,
                    dateUploaded: 1700000000000,
                    scanlator: 'ScanGroup',
                    sourceOrder: 1,
                    pageCount: 20,
                    incomplete: false
                },
                {
                    fileName: 'Chapter 2.cbz',
                    remoteId: 102,
                    name: 'Chapter 2',
                    number: 2,
                    dateUploaded: 1700000000000,
                    scanlator: 'ScanGroup',
                    sourceOrder: 2,
                    pageCount: 18,
                    incomplete: true
                }
            ]
        });
    });

    it('extracts Windows file names when platform is win32', () => {
        const chapter = makeChapter({ filePath: 'C:\\Manga\\One Piece\\Chapter 1.cbz' });
        const metadata = metadataOfManga(makeManga({ chapters: [chapter] }), [chapter], 'win32');
        expect(metadata.chapters[0]?.fileName).toBe('Chapter 1.cbz');
        expect(mangaMetadataPath('C:\\Manga\\One Piece', 'win32')).toBe(`C:\\Manga\\One Piece\\${MANGA_METADATA_FILE}`);
    });

    it('round-trips through JSON and rejects corrupt or unsafe chapter file names', () => {
        const metadata = metadataOfManga(makeManga(), [makeChapter()], 'linux');
        expect(parseMangaMetadata(JSON.stringify(metadata))).toEqual(metadata);
        expect(parseMangaMetadata('not json')).toBeNull();
        expect(parseMangaMetadata(JSON.stringify({ ...metadata, version: 2 }))).toBeNull();
        expect(parseMangaMetadata(JSON.stringify({ ...metadata, sourceId: '' }))).toBeNull();
        expect(parseMangaMetadata(JSON.stringify({ ...metadata, title: '  ' }))).toBeNull();

        const withTraversal = {
            ...metadata,
            thumbnailUrl: 'http://127.0.0.1:8080/internal',
            url: 'file:///etc/passwd',
            chapters: [
                ...metadata.chapters,
                { fileName: '../escape.cbz', remoteId: 2, name: 'Bad', number: 2, dateUploaded: null, scanlator: null, sourceOrder: 2, pageCount: 1, incomplete: false },
                { fileName: 'sub\\bad.cbz', remoteId: 3, name: 'Bad2', number: 3, dateUploaded: null, scanlator: null, sourceOrder: 3, pageCount: 1, incomplete: false },
                { fileName: 'huge.cbz', remoteId: 4, name: 'Huge', number: 4, dateUploaded: null, scanlator: null, sourceOrder: 4, pageCount: 100_000_000, incomplete: true }
            ]
        };
        const parsed = parseMangaMetadata(JSON.stringify(withTraversal));
        expect(parsed?.chapters).toHaveLength(1);
        expect(parsed?.thumbnailUrl).toBeNull();
        expect(parsed?.url).toBeNull();
        expect(parseMangaMetadata(JSON.stringify({ ...metadata, sourceId: 'arbitrary-source' }))).toBeNull();
        expect(parseMangaMetadata(JSON.stringify({ ...metadata, remoteId: 0 }))).toBeNull();
        expect(parseMangaMetadata(JSON.stringify({ ...metadata, remoteId: -5 }))).toBeNull();

        const withUnlistedLocalChapter = {
            ...metadata,
            chapters: [
                ...metadata.chapters,
                { fileName: 'Extra.cbz', remoteId: -1, name: 'Extra', number: 1.5, dateUploaded: null, scanlator: null, sourceOrder: 2, pageCount: 10, incomplete: false }
            ]
        };
        expect(parseMangaMetadata(JSON.stringify(withUnlistedLocalChapter))?.chapters).toHaveLength(2);
    });

    it('writes, reads, and refreshes pullwave.json on the real filesystem', () => {
        const folder = join(makeTempDir(), 'One Piece');
        const chapterPath = join(folder, 'Chapter 1.cbz');
        const manga = makeManga({ chapters: [makeChapter({ filePath: chapterPath })] });

        refreshMangaMetadata(
            {
                getLibraryManga: (id) => {
                    return id === manga.id ? manga : null;
                }
            },
            manga.id,
            defaultMangaMetadataFiles,
            process.platform
        );

        const metaFile = join(folder, MANGA_METADATA_FILE);
        expect(existsSync(metaFile)).toBe(true);
        expect(readMangaMetadata(folder, defaultMangaMetadataFiles, process.platform)).toEqual(metadataOfManga(manga, manga.chapters, process.platform));
        expect(readFileSync(metaFile, 'utf-8').endsWith('\n')).toBe(true);
    });

    it('ignores write errors silently and does nothing when a manga has no downloaded chapters', () => {
        const dir = makeTempDir();
        const blocker = join(dir, 'blocker');
        writeFileSync(blocker, 'file');
        writeMangaMetadata(blocker, metadataOfManga(makeManga(), [], 'linux'), defaultMangaMetadataFiles, process.platform);

        const write = vi.fn();
        refreshMangaMetadata(
            {
                getLibraryManga: () => {
                    return makeManga({ chapters: [makeChapter({ status: 'idle', filePath: null })] });
                }
            },
            10,
            { write }
        );
        expect(write).not.toHaveBeenCalled();
    });
});
