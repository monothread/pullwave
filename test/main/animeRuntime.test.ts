import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnimeJob } from '@shared/anime';
import { DEFAULT_SETTINGS, IPC } from '@shared/constants';
import { machineTimeZone, zonedDayLimits } from '@shared/timezone';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createAnimeRuntime, fetchSubtitleText, REMOVE_RETRY_MS, SUBTITLE_FETCH_TIMEOUT_MS, type AnimeRuntime, type AnimeRuntimeOptions } from '@main/animeRuntime';
import { DatabaseSync } from 'node:sqlite';
import { AnimeDb } from '@main/services/animeDb';
import { BinaryResolver } from '@main/services/binaryResolver';
import { cleanTempDirs, makeTempDir } from '../helpers/tempDir';

// The library keeps its file open (and Windows will not delete an open file): close what a test opened before cleaning up.
const opened: AnimeRuntime[] = [];

function open(given: AnimeRuntimeOptions): AnimeRuntime | null {
    const runtime = createAnimeRuntime(given);
    if (runtime) {
        opened.push(runtime);
    }
    return runtime;
}

afterEach(() => {
    opened.splice(0).forEach((runtime) => {
        runtime.db.close();
    });
    cleanTempDirs();
});

function options(overrides: Partial<AnimeRuntimeOptions> = {}) {
    const root = makeTempDir();
    const send = vi.fn();
    const base: AnimeRuntimeOptions = {
        platform: process.platform,
        dataDir: join(root, 'data'),
        bundledDir: join(root, 'resources', 'bin'),
        scriptsDir: join(root, 'resources', 'ani-scripts'),
        defaultDownloadDir: join(root, 'Downloads'),
        systemLocale: 'en-US',
        resolver: new BinaryResolver({ bundledDir: join(root, 'resources', 'bin'), userBinDir: join(root, 'data', 'bin') }),
        getSettings: () => {
            return DEFAULT_SETTINGS;
        },
        send
    };
    return { root, send, options: { ...base, ...overrides } };
}

async function flush(): Promise<void> {
    await new Promise((resolve) => {
        setTimeout(resolve, 20);
    });
}

describe('createAnimeRuntime', () => {
    it('does not exist where the section is not available', () => {
        expect(open(options({ platform: 'darwin' }).options)).toBeNull();
        expect(open(options({ platform: 'freebsd' }).options)).toBeNull();
    });

    it('exists on Linux and on Windows', () => {
        expect(open(options({ platform: 'linux' }).options)).not.toBeNull();
        expect(open(options({ platform: 'win32' }).options)).not.toBeNull();
    });

    it('creates the library under the data folder', () => {
        const { root, options: given } = options();
        const runtime = open(given);
        expect(runtime).not.toBeNull();
        expect(existsSync(join(root, 'data', 'anime', 'anime.db'))).toBe(true);
        expect(runtime?.db.list()).toEqual([]);
    });

    it('fails what was left unfinished by the previous run', () => {
        const { root, options: given } = options();
        const path = join(root, 'data', 'anime', 'anime.db');
        const previous = new AnimeDb(path);
        const episode = previous.ensureEpisode(previous.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' }).id, '1');
        previous.close();

        const runtime = open(given);
        expect(runtime?.db.getEpisode(episode.id)).toMatchObject({ status: 'error', error: { code: 'UNKNOWN' } });
    });

    it('serves the video and the subtitles of a downloaded episode only', () => {
        const runtime = open(options().options);
        const db = runtime?.db as AnimeDb;
        const anime = db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' });
        const done = db.ensureEpisode(anime.id, '1');
        const waiting = db.ensureEpisode(anime.id, '2');
        db.markDone(done.id, '/lib/Naruto/Naruto Episode 1.mp4', 10);

        expect(runtime?.media.resolve('episode', done.id, '')).toBe('/lib/Naruto/Naruto Episode 1.mp4');
        expect(runtime?.media.resolve('subtitle', done.id, '')).toBe(join('/lib/Naruto', 'Naruto Episode 1.vtt'));
        expect(runtime?.media.resolve('episode', waiting.id, '')).toBeNull();
        expect(runtime?.media.resolve('episode', 99, '')).toBeNull();
    });

    describe('subtitles', () => {
        function downloaded(extraFiles: Record<string, string> = {}) {
            const { root, options: given } = options();
            const folder = join(root, 'lib', 'Naruto');
            mkdirSync(folder, { recursive: true });
            const video = join(folder, 'Naruto Episode 1.mp4');
            writeFileSync(video, 'v');
            Object.entries(extraFiles).forEach(([name, text]) => {
                writeFileSync(join(folder, name), text);
            });
            return { root, folder, video, given };
        }

        function addEpisode(runtime: AnimeRuntime | null, video: string, number = '1') {
            const db = runtime?.db as AnimeDb;
            const anime = db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' });
            const episode = db.ensureEpisode(anime.id, number);
            db.markDone(episode.id, video, 1);
            return episode;
        }

        it('serves the subtitle of the episode that was asked for, and no file outside of them', () => {
            const { folder, video, given } = downloaded({ 'Naruto Episode 1.vtt': 'a', 'Naruto Episode 1.subtitle-Japanese.vtt': 'ja' });
            const runtime = open(given);
            const episode = addEpisode(runtime, video);
            expect(runtime?.media.resolve('subtitle', episode.id, '')).toBe(join(folder, 'Naruto Episode 1.vtt'));
            expect(runtime?.media.resolve('subtitle', episode.id, 'subtitle-Japanese')).toBe(join(folder, 'Naruto Episode 1.subtitle-Japanese.vtt'));
            expect(runtime?.media.resolve('subtitle', episode.id, 'subtitle-Korean')).toBeNull();
            expect(runtime?.media.resolve('subtitle', episode.id, '../Naruto Episode 1')).toBeNull();
            expect(runtime?.media.resolve('episode', episode.id, 'subtitle-Japanese')).toBe(video);
        });

        it('lists the subtitles of a downloaded episode', () => {
            const { video, given } = downloaded({ 'Naruto Episode 1.vtt': 'a', 'Naruto Episode 1.subtitle-Japanese.vtt': 'ja' });
            const runtime = open(given);
            const episode = addEpisode(runtime, video);
            expect(runtime?.handlers.subtitles.list(episode.id)).toEqual([
                { id: '', label: 'Default', kind: 'default' },
                { id: 'subtitle-Japanese', label: 'Japanese', kind: 'source' }
            ]);
        });

        it('lists nothing for an episode that is not downloaded or does not exist', () => {
            const { given } = downloaded();
            const runtime = open(given);
            const db = runtime?.db as AnimeDb;
            const waiting = db.ensureEpisode(db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' }).id, '2');
            expect(runtime?.handlers.subtitles.list(waiting.id)).toEqual([]);
            expect(runtime?.handlers.subtitles.list(99)).toEqual([]);
        });

        it('loads the file the user chooses next to the video', async () => {
            const { root, folder, video, given } = downloaded();
            const source = join(root, 'ja.srt');
            writeFileSync(source, '1\n00:00:01,000 --> 00:00:02,000\nHi\n');
            const chooseSubtitleFile = vi.fn(async () => {
                return source;
            });
            const runtime = open({ ...given, chooseSubtitleFile });
            const episode = addEpisode(runtime, video);

            expect(await runtime?.handlers.subtitles.import(episode.id)).toEqual({
                ok: true,
                tracks: [{ id: 'import-ja', label: 'ja', kind: 'imported' }],
                imported: { id: 'import-ja', label: 'ja', kind: 'imported' }
            });
            expect(chooseSubtitleFile).toHaveBeenCalledTimes(1);
            expect(readFileSync(join(folder, 'Naruto Episode 1.import-ja.vtt'), 'utf-8')).toBe('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nHi\n');
        });

        it('says an episode is missing when it is not downloaded or does not exist, without asking the source', async () => {
            const { given } = downloaded();
            const runtime = open(given);
            const db = runtime?.db as AnimeDb;
            const waiting = db.ensureEpisode(db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' }).id, '2');
            expect(await runtime?.handlers.subtitles.check(waiting.id)).toEqual({ ok: false, reason: 'missing' });
            expect(await runtime?.handlers.subtitles.check(99)).toEqual({ ok: false, reason: 'missing' });
        });

        it('does not load anything when no file picker is given, and for an episode that is not downloaded', async () => {
            const { folder, video, given } = downloaded();
            const runtime = open(given);
            const episode = addEpisode(runtime, video);
            expect(await runtime?.handlers.subtitles.import(episode.id)).toEqual({ ok: false, reason: 'cancelled' });
            expect(await runtime?.handlers.subtitles.import(99)).toEqual({ ok: false, reason: 'missing' });
            expect(existsSync(join(folder, 'Naruto Episode 1.import-ja.vtt'))).toBe(false);
        });
    });

    it('does not serve a downloaded episode that has no file recorded', () => {
        const runtime = open(options().options);
        const db = runtime?.db as AnimeDb;
        const episode = db.ensureEpisode(db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' }).id, '1');
        db.markFailed(episode.id, 'error', null);
        expect(runtime?.media.resolve('episode', episode.id, '')).toBeNull();
    });

    it('tells the screen when the library changes', () => {
        const { send, options: given } = options();
        open(given)?.handlers.onLibraryChanged();
        expect(send).toHaveBeenCalledWith(IPC.eventAnimeLibrary);
    });

    it('deletes files for the handlers', () => {
        const { root, options: given } = options();
        const runtime = open(given);
        const video = join(root, 'a.mp4');
        writeFileSync(video, 'x');
        runtime?.handlers.removeFiles([video, join(root, 'missing.vtt')]);
        expect(existsSync(video)).toBe(false);
    });

    it('has a stream handler that refuses what it was not asked to open, and a stream quality from the settings', async () => {
        const { options: given } = options({ getSettings: () => { return { ...DEFAULT_SETTINGS, animeQuality: '480p' }; } });
        const runtime = open(given);
        expect(runtime?.handlers.streamQuality()).toBe('480p');
        expect((await (runtime?.streamHandler as (request: Request) => Promise<Response>)(new Request('pullwave-stream://p/unknown/abc'))).status).toBe(404);

        const stream = runtime?.handlers.streams.create({ url: 'http://127.0.0.1:1/a.m3u8', subtitleUrl: null, referer: null, subtitles: [] });
        expect(stream?.url).toMatch(/^pullwave-stream:\/\/p\//);
        runtime?.handlers.streams.close(stream?.sessionId ?? '');
        expect((await (runtime?.streamHandler as (request: Request) => Promise<Response>)(new Request(stream?.url ?? ''))).status).toBe(404);
    });

    it('updates ani-cli through the dependencies it was given', async () => {
        const updaterDependencies = {
            fetchText: vi.fn(async (url: string) => {
                // A script the change of Pullwave that finds the stream fits (without it the update is refused).
                return url.includes('/commits/')
                    ? JSON.stringify({ sha: 'b'.repeat(40) })
                    : '#!/bin/sh\nversion_number="9.0.0"\n        debug) printf "All links:\\n%s\\nSelected link:\\n%s\\nSubtitles:\\n%s\\n" "$links" "$video_link" "$sub_link" ;;\n';
            }),
            checkSyntax: vi.fn(async () => {
                return true;
            }),
            readText: vi.fn(() => {
                return null;
            }),
            writeFile: vi.fn(),
            replaceFile: vi.fn(),
            removeFile: vi.fn(),
            makeDirectory: vi.fn()
        };
        const { root, options: given } = options({ updaterDependencies });
        const runtime = open(given);

        expect(await runtime?.handlers.updateAniCli()).toEqual({
            ok: true,
            output: 'Updated ani-cli unknown → 9.0.0, but a change of Pullwave no longer fits it: subtitle language choice, saving every subtitle. That feature will not work until Pullwave is updated.'
        });
        expect(updaterDependencies.replaceFile).toHaveBeenCalledWith(join(root, 'data', 'bin', 'ani-cli.tmp'), join(root, 'data', 'bin', 'ani-cli'));
    });

    it('goes back to the ani-cli that ships with the app by deleting the one an update saved', async () => {
        const readText = vi.fn((path: string) => {
            return path.endsWith(join('data', 'bin', 'ani-cli')) ? '#!/bin/sh\nversion_number="9.0.0"\n' : null;
        });
        const removeFile = vi.fn();
        const updaterDependencies = {
            fetchText: vi.fn(),
            checkSyntax: vi.fn(),
            readText,
            writeFile: vi.fn(),
            replaceFile: vi.fn(),
            removeFile,
            makeDirectory: vi.fn()
        };
        const { root, options: given } = options({ updaterDependencies });
        const runtime = open(given);

        expect(runtime?.handlers.resetAniCli()).toEqual({ ok: true, output: 'Using the ani-cli that ships with the app again.' });
        expect(removeFile).toHaveBeenCalledTimes(1);
        expect(removeFile).toHaveBeenCalledWith(join(root, 'data', 'bin', 'ani-cli'));
        expect(updaterDependencies.fetchText).not.toHaveBeenCalled();
    });

    it('says there is nothing to delete when no update saved an ani-cli', () => {
        const removeFile = vi.fn();
        const { options: given } = options({
            updaterDependencies: { fetchText: vi.fn(), checkSyntax: vi.fn(), readText: vi.fn(() => { return null; }), writeFile: vi.fn(), replaceFile: vi.fn(), removeFile, makeDirectory: vi.fn() }
        });
        expect(open(given)?.handlers.resetAniCli()).toEqual({ ok: false, output: 'There is no updated ani-cli to remove: the one that ships with the app is already in use.' });
        expect(removeFile).not.toHaveBeenCalled();
    });

    it('does not update a script that was replaced by another one', async () => {
        const fetchText = vi.fn();
        const { options: given } = options({
            customScriptPath: () => {
                return '/opt/ani-cli';
            },
            updaterDependencies: { fetchText, checkSyntax: vi.fn(), readText: vi.fn(), writeFile: vi.fn(), replaceFile: vi.fn(), removeFile: vi.fn(), makeDirectory: vi.fn() }
        });
        const result = await open(given)?.handlers.updateAniCli();
        expect(result?.ok).toBe(false);
        expect(fetchText).not.toHaveBeenCalled();
    });

    it('updates with the real network and shell when none are given (the script is not touched when the answer is bad)', () => {
        const { options: given } = options();
        const runtime = open(given);
        expect(typeof runtime?.handlers.updateAniCli).toBe('function');
    });

    it('removes folders and tells where the anime go, for the handlers', () => {
        const { root, options: given } = options();
        const runtime = open(given);
        const folder = join(root, 'Downloads', 'Pullwave Anime', 'Naruto');
        mkdirSync(join(folder, 'nested'), { recursive: true });
        writeFileSync(join(folder, 'a.part'), 'x');

        runtime?.handlers.removeFolders([folder]);

        expect(existsSync(folder)).toBe(false);
        expect(runtime?.handlers.baseDirectory()).toBe(join(root, 'Downloads', 'Pullwave Anime'));
    });

    it('removes the folder of an episode for the handlers only when it is empty', () => {
        const { root, options: given } = options();
        const runtime = open(given);
        const empty = join(root, 'Naruto', 'Episode 1');
        const full = join(root, 'Naruto', 'Episode 2');
        mkdirSync(empty, { recursive: true });
        mkdirSync(full, { recursive: true });
        writeFileSync(join(full, 'a.vtt'), 'x');

        runtime?.handlers.removeEmptyFolders([empty, full, join(root, 'Naruto', 'Episode 3')]);

        expect(existsSync(empty)).toBe(false);
        expect(existsSync(join(full, 'a.vtt'))).toBe(true);
    });

    it('opens folders through the function it was given, and does nothing without one', () => {
        const openFolder = vi.fn();
        open({ ...options().options, openFolder })?.handlers.openFolder('/lib/Naruto');
        expect(openFolder).toHaveBeenCalledTimes(1);
        expect(openFolder).toHaveBeenCalledWith('/lib/Naruto');
        expect(() => {
            open(options().options)?.handlers.openFolder('/lib/Naruto');
        }).not.toThrow();
    });

    describe('importing a folder of anime', () => {
        function folderOfAnime(root: string): string {
            const folder = join(root, 'Downloads', 'Pullwave Anime', 'backup');
            mkdirSync(join(folder, 'Naruto', 'Episode 1'), { recursive: true });
            mkdirSync(join(folder, 'Naruto', 'Episode 2'), { recursive: true });
            writeFileSync(join(folder, 'Naruto', 'Episode 1', 'Naruto Episode 1.mp4'), 'abc');
            writeFileSync(join(folder, 'Naruto', 'Episode 2', 'Naruto Episode 2.mp4'), 'abcdef');
            writeFileSync(
                join(folder, 'Naruto', 'Episode 2', 'pullwave.json'),
                JSON.stringify({ version: 1, title: 'Naruto', query: 'naruto', searchIndex: 2, audio: 'dub', number: '2', positionSeconds: 50, durationSeconds: 100, watched: true })
            );
            return folder;
        }

        it('adds what is in the folder the user chose, starting at the folder of the anime', async () => {
            const { root, options: given } = options();
            const folder = folderOfAnime(root);
            const chooseLibraryFolder = vi.fn(async () => {
                return folder;
            });
            const runtime = open({ ...given, chooseLibraryFolder });

            expect(await runtime?.handlers.importLibrary()).toEqual({ ok: true, added: 2, relinked: 0, skipped: 0, ignored: 0 });
            expect(chooseLibraryFolder).toHaveBeenCalledTimes(1);
            expect(chooseLibraryFolder).toHaveBeenCalledWith(join(root, 'Downloads', 'Pullwave Anime'));
            const list = runtime?.db.list() ?? [];
            expect(
                list.map((anime) => {
                    return [anime.title, anime.audio, anime.searchIndex];
                })
            ).toEqual([
                ['Naruto', 'dub', 2],
                ['Naruto', 'sub', 0]
            ]);
            expect(list[0]?.episodes[0]).toMatchObject({ number: '2', status: 'done', sizeBytes: 6, positionSeconds: 50, watched: true });
        });

        it('uses the audio of the settings for what does not say it', async () => {
            const { root, options: given } = options({ getSettings: () => { return { ...DEFAULT_SETTINGS, animeAudio: 'dub' }; } });
            const folder = folderOfAnime(root);
            const runtime = open({ ...given, chooseLibraryFolder: async () => { return folder; } });
            await runtime?.handlers.importLibrary();
            expect(
                runtime?.db.list().map((anime) => {
                    return [anime.title, anime.audio];
                })
            ).toEqual([['Naruto', 'dub']]);
        });

        it('writes the metadata of what it added, so the next time they are known exactly', async () => {
            const { root, options: given } = options();
            const folder = folderOfAnime(root);
            const runtime = open({ ...given, chooseLibraryFolder: async () => { return folder; } });
            await runtime?.handlers.importLibrary();
            expect(JSON.parse(readFileSync(join(folder, 'Naruto', 'Episode 1', 'pullwave.json'), 'utf-8'))).toEqual({
                version: 1,
                title: 'Naruto',
                query: 'Naruto',
                searchIndex: 0,
                audio: 'sub',
                number: '1',
                positionSeconds: 0,
                durationSeconds: 0,
                watched: false
            });
        });

        it('accepts the folder of the anime itself', async () => {
            const { root, options: given } = options();
            const folder = join(root, 'Downloads', 'Pullwave Anime');
            mkdirSync(join(folder, 'Naruto', 'Episode 1'), { recursive: true });
            writeFileSync(join(folder, 'Naruto', 'Episode 1', 'Naruto Episode 1.mp4'), 'abc');
            const runtime = open({ ...given, chooseLibraryFolder: async () => { return folder; } });
            expect(await runtime?.handlers.importLibrary()).toEqual({ ok: true, added: 1, relinked: 0, skipped: 0, ignored: 0 });
        });

        it('accepts a folder inside the anime folder of the settings', async () => {
            const { root, options: given } = options();
            const base = join(root, 'media');
            mkdirSync(join(base, 'Naruto', 'Episode 1'), { recursive: true });
            writeFileSync(join(base, 'Naruto', 'Episode 1', 'Naruto Episode 1.mp4'), 'abc');
            const runtime = open({
                ...given,
                getSettings: () => {
                    return { ...DEFAULT_SETTINGS, animeDownloadDir: base };
                },
                chooseLibraryFolder: async () => {
                    return join(base, 'Naruto');
                }
            });
            expect(await runtime?.handlers.importLibrary()).toEqual({ ok: true, added: 1, relinked: 0, skipped: 0, ignored: 0 });
        });

        it('refuses a folder that is outside the anime folder and adds nothing', async () => {
            const { root, options: given } = options();
            const outside = join(root, 'backup');
            mkdirSync(join(outside, 'Naruto', 'Episode 1'), { recursive: true });
            writeFileSync(join(outside, 'Naruto', 'Episode 1', 'Naruto Episode 1.mp4'), 'abc');
            const runtime = open({ ...given, chooseLibraryFolder: async () => { return outside; } });

            expect(await runtime?.handlers.importLibrary()).toEqual({ ok: false, reason: 'outside', folder: join(root, 'Downloads', 'Pullwave Anime') });
            expect(runtime?.db.list()).toEqual([]);
        });

        it('refuses a folder beside the anime folder whose name starts the same', async () => {
            const { root, options: given } = options();
            const beside = join(root, 'Downloads', 'Pullwave Anime Old');
            mkdirSync(join(beside, 'Naruto', 'Episode 1'), { recursive: true });
            writeFileSync(join(beside, 'Naruto', 'Episode 1', 'Naruto Episode 1.mp4'), 'abc');
            const runtime = open({ ...given, chooseLibraryFolder: async () => { return beside; } });
            expect(await runtime?.handlers.importLibrary()).toEqual({ ok: false, reason: 'outside', folder: join(root, 'Downloads', 'Pullwave Anime') });
            expect(runtime?.db.list()).toEqual([]);
        });

        it('refuses the folder above the anime folder', async () => {
            const { root, options: given } = options();
            const runtime = open({ ...given, chooseLibraryFolder: async () => { return join(root, 'Downloads'); } });
            expect(await runtime?.handlers.importLibrary()).toEqual({ ok: false, reason: 'outside', folder: join(root, 'Downloads', 'Pullwave Anime') });
        });

        it('does nothing when the user gives up or there is no way to ask', async () => {
            const { root, options: given } = options();
            folderOfAnime(root);
            const cancelled = open({ ...given, chooseLibraryFolder: async () => { return null; } });
            expect(await cancelled?.handlers.importLibrary()).toEqual({ ok: false, reason: 'cancelled' });
            expect(cancelled?.db.list()).toEqual([]);
            expect(await open(options().options)?.handlers.importLibrary()).toEqual({ ok: false, reason: 'cancelled' });
        });

        it('says which episodes have lost their file and refreshes the metadata when the progress is saved', () => {
            const { root, options: given } = options();
            const runtime = open(given);
            const folder = join(root, 'Naruto', 'Episode 1');
            mkdirSync(folder, { recursive: true });
            const video = join(folder, 'Naruto Episode 1.mp4');
            writeFileSync(video, 'x');
            const anime = (runtime?.db as AnimeDb).upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' });
            const episode = (runtime?.db as AnimeDb).ensureEpisode(anime.id, '1');
            (runtime?.db as AnimeDb).markDone(episode.id, video, 1);

            expect(runtime?.handlers.fileExists(video)).toBe(true);
            expect(runtime?.handlers.fileExists(join(folder, 'gone.mp4'))).toBe(false);
            runtime?.handlers.refreshMetadata(episode.id);
            expect(JSON.parse(readFileSync(join(folder, 'pullwave.json'), 'utf-8'))).toMatchObject({ title: 'Naruto', searchIndex: 1, number: '1' });
        });
    });

    describe('migrating the folder of the anime', () => {
        // One downloaded episode in the default folder of the anime.
        function libraryWithOneEpisode(runtime: AnimeRuntime | null, root: string): { episodeId: number; video: string } {
            const folder = join(root, 'Downloads', 'Pullwave Anime', 'Naruto', 'Episode 1');
            mkdirSync(folder, { recursive: true });
            const video = join(folder, 'Naruto Episode 1.mp4');
            writeFileSync(video, 'abc');
            const db = runtime?.db as AnimeDb;
            const anime = db.upsertAnime({ title: 'Naruto', query: 'naruto', searchIndex: 1, audio: 'sub' });
            const episode = db.ensureEpisode(anime.id, '1');
            db.markDone(episode.id, video, 3);
            return { episodeId: episode.id, video };
        }

        it('asks for the new folder starting at the current one, moves the anime there and saves it in the settings', async () => {
            const { root, send, options: given } = options();
            const destination = join(root, 'elsewhere');
            const chooseMigrationFolder = vi.fn(async () => {
                return destination;
            });
            const saveAnimeDirectory = vi.fn();
            const runtime = open({ ...given, chooseMigrationFolder, saveAnimeDirectory });
            const { episodeId } = libraryWithOneEpisode(runtime, root);

            const result = await runtime?.handlers.migrateFolder();

            expect(result).toEqual({ ok: true, episodes: 1, files: 1, destination });
            expect(chooseMigrationFolder).toHaveBeenCalledTimes(1);
            expect(chooseMigrationFolder).toHaveBeenCalledWith(join(root, 'Downloads', 'Pullwave Anime'));
            expect(saveAnimeDirectory).toHaveBeenCalledTimes(1);
            expect(saveAnimeDirectory).toHaveBeenCalledWith(destination);
            expect(runtime?.db.getEpisode(episodeId)?.filePath).toBe(join(destination, 'Naruto', 'Episode 1', 'Naruto Episode 1.mp4'));
            expect(readFileSync(join(destination, 'Naruto', 'Episode 1', 'Naruto Episode 1.mp4'), 'utf-8')).toBe('abc');
            expect(existsSync(join(root, 'Downloads', 'Pullwave Anime'))).toBe(false);
            expect(send).toHaveBeenCalledWith(IPC.eventAnimeMigration, { done: 0, total: 1 });
            expect(send).toHaveBeenCalledWith(IPC.eventAnimeMigration, { done: 1, total: 1 });
        });

        it('starts at the folder of the settings when it is not the default one', async () => {
            const { root, options: given } = options();
            const current = join(root, 'media');
            const chooseMigrationFolder = vi.fn(async () => {
                return null;
            });
            const runtime = open({
                ...given,
                getSettings: () => {
                    return { ...DEFAULT_SETTINGS, animeDownloadDir: current };
                },
                chooseMigrationFolder
            });
            await runtime?.handlers.migrateFolder();
            expect(chooseMigrationFolder).toHaveBeenCalledWith(current);
        });

        it('does nothing when the user gives up or there is no way to ask', async () => {
            const { root, send, options: given } = options();
            const saveAnimeDirectory = vi.fn();
            const cancelled = open({ ...given, saveAnimeDirectory, chooseMigrationFolder: async () => { return null; } });
            const { video, episodeId } = libraryWithOneEpisode(cancelled, root);

            expect(await cancelled?.handlers.migrateFolder()).toEqual({ ok: false, reason: 'cancelled' });
            expect(cancelled?.db.getEpisode(episodeId)?.filePath).toBe(video);
            expect(existsSync(video)).toBe(true);
            expect(saveAnimeDirectory).not.toHaveBeenCalled();
            expect(send).not.toHaveBeenCalled();
            expect(await open(options().options)?.handlers.migrateFolder()).toEqual({ ok: false, reason: 'cancelled' });
        });

        it('says why a folder was not accepted, changing nothing', async () => {
            const { root, options: given } = options();
            const saveAnimeDirectory = vi.fn();
            const current = join(root, 'Downloads', 'Pullwave Anime');
            const runtime = open({ ...given, saveAnimeDirectory, chooseMigrationFolder: async () => { return current; } });
            const { video } = libraryWithOneEpisode(runtime, root);

            expect(await runtime?.handlers.migrateFolder()).toEqual({ ok: false, reason: 'same' });
            expect(existsSync(video)).toBe(true);
            expect(saveAnimeDirectory).not.toHaveBeenCalled();
        });

        it('uses the way of copying given, and so can fail without changing anything', async () => {
            const { root, options: given } = options();
            const saveAnimeDirectory = vi.fn();
            const destination = join(root, 'elsewhere');
            const runtime = open({
                ...given,
                saveAnimeDirectory,
                chooseMigrationFolder: async () => {
                    return destination;
                },
                migrationFiles: {
                    size: (path) => {
                        return existsSync(path) ? 3 : null;
                    },
                    exists: existsSync,
                    makeDirectory: (path) => {
                        mkdirSync(path, { recursive: true });
                    },
                    copy: async () => {
                        throw new Error('disk full');
                    },
                    removeFile: () => {
                        return undefined;
                    },
                    removeEmptyDirectory: () => {
                        return undefined;
                    }
                }
            });
            const { video, episodeId } = libraryWithOneEpisode(runtime, root);

            expect(await runtime?.handlers.migrateFolder()).toEqual({ ok: false, reason: 'failed' });
            expect(runtime?.db.getEpisode(episodeId)?.filePath).toBe(video);
            expect(saveAnimeDirectory).not.toHaveBeenCalled();
        });

        it('copes with there being no way to save the setting', async () => {
            const { root, options: given } = options();
            const destination = join(root, 'elsewhere');
            const runtime = open({ ...given, chooseMigrationFolder: async () => { return destination; } });
            libraryWithOneEpisode(runtime, root);
            expect(await runtime?.handlers.migrateFolder()).toEqual({ ok: true, episodes: 1, files: 1, destination });
        });
    });

    it('uses the anime folder of the settings', () => {
        const { options: given } = options({ getSettings: () => { return { ...DEFAULT_SETTINGS, animeDownloadDir: '/media/anime' }; } });
        expect(open(given)?.handlers.baseDirectory()).toBe('/media/anime');
    });

    describe('removing again what could not be removed at once', () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it('tries again for what is still there after a moment, but not before', () => {
            vi.useFakeTimers();
            const { root, options: given } = options({ removeRetryMs: 500 });
            const video = join(root, 'a.mp4');
            writeFileSync(video, 'x');
            const files = vi.fn();
            const runtime = open({ ...given, remover: { files, folders: vi.fn() } });

            runtime?.handlers.removeFiles([video, join(root, 'gone.vtt')]);
            expect(files.mock.calls).toEqual([[[video, join(root, 'gone.vtt')]]]);
            vi.advanceTimersByTime(499);
            expect(files).toHaveBeenCalledTimes(1);
            vi.advanceTimersByTime(1);
            expect(files.mock.calls[1]).toEqual([[video]]);
        });

        it('does not try again when everything is gone', () => {
            vi.useFakeTimers();
            const { root, options: given } = options({ removeRetryMs: 500 });
            const files = vi.fn();
            open({ ...given, remover: { files, folders: vi.fn() } })?.handlers.removeFiles([join(root, 'gone.mp4')]);
            vi.advanceTimersByTime(1000);
            expect(files).toHaveBeenCalledTimes(1);
        });

        it('does the same for folders', () => {
            vi.useFakeTimers();
            const { root, options: given } = options({ removeRetryMs: 100 });
            const folder = join(root, 'Naruto');
            mkdirSync(folder);
            const folders = vi.fn();
            open({ ...given, remover: { files: vi.fn(), folders } })?.handlers.removeFolders([folder]);
            vi.advanceTimersByTime(100);
            expect(folders.mock.calls).toEqual([[[folder]], [[folder]]]);
        });

        it('does the same for the folders of the episodes', () => {
            vi.useFakeTimers();
            const { root, options: given } = options({ removeRetryMs: 100 });
            const folder = join(root, 'Naruto', 'Episode 1');
            mkdirSync(folder, { recursive: true });
            const emptyFolders = vi.fn();
            open({ ...given, remover: { files: vi.fn(), folders: vi.fn(), emptyFolders } })?.handlers.removeEmptyFolders([folder]);
            vi.advanceTimersByTime(100);
            expect(emptyFolders.mock.calls).toEqual([[[folder]], [[folder]]]);
        });

        it('waits 500 ms by default', () => {
            vi.useFakeTimers();
            const { root, options: given } = options();
            const video = join(root, 'a.mp4');
            writeFileSync(video, 'x');
            const files = vi.fn();
            open({ ...given, remover: { files, folders: vi.fn() } })?.handlers.removeFiles([video]);
            vi.advanceTimersByTime(REMOVE_RETRY_MS - 1);
            expect(files).toHaveBeenCalledTimes(1);
            vi.advanceTimersByTime(1);
            expect(files).toHaveBeenCalledTimes(2);
        });

        it('really removes with the default removers', () => {
            const { root, options: given } = options({ removeRetryMs: 10 });
            const video = join(root, 'a.mp4');
            writeFileSync(video, 'x');
            open(given)?.handlers.removeFiles([video]);
            expect(existsSync(video)).toBe(false);
        });
    });

    it('wires the queue to the folders, the screen and ani-cli', async () => {
        const { root, send, options: given } = options();
        mkdirSync(join(root, 'resources', 'bin'), { recursive: true });
        const runtime = open(given);

        runtime?.queue.enqueue({ title: 'Naruto', query: 'naruto', index: 1, audio: 'sub', episodes: ['1'] });
        await flush();

        // The folder of the anime was created inside the default one.
        expect(existsSync(join(root, 'Downloads', 'Pullwave Anime', 'Naruto'))).toBe(true);
        const jobs = send.mock.calls
            .filter(([channel]) => {
                return channel === IPC.eventAnimeJob;
            })
            .map(([, job]) => {
                return (job as AnimeJob).status;
            });
        expect(jobs).toEqual(['queued', 'running', 'error']);
        // There is no ani-cli in the empty resources folder, so the download ends with that error.
        expect(runtime?.db.getEpisode(1)).toMatchObject({
            status: 'error',
            error: { code: 'UNKNOWN', raw: 'ani-cli was not found: the copy that ships with the app is missing.' }
        });
        expect(send).toHaveBeenCalledWith(IPC.eventAnimeLibrary);
    });
});

describe('fetchSubtitleText', () => {
    let server: Server;
    let origin = '';
    let lastHeaders: IncomingHttpHeaders = {};

    beforeEach(async () => {
        lastHeaders = {};
        server = createServer((request, response) => {
            lastHeaders = request.headers;
            if (request.url === '/ok.vtt') {
                response.writeHead(200, { 'Content-Type': 'text/vtt' });
                response.end('WEBVTT\n');
            } else if (request.url === '/slow.vtt') {
                // Never answers: the request has to give up by itself.
                return;
            } else {
                response.writeHead(404);
                response.end('nope');
            }
        });
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', resolve);
        });
        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => {
                resolve();
            });
        });
    });

    it('reads the text, asking the way a browser does and with the site the source expects', async () => {
        expect(await fetchSubtitleText(`${origin}/ok.vtt`, 'https://embed.example/')).toBe('WEBVTT\n');
        expect(lastHeaders['user-agent']).toMatch(/^Mozilla\/5\.0 .*Chrome\//);
        expect(lastHeaders.referer).toBe('https://embed.example/');
    });

    it('asks without a referer when the source gave none', async () => {
        expect(await fetchSubtitleText(`${origin}/ok.vtt`, null)).toBe('WEBVTT\n');
        expect(lastHeaders.referer).toBeUndefined();
    });

    it('gives null for an answer that is not a success, for an address that does not answer and for one that is not an address', async () => {
        expect(await fetchSubtitleText(`${origin}/missing.vtt`, null)).toBeNull();
        expect(await fetchSubtitleText('http://127.0.0.1:1/x.vtt', null)).toBeNull();
        expect(await fetchSubtitleText('not an address', null)).toBeNull();
    });

    it('waits ten seconds for a subtitle by default', () => {
        expect(SUBTITLE_FETCH_TIMEOUT_MS).toBe(10000);
    });

    it('gives up on an address that never answers, after the time it is given', async () => {
        const started = Date.now();
        expect(await fetchSubtitleText(`${origin}/slow.vtt`, null, 100)).toBeNull();
        expect(Date.now() - started).toBeLessThan(3000);
    });
});


describe('createAnimeRuntime schedule', () => {
    let server: Server;
    let origin: string;
    let bodies: Array<{ query: string; variables: { start: number; end: number; page: number; perPage: number } }>;

    function item(id: number, title: string, episode: number, airingAt: number): unknown {
        return {
            episode,
            airingAt,
            media: { id, format: 'TV', countryOfOrigin: 'JP', isAdult: false, title: { romaji: title, english: 'English name' }, synonyms: ['Other name'], coverImage: { large: 'https://s4.anilist.co/cover.jpg' } }
        };
    }

    beforeEach(async () => {
        bodies = [];
        server = createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });
            request.on('end', () => {
                bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false }, airingSchedules: [item(1, 'Sousou no Frieren', 12, 1_700_040_000), item(2, 'Dandadan', 3, 1_700_050_000)] } } }));
            });
        });
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', resolve);
        });
        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => {
                resolve();
            });
        });
    });

    it('asks for the stretch at the address it was given and lists what airs, with the names and the cover', async () => {
        const { send, options: given } = options({ scheduleUrl: origin });
        const runtime = open(given) as AnimeRuntime;

        const response = await runtime.handlers.schedule.list({ from: 1_700_000_000, to: 1_700_604_800, refresh: false });

        expect(bodies).toHaveLength(1);
        expect(bodies[0]?.variables).toEqual({ start: 1_700_000_000 - 1, end: 1_700_604_800, page: 1, perPage: 50 });
        expect(response).toEqual({
            ok: true,
            entries: [
                { anilistId: 1, title: 'English name', english: 'English name', romaji: 'Sousou no Frieren', names: ['English name', 'Sousou no Frieren', 'Other name'], episode: 12, airingAt: 1_700_040_000, coverUrl: 'https://s4.anilist.co/cover.jpg' },
                { anilistId: 2, title: 'English name', english: 'English name', romaji: 'Dandadan', names: ['English name', 'Dandadan', 'Other name'], episode: 3, airingAt: 1_700_050_000, coverUrl: 'https://s4.anilist.co/cover.jpg' }
            ]
        });
        // Nothing is pushed to the screen: it is asked, and answered, once.
        expect(send).not.toHaveBeenCalled();
    });

    it('keeps what AniList said for a day, and answers the same day from it without asking again', async () => {
        const { options: given } = options({ scheduleUrl: origin });
        const runtime = open(given) as AnimeRuntime;
        const request = { from: 1_700_000_000, to: 1_700_086_400, refresh: false };

        const first = await runtime.handlers.schedule.list(request);
        const second = await runtime.handlers.schedule.list(request);

        expect(bodies).toHaveLength(1);
        expect(second).toEqual(first);
        expect(first.ok && first.entries).toHaveLength(2);
    });

    it('answers a shorter stretch from a longer one that was kept, with only what airs inside it', async () => {
        const { options: given } = options({ scheduleUrl: origin });
        const runtime = open(given) as AnimeRuntime;

        await runtime.handlers.schedule.list({ from: 1_700_000_000, to: 1_700_604_800, refresh: false });
        const day = await runtime.handlers.schedule.list({ from: 1_700_000_000, to: 1_700_043_000, refresh: false });

        expect(bodies).toHaveLength(1);
        expect(day.ok && day.entries.map((entry) => {
            return entry.anilistId;
        })).toEqual([1]);
    });

    it('asks AniList again when it is asked to refresh, and keeps the new answer', async () => {
        const { options: given } = options({ scheduleUrl: origin });
        const runtime = open(given) as AnimeRuntime;

        await runtime.handlers.schedule.list({ from: 1_700_000_000, to: 1_700_086_400, refresh: false });
        await runtime.handlers.schedule.list({ from: 1_700_000_000, to: 1_700_086_400, refresh: true });
        await runtime.handlers.schedule.list({ from: 1_700_000_000, to: 1_700_086_400, refresh: false });

        expect(bodies).toHaveLength(2);
    });

    it('keeps the listing in the library file, so it is still there when the app is opened again', async () => {
        const { options: given } = options({ scheduleUrl: origin });
        const first = open(given) as AnimeRuntime;
        await first.handlers.schedule.list({ from: 1_700_000_000, to: 1_700_086_400, refresh: false });
        first.db.close();
        opened.splice(opened.indexOf(first), 1);

        const second = open(given) as AnimeRuntime;
        const again = await second.handlers.schedule.list({ from: 1_700_000_000, to: 1_700_086_400, refresh: false });

        expect(bodies).toHaveLength(1);
        expect(again.ok && again.entries).toHaveLength(2);
    });

    it('does not keep a failure: the next time asks again', async () => {
        const { options: given } = options({ scheduleUrl: 'http://127.0.0.1:1/graphql' });
        const runtime = open(given) as AnimeRuntime;

        const failed = await runtime.handlers.schedule.list({ from: 1_700_000_000, to: 1_700_086_400, refresh: false });

        expect(failed.ok).toBe(false);
        expect(runtime.db.findScheduleCache(1_700_000_000, 1_700_086_400, 0)).toBeNull();
    });

    it('fails with a network error when the schedule cannot be reached', async () => {
        const { options: given } = options({ scheduleUrl: origin });
        const runtime = open(given) as AnimeRuntime;
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => {
                resolve();
            });
        });

        const response = await runtime.handlers.schedule.list({ from: 1_700_000_000, to: 1_700_086_400, refresh: false });

        expect(response.ok).toBe(false);
        expect(response.ok ? '' : response.error.code).toBe('NETWORK');
        expect(response.ok ? '' : response.error.raw).toContain('AniList could not be reached:');
        server = createServer();
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', resolve);
        });
    });
});

describe('createAnimeRuntime availability', () => {
    it('answers at once with what was checked in the last hour, from the library file, and says nothing', () => {
        const { send, options: given } = options();
        const runtime = open(given) as AnimeRuntime;
        runtime.db.saveAvailability({ anilistId: 7, state: 'available', query: 'Dandadan', index: 2, title: 'Dandadan' }, 'sub');
        runtime.db.saveAvailability({ anilistId: 8, state: 'unavailable' }, 'sub');

        const known = runtime.handlers.availability.request([
            { anilistId: 7, english: 'Dandadan', romaji: null },
            { anilistId: 8, english: 'Blue Lock', romaji: null }
        ]);

        expect(known).toEqual([
            { anilistId: 7, state: 'available', query: 'Dandadan', index: 2, title: 'Dandadan' },
            { anilistId: 8, state: 'unavailable' }
        ]);
        expect(send).not.toHaveBeenCalled();
    });

    it('uses the audio of the settings: what was checked for the other audio is not an answer', () => {
        const { options: given } = options({
            getSettings: () => {
                return { ...DEFAULT_SETTINGS, animeAudio: 'dub' };
            }
        });
        const runtime = open(given) as AnimeRuntime;
        runtime.db.saveAvailability({ anilistId: 7, state: 'unavailable' }, 'sub');

        expect(runtime.handlers.availability.request([])).toEqual([]);
        expect(runtime.db.findAvailability(7, 'dub', 0)).toBeNull();
        expect(runtime.db.findAvailability(7, 'sub', 0)).toEqual({ anilistId: 7, state: 'unavailable' });
    });

    it('tells each answer to the screen as it is known, and says unknown (keeping nothing) when ani-cli cannot be run', async () => {
        const { send, options: given } = options();
        const runtime = open(given) as AnimeRuntime;

        runtime.handlers.availability.request([{ anilistId: 7, english: 'Dandadan', romaji: 'Dan Da Dan' }]);
        await vi.waitFor(() => {
            expect(send).toHaveBeenCalledTimes(1);
        });

        expect(send).toHaveBeenCalledWith(IPC.eventAnimeAvailability, { anilistId: 7, state: 'unknown' });
        expect(runtime.db.findAvailability(7, 'sub', 0)).toBeNull();
    });
});

describe('createAnimeRuntime background checks', () => {
    let server: Server;
    let origin: string;
    let bodies: Array<{ variables: { start: number; end: number } }>;

    beforeEach(async () => {
        bodies = [];
        server = createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });
            request.on('end', () => {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { variables: { start: number; end: number } };
                bodies.push(body);
                const airingAt = body.variables.start + 3600;
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end(
                    JSON.stringify({
                        data: {
                            Page: {
                                pageInfo: { hasNextPage: false },
                                airingSchedules: [
                                    { episode: 3, airingAt, media: { id: 7, format: 'TV', countryOfOrigin: 'JP', isAdult: false, title: { romaji: 'Dan Da Dan', english: 'Dandadan' }, synonyms: [], coverImage: { large: null } } }
                                ]
                            }
                        }
                    })
                );
            });
        });
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', resolve);
        });
        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => {
                resolve();
            });
        });
    });

    it('does nothing by itself when the runtime is created', async () => {
        const { send, options: given } = options({ scheduleUrl: origin });
        open(given);
        await flush();

        expect(bodies).toEqual([]);
        expect(send).not.toHaveBeenCalled();
    });

    it('lists today in the time zone of the machine and checks the anime that air in it, telling each answer', async () => {
        const { send, options: given } = options({ scheduleUrl: origin });
        const runtime = open(given) as AnimeRuntime;

        runtime.startBackgroundChecks();
        await vi.waitFor(() => {
            expect(send).toHaveBeenCalledTimes(1);
        });

        const limits = zonedDayLimits(Date.now(), machineTimeZone(), 1);
        expect(bodies).toHaveLength(1);
        // AniList's limits are exclusive: the first moment of the day is asked from one second before.
        expect(bodies[0]?.variables).toMatchObject({ start: (limits[0] as number) - 1, end: limits[1] });
        // No ani-cli runs in this test, so the look-up fails: it is told as unknown.
        expect(send).toHaveBeenCalledWith(IPC.eventAnimeAvailability, { anilistId: 7, state: 'unknown' });
    });

    it('is quiet when the schedule cannot be had', async () => {
        const { send, options: given } = options({ scheduleUrl: 'http://127.0.0.1:1/graphql' });
        const runtime = open(given) as AnimeRuntime;

        expect(() => {
            runtime.startBackgroundChecks();
        }).not.toThrow();
        await flush();

        expect(send).not.toHaveBeenCalled();
    });
});

describe('createAnimeRuntime covers', () => {
    let server: Server;
    let origin: string;
    let searches: string[];
    let cover: string;

    beforeEach(async () => {
        searches = [];
        cover = 'https://s4.anilist.co/cover/naruto.jpg';
        server = createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });
            request.on('end', () => {
                const search = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { variables: { search: string } }).variables.search;
                searches.push(search);
                if (search.includes('Unknown')) {
                    response.writeHead(404, { 'Content-Type': 'application/json' });
                    response.end(JSON.stringify({ errors: [{ status: 404 }], data: { Media: null } }));
                    return;
                }
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({ data: { Media: { coverImage: { large: cover } } } }));
            });
        });
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', resolve);
        });
        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => {
            server.close(() => {
                resolve();
            });
        });
    });

    it('looks the cover up at the address it was given and keeps it in the library file', async () => {
        const { options: given } = options({ scheduleUrl: origin });
        const runtime = open(given) as AnimeRuntime;

        expect(await runtime.handlers.covers.find('Naruto')).toBe(cover);

        expect(searches).toEqual(['Naruto']);
        expect(runtime.db.getCover('naruto')).toEqual({ url: cover, checkedAt: expect.any(Number) });
    });

    it('keeps that a title has no cover', async () => {
        const { options: given } = options({ scheduleUrl: origin });
        const runtime = open(given) as AnimeRuntime;

        expect(await runtime.handlers.covers.find('Unknown anime')).toBeNull();

        expect(runtime.db.getCover('unknown anime')).toEqual({ url: null, checkedAt: expect.any(Number) });
    });

    it('starts with the covers that were kept, without asking AniList again, when the app is opened again the same day', async () => {
        const { options: given } = options({ scheduleUrl: origin });
        const first = open(given) as AnimeRuntime;
        await first.handlers.covers.find('Naruto');
        first.db.close();
        opened.splice(opened.indexOf(first), 1);

        const second = open(given) as AnimeRuntime;

        expect(await second.handlers.covers.find('Naruto')).toBe(cover);
        expect(searches).toEqual(['Naruto']);
    });

    it('checks a cover kept on an earlier day once, and tells the screen when AniList gives another address', async () => {
        const { send, options: given } = options({ scheduleUrl: origin });
        const previous = new AnimeDb(join(given.dataDir, 'anime', 'anime.db'));
        previous.saveCover('naruto', 'https://s4.anilist.co/cover/old.jpg');
        previous.close();
        const longAgo = new DatabaseSync(join(given.dataDir, 'anime', 'anime.db'));
        longAgo.prepare('UPDATE anime_cover SET checked_at = ?').run(Date.now() - 3 * 24 * 60 * 60 * 1000);
        longAgo.close();
        const runtime = open(given) as AnimeRuntime;

        // What was kept is shown at once.
        expect(await runtime.handlers.covers.find('Naruto')).toBe('https://s4.anilist.co/cover/old.jpg');

        await vi.waitFor(() => {
            expect(send).toHaveBeenCalledWith(IPC.eventAnimeCover, { title: 'Naruto', url: cover });
        });
        expect(send).toHaveBeenCalledTimes(1);
        expect(runtime.db.getCover('naruto')?.url).toBe(cover);
        expect(await runtime.handlers.covers.find('Naruto')).toBe(cover);
        expect(searches).toEqual(['Naruto']);
    });

    it('keeps the cover it has, and says nothing, when AniList gives the same address', async () => {
        const { send, options: given } = options({ scheduleUrl: origin });
        const previous = new AnimeDb(join(given.dataDir, 'anime', 'anime.db'));
        previous.saveCover('naruto', cover);
        previous.close();
        const longAgo = new DatabaseSync(join(given.dataDir, 'anime', 'anime.db'));
        longAgo.prepare('UPDATE anime_cover SET checked_at = ?').run(Date.now() - 3 * 24 * 60 * 60 * 1000);
        longAgo.close();
        const runtime = open(given) as AnimeRuntime;

        await runtime.handlers.covers.find('Naruto');

        await vi.waitFor(() => {
            expect(searches).toEqual(['Naruto']);
        });
        await vi.waitFor(() => {
            expect(runtime.db.getCover('naruto')?.checkedAt).toBeGreaterThan(Date.now() - 60_000);
        });
        expect(send).not.toHaveBeenCalled();
    });

    it('fails, and keeps nothing, when AniList cannot be reached', async () => {
        const { options: given } = options({ scheduleUrl: 'http://127.0.0.1:1/graphql' });
        const runtime = open(given) as AnimeRuntime;

        await expect(runtime.handlers.covers.find('Naruto')).rejects.toThrow('AniList could not be reached:');

        expect(runtime.db.getCover('naruto')).toBeNull();
    });
});
