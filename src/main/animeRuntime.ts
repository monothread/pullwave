import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isAnimeSupported, type AnimeScheduleRequest, type SubtitleGenerateResponse, type SubtitleTranslateResponse } from '@shared/anime';
import { IPC } from '@shared/constants';
import { resolveLanguage } from '@shared/i18n';
import { LLM_PROVIDERS, SPEECH_PROVIDERS, speechTokenSlot, speechTranslatesTo, type LlmTokenSlot } from '@shared/llm';
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
import { createFfmpegRunner, type AudioFiles, type FfmpegRunner } from './services/audioExtractor';
import { completeWithLlm, type LlmFetch } from './services/llmProviders';
import { transcribeWithGemini } from './services/geminiSpeech';
import { transcribeWithSpeechService } from './services/speechProviders';
import { estimateSubtitleGeneration, generateEpisodeSubtitle, type SpeechAccess } from './services/subtitleGeneration';
import { SubtitleGenerationQueue } from './services/subtitleGenerationQueue';
import { checkSubtitles } from './services/subtitleCheck';
import { estimateSubtitleTranslation, translateEpisodeSubtitle, type LlmAccess } from './services/subtitleTranslation';
import { SubtitleTranslationQueue } from './services/subtitleTranslationQueue';
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
    // The token of a provider or of a service of speech to text (a slot), or null when it has none (it lives in the main process only, see
    // llmTokenStore.ts).
    getLlmToken?: (slot: LlmTokenSlot) => string | null;
    // How the language model and the service of speech to text are reached, how ffmpeg is run to take the audio out of a video and where
    // its parts are kept, and how long a translation waits when the provider asks it to (the tests replace them).
    llmFetch?: LlmFetch;
    speechFetch?: LlmFetch;
    runFfmpeg?: FfmpegRunner;
    audioFiles?: AudioFiles;
    translationSleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
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
    // What the language model of the settings is asked with; what the settings lack when it cannot be.
    const llmAccess = (): LlmAccess => {
        const settings = options.getSettings();
        const token = options.getLlmToken?.(settings.translateProvider) ?? null;
        if (token === null) {
            return { ok: false, reason: 'no-token' };
        }
        if (settings.translateModel.length === 0) {
            return { ok: false, reason: 'no-model' };
        }
        if (settings.translateBaseUrl.length === 0 && LLM_PROVIDERS[settings.translateProvider].defaultBaseUrl.length === 0) {
            return { ok: false, reason: 'no-address' };
        }
        return {
            ok: true,
            ask: (system, user, signal) => {
                return completeWithLlm({
                    provider: settings.translateProvider,
                    baseUrl: settings.translateBaseUrl,
                    model: settings.translateModel,
                    token,
                    system,
                    user,
                    signal
                }, options.llmFetch);
            }
        };
    };
    const translations = new SubtitleTranslationQueue({
        run: (request, onProgress, signal): Promise<SubtitleTranslateResponse> => {
            const filePath = downloadedFile(request.episodeId);
            if (filePath === null) {
                return Promise.resolve({ ok: false, reason: 'missing' });
            }
            return translateEpisodeSubtitle(filePath, request, { llm: llmAccess, files: options.subtitleFiles, sleep: options.translationSleep }, onProgress, signal);
        },
        onJobUpdate: (job) => {
            options.send(IPC.eventSubtitleTranslation, job);
        }
    });
    // What the service of speech to text of the settings is asked with; what the settings lack when it cannot be.
    const speechAccess = (): SpeechAccess => {
        const settings = options.getSettings();
        const token = options.getLlmToken?.(speechTokenSlot(settings.transcribeProvider)) ?? null;
        if (token === null) {
            return { ok: false, reason: 'no-token' };
        }
        if (settings.transcribeModel.length === 0) {
            return { ok: false, reason: 'no-model' };
        }
        if (settings.transcribeBaseUrl.length === 0 && SPEECH_PROVIDERS[settings.transcribeProvider].defaultBaseUrl.length === 0) {
            return { ok: false, reason: 'no-address' };
        }
        return {
            ok: true,
            translatesTo: speechTranslatesTo(settings.transcribeProvider),
            ask: (input) => {
                if (settings.transcribeProvider === 'gemini') {
                    return transcribeWithGemini({
                        baseUrl: settings.transcribeBaseUrl,
                        model: settings.transcribeModel,
                        token,
                        task: input.task,
                        audioLanguage: input.audioLanguage,
                        language: input.language,
                        audio: input.audio,
                        signal: input.signal
                    }, options.speechFetch);
                }
                return transcribeWithSpeechService({
                    provider: settings.transcribeProvider,
                    baseUrl: settings.transcribeBaseUrl,
                    model: settings.transcribeModel,
                    token,
                    task: input.task,
                    language: input.languageCode,
                    audio: input.audio,
                    fileName: input.fileName,
                    signal: input.signal
                }, options.speechFetch);
            }
        };
    };
    // ffmpeg is looked for when it is needed, since the path can be changed in the settings.
    const runFfmpeg: FfmpegRunner = (args, signal) => {
        return (options.runFfmpeg ?? createFfmpegRunner(options.resolver.ffmpeg(options.getSettings()).path))(args, signal);
    };
    const generations = new SubtitleGenerationQueue({
        run: (request, onProgress, signal): Promise<SubtitleGenerateResponse> => {
            const filePath = downloadedFile(request.episodeId);
            if (filePath === null) {
                return Promise.resolve({ ok: false, reason: 'missing' });
            }
            return generateEpisodeSubtitle(filePath, request, { speech: speechAccess, translation: llmAccess, ffmpeg: runFfmpeg, audio: options.audioFiles, files: options.subtitleFiles, sleep: options.translationSleep }, onProgress, signal);
        },
        onJobUpdate: (job) => {
            options.send(IPC.eventSubtitleGeneration, job);
        }
    });
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
                generate: (request) => {
                    return generations.enqueue(request);
                },
                estimateGeneration: async (episodeId) => {
                    const filePath = downloadedFile(episodeId);
                    return filePath === null ? { ok: false, reason: 'missing' } : estimateSubtitleGeneration(filePath, runFfmpeg);
                },
                cancelGeneration: (episodeId) => {
                    generations.cancel(episodeId);
                },
                translate: (request) => {
                    return translations.enqueue(request);
                },
                estimate: (request) => {
                    const filePath = downloadedFile(request.episodeId);
                    return Promise.resolve(filePath === null ? { ok: false, reason: 'missing' } : estimateSubtitleTranslation(filePath, request, options.subtitleFiles));
                },
                cancelTranslation: (episodeId) => {
                    translations.cancel(episodeId);
                },
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
