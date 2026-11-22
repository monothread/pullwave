import { join } from 'node:path';
import { LOCAL_MANGA_SOURCE_ID, MangaDb } from '@main/services/manga/mangaDb';
import { importMangaLibrary } from '@main/services/manga/mangaLibraryImport';
import type { MangaScanResult } from '@main/services/manga/mangaLibraryScan';

function scanWithMetadata(filePath: string): MangaScanResult {
    return {
        ignored: 1,
        mangas: [
            {
                folder: join('/manga', 'One Piece'),
                sourceId: 'src-1',
                remoteId: 77,
                title: 'One Piece',
                thumbnailUrl: 'https://img.example/op.jpg',
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
                        filePath,
                        remoteId: 1001,
                        name: 'Romance Dawn',
                        number: 1,
                        dateUploaded: 1700000000000,
                        scanlator: 'Group A',
                        sourceOrder: 1,
                        pageCount: 52,
                        incomplete: false
                    }
                ]
            }
        ]
    };
}

describe('importMangaLibrary', () => {
    it('imports mangas with pullwave.json metadata, skips duplicates, and relinks moved chapters', () => {
        const db = new MangaDb(':memory:', () => {
            return 1000;
        });
        const saved: number[] = [];
        const firstPath = join('/manga', 'One Piece', 'Chapter 1.cbz');

        const added = importMangaLibrary(db, scanWithMetadata(firstPath), {
            pathSize: () => {
                return 2048;
            },
            onMangaSaved: (id) => {
                saved.push(id);
            }
        });
        expect(added).toEqual({ added: 1, relinked: 0, skipped: 0, ignored: 1 });
        expect(saved).toEqual([1]);
        expect(db.list()).toEqual([
            expect.objectContaining({
                id: 1,
                sourceId: 'src-1',
                remoteId: 77,
                title: 'One Piece',
                author: 'Oda',
                series: 'One Piece Saga',
                season: 1,
                seasonName: 'East Blue',
                chapters: [
                    expect.objectContaining({
                        remoteId: 1001,
                        name: 'Romance Dawn',
                        number: 1,
                        status: 'done',
                        filePath: firstPath,
                        sizeBytes: 2048,
                        pageCount: 52
                    })
                ]
            })
        ]);

        const skipped = importMangaLibrary(db, scanWithMetadata(firstPath), {
            pathSize: () => {
                return 2048;
            },
            onMangaSaved: (id) => {
                saved.push(id);
            }
        });
        expect(skipped).toEqual({ added: 0, relinked: 0, skipped: 1, ignored: 1 });
        expect(saved).toEqual([1]);

        const movedPath = join('/manga', 'One Piece', 'Chapter 1 (2).cbz');
        const hijackSkipped = importMangaLibrary(db, scanWithMetadata(movedPath), {
            pathSize: () => {
                return 4096;
            },
            onMangaSaved: (id) => {
                saved.push(id);
            }
        });
        expect(hijackSkipped).toEqual({ added: 0, relinked: 0, skipped: 1, ignored: 1 });
        expect(db.getLibraryManga(1)?.chapters[0]).toMatchObject({ filePath: firstPath, sizeBytes: 2048 });

        const relinked = importMangaLibrary(db, scanWithMetadata(movedPath), {
            pathSize: (candidate) => {
                return candidate === movedPath ? 4096 : null;
            },
            onMangaSaved: (id) => {
                saved.push(id);
            }
        });
        expect(relinked).toEqual({ added: 0, relinked: 1, skipped: 0, ignored: 1 });
        expect(saved).toEqual([1, 1]);
        expect(db.getLibraryManga(1)?.chapters[0]).toMatchObject({ filePath: movedPath, sizeBytes: 4096 });
        db.close();
    });

    it('imports local-only mangas without pullwave.json using negative remote IDs and preserves incomplete status', () => {
        const db = new MangaDb(':memory:', () => {
            return 2000;
        });
        const scan: MangaScanResult = {
            ignored: 0,
            mangas: [
                {
                    folder: join('/manga', 'Local Tale'),
                    sourceId: null,
                    remoteId: null,
                    title: 'Local Tale',
                    thumbnailUrl: null,
                    url: null,
                    author: 'Author',
                    artist: null,
                    description: null,
                    genres: [],
                    status: 'unknown',
                    series: null,
                    season: null,
                    seasonName: null,
                    chapters: [
                        {
                            filePath: join('/manga', 'Local Tale', 'Chapter 1.cbz'),
                            remoteId: null,
                            name: 'Chapter 1',
                            number: 1,
                            dateUploaded: null,
                            scanlator: null,
                            sourceOrder: 1,
                            pageCount: 15,
                            incomplete: true
                        }
                    ]
                }
            ]
        };

        const result = importMangaLibrary(db, scan, {
            pathSize: () => {
                return 1024;
            }
        });
        expect(result).toEqual({ added: 1, relinked: 0, skipped: 0, ignored: 0 });
        const [manga] = db.list();
        expect(manga).toMatchObject({
            sourceId: LOCAL_MANGA_SOURCE_ID,
            remoteId: -1,
            title: 'Local Tale'
        });
        expect(manga?.chapters[0]).toMatchObject({
            remoteId: -1,
            status: 'incomplete',
            pageCount: 15,
            sizeBytes: 1024
        });
        db.close();
    });
});
