import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isAnimeSupported, type AnimeScheduleRequest } from '@shared/anime';
import { IPC } from '@shared/constants';
import { resolveLanguage } from '@shared/i18n';
import { machineTimeZone, zonedDayLimits } from '@shared/timezone';
import type { Settings } from '@shared/types';
import type { AnimeHandlerDependencies } from './ipc/registerAnimeHandlers';
import { AniCliLocator, readTextFile } from './services/aniCliLocator';
import { createDefaultUpdaterDependencies, resetAniCli, updateAniCli, type AniCliUpdaterDependencies } from './services/aniCliUpdater';
import { AniCliService } from './services/aniCliService';
import { subtitleLabels } from './services/aniSubtitles';
import { AnimeDb } from './services/animeDb';
import { AnimeAvailabilityService } from './services/animeAvailability';
import { AnimeCoverService } from './services/animeCovers';
import { loadSchedule, SCHEDULE_CACHE_MS } from './services/animeSchedule';
import { AnimeDownloadQueue } from './services/animeDownloadQueue';
import { animeBaseDirectory, isInsideDirectory, removeDirectories, removeEmptyDirectories } from './services/animeFiles';
import { migrateAnimeFolder, type MigrationFileSystem } from './services/animeMigration';
import type { BinaryResolver } from './services/binaryResolver';
import type { MediaSource } from './services/mediaProtocol';
import { createStreamHandler, STREAM_USER_AGENT, StreamSessions } from './services/streamProxy';
import { removeFiles } from './services/partialFiles';
import { refreshEpisodeMetadata } from './services/episodeMetadata';
import { importLibrary } from './services/libraryImport';
import { scanLibraryFolder, type ScanFileSystem } from './services/libraryScan';
import { checkSubtitles } from './services/subtitleCheck';
import { defaultSubtitleFileSystem, importSubtitle, listSubtitleTracks, resolveSubtitlePath, type SubtitleFileSystem } from './services/subtitleFiles';

// A file the player has just let go of can still be held for a moment (Windows will not delete it then): what is left is
// removed again after this long.
export const REMOVE_RETRY_MS = 500;

export interface AnimeRuntimeOptions {
    platform: NodeJS.Platform;
    // userData: the library lives in <dataDir>/anime.
    dataDir: string;
    // resources/bin and resources/ani-scripts (inside the package once built).
    bundledDir: string;
    scriptsDir: string;
    defaultDownloadDir: string;
    resolver: BinaryResolver;
    getSettings: () => Settings;
    // The language of the system, which the interface (and so the subtitles) follows when it is set to "device".
    systemLocale: string;
    // A different ani-cli to run instead of the one that ships with the app (used by the end-to-end tests).
    customScriptPath?: () => string;
    // How files and folders are deleted (the tests replace it).
    remover?: { files: (paths: string[]) => void; folders: (paths: string[]) => void; emptyFolders?: (paths: string[]) => void };
    // How long to wait before removing again what could not be removed at first (the tests make it short).
    removeRetryMs?: number;
    // How the update of ani-cli reaches the network and checks what it got (the end-to-end tests replace it).
    updaterDependencies?: AniCliUpdaterDependencies;
    // Asks the user for a folder of anime to put into the library, starting at the given folder; null when they gave up (the
    // tests replace it).
    chooseLibraryFolder?: (startAt: string) => Promise<string | null>;
    // How the folders of anime are read (the tests replace it).
    scanFiles?: ScanFileSystem;
    // Asks the user for the folder the anime are migrated to, starting at the given folder; null when they gave up (the tests
    // replace it).
    chooseMigrationFolder?: (startAt: string) => Promise<string | null>;
    // Saves the folder the anime are in now in the settings (once a migration has moved them).
    saveAnimeDirectory?: (directory: string) => void;
    // How the files are copied and removed by a migration (the tests replace it).
    migrationFiles?: MigrationFileSystem;
    // Opens a folder in the file manager of the system (the tests replace it).
    openFolder?: (path: string) => void;
    // Asks the user for a subtitle file to load; null when they gave up (the tests replace it).
    chooseSubtitleFile?: () => Promise<string | null>;
    // How the files next to a video are read and written (the tests replace it).
    subtitleFiles?: SubtitleFileSystem;
    // How the text at an address is fetched when the subtitles of an episode are checked; null when it could not be (the tests
    // replace it).
    fetchSubtitleText?: (url: string, referer: string | null) => Promise<string | null>;
    // The address the schedule of the day is asked at, instead of AniList's (used by the end-to-end tests).
    scheduleUrl?: string;
    send: (channel: string, payload?: unknown) => void;
}

export interface AnimeRuntime {
    db: AnimeDb;
    queue: AnimeDownloadQueue;
    handlers: AnimeHandlerDependencies;
    media: MediaSource;
    // Answers the requests of the player for a stream that is being watched without downloading it.
    streamHandler: (request: Request) => Promise<Response>;
    // Starts, in the background, to check which anime of today's schedule the source has (it is not started by creating the runtime).
    startBackgroundChecks: () => void;
}

function fileSize(path: string): number | null {
    try {
        const stats = statSync(path);
        return stats.isFile() ? stats.size : null;
    } catch {
        return null;
    }
}

// How long a subtitle may take to arrive.
export const SUBTITLE_FETCH_TIMEOUT_MS = 10000;

// The text at an address, asked for with the site the source expects (as ani-cli asks for the subtitle it saves).
export async function fetchSubtitleText(url: string, referer: string | null, timeoutMs: number = SUBTITLE_FETCH_TIMEOUT_MS): Promise<string | null> {
    try {
        const headers: Record<string, string> = { 'User-Agent': STREAM_USER_AGENT };
        if (referer !== null) {
            headers.Referer = referer;
        }
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
        return response.ok ? await response.text() : null;
    } catch {
        return null;
    }
}

function removeAgainLater(paths: string[], remove: (paths: string[]) => void, milliseconds: number): void {
    setTimeout(() => {
        const left = paths.filter((path) => {
            return existsSync(path);
        });
        if (left.length > 0) {
            remove(left);
        }
    }, milliseconds).unref();
}

// Everything the anime section needs, or null where it does not exist (it is available on Linux and Windows).
export function createAnimeRuntime(options: AnimeRuntimeOptions): AnimeRuntime | null {
    if (!isAnimeSupported(options.platform)) {
        return null;
    }
    const animeDir = join(options.dataDir, 'anime');
    const db = new AnimeDb(join(animeDir, 'anime.db'));
    // The queue lives in memory: what was not finished when the app closed has to be started again by the user.
    db.failInterrupted();
    const locator = new AniCliLocator(
        {
            bundledDir: options.bundledDir,
            scriptsDir: options.scriptsDir,
            userBinDir: join(options.dataDir, 'bin'),
            dataDir: animeDir
        },
        undefined,
        options.platform
    );
    const customScriptPath = options.customScriptPath ?? ((): string => {
        return '';
    });
    const service = new AniCliService({
        locator,
        customScriptPath,
        subtitleLabels: () => {
            const settings = options.getSettings();
            return subtitleLabels(settings.animeSubtitles, resolveLanguage(settings.language, options.systemLocale));
        },
        tools: () => {
            const settings = options.getSettings();
            return { ytdlp: options.resolver.ytdlp(settings), ffmpeg: options.resolver.ffmpeg(settings) };
        }
    });
    const queue = new AnimeDownloadQueue({
        db,
        download: (request) => {
            return service.download(request);
        },
        getSettings: options.getSettings,
        defaultDownloadDir: options.defaultDownloadDir,
        platform: options.platform,
        ensureDirectory: (path) => {
            mkdirSync(path, { recursive: true });
        },
        fileSize,
        directoryExists: (path) => {
            return existsSync(path);
        },
        removeDirectory: (path) => {
            rmSync(path, { recursive: true, force: true });
        },
        onEpisodeDownloaded: (episodeId) => {
            refreshEpisodeMetadata(db, episodeId, options.subtitleFiles ?? defaultSubtitleFileSystem, options.platform);
        },
        onJobUpdate: (job) => {
            options.send(IPC.eventAnimeJob, job);
        },
        onLibraryChanged: () => {
            options.send(IPC.eventAnimeLibrary);
        }
    });
    // The video of a downloaded episode, or null when it has none.
    const downloadedFile = (episodeId: number): string | null => {
        const episode = db.getEpisode(episodeId);
        return episode && episode.status === 'done' ? episode.filePath : null;
    };
    const media: MediaSource = {
        resolve: (kind, episodeId, trackId) => {
            const filePath = downloadedFile(episodeId);
            if (filePath === null) {
                return null;
            }
            return kind === 'episode' ? filePath : resolveSubtitlePath(filePath, trackId, options.subtitleFiles);
        }
    };
    const streams = new StreamSessions();
    const covers = new AnimeCoverService({
        url: options.scheduleUrl,
        store: {
            get: (key) => {
                return db.getCover(key);
            },
            save: (key, url) => {
                db.saveCover(key, url);
            }
        },
        onChange: (title, url) => {
            options.send(IPC.eventAnimeCover, { title, url });
        }
    });
    const listSchedule = (request: AnimeScheduleRequest): ReturnType<typeof loadSchedule> => {
        return loadSchedule(request, {
            url: options.scheduleUrl,
            cache: {
                find: (from, to) => {
                    return db.findScheduleCache(from, to, Date.now() - SCHEDULE_CACHE_MS);
                },
                save: (from, to, entries) => {
                    db.saveScheduleCache(from, to, entries, Date.now() - SCHEDULE_CACHE_MS);
                }
            }
        });
    };
    const availability = new AnimeAvailabilityService({
        search: (query, audio) => {
            return service.search(query, audio);
        },
        store: {
            find: (anilistId, audio, since) => {
                return db.findAvailability(anilistId, audio, since);
            },
            save: (result, audio) => {
                db.saveAvailability(result, audio);
            },
            forgetBefore: (since) => {
                db.forgetAvailabilityBefore(since);
            }
        },
        audio: () => {
            return options.getSettings().animeAudio;
        },
        onResult: (result) => {
            options.send(IPC.eventAnimeAvailability, result);
        }
    });
    return {
        db,
        queue,
        media,
        streamHandler: createStreamHandler(streams),
        startBackgroundChecks: () => {
            // Today's schedule, in the time zone of the machine, is the one the screen opens on: its anime are checked before it is shown.
            const limits = zonedDayLimits(Date.now(), machineTimeZone(), 1);
            void listSchedule({ from: limits[0] as number, to: limits[1] as number, refresh: false })
                .then((response) => {
                    if (response.ok) {
                        availability.request(response.entries);
                    }
                    return undefined;
                })
                .catch(() => {
                    return undefined;
                });
        },
        handlers: {
            service,
            covers,
            availability,
            schedule: {
                list: listSchedule
            },
            updateAniCli: () => {
                return updateAniCli(locator, customScriptPath(), options.updaterDependencies ?? createDefaultUpdaterDependencies(locator.busyboxPath, readTextFile));
            },
            resetAniCli: () => {
                return resetAniCli(locator, options.updaterDependencies ?? createDefaultUpdaterDependencies(locator.busyboxPath, readTextFile));
            },
            streams,
            streamQuality: () => {
                return options.getSettings().animeQuality;
            },
            queue,
            db,
            removeFiles: (paths) => {
                const remove = options.remover?.files ?? removeFiles;
                remove(paths);
                removeAgainLater(paths, remove, options.removeRetryMs ?? REMOVE_RETRY_MS);
            },
            removeFolders: (paths) => {
                const remove = options.remover?.folders ?? removeDirectories;
                remove(paths);
                removeAgainLater(paths, remove, options.removeRetryMs ?? REMOVE_RETRY_MS);
            },
            removeEmptyFolders: (paths) => {
                const remove = options.remover?.emptyFolders ?? removeEmptyDirectories;
                remove(paths);
                removeAgainLater(paths, remove, options.removeRetryMs ?? REMOVE_RETRY_MS);
            },
            fileExists: (path) => {
                return fileSize(path) !== null;
            },
            refreshMetadata: (episodeId) => {
                refreshEpisodeMetadata(db, episodeId, options.subtitleFiles ?? defaultSubtitleFileSystem, options.platform);
            },
            importLibrary: async () => {
                const settings = options.getSettings();
                const startAt = animeBaseDirectory(settings, options.defaultDownloadDir, options.platform);
                const chosen = await (options.chooseLibraryFolder?.(startAt) ?? Promise.resolve(null));
                if (chosen === null) {
                    return { ok: false, reason: 'cancelled' };
                }
                // Every anime is inside the folder of the settings: one that is anywhere else is not accepted.
                if (!isInsideDirectory(chosen, startAt, options.platform)) {
                    return { ok: false, reason: 'outside', folder: startAt };
                }
                const summary = importLibrary(db, scanLibraryFolder(chosen, options.scanFiles), {
                    defaultAudio: settings.animeAudio,
                    fileSize,
                    onEpisodeSaved: (episodeId) => {
                        refreshEpisodeMetadata(db, episodeId, options.subtitleFiles ?? defaultSubtitleFileSystem, options.platform);
                    }
                });
                return { ok: true, ...summary };
            },
            migrateFolder: async () => {
                const currentDirectory = animeBaseDirectory(options.getSettings(), options.defaultDownloadDir, options.platform);
                const chosen = await (options.chooseMigrationFolder?.(currentDirectory) ?? Promise.resolve(null));
                if (chosen === null) {
                    return { ok: false, reason: 'cancelled' };
                }
                const outcome = await migrateAnimeFolder({
                    db,
                    files: options.migrationFiles,
                    platform: options.platform,
                    currentDirectory,
                    newDirectory: chosen,
                    saveDirectory: (directory) => {
                        options.saveAnimeDirectory?.(directory);
                    },
                    onProgress: (progress) => {
                        options.send(IPC.eventAnimeMigration, progress);
                    }
                });
                return outcome.ok ? { ...outcome, destination: chosen } : outcome;
            },
            openFolder: (path) => {
                options.openFolder?.(path);
            },
            platform: options.platform,
            baseDirectory: () => {
                return animeBaseDirectory(options.getSettings(), options.defaultDownloadDir, options.platform);
            },
            onLibraryChanged: () => {
                options.send(IPC.eventAnimeLibrary);
            },
            subtitles: {
                list: (episodeId) => {
                    const filePath = downloadedFile(episodeId);
                    return filePath === null ? [] : listSubtitleTracks(filePath, options.subtitleFiles);
                },
                import: async (episodeId) => {
                    const filePath = downloadedFile(episodeId);
                    if (filePath === null) {
                        return { ok: false, reason: 'missing' };
                    }
                    return importSubtitle(filePath, {
                        chooseFile: options.chooseSubtitleFile ?? ((): Promise<string | null> => {
                            return Promise.resolve(null);
                        }),
                        files: options.subtitleFiles
                    });
                },
                check: async (episodeId) => {
                    const episode = db.getEpisode(episodeId);
                    const anime = episode ? db.getAnime(episode.animeId) : null;
                    if (!episode || !anime) {
                        return { ok: false, reason: 'missing' };
                    }
                    return checkSubtitles(anime, episode, {
                        resolveSubtitles: (request) => {
                            return service.resolveSubtitles(request);
                        },
                        search: (query, audio) => {
                            return service.search(query, audio);
                        },
                        quality: () => {
                            return options.getSettings().animeQuality;
                        },
                        fetchText: options.fetchSubtitleText ?? fetchSubtitleText,
                        files: options.subtitleFiles
                    });
                }
            }
        }
    };
}
