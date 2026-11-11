import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnimeMigrationProgress } from '@shared/anime';
import { AnimeDb } from '@main/services/animeDb';
import { defaultMigrationFileSystem, migrateAnimeFolder, type MigrationFileSystem } from '@main/services/animeMigration';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

afterEach(() => {
    cleanTempDirs();
});

interface Fixture {
    root: string;
    oldBase: string;
    newBase: string;
    db: AnimeDb;
    saved: string[];
    progress: AnimeMigrationProgress[];
}

function newFixture(): Fixture {
    const root = makeTempDir();
    const oldBase = join(root, 'old');
    mkdirSync(oldBase, { recursive: true });
    const db = new AnimeDb(':memory:', () => {
        return 5;
    });
    return { root, oldBase, newBase: join(root, 'new'), db, saved: [], progress: [] };
}

function write(path: string, content: string): void {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
}

// Puts an episode in the library as downloaded, with a video (and a subtitle and metadata beside it) in the folder given.
function addEpisode(fixture: Fixture, folder: string, options: { title?: string; number?: string; series?: string; season?: number; content?: string } = {}): { episodeId: number; video: string } {
    const { title = 'Naruto', number = '1', content = 'video-data' } = options;
    const anime = fixture.db.upsertAnime({ title, query: title.toLowerCase(), searchIndex: 1 });
    if (options.series !== undefined && options.season !== undefined) {
        fixture.db.setSeries(anime.id, options.series, options.season, null);
    }
    const video = join(folder, `${title} Episode ${number}.mp4`);
    write(video, content);
    write(join(folder, `${title} Episode ${number}.vtt`), 'WEBVTT');
    write(join(folder, 'pullwave.json'), `{"number":"${number}"}`);
    const episode = fixture.db.ensureEpisode(anime.id, number);
    fixture.db.markDone(episode.id, video, content.length);
    return { episodeId: episode.id, video };
}

function migrate(fixture: Fixture, files?: MigrationFileSystem) {
    return migrateAnimeFolder({
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

function filePathOf(fixture: Fixture, episodeId: number): string | null {
    return fixture.db.getEpisode(episodeId)?.filePath ?? null;
}

describe('migrateAnimeFolder', () => {
    describe('moving the files', () => {
        it('copies the video, the subtitle and the metadata of an episode to the layout of the new folder and removes the old ones', async () => {
            const fixture = newFixture();
            const { episodeId } = addEpisode(fixture, join(fixture.oldBase, 'Naruto', 'Episode 1'));

            const outcome = await migrate(fixture);

            expect(outcome).toEqual({ ok: true, episodes: 1, files: 3 });
            const folder = join(fixture.newBase, 'Naruto', 'Episode 1');
            expect(readdirSync(folder).sort()).toEqual(['Naruto Episode 1.mp4', 'Naruto Episode 1.vtt', 'pullwave.json']);
            expect(readFileSync(join(folder, 'Naruto Episode 1.mp4'), 'utf-8')).toBe('video-data');
            expect(readFileSync(join(folder, 'Naruto Episode 1.vtt'), 'utf-8')).toBe('WEBVTT');
            expect(readFileSync(join(folder, 'pullwave.json'), 'utf-8')).toBe('{"number":"1"}');
            expect(existsSync(join(fixture.oldBase, 'Naruto'))).toBe(false);
            expect(filePathOf(fixture, episodeId)).toBe(join(folder, 'Naruto Episode 1.mp4'));
            expect(fixture.db.getEpisode(episodeId)).toMatchObject({ status: 'done', sizeBytes: 10 });
        });

        it('saves the new folder in the settings, once, after the library points to it', async () => {
            const fixture = newFixture();
            addEpisode(fixture, join(fixture.oldBase, 'Naruto', 'Episode 1'));
            await migrate(fixture);
            expect(fixture.saved).toEqual([fixture.newBase]);
        });

        it('keeps the layout of a season of a series', async () => {
            const fixture = newFixture();
            const { episodeId } = addEpisode(fixture, join(fixture.oldBase, 'Frieren', 'Season 2', 'Episode 3'), { title: 'Frieren 2', number: '3', series: 'Frieren', season: 2 });

            const outcome = await migrate(fixture);

            expect(outcome).toEqual({ ok: true, episodes: 1, files: 3 });
            expect(filePathOf(fixture, episodeId)).toBe(join(fixture.newBase, 'Frieren', 'Season 2', 'Episode 3', 'Frieren 2 Episode 3.mp4'));
            expect(existsSync(join(fixture.oldBase, 'Frieren'))).toBe(false);
        });

        it('moves every episode of every anime', async () => {
            const fixture = newFixture();
            const first = addEpisode(fixture, join(fixture.oldBase, 'Naruto', 'Episode 1'));
            const second = addEpisode(fixture, join(fixture.oldBase, 'Naruto', 'Episode 2'), { number: '2' });
            const third = addEpisode(fixture, join(fixture.oldBase, 'Bleach', 'Episode 1'), { title: 'Bleach' });
            const dubbed = addEpisode(fixture, join(fixture.oldBase, 'Naruto Dub', 'Episode 1'), { title: 'Naruto Dub' });

            expect(await migrate(fixture)).toEqual({ ok: true, episodes: 4, files: 12 });

            expect(filePathOf(fixture, first.episodeId)).toBe(join(fixture.newBase, 'Naruto', 'Episode 1', 'Naruto Episode 1.mp4'));
            expect(filePathOf(fixture, second.episodeId)).toBe(join(fixture.newBase, 'Naruto', 'Episode 2', 'Naruto Episode 2.mp4'));
            expect(filePathOf(fixture, third.episodeId)).toBe(join(fixture.newBase, 'Bleach', 'Episode 1', 'Bleach Episode 1.mp4'));
            expect(filePathOf(fixture, dubbed.episodeId)).toBe(join(fixture.newBase, 'Naruto Dub', 'Episode 1', 'Naruto Dub Episode 1.mp4'));
            expect(existsSync(fixture.oldBase)).toBe(false);
        });

        it('brings in an anime that was outside the old folder, and removes its emptied folders', async () => {
            const fixture = newFixture();
            const outside = join(fixture.root, 'external');
            const { episodeId } = addEpisode(fixture, join(outside, 'Bleach', 'Episode 1'), { title: 'Bleach' });

            expect(await migrate(fixture)).toEqual({ ok: true, episodes: 1, files: 3 });

            expect(filePathOf(fixture, episodeId)).toBe(join(fixture.newBase, 'Bleach', 'Episode 1', 'Bleach Episode 1.mp4'));
            expect(existsSync(join(outside, 'Bleach'))).toBe(false);
            expect(existsSync(outside)).toBe(true);
        });

        it('moves an episode saved before each episode had a folder of its own, and leaves the folder the user chose alone', async () => {
            const fixture = newFixture();
            const chosen = join(fixture.root, 'my-videos');
            const { episodeId } = addEpisode(fixture, chosen);

            expect(await migrate(fixture)).toEqual({ ok: true, episodes: 1, files: 3 });

            expect(filePathOf(fixture, episodeId)).toBe(join(fixture.newBase, 'Naruto', 'Episode 1', 'Naruto Episode 1.mp4'));
            expect(existsSync(chosen)).toBe(true);
            expect(readdirSync(chosen)).toEqual([]);
        });

        it('removes the old folder of the library when nothing is left in it', async () => {
            const fixture = newFixture();
            addEpisode(fixture, join(fixture.oldBase, 'Naruto', 'Episode 1'));
            await migrate(fixture);
            expect(existsSync(fixture.oldBase)).toBe(false);
        });

        it('keeps the old folder of the library when something else is left in it', async () => {
            const fixture = newFixture();
            addEpisode(fixture, join(fixture.oldBase, 'Naruto', 'Episode 1'));
            write(join(fixture.oldBase, 'readme.txt'), 'mine');
            await migrate(fixture);
            expect(readdirSync(fixture.oldBase)).toEqual(['readme.txt']);
        });

        it('never removes a folder that still has something the library does not know', async () => {
            const fixture = newFixture();
            const folder = join(fixture.oldBase, 'Naruto', 'Episode 1');
            addEpisode(fixture, folder);
            write(join(folder, 'notes.txt'), 'keep me');
            write(join(fixture.oldBase, 'Other thing', 'a.txt'), 'keep me too');

            expect(await migrate(fixture)).toEqual({ ok: true, episodes: 1, files: 3 });

            expect(readdirSync(folder)).toEqual(['notes.txt']);
            expect(readFileSync(join(folder, 'notes.txt'), 'utf-8')).toBe('keep me');
            expect(readFileSync(join(fixture.oldBase, 'Other thing', 'a.txt'), 'utf-8')).toBe('keep me too');
        });

        it('leaves in place an episode that is not downloaded or whose video is gone', async () => {
            const fixture = newFixture();
            const anime = fixture.db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1 });
            const queued = fixture.db.ensureEpisode(anime.id, '1');
            const lost = fixture.db.ensureEpisode(anime.id, '2');
            fixture.db.markDone(lost.id, join(fixture.oldBase, 'Naruto', 'Episode 2', 'gone.mp4'), 5);
            const withoutPath = fixture.db.ensureEpisode(anime.id, '3');
            fixture.db.markDone(withoutPath.id, '', 0);
            fixture.db.relinkEpisode(withoutPath.id, join(fixture.oldBase, 'missing.mp4'), 0);

            expect(await migrate(fixture)).toEqual({ ok: true, episodes: 0, files: 0 });

            expect(fixture.db.getEpisode(queued.id)).toMatchObject({ status: 'queued', filePath: null });
            expect(filePathOf(fixture, lost.id)).toBe(join(fixture.oldBase, 'Naruto', 'Episode 2', 'gone.mp4'));
            expect(filePathOf(fixture, withoutPath.id)).toBe(join(fixture.oldBase, 'missing.mp4'));
            expect(fixture.saved).toEqual([fixture.newBase]);
        });

        it('only changes the setting when the library is empty', async () => {
            const fixture = newFixture();
            expect(await migrate(fixture)).toEqual({ ok: true, episodes: 0, files: 0 });
            expect(fixture.saved).toEqual([fixture.newBase]);
            expect(existsSync(fixture.newBase)).toBe(false);
        });

        it('copes with an old folder that does not exist', async () => {
            const fixture = newFixture();
            fixture.oldBase = join(fixture.root, 'never-made');
            expect(await migrate(fixture)).toEqual({ ok: true, episodes: 0, files: 0 });
        });

        it('keeps the files that only exist as an episode of the library once (no subtitle, no metadata)', async () => {
            const fixture = newFixture();
            const folder = join(fixture.oldBase, 'Naruto', 'Episode 1');
            const anime = fixture.db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1 });
            const video = join(folder, 'Naruto Episode 1.mp4');
            write(video, 'abc');
            const episode = fixture.db.ensureEpisode(anime.id, '1');
            fixture.db.markDone(episode.id, video, 3);

            expect(await migrate(fixture)).toEqual({ ok: true, episodes: 1, files: 1 });
            expect(readdirSync(join(fixture.newBase, 'Naruto', 'Episode 1'))).toEqual(['Naruto Episode 1.mp4']);
        });
    });

    describe('progress', () => {
        it('starts at zero with the number of files and counts every copy', async () => {
            const fixture = newFixture();
            addEpisode(fixture, join(fixture.oldBase, 'Naruto', 'Episode 1'));
            await migrate(fixture);
            expect(fixture.progress).toEqual([
                { done: 0, total: 3 },
                { done: 1, total: 3 },
                { done: 2, total: 3 },
                { done: 3, total: 3 }
            ]);
        });

        it('says there is nothing to copy for an empty library', async () => {
            const fixture = newFixture();
            await migrate(fixture);
            expect(fixture.progress).toEqual([{ done: 0, total: 0 }]);
        });
    });

    describe('refusing', () => {
        it('refuses the folder the anime are in already, changing nothing', async () => {
            const fixture = newFixture();
            const { episodeId, video } = addEpisode(fixture, join(fixture.oldBase, 'Naruto', 'Episode 1'));
            fixture.newBase = fixture.oldBase;

            expect(await migrate(fixture)).toEqual({ ok: false, reason: 'same' });

            expect(filePathOf(fixture, episodeId)).toBe(video);
            expect(existsSync(video)).toBe(true);
            expect(fixture.saved).toEqual([]);
            expect(fixture.progress).toEqual([]);
        });

        it('refuses the same folder written another way', async () => {
            const fixture = newFixture();
            addEpisode(fixture, join(fixture.oldBase, 'Naruto', 'Episode 1'));
            fixture.newBase = `${fixture.oldBase}/./`;
            expect(await migrate(fixture)).toEqual({ ok: false, reason: 'same' });
        });

        it('refuses a folder inside the current one, changing nothing', async () => {
            const fixture = newFixture();
            const { episodeId, video } = addEpisode(fixture, join(fixture.oldBase, 'Naruto', 'Episode 1'));
            fixture.newBase = join(fixture.oldBase, 'inner');

            expect(await migrate(fixture)).toEqual({ ok: false, reason: 'inside' });

            expect(filePathOf(fixture, episodeId)).toBe(video);
            expect(existsSync(join(fixture.oldBase, 'inner'))).toBe(false);
            expect(fixture.saved).toEqual([]);
        });

        it('accepts a folder that only starts with the name of the current one', async () => {
            const fixture = newFixture();
            addEpisode(fixture, join(fixture.oldBase, 'Naruto', 'Episode 1'));
            fixture.newBase = `${fixture.oldBase}-bigger`;
            expect(await migrate(fixture)).toEqual({ ok: true, episodes: 1, files: 3 });
        });

        it('accepts the folder above the current one', async () => {
            const fixture = newFixture();
            const { episodeId } = addEpisode(fixture, join(fixture.oldBase, 'Naruto', 'Episode 1'));
            fixture.newBase = fixture.root;
            expect(await migrate(fixture)).toEqual({ ok: true, episodes: 1, files: 3 });
            expect(filePathOf(fixture, episodeId)).toBe(join(fixture.root, 'Naruto', 'Episode 1', 'Naruto Episode 1.mp4'));
        });

        it('refuses when a file is already where one would be copied, overwriting nothing', async () => {
            const fixture = newFixture();
            const { episodeId, video } = addEpisode(fixture, join(fixture.oldBase, 'Naruto', 'Episode 1'));
            const inTheWay = join(fixture.newBase, 'Naruto', 'Episode 1', 'Naruto Episode 1.mp4');
            write(inTheWay, 'someone else');

            expect(await migrate(fixture)).toEqual({ ok: false, reason: 'conflict' });

            expect(readFileSync(inTheWay, 'utf-8')).toBe('someone else');
            expect(readdirSync(join(fixture.newBase, 'Naruto', 'Episode 1'))).toEqual(['Naruto Episode 1.mp4']);
            expect(filePathOf(fixture, episodeId)).toBe(video);
            expect(existsSync(video)).toBe(true);
            expect(fixture.saved).toEqual([]);
        });

        it('refuses when two episodes would be copied to the same file', async () => {
            const fixture = newFixture();
            // Two anime whose titles become the same name of a folder end up in the same place: a name does not start with a dot, on Linux as
            // on Windows (and both titles are names a file can have on either system).
            const first = addEpisode(fixture, join(fixture.oldBase, 'one', 'Episode 1'), { title: 'Naruto' });
            const second = addEpisode(fixture, join(fixture.root, 'two', 'Episode 1'), { title: '.Naruto' });

            expect(await migrate(fixture)).toEqual({ ok: false, reason: 'conflict' });

            expect(filePathOf(fixture, first.episodeId)).toBe(first.video);
            expect(filePathOf(fixture, second.episodeId)).toBe(second.video);
            expect(existsSync(fixture.newBase)).toBe(false);
        });
    });

    describe('failing half way', () => {
        // The real disk, but the n-th copy fails (or makes a copy that is not like the original).
        function failingFiles(options: { failAtCopy?: number; truncateCopy?: number }): MigrationFileSystem & { copies: number } {
            const state = { copies: 0 };
            return {
                ...defaultMigrationFileSystem,
                get copies() {
                    return state.copies;
                },
                copy: async (from, to) => {
                    state.copies += 1;
                    if (state.copies === options.failAtCopy) {
                        throw new Error('disk full');
                    }
                    await defaultMigrationFileSystem.copy(from, to);
                    if (state.copies === options.truncateCopy) {
                        writeFileSync(to, 'x');
                    }
                }
            };
        }

        function twoEpisodes(fixture: Fixture) {
            return [
                addEpisode(fixture, join(fixture.oldBase, 'Naruto', 'Episode 1')),
                addEpisode(fixture, join(fixture.oldBase, 'Naruto', 'Episode 2'), { number: '2' })
            ];
        }

        it('removes the copies, and the folders made for them, when a copy fails, leaving everything as it was', async () => {
            const fixture = newFixture();
            const episodes = twoEpisodes(fixture);

            expect(await migrate(fixture, failingFiles({ failAtCopy: 5 }))).toEqual({ ok: false, reason: 'failed' });

            expect(existsSync(fixture.newBase)).toBe(false);
            episodes.forEach((episode) => {
                expect(filePathOf(fixture, episode.episodeId)).toBe(episode.video);
                expect(existsSync(episode.video)).toBe(true);
                expect(existsSync(episode.video.replace('.mp4', '.vtt'))).toBe(true);
            });
            expect(fixture.saved).toEqual([]);
        });

        it('keeps the folders of the new place that were there before', async () => {
            const fixture = newFixture();
            twoEpisodes(fixture);
            mkdirSync(fixture.newBase, { recursive: true });
            write(join(fixture.newBase, 'Other', 'file.txt'), 'mine');

            expect(await migrate(fixture, failingFiles({ failAtCopy: 2 }))).toEqual({ ok: false, reason: 'failed' });

            expect(readdirSync(fixture.newBase)).toEqual(['Other']);
            expect(readFileSync(join(fixture.newBase, 'Other', 'file.txt'), 'utf-8')).toBe('mine');
        });

        it('fails when a copy is not like its original, and removes the copies', async () => {
            const fixture = newFixture();
            const episodes = twoEpisodes(fixture);

            expect(await migrate(fixture, failingFiles({ truncateCopy: 4 }))).toEqual({ ok: false, reason: 'failed' });

            expect(existsSync(fixture.newBase)).toBe(false);
            expect(filePathOf(fixture, episodes[0]?.episodeId ?? 0)).toBe(episodes[0]?.video);
            expect(episodes.every((episode) => {
                return existsSync(episode.video);
            })).toBe(true);
            expect(fixture.saved).toEqual([]);
        });

        it('fails, with everything as it was, when the new folder cannot be made', async () => {
            const fixture = newFixture();
            const [first] = twoEpisodes(fixture);
            const files: MigrationFileSystem = {
                ...defaultMigrationFileSystem,
                makeDirectory: () => {
                    throw new Error('read-only');
                }
            };
            expect(await migrate(fixture, files)).toEqual({ ok: false, reason: 'failed' });
            expect(filePathOf(fixture, first?.episodeId ?? 0)).toBe(first?.video);
            expect(fixture.saved).toEqual([]);
        });

        it('points the library back to the old files and removes the copies when the setting cannot be saved', async () => {
            const fixture = newFixture();
            const episodes = twoEpisodes(fixture);

            const outcome = await migrateAnimeFolder({
                db: fixture.db,
                platform: process.platform,
                currentDirectory: fixture.oldBase,
                newDirectory: fixture.newBase,
                saveDirectory: () => {
                    throw new Error('settings are read-only');
                },
                onProgress: () => {
                    return;
                }
            });

            expect(outcome).toEqual({ ok: false, reason: 'failed' });
            expect(existsSync(fixture.newBase)).toBe(false);
            episodes.forEach((episode) => {
                expect(filePathOf(fixture, episode.episodeId)).toBe(episode.video);
                expect(fixture.db.getEpisode(episode.episodeId)).toMatchObject({ status: 'done', sizeBytes: 10 });
                expect(existsSync(episode.video)).toBe(true);
            });
        });

        it('does not touch the old files before every copy is checked', async () => {
            const fixture = newFixture();
            const [first] = twoEpisodes(fixture);
            const removed: string[] = [];
            const files: MigrationFileSystem = {
                ...failingFiles({ failAtCopy: 6 }),
                removeFile: (path) => {
                    removed.push(path);
                    defaultMigrationFileSystem.removeFile(path);
                }
            };
            await migrate(fixture, files);
            // Only the copies in the new folder were removed (rolled back); the originals never were.
            expect(
                removed.every((path) => {
                    return path.startsWith(fixture.newBase);
                })
            ).toBe(true);
            expect(existsSync(first?.video ?? '')).toBe(true);
        });
    });

    describe('after the library points to the new files', () => {
        it('still succeeds when an old file cannot be removed, leaving it and the folder it is in', async () => {
            const fixture = newFixture();
            const folder = join(fixture.oldBase, 'Naruto', 'Episode 1');
            const { episodeId, video } = addEpisode(fixture, folder);
            const files: MigrationFileSystem = {
                ...defaultMigrationFileSystem,
                removeFile: (path) => {
                    if (path === video) {
                        throw new Error('in use');
                    }
                    defaultMigrationFileSystem.removeFile(path);
                }
            };

            expect(await migrate(fixture, files)).toEqual({ ok: true, episodes: 1, files: 3 });

            expect(filePathOf(fixture, episodeId)).toBe(join(fixture.newBase, 'Naruto', 'Episode 1', 'Naruto Episode 1.mp4'));
            expect(readdirSync(folder)).toEqual(['Naruto Episode 1.mp4']);
        });

        it('removes only the empty folders, deepest first', async () => {
            const fixture = newFixture();
            addEpisode(fixture, join(fixture.oldBase, 'Frieren', 'Season 1', 'Episode 1'), { title: 'Frieren', series: 'Frieren', season: 1 });
            const removedFolders: string[] = [];
            const files: MigrationFileSystem = {
                ...defaultMigrationFileSystem,
                removeEmptyDirectory: (path) => {
                    removedFolders.push(path);
                    defaultMigrationFileSystem.removeEmptyDirectory(path);
                }
            };

            await migrate(fixture, files);

            expect(removedFolders).toEqual([
                join(fixture.oldBase, 'Frieren', 'Season 1', 'Episode 1'),
                join(fixture.oldBase, 'Frieren', 'Season 1'),
                join(fixture.oldBase, 'Frieren'),
                fixture.oldBase
            ]);
        });
    });
});

describe('defaultMigrationFileSystem', () => {
    it('tells the size of a file, and null for a folder or what is not there', () => {
        const root = makeTempDir();
        write(join(root, 'a.mp4'), 'abcd');
        expect(defaultMigrationFileSystem.size(join(root, 'a.mp4'))).toBe(4);
        expect(defaultMigrationFileSystem.size(root)).toBeNull();
        expect(defaultMigrationFileSystem.size(join(root, 'none'))).toBeNull();
    });

    it('tells whether a path exists', () => {
        const root = makeTempDir();
        expect(defaultMigrationFileSystem.exists(root)).toBe(true);
        expect(defaultMigrationFileSystem.exists(join(root, 'none'))).toBe(false);
    });

    it('makes folders, copies a file and never overwrites one', async () => {
        const root = makeTempDir();
        write(join(root, 'from.mp4'), 'abcd');
        defaultMigrationFileSystem.makeDirectory(join(root, 'a', 'b'));
        await defaultMigrationFileSystem.copy(join(root, 'from.mp4'), join(root, 'a', 'b', 'to.mp4'));
        expect(readFileSync(join(root, 'a', 'b', 'to.mp4'), 'utf-8')).toBe('abcd');
        await expect(defaultMigrationFileSystem.copy(join(root, 'from.mp4'), join(root, 'a', 'b', 'to.mp4'))).rejects.toThrow();
        await expect(defaultMigrationFileSystem.copy(join(root, 'none.mp4'), join(root, 'a', 'none.mp4'))).rejects.toThrow();
    });

    it('removes a file (and does not mind one that is gone), and a folder only when it is empty', () => {
        const root = makeTempDir();
        write(join(root, 'a', 'f.txt'), 'x');
        defaultMigrationFileSystem.removeFile(join(root, 'a', 'f.txt'));
        defaultMigrationFileSystem.removeFile(join(root, 'a', 'f.txt'));
        expect(existsSync(join(root, 'a', 'f.txt'))).toBe(false);

        write(join(root, 'b', 'f.txt'), 'x');
        expect(() => {
            defaultMigrationFileSystem.removeEmptyDirectory(join(root, 'b'));
        }).toThrow();
        defaultMigrationFileSystem.removeEmptyDirectory(join(root, 'a'));
        expect(existsSync(join(root, 'a'))).toBe(false);
    });
});

describe('migrateAnimeFolder with the paths of Windows', () => {
    // A disk in memory, so the paths of Windows can be used wherever the tests run.
    function memoryDisk(initial: Record<string, number>) {
        const key = (path: string): string => {
            return path.replace(/\//g, '\\').toLowerCase();
        };
        const sizes = new Map<string, number>(
            Object.entries(initial).map(([path, size]) => {
                return [key(path), size];
            })
        );
        const folders = new Set<string>();
        const copies: Array<[string, string]> = [];
        const removed: string[] = [];
        const files: MigrationFileSystem = {
            size: (path) => {
                return sizes.get(key(path)) ?? null;
            },
            exists: (path) => {
                return sizes.has(key(path)) || folders.has(key(path));
            },
            makeDirectory: (path) => {
                folders.add(key(path));
            },
            copy: async (from, to) => {
                copies.push([from, to]);
                sizes.set(key(to), sizes.get(key(from)) ?? 0);
            },
            removeFile: (path) => {
                removed.push(path);
                sizes.delete(key(path));
            },
            removeEmptyDirectory: () => {
                return undefined;
            }
        };
        return { files, copies, removed };
    }

    function windowsLibrary() {
        const db = new AnimeDb(':memory:', () => {
            return 5;
        });
        const anime = db.upsertAnime({ title: 'Fake Anime', query: 'fake', searchIndex: 1 });
        db.setSeries(anime.id, 'Fake Anime', 1, null);
        const episode = db.ensureEpisode(anime.id, '1');
        // As ani-cli reports it on Windows: the folders with slashes.
        const video = 'C:/Anime/Fake Anime/Season 1/Episode 1/Fake Anime Episode 1.mp4';
        db.markDone(episode.id, video, 10);
        return { db, episode, video };
    }

    function run(disk: ReturnType<typeof memoryDisk>, db: AnimeDb, filesOf: (video: string) => string[]) {
        const saved: string[] = [];
        return migrateAnimeFolder({
            db,
            files: disk.files,
            filesOf,
            platform: 'win32',
            currentDirectory: 'C:\\Anime',
            newDirectory: 'D:\\Library',
            saveDirectory: (directory) => {
                saved.push(directory);
            },
            onProgress: () => {
                return undefined;
            }
        }).then((outcome) => {
            return { outcome, saved };
        });
    }

    it('moves a file once when it is given two ways, with slashes and with backslashes, and does not call it a conflict', async () => {
        const { db, episode, video } = windowsLibrary();
        const disk = memoryDisk({
            [video]: 10,
            'C:/Anime/Fake Anime/Season 1/Episode 1/Fake Anime Episode 1.vtt': 6,
            'C:/Anime/Fake Anime/Season 1/Episode 1/pullwave.json': 20
        });

        const { outcome, saved } = await run(disk, db, (path) => {
            return [path, 'C:/Anime/Fake Anime/Season 1/Episode 1/Fake Anime Episode 1.vtt', 'C:\\Anime\\Fake Anime\\Season 1\\Episode 1\\Fake Anime Episode 1.vtt', 'C:\\Anime\\Fake Anime\\Season 1\\Episode 1\\pullwave.json', 'C:/Anime/Fake Anime/Season 1/Episode 1/pullwave.json'];
        });

        expect(outcome).toEqual({ ok: true, episodes: 1, files: 3 });
        expect(disk.copies.map(([, to]) => {
            return to;
        })).toEqual([
            'D:\\Library\\Fake Anime\\Season 1\\Episode 1\\Fake Anime Episode 1.mp4',
            'D:\\Library\\Fake Anime\\Season 1\\Episode 1\\Fake Anime Episode 1.vtt',
            'D:\\Library\\Fake Anime\\Season 1\\Episode 1\\pullwave.json'
        ]);
        expect(db.getEpisode(episode.id)?.filePath).toBe('D:\\Library\\Fake Anime\\Season 1\\Episode 1\\Fake Anime Episode 1.mp4');
        expect(saved).toEqual(['D:\\Library']);
        expect(disk.removed).toHaveLength(3);
    });

    it('does not tell capitals apart for the same file', async () => {
        const { db, video } = windowsLibrary();
        const disk = memoryDisk({ [video]: 10, 'C:/Anime/Fake Anime/Season 1/Episode 1/Fake Anime Episode 1.vtt': 6 });
        const { outcome } = await run(disk, db, (path) => {
            return [path, 'C:/Anime/Fake Anime/Season 1/Episode 1/Fake Anime Episode 1.vtt', 'C:/Anime/Fake Anime/Season 1/Episode 1/FAKE ANIME EPISODE 1.VTT'];
        });
        expect(outcome).toEqual({ ok: true, episodes: 1, files: 2 });
    });

    it('still refuses a file that is really in the way', async () => {
        const { db, video } = windowsLibrary();
        const disk = memoryDisk({ [video]: 10, 'D:/Library/Fake Anime/Season 1/Episode 1/Fake Anime Episode 1.mp4': 3 });
        const { outcome } = await run(disk, db, (path) => {
            return [path];
        });
        expect(outcome).toEqual({ ok: false, reason: 'conflict' });
        expect(disk.copies).toEqual([]);
    });
});
