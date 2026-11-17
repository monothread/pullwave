import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MangaChapter, MangaMigrationProgress } from '@shared/manga';
import { MangaDb } from '@main/services/manga/mangaDb';
import { defaultMangaMigrationFileSystem, migrateMangaFolder, renameMangaFolder, type MangaFolderRenameDependencies, type MangaMigrationFileSystem } from '@main/services/manga/mangaMigration';
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

describe('renameMangaFolder', () => {
    function rename(fixture: Fixture, options: { mangaRemoteId?: number; from?: string; to?: string; files?: MangaMigrationFileSystem; db?: MangaFolderRenameDependencies['db'] } = {}) {
        const manga = fixture.db.list().find((item) => {
            return item.remoteId === (options.mangaRemoteId ?? 7);
        });
        if (manga === undefined) {
            throw new Error('no manga');
        }
        return renameMangaFolder({
            db: options.db ?? fixture.db,
            files: options.files,
            platform: process.platform,
            manga,
            currentFolder: join(fixture.oldBase, options.from ?? 'One Piece'),
            newFolder: join(fixture.oldBase, options.to ?? 'New Title')
        });
    }

    function filesIn(folder: string): string[] {
        return existsSync(folder) ? readdirSync(folder, { recursive: true, encoding: 'utf-8' }).sort() : [];
    }

    it('moves the chapters of the manga to the folder of its new title, points the library to them and removes the old folder', async () => {
        const fixture = newFixture();
        const first = addChapter(fixture, fixture.oldBase, { remoteId: 1, content: 'one' });
        const second = addChapter(fixture, fixture.oldBase, { remoteId: 2, images: ['001.jpg', '002.jpg'], content: 'img' });

        expect(await rename(fixture)).toEqual({ ok: true });

        const folder = join(fixture.oldBase, 'New Title');
        expect(filesIn(folder)).toEqual(['Chapter 1.cbz', 'Chapter 2', join('Chapter 2', '001.jpg'), join('Chapter 2', '002.jpg')]);
        expect(readFileSync(join(folder, 'Chapter 1.cbz'), 'utf-8')).toBe('one');
        expect(fixture.db.getChapter(first.chapterId)).toMatchObject({ status: 'done', filePath: join(folder, 'Chapter 1.cbz'), sizeBytes: 3 });
        expect(fixture.db.getChapter(second.chapterId)).toMatchObject({ status: 'done', filePath: join(folder, 'Chapter 2'), sizeBytes: 6 });
        expect(existsSync(join(fixture.oldBase, 'One Piece'))).toBe(false);
        expect(readdirSync(fixture.oldBase)).toEqual(['New Title']);
        expect(fixture.db.chaptersOf(fixture.db.list()[0]!.id)).toHaveLength(2);
    });

    it('leaves the other mangas and the folder of the mangas where they are', async () => {
        const fixture = newFixture();
        addChapter(fixture, fixture.oldBase);
        const other = addChapter(fixture, fixture.oldBase, { title: 'Bleach', mangaRemoteId: 8 });

        expect(await rename(fixture)).toEqual({ ok: true });

        expect(filePathOf(fixture, other.chapterId)).toBe(other.path);
        expect(filesIn(join(fixture.oldBase, 'Bleach'))).toEqual(['Chapter 1.cbz']);
        expect(readdirSync(fixture.oldBase).sort()).toEqual(['Bleach', 'New Title']);
    });

    it('leaves a chapter kept outside the folder of the manga where it is', async () => {
        const fixture = newFixture();
        const elsewhere = addChapter(fixture, join(fixture.root, 'elsewhere'));

        expect(await rename(fixture)).toEqual({ ok: true });

        expect(filePathOf(fixture, elsewhere.chapterId)).toBe(elsewhere.path);
        expect(existsSync(elsewhere.path)).toBe(true);
        expect(existsSync(join(fixture.oldBase, 'New Title'))).toBe(false);
    });

    it('does nothing to the files when the manga has none downloaded', async () => {
        const fixture = newFixture();
        fixture.db.upsertManga({ remoteId: 7, sourceId: 's', title: 'One Piece', thumbnailUrl: null });

        expect(await rename(fixture)).toEqual({ ok: true });

        expect(readdirSync(fixture.oldBase)).toEqual([]);
    });

    it('does nothing to the files when both titles make the same folder', async () => {
        const fixture = newFixture();
        const { chapterId, path } = addChapter(fixture, fixture.oldBase);

        expect(await rename(fixture, { to: 'One Piece' })).toEqual({ ok: true });

        expect(filePathOf(fixture, chapterId)).toBe(path);
        expect(filesIn(join(fixture.oldBase, 'One Piece'))).toEqual(['Chapter 1.cbz']);
    });

    it('says there is a conflict, and changes nothing, when the folder of the new title has a file with the same name', async () => {
        const fixture = newFixture();
        const { chapterId, path } = addChapter(fixture, fixture.oldBase, { content: 'mine' });
        write(join(fixture.oldBase, 'New Title', 'Chapter 1.cbz'), 'theirs');

        expect(await rename(fixture)).toEqual({ ok: false, reason: 'conflict' });

        expect(filePathOf(fixture, chapterId)).toBe(path);
        expect(readFileSync(path, 'utf-8')).toBe('mine');
        expect(readFileSync(join(fixture.oldBase, 'New Title', 'Chapter 1.cbz'), 'utf-8')).toBe('theirs');
        expect(filesIn(join(fixture.oldBase, 'New Title'))).toEqual(['Chapter 1.cbz']);
    });

    it('says it failed, and leaves everything as it was, when the folder cannot be renamed and a copy fails', async () => {
        const fixture = newFixture();
        const first = addChapter(fixture, fixture.oldBase, { remoteId: 1 });
        const second = addChapter(fixture, fixture.oldBase, { remoteId: 2 });
        let copies = 0;
        const files: MangaMigrationFileSystem = {
            ...defaultMangaMigrationFileSystem,
            rename: () => {
                throw new Error('cannot rename');
            },
            copy: async (from, to) => {
                copies += 1;
                if (copies === 2) {
                    throw new Error('disk full');
                }
                await defaultMangaMigrationFileSystem.copy(from, to);
            }
        };

        expect(await rename(fixture, { files })).toEqual({ ok: false, reason: 'failed' });

        expect(existsSync(join(fixture.oldBase, 'New Title'))).toBe(false);
        [first, second].forEach((item) => {
            expect(filePathOf(fixture, item.chapterId)).toBe(item.path);
            expect(existsSync(item.path)).toBe(true);
        });
    });

    it('says it failed when the new folder would be inside the old one', async () => {
        const fixture = newFixture();
        const { chapterId, path } = addChapter(fixture, fixture.oldBase);

        expect(await rename(fixture, { to: join('One Piece', 'Inside') })).toEqual({ ok: false, reason: 'failed' });

        expect(filePathOf(fixture, chapterId)).toBe(path);
    });

    it('keeps the library on the copies when the folder cannot be renamed and an old file cannot be removed, which is left behind', async () => {
        const fixture = newFixture();
        const { chapterId, path } = addChapter(fixture, fixture.oldBase);
        const files: MangaMigrationFileSystem = {
            ...defaultMangaMigrationFileSystem,
            rename: () => {
                throw new Error('cannot rename');
            },
            removeFile: () => {
                throw new Error('locked');
            }
        };

        expect(await rename(fixture, { files })).toEqual({ ok: true });

        expect(filePathOf(fixture, chapterId)).toBe(join(fixture.oldBase, 'New Title', 'Chapter 1.cbz'));
        expect(existsSync(path)).toBe(true);
    });

    it('renames the whole folder at once, with what else is in it and the work of a chapter cut short, and points the library to them', async () => {
        const fixture = newFixture();
        const done = addChapter(fixture, fixture.oldBase, { remoteId: 1 });
        const manga = fixture.db.list()[0]!;
        const interrupted = fixture.db.ensureChapter(manga.id, chapter(3));
        fixture.db.setOutputPath(interrupted.id, join(fixture.oldBase, 'One Piece', 'Chapter 3.cbz'));
        write(join(fixture.oldBase, 'One Piece', 'Chapter 3.cbz.part', '001.jpg'), 'page');
        write(join(fixture.oldBase, 'One Piece', 'notes.txt'), 'mine');
        const copies: string[] = [];
        const files: MangaMigrationFileSystem = {
            ...defaultMangaMigrationFileSystem,
            copy: async (from, to) => {
                copies.push(from);
                await defaultMangaMigrationFileSystem.copy(from, to);
            }
        };

        expect(await rename(fixture, { files })).toEqual({ ok: true });

        const folder = join(fixture.oldBase, 'New Title');
        expect(copies).toEqual([]);
        expect(readdirSync(fixture.oldBase)).toEqual(['New Title']);
        expect(filesIn(folder)).toEqual(['Chapter 1.cbz', 'Chapter 3.cbz.part', join('Chapter 3.cbz.part', '001.jpg'), 'notes.txt']);
        expect(fixture.db.getChapter(done.chapterId)).toMatchObject({ status: 'done', filePath: join(folder, 'Chapter 1.cbz'), sizeBytes: 8 });
        expect(fixture.db.outputPathOf(interrupted.id)).toBe(join(folder, 'Chapter 3.cbz'));
    });

    it('puts the folder back, with the library still pointing into it, when the library cannot be pointed to the renamed folder', async () => {
        const fixture = newFixture();
        const { chapterId, path } = addChapter(fixture, fixture.oldBase);
        const manga = fixture.db.list()[0]!;
        const interrupted = fixture.db.ensureChapter(manga.id, chapter(3));
        fixture.db.setOutputPath(interrupted.id, join(fixture.oldBase, 'One Piece', 'Chapter 3.cbz'));
        const relinks: unknown[] = [];
        const db: MangaFolderRenameDependencies['db'] = {
            relinkChapters: (updates) => {
                fixture.db.relinkChapters(updates);
            },
            outputPathOf: (id) => {
                return fixture.db.outputPathOf(id);
            },
            relinkFolder: (links) => {
                relinks.push(links);
                throw new Error('disk full');
            }
        };

        expect(await rename(fixture, { db })).toEqual({ ok: false, reason: 'failed' });

        expect(relinks).toEqual([
            { chapters: [{ chapterId, filePath: join(fixture.oldBase, 'New Title', 'Chapter 1.cbz'), sizeBytes: 8 }], outputs: [{ chapterId: interrupted.id, outputPath: join(fixture.oldBase, 'New Title', 'Chapter 3.cbz') }] }
        ]);
        expect(readdirSync(fixture.oldBase)).toEqual(['One Piece']);
        expect(filePathOf(fixture, chapterId)).toBe(path);
        expect(existsSync(path)).toBe(true);
        expect(fixture.db.outputPathOf(interrupted.id)).toBe(join(fixture.oldBase, 'One Piece', 'Chapter 3.cbz'));
    });

    it('copies the chapters when the folder cannot be renamed', async () => {
        const fixture = newFixture();
        const { chapterId } = addChapter(fixture, fixture.oldBase);
        const files: MangaMigrationFileSystem = {
            ...defaultMangaMigrationFileSystem,
            rename: () => {
                throw new Error('other drive');
            }
        };

        expect(await rename(fixture, { files })).toEqual({ ok: true });

        expect(filePathOf(fixture, chapterId)).toBe(join(fixture.oldBase, 'New Title', 'Chapter 1.cbz'));
        expect(readdirSync(fixture.oldBase)).toEqual(['New Title']);
    });

    it('copies the chapters into the folder of the new title when it is there already', async () => {
        const fixture = newFixture();
        const { chapterId } = addChapter(fixture, fixture.oldBase);
        write(join(fixture.oldBase, 'New Title', 'cover.jpg'), 'jpg');

        expect(await rename(fixture)).toEqual({ ok: true });

        expect(filePathOf(fixture, chapterId)).toBe(join(fixture.oldBase, 'New Title', 'Chapter 1.cbz'));
        expect(filesIn(join(fixture.oldBase, 'New Title'))).toEqual(['Chapter 1.cbz', 'cover.jpg']);
        expect(existsSync(join(fixture.oldBase, 'One Piece'))).toBe(false);
    });

    it('takes the work of a chapter cut short along when it copies the chapters, so the download goes on in the folder of the new title', async () => {
        const fixture = newFixture();
        addChapter(fixture, fixture.oldBase);
        const manga = fixture.db.list()[0]!;
        const interrupted = fixture.db.ensureChapter(manga.id, chapter(3));
        fixture.db.setOutputPath(interrupted.id, join(fixture.oldBase, 'One Piece', 'Chapter 3.cbz'));
        write(join(fixture.oldBase, 'One Piece', 'Chapter 3.cbz.part', '001.jpg'), 'page');
        write(join(fixture.oldBase, 'New Title', 'cover.jpg'), 'jpg');

        expect(await rename(fixture)).toEqual({ ok: true });

        expect(fixture.db.outputPathOf(interrupted.id)).toBe(join(fixture.oldBase, 'New Title', 'Chapter 3.cbz'));
        expect(filesIn(join(fixture.oldBase, 'New Title'))).toEqual(['Chapter 1.cbz', 'Chapter 3.cbz.part', join('Chapter 3.cbz.part', '001.jpg'), 'cover.jpg']);
        expect(existsSync(join(fixture.oldBase, 'One Piece'))).toBe(false);
    });

    describe('when it copies the chapters and a chapter was cut short', () => {
        function withCutShortWork() {
            const fixture = newFixture();
            addChapter(fixture, fixture.oldBase);
            const manga = fixture.db.list()[0]!;
            const interrupted = fixture.db.ensureChapter(manga.id, chapter(3));
            const waiting = fixture.db.ensureChapter(manga.id, chapter(4));
            fixture.db.setOutputPath(interrupted.id, join(fixture.oldBase, 'One Piece', 'Chapter 3.cbz'));
            fixture.db.setOutputPath(waiting.id, join(fixture.oldBase, 'One Piece', 'Chapter 4.cbz'));
            write(join(fixture.oldBase, 'One Piece', 'Chapter 3.cbz.part', '001.jpg'), 'page');
            write(join(fixture.oldBase, 'New Title', 'cover.jpg'), 'jpg');
            return { fixture, interrupted, waiting };
        }

        it('points a chapter with no work yet to the folder of the new title', async () => {
            const { fixture, waiting } = withCutShortWork();
            expect(await rename(fixture)).toEqual({ ok: true });
            expect(fixture.db.outputPathOf(waiting.id)).toBe(join(fixture.oldBase, 'New Title', 'Chapter 4.cbz'));
        });

        it('leaves the work where it is, and the old folder with it, when the folder of the new title has work with the same name', async () => {
            const { fixture, interrupted } = withCutShortWork();
            write(join(fixture.oldBase, 'New Title', 'Chapter 3.cbz.part', '009.jpg'), 'other');
            expect(await rename(fixture)).toEqual({ ok: true });
            expect(fixture.db.outputPathOf(interrupted.id)).toBe(join(fixture.oldBase, 'One Piece', 'Chapter 3.cbz'));
            expect(filesIn(join(fixture.oldBase, 'One Piece'))).toEqual(['Chapter 3.cbz.part', join('Chapter 3.cbz.part', '001.jpg')]);
            expect(filesIn(join(fixture.oldBase, 'New Title', 'Chapter 3.cbz.part'))).toEqual(['009.jpg']);
        });

        it('puts the work back where the library says it is when the library cannot be pointed to it', async () => {
            const { fixture, interrupted } = withCutShortWork();
            const db: MangaFolderRenameDependencies['db'] = {
                relinkChapters: (updates) => {
                    fixture.db.relinkChapters(updates);
                },
                outputPathOf: (id) => {
                    return fixture.db.outputPathOf(id);
                },
                relinkFolder: () => {
                    throw new Error('disk full');
                }
            };
            expect(await rename(fixture, { db })).toEqual({ ok: true });
            expect(fixture.db.outputPathOf(interrupted.id)).toBe(join(fixture.oldBase, 'One Piece', 'Chapter 3.cbz'));
            expect(filesIn(join(fixture.oldBase, 'One Piece'))).toEqual(['Chapter 3.cbz.part', join('Chapter 3.cbz.part', '001.jpg')]);
            expect(filesIn(join(fixture.oldBase, 'New Title'))).toEqual(['Chapter 1.cbz', 'cover.jpg']);
        });
    });

    it('does nothing to the files on Windows when the titles differ only in the case of their letters, which is the same folder there', async () => {
        const fixture = newFixture();
        addChapter(fixture, fixture.oldBase);
        const manga = fixture.db.list()[0]!;
        const untouchable: MangaMigrationFileSystem = Object.fromEntries(
            Object.keys(defaultMangaMigrationFileSystem).map((name) => {
                return [
                    name,
                    () => {
                        throw new Error(`no ${name}`);
                    }
                ];
            })
        ) as unknown as MangaMigrationFileSystem;
        const outcome = await renameMangaFolder({ db: fixture.db, files: untouchable, platform: 'win32', manga, currentFolder: 'C:\\M\\one piece', newFolder: 'C:\\M\\One Piece' });
        expect(outcome).toEqual({ ok: true });
        expect(fixture.db.getChapter(manga.chapters[0]!.id)?.filePath).toBe(manga.chapters[0]!.filePath);
    });

    it('moves the folder on Windows when the titles differ in more than the case', async () => {
        const fixture = newFixture();
        addChapter(fixture, fixture.oldBase);
        const manga = fixture.db.list()[0]!;
        const renamed: string[][] = [];
        const files: MangaMigrationFileSystem = {
            ...defaultMangaMigrationFileSystem,
            exists: (path) => {
                return path === 'C:\\M\\one piece';
            },
            rename: (from, to) => {
                renamed.push([from, to]);
            }
        };
        const outcome = await renameMangaFolder({ db: fixture.db, files, platform: 'win32', manga, currentFolder: 'C:\\M\\one piece', newFolder: 'C:\\M\\Two Piece' });
        expect(outcome).toEqual({ ok: true });
        expect(renamed).toEqual([['C:\\M\\one piece', 'C:\\M\\Two Piece']]);
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

    it('renames a folder with everything inside it, and fails for a folder that is not there', () => {
        const root = makeTempDir();
        write(join(root, 'old', 'sub', 'a.txt'), 'abc');
        defaultMangaMigrationFileSystem.rename(join(root, 'old'), join(root, 'new'));
        expect(readFileSync(join(root, 'new', 'sub', 'a.txt'), 'utf-8')).toBe('abc');
        expect(existsSync(join(root, 'old'))).toBe(false);
        expect(() => {
            defaultMangaMigrationFileSystem.rename(join(root, 'old'), join(root, 'other'));
        }).toThrow();
    });
});
