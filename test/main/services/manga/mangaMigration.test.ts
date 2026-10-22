import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MangaChapter, MangaMigrationProgress } from '@shared/manga';
import { MangaDb } from '@main/services/manga/mangaDb';
import { defaultMangaMigrationFileSystem, migrateMangaFolder, type MangaMigrationFileSystem } from '@main/services/manga/mangaMigration';
import { cleanTempDirs, makeTempDir } from '../../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

interface Fixture {
    root: string;
    oldBase: string;
    newBase: string;
    db: MangaDb;
    saved: string[];
    progress: MangaMigrationProgress[];
}

function newFixture(): Fixture {
    const root = makeTempDir();
    const oldBase = join(root, 'old');
    mkdirSync(oldBase, { recursive: true });
    return { root, oldBase, newBase: join(root, 'new'), db: new MangaDb(':memory:', () => {return 5}), saved: [], progress: [] };
}

function write(path: string, content: string): void {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
}

function chapter(remoteId: number): MangaChapter {
    return { remoteId, name: `Chapter ${remoteId}`, number: remoteId, dateUploaded: null, scanlator: null, sourceOrder: remoteId };
}

// Puts a manga with a chapter in the library as downloaded, as a CBZ in the folder of the manga (or, when `images` is given, as a folder
// of images).
function addChapter(fixture: Fixture, base: string, options: { title?: string; remoteId?: number; mangaRemoteId?: number; content?: string; images?: string[]; incomplete?: boolean } = {}): { chapterId: number; path: string } {
    const { title = 'One Piece', remoteId = 1, mangaRemoteId = 7, content = 'cbz-data', images, incomplete = false } = options;
    const manga = fixture.db.upsertManga({ remoteId: mangaRemoteId, sourceId: 's', title, thumbnailUrl: null });
    const saved = fixture.db.ensureChapter(manga.id, chapter(remoteId));
    const folder = join(base, title);
    let path: string;
    let size: number;
    if (images === undefined) {
        path = join(folder, `Chapter ${remoteId}.cbz`);
        write(path, content);
        size = content.length;
    } else {
        path = join(folder, `Chapter ${remoteId}`);
        images.forEach((name) => {
            write(join(path, name), content);
        });
        size = content.length * images.length;
    }
    if (incomplete) {
        fixture.db.markIncomplete(saved.id, path, size, 3);
    } else {
        fixture.db.markDone(saved.id, path, size, 3);
    }
    return { chapterId: saved.id, path };
}

function migrate(fixture: Fixture, files?: MangaMigrationFileSystem) {
    return migrateMangaFolder({
        db: fixture.db,
        files,
        platform: process.platform,
        currentDirectory: fixture.oldBase,
        newDirectory: fixture.newBase,
        saveDirectory: (directory) => {
            fixture.saved.push(directory);
        },
        onProgress: (progress) => {
            fixture.progress.push(progress);
        }
    });
}

function filePathOf(fixture: Fixture, chapterId: number): string | null {
    return fixture.db.getChapter(chapterId)?.filePath ?? null;
}

describe('migrateMangaFolder', () => {
    describe('moving the files', () => {
        it('copies a CBZ to the same place in the new folder, points the library to the copy and removes the old file and its folders', async () => {
            const fixture = newFixture();
            const { chapterId } = addChapter(fixture, fixture.oldBase);

            expect(await migrate(fixture)).toEqual({ ok: true, chapters: 1, files: 1 });

            const moved = join(fixture.newBase, 'One Piece', 'Chapter 1.cbz');
            expect(readFileSync(moved, 'utf-8')).toBe('cbz-data');
            expect(filePathOf(fixture, chapterId)).toBe(moved);
            expect(fixture.db.getChapter(chapterId)).toMatchObject({ status: 'done', sizeBytes: 8 });
            expect(existsSync(join(fixture.oldBase, 'One Piece'))).toBe(false);
            expect(existsSync(fixture.oldBase)).toBe(false);
        });

        it('moves an incomplete chapter too, and keeps it incomplete', async () => {
            const fixture = newFixture();
            const { chapterId } = addChapter(fixture, fixture.oldBase, { incomplete: true });

            expect(await migrate(fixture)).toEqual({ ok: true, chapters: 1, files: 1 });

            const moved = join(fixture.newBase, 'One Piece', 'Chapter 1.cbz');
            expect(readFileSync(moved, 'utf-8')).toBe('cbz-data');
            expect(fixture.db.getChapter(chapterId)).toMatchObject({ status: 'incomplete', filePath: moved, sizeBytes: 8, pageCount: 3 });
            expect(existsSync(join(fixture.oldBase, 'One Piece'))).toBe(false);
        });

        it('saves the new folder in the settings, once', async () => {
            const fixture = newFixture();
            addChapter(fixture, fixture.oldBase);
            await migrate(fixture);
            expect(fixture.saved).toEqual([fixture.newBase]);
        });

        it('moves a chapter that is a folder of images, with everything inside it, and the size is the sum of the images', async () => {
            const fixture = newFixture();
            const { chapterId } = addChapter(fixture, fixture.oldBase, { images: ['001.jpg', '002.jpg', 'ComicInfo.xml'], content: 'img' });
            write(join(fixture.oldBase, 'One Piece', 'Chapter 1', 'extra', 'deep.png'), 'png');

            expect(await migrate(fixture)).toEqual({ ok: true, chapters: 1, files: 4 });

            const moved = join(fixture.newBase, 'One Piece', 'Chapter 1');
            expect(readdirSync(moved).sort()).toEqual(['001.jpg', '002.jpg', 'ComicInfo.xml', 'extra']);
            expect(readFileSync(join(moved, 'extra', 'deep.png'), 'utf-8')).toBe('png');
            expect(filePathOf(fixture, chapterId)).toBe(moved);
            expect(fixture.db.getChapter(chapterId)?.sizeBytes).toBe(3 + 3 + 3 + 3);
            expect(existsSync(join(fixture.oldBase, 'One Piece'))).toBe(false);
        });

        it('moves every chapter of every manga, keeping the folder of each manga and the name of each chapter', async () => {
            const fixture = newFixture();
            const a = addChapter(fixture, fixture.oldBase, { remoteId: 1 });
            const b = addChapter(fixture, fixture.oldBase, { remoteId: 2 });
            const c = addChapter(fixture, fixture.oldBase, { title: 'Bleach', mangaRemoteId: 8, remoteId: 1 });

            expect(await migrate(fixture)).toEqual({ ok: true, chapters: 3, files: 3 });

            expect(filePathOf(fixture, a.chapterId)).toBe(join(fixture.newBase, 'One Piece', 'Chapter 1.cbz'));
            expect(filePathOf(fixture, b.chapterId)).toBe(join(fixture.newBase, 'One Piece', 'Chapter 2.cbz'));
            expect(filePathOf(fixture, c.chapterId)).toBe(join(fixture.newBase, 'Bleach', 'Chapter 1.cbz'));
            expect(existsSync(fixture.oldBase)).toBe(false);
        });

        it('leaves alone a chapter that is not downloaded, whose file is gone, or that is outside the folder of the library', async () => {
            const fixture = newFixture();
            const manga = fixture.db.upsertManga({ remoteId: 7, sourceId: 's', title: 'One Piece', thumbnailUrl: null });
            const idle = fixture.db.ensureChapter(manga.id, chapter(1));
            const lost = fixture.db.ensureChapter(manga.id, chapter(2));
            fixture.db.markDone(lost.id, join(fixture.oldBase, 'One Piece', 'gone.cbz'), 5, 3);
            const outside = addChapter(fixture, join(fixture.root, 'elsewhere'), { remoteId: 3 });

            expect(await migrate(fixture)).toEqual({ ok: true, chapters: 0, files: 0 });

            expect(fixture.db.getChapter(idle.id)).toMatchObject({ status: 'idle', filePath: null });
            expect(filePathOf(fixture, lost.id)).toBe(join(fixture.oldBase, 'One Piece', 'gone.cbz'));
            expect(filePathOf(fixture, outside.chapterId)).toBe(outside.path);
            expect(existsSync(outside.path)).toBe(true);
            expect(fixture.saved).toEqual([fixture.newBase]);
        });

        it('keeps the old folder of the library when something else is left in it, and a folder with files the library does not know', async () => {
            const fixture = newFixture();
            addChapter(fixture, fixture.oldBase);
            write(join(fixture.oldBase, 'One Piece', 'cover.jpg'), 'mine');
            write(join(fixture.oldBase, 'readme.txt'), 'mine too');

            expect(await migrate(fixture)).toEqual({ ok: true, chapters: 1, files: 1 });

            expect(readdirSync(fixture.oldBase).sort()).toEqual(['One Piece', 'readme.txt']);
            expect(readdirSync(join(fixture.oldBase, 'One Piece'))).toEqual(['cover.jpg']);
        });

        it('only changes the setting when the library is empty', async () => {
            const fixture = newFixture();
            expect(await migrate(fixture)).toEqual({ ok: true, chapters: 0, files: 0 });
            expect(fixture.saved).toEqual([fixture.newBase]);
            expect(existsSync(fixture.newBase)).toBe(false);
        });

        it('copes with an old folder that does not exist', async () => {
            const fixture = newFixture();
            fixture.oldBase = join(fixture.root, 'never-made');
            expect(await migrate(fixture)).toEqual({ ok: true, chapters: 0, files: 0 });
        });
    });

    describe('progress', () => {
        it('starts at zero with the number of files and counts every copy', async () => {
            const fixture = newFixture();
            addChapter(fixture, fixture.oldBase, { remoteId: 1 });
            addChapter(fixture, fixture.oldBase, { remoteId: 2 });
            await migrate(fixture);
            expect(fixture.progress).toEqual([
                { done: 0, total: 2 },
                { done: 1, total: 2 },
                { done: 2, total: 2 }
            ]);
        });

        it('says there is nothing to copy for an empty library', async () => {
            const fixture = newFixture();
            await migrate(fixture);
            expect(fixture.progress).toEqual([{ done: 0, total: 0 }]);
        });
    });

    describe('refusing', () => {
        it('refuses the folder the mangas are in already, changing nothing', async () => {
            const fixture = newFixture();
            const { chapterId, path } = addChapter(fixture, fixture.oldBase);
            fixture.newBase = fixture.oldBase;

            expect(await migrate(fixture)).toEqual({ ok: false, reason: 'same' });

            expect(filePathOf(fixture, chapterId)).toBe(path);
            expect(existsSync(path)).toBe(true);
            expect(fixture.saved).toEqual([]);
            expect(fixture.progress).toEqual([]);
        });

        it('refuses the same folder written another way', async () => {
            const fixture = newFixture();
            addChapter(fixture, fixture.oldBase);
            fixture.newBase = `${fixture.oldBase}/./`;
            expect(await migrate(fixture)).toEqual({ ok: false, reason: 'same' });
        });

        it('refuses a folder inside the current one, changing nothing', async () => {
            const fixture = newFixture();
            const { chapterId, path } = addChapter(fixture, fixture.oldBase);
            fixture.newBase = join(fixture.oldBase, 'inner');

            expect(await migrate(fixture)).toEqual({ ok: false, reason: 'inside' });

            expect(filePathOf(fixture, chapterId)).toBe(path);
            expect(existsSync(join(fixture.oldBase, 'inner'))).toBe(false);
            expect(fixture.saved).toEqual([]);
        });

        it('accepts a folder that only starts with the name of the current one, and the folder above it', async () => {
            const fixture = newFixture();
            addChapter(fixture, fixture.oldBase);
            fixture.newBase = `${fixture.oldBase}-bigger`;
            expect(await migrate(fixture)).toEqual({ ok: true, chapters: 1, files: 1 });
            const above = newFixture();
            const { chapterId } = addChapter(above, above.oldBase);
            above.newBase = above.root;
            expect(await migrate(above)).toEqual({ ok: true, chapters: 1, files: 1 });
            expect(filePathOf(above, chapterId)).toBe(join(above.root, 'One Piece', 'Chapter 1.cbz'));
        });

        it('refuses when a file is already where one would be copied, overwriting nothing', async () => {
            const fixture = newFixture();
            const { chapterId, path } = addChapter(fixture, fixture.oldBase);
            const inTheWay = join(fixture.newBase, 'One Piece', 'Chapter 1.cbz');
            write(inTheWay, 'someone else');

            expect(await migrate(fixture)).toEqual({ ok: false, reason: 'conflict' });

            expect(readFileSync(inTheWay, 'utf-8')).toBe('someone else');
            expect(filePathOf(fixture, chapterId)).toBe(path);
            expect(existsSync(path)).toBe(true);
            expect(fixture.saved).toEqual([]);
        });
    });

    describe('failing half way', () => {
        // The real disk, but the n-th copy fails (or makes a copy that is not like the original).
        function failingFiles(options: { failAtCopy?: number; truncateCopy?: number }): MangaMigrationFileSystem {
            const state = { copies: 0 };
            return {
                ...defaultMangaMigrationFileSystem,
                copy: async (from, to) => {
                    state.copies += 1;
                    if (state.copies === options.failAtCopy) {
                        throw new Error('disk full');
                    }
                    await defaultMangaMigrationFileSystem.copy(from, to);
                    if (state.copies === options.truncateCopy) {
                        writeFileSync(to, 'x');
                    }
                }
            };
        }

        it('removes the copies, and the folders made for them, when a copy fails, leaving everything as it was', async () => {
            const fixture = newFixture();
            const first = addChapter(fixture, fixture.oldBase, { remoteId: 1 });
            const second = addChapter(fixture, fixture.oldBase, { remoteId: 2 });

            expect(await migrate(fixture, failingFiles({ failAtCopy: 2 }))).toEqual({ ok: false, reason: 'failed' });

            expect(existsSync(fixture.newBase)).toBe(false);
            [first, second].forEach((item) => {
                expect(filePathOf(fixture, item.chapterId)).toBe(item.path);
                expect(existsSync(item.path)).toBe(true);
            });
            expect(fixture.saved).toEqual([]);
        });

        it('keeps the folders of the new place that were there before', async () => {
            const fixture = newFixture();
            addChapter(fixture, fixture.oldBase, { remoteId: 1 });
            addChapter(fixture, fixture.oldBase, { remoteId: 2 });
            write(join(fixture.newBase, 'Other', 'file.txt'), 'mine');

            expect(await migrate(fixture, failingFiles({ failAtCopy: 2 }))).toEqual({ ok: false, reason: 'failed' });

            expect(readdirSync(fixture.newBase)).toEqual(['Other']);
        });

        it('fails when a copy is not like its original, and removes the copies', async () => {
            const fixture = newFixture();
            const first = addChapter(fixture, fixture.oldBase, { remoteId: 1 });
            addChapter(fixture, fixture.oldBase, { remoteId: 2 });

            expect(await migrate(fixture, failingFiles({ truncateCopy: 2 }))).toEqual({ ok: false, reason: 'failed' });

            expect(existsSync(fixture.newBase)).toBe(false);
            expect(filePathOf(fixture, first.chapterId)).toBe(first.path);
            expect(fixture.saved).toEqual([]);
        });

        it('fails, with everything as it was, when the new folder cannot be made', async () => {
            const fixture = newFixture();
            const first = addChapter(fixture, fixture.oldBase);
            const files: MangaMigrationFileSystem = {
                ...defaultMangaMigrationFileSystem,
                makeDirectory: () => {
                    throw new Error('read-only');
                }
            };
            expect(await migrate(fixture, files)).toEqual({ ok: false, reason: 'failed' });
            expect(filePathOf(fixture, first.chapterId)).toBe(first.path);
            expect(fixture.saved).toEqual([]);
        });

        it('points the library back to the old files and removes the copies when the settings cannot be saved', async () => {
            const fixture = newFixture();
            const first = addChapter(fixture, fixture.oldBase, { images: ['001.jpg'], content: 'img' });

            const outcome = await migrateMangaFolder({
                db: fixture.db,
                platform: process.platform,
                currentDirectory: fixture.oldBase,
                newDirectory: fixture.newBase,
                saveDirectory: () => {
                    throw new Error('cannot save');
                },
                onProgress: () => {
                    return undefined;
                }
            });

            expect(outcome).toEqual({ ok: false, reason: 'failed' });
            expect(filePathOf(fixture, first.chapterId)).toBe(first.path);
            expect(fixture.db.getChapter(first.chapterId)?.sizeBytes).toBe(3);
            expect(existsSync(first.path)).toBe(true);
            expect(existsSync(fixture.newBase)).toBe(false);
        });
    });

    describe('after the files are moved', () => {
        it('leaves a file that cannot be removed where it is, and still ends well', async () => {
            const fixture = newFixture();
            const { chapterId } = addChapter(fixture, fixture.oldBase);
            const files: MangaMigrationFileSystem = {
                ...defaultMangaMigrationFileSystem,
                removeFile: () => {
                    throw new Error('locked');
                }
            };
            expect(await migrate(fixture, files)).toEqual({ ok: true, chapters: 1, files: 1 });
            expect(filePathOf(fixture, chapterId)).toBe(join(fixture.newBase, 'One Piece', 'Chapter 1.cbz'));
            expect(existsSync(join(fixture.oldBase, 'One Piece', 'Chapter 1.cbz'))).toBe(true);
        });
    });
});

describe('defaultMangaMigrationFileSystem', () => {
    it('reads the size of a file, and nothing for a folder or something that is not there', () => {
        const root = makeTempDir();
        write(join(root, 'a.txt'), 'abc');
        expect(defaultMangaMigrationFileSystem.size(join(root, 'a.txt'))).toBe(3);
        expect(defaultMangaMigrationFileSystem.size(root)).toBeNull();
        expect(defaultMangaMigrationFileSystem.size(join(root, 'nope'))).toBeNull();
    });

    it('tells a folder from a file and from what is not there', () => {
        const root = makeTempDir();
        write(join(root, 'a.txt'), 'abc');
        expect(defaultMangaMigrationFileSystem.isDirectory(root)).toBe(true);
        expect(defaultMangaMigrationFileSystem.isDirectory(join(root, 'a.txt'))).toBe(false);
        expect(defaultMangaMigrationFileSystem.isDirectory(join(root, 'nope'))).toBe(false);
        expect(defaultMangaMigrationFileSystem.exists(join(root, 'a.txt'))).toBe(true);
        expect(defaultMangaMigrationFileSystem.exists(join(root, 'nope'))).toBe(false);
    });

    it('lists every file inside a folder, with the path from it using slashes', () => {
        const root = makeTempDir();
        write(join(root, 'a.txt'), '1');
        write(join(root, 'sub', 'b.txt'), '2');
        write(join(root, 'sub', 'deep', 'c.txt'), '3');
        expect(defaultMangaMigrationFileSystem.listFiles(root).sort()).toEqual(['a.txt', 'sub/b.txt', 'sub/deep/c.txt']);
    });

    it('copies a file without overwriting, makes folders, removes a file and an empty folder only', async () => {
        const root = makeTempDir();
        write(join(root, 'a.txt'), 'abc');
        defaultMangaMigrationFileSystem.makeDirectory(join(root, 'x', 'y'));
        await defaultMangaMigrationFileSystem.copy(join(root, 'a.txt'), join(root, 'x', 'y', 'a.txt'));
        expect(readFileSync(join(root, 'x', 'y', 'a.txt'), 'utf-8')).toBe('abc');
        await expect(defaultMangaMigrationFileSystem.copy(join(root, 'a.txt'), join(root, 'x', 'y', 'a.txt'))).rejects.toThrow();
        expect(() => {
            defaultMangaMigrationFileSystem.removeEmptyDirectory(join(root, 'x', 'y'));
        }).toThrow();
        defaultMangaMigrationFileSystem.removeFile(join(root, 'x', 'y', 'a.txt'));
        defaultMangaMigrationFileSystem.removeEmptyDirectory(join(root, 'x', 'y'));
        expect(existsSync(join(root, 'x', 'y'))).toBe(false);
        defaultMangaMigrationFileSystem.removeFile(join(root, 'nope'));
    });
});
