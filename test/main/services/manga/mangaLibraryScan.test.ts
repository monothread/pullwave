import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yazl from 'yazl';
import { buildComicInfo } from '@main/services/manga/comicInfo';
import { scanMangaLibraryFolder } from '@main/services/manga/mangaLibraryScan';
import { MANGA_METADATA_FILE, MANGA_METADATA_VERSION } from '@main/services/manga/mangaMetadata';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

function writeCbz(filePath: string, entries: ReadonlyArray<{ name: string; content: Buffer | string }>): Promise<void> {
    return new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        entries.forEach((entry) => {
            zip.addBuffer(typeof entry.content === 'string' ? Buffer.from(entry.content, 'utf-8') : entry.content, entry.name);
        });
        zip.end();
        const chunks: Buffer[] = [];
        zip.outputStream.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
        });
        zip.outputStream.once('error', reject);
        zip.outputStream.once('end', () => {
            writeFileSync(filePath, Buffer.concat(chunks));
            resolve();
        });
    });
}

describe('scanMangaLibraryFolder', () => {
    it('reads pullwave.json metadata for CBZ and folder chapters and skips work directories', async () => {
        const root = makeTempDir();
        const mangaDir = join(root, 'One Piece');
        mkdirSync(join(mangaDir, 'Chapter 2'), { recursive: true });
        mkdirSync(join(mangaDir, 'Chapter 3.cbz.part'), { recursive: true });
        await writeCbz(join(mangaDir, 'Chapter 1.cbz'), [{ name: '001.jpg', content: Buffer.from([0xff, 0xd8]) }]);
        writeFileSync(join(mangaDir, 'Chapter 2', '001.jpg'), Buffer.from([1, 2, 3]));
        writeFileSync(join(mangaDir, 'Chapter 3.cbz.part', '001.jpg'), Buffer.from([1, 2, 3]));
        writeFileSync(
            join(mangaDir, MANGA_METADATA_FILE),
            JSON.stringify({
                version: MANGA_METADATA_VERSION,
                sourceId: '4242',
                remoteId: 77,
                title: 'One Piece',
                thumbnailUrl: '/api/v1/manga/77/thumbnail',
                url: 'https://site.example/op',
                author: 'Oda',
                artist: 'Oda',
                description: 'Pirates',
                genres: ['Action'],
                status: 'ongoing',
                series: 'One Piece Saga',
                season: 1,
                seasonName: 'East Blue',
                chapters: [
                    {
                        fileName: 'Chapter 1.cbz',
                        remoteId: 1001,
                        name: 'Romance Dawn',
                        number: 1,
                        dateUploaded: 1700000000000,
                        scanlator: 'Group A',
                        sourceOrder: 1,
                        pageCount: 52,
                        incomplete: false
                    },
                    {
                        fileName: 'Chapter 2',
                        remoteId: 1002,
                        name: 'They Call Him Luffy',
                        number: 2,
                        dateUploaded: 1700000001000,
                        scanlator: 'Group A',
                        sourceOrder: 2,
                        pageCount: 22,
                        incomplete: true
                    }
                ]
            })
        );

        const result = await scanMangaLibraryFolder(root);
        expect(result).toEqual({
            ignored: 0,
            mangas: [
                {
                    folder: mangaDir,
                    sourceId: '4242',
                    remoteId: 77,
                    title: 'One Piece',
                    thumbnailUrl: '/api/v1/manga/77/thumbnail',
                    url: 'https://site.example/op',
                    author: 'Oda',
                    artist: 'Oda',
                    description: 'Pirates',
                    genres: ['Action'],
                    status: 'ongoing',
                    series: 'One Piece Saga',
                    season: 1,
                    seasonName: 'East Blue',
                    chapters: [
                        {
                            filePath: join(mangaDir, 'Chapter 1.cbz'),
                            remoteId: 1001,
                            name: 'Romance Dawn',
                            number: 1,
                            dateUploaded: 1700000000000,
                            scanlator: 'Group A',
                            sourceOrder: 1,
                            pageCount: 52,
                            incomplete: false
                        },
                        {
                            filePath: join(mangaDir, 'Chapter 2'),
                            remoteId: 1002,
                            name: 'They Call Him Luffy',
                            number: 2,
                            dateUploaded: 1700000001000,
                            scanlator: 'Group A',
                            sourceOrder: 2,
                            pageCount: 22,
                            incomplete: true
                        }
                    ]
                }
            ]
        });
    });

    it('falls back to ComicInfo.xml inside a real CBZ and counts corrupt archives as ignored', async () => {
        const root = makeTempDir();
        const mangaDir = join(root, 'Bleach Folder');
        mkdirSync(mangaDir, { recursive: true });
        const comicXml = buildComicInfo({
            seriesTitle: 'Bleach',
            chapter: { name: 'Death & Strawberry', number: 1, scanlator: 'TiteScan' },
            details: { author: 'Kubo', artist: 'Kubo', description: 'Soul reapers', genres: ['Action', 'Supernatural'] },
            pageCount: 2
        });
        await writeCbz(join(mangaDir, 'Chapter 1.cbz'), [
            { name: '001.jpg', content: Buffer.from([0xff, 0xd8]) },
            { name: '002.png', content: Buffer.from([0x89, 0x50]) },
            { name: 'ComicInfo.xml', content: comicXml }
        ]);
        writeFileSync(join(mangaDir, 'Broken.cbz'), 'not a zip');

        const result = await scanMangaLibraryFolder(root);
        expect(result.ignored).toBe(1);
        expect(result.mangas).toEqual([
            {
                folder: mangaDir,
                sourceId: null,
                remoteId: null,
                title: 'Bleach',
                thumbnailUrl: null,
                url: null,
                author: 'Kubo',
                artist: 'Kubo',
                description: 'Soul reapers',
                genres: ['Action', 'Supernatural'],
                status: 'unknown',
                series: null,
                season: null,
                seasonName: null,
                chapters: [
                    {
                        filePath: join(mangaDir, 'Chapter 1.cbz'),
                        remoteId: null,
                        name: 'Death & Strawberry',
                        number: 1,
                        dateUploaded: null,
                        scanlator: 'TiteScan',
                        sourceOrder: 1,
                        pageCount: 2,
                        incomplete: false
                    }
                ]
            }
        ]);
    });

    it('falls back to folder names when neither pullwave.json nor ComicInfo.xml exists', async () => {
        const root = makeTempDir();
        const chapterDir = join(root, 'Naruto', 'Chapter 12.5');
        mkdirSync(chapterDir, { recursive: true });
        writeFileSync(join(chapterDir, '001.webp'), Buffer.from([1]));
        writeFileSync(join(chapterDir, '002.webp'), Buffer.from([2]));

        const result = await scanMangaLibraryFolder(root);
        expect(result.ignored).toBe(0);
        expect(result.mangas).toHaveLength(1);
        expect(result.mangas[0]).toMatchObject({
            title: 'Naruto',
            sourceId: null,
            remoteId: null,
            chapters: [
                {
                    filePath: chapterDir,
                    remoteId: null,
                    name: 'Chapter 12.5',
                    number: 12.5,
                    pageCount: 2,
                    incomplete: false
                }
            ]
        });
    });

    it('ignores corrupt CBZs listed in pullwave.json, empty folders with only ComicInfo.xml, and symlinks', async () => {
        const root = makeTempDir();
        const outside = makeTempDir();
        const mangaDir = join(root, 'Guarded');
        const emptyFolder = join(mangaDir, 'Chapter 2');
        mkdirSync(emptyFolder, { recursive: true });
        writeFileSync(join(mangaDir, 'Chapter 1.cbz'), 'corrupt-data');
        writeFileSync(join(emptyFolder, 'ComicInfo.xml'), '<ComicInfo><Series>Guarded</Series><Number>2</Number></ComicInfo>');
        writeFileSync(
            join(mangaDir, MANGA_METADATA_FILE),
            JSON.stringify({
                version: MANGA_METADATA_VERSION,
                sourceId: '4242',
                remoteId: 77,
                title: 'Guarded',
                thumbnailUrl: null,
                url: null,
                author: null,
                artist: null,
                description: null,
                genres: [],
                status: 'unknown',
                chapters: [
                    { fileName: 'Chapter 1.cbz', remoteId: 1, name: 'Ch 1', number: 1, dateUploaded: null, scanlator: null, sourceOrder: 1, pageCount: 10, incomplete: false }
                ]
            })
        );
        await writeCbz(join(outside, 'Secret.cbz'), [{ name: '001.jpg', content: Buffer.from([1]) }]);
        if (process.platform !== 'win32') {
            symlinkSync(join(outside, 'Secret.cbz'), join(mangaDir, 'Linked.cbz'));
        }

        const result = await scanMangaLibraryFolder(root);
        expect(result.mangas).toEqual([]);
        expect(result.ignored).toBe(2);
    });
});
