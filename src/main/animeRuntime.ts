import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isAnimeSupported, type AnimeScheduleRequest, type AutoTranslateOffReason, type SubtitleGenerateResponse, type SubtitleTranslateResponse, type TranslationLanguage } from '@shared/anime';
import { IPC } from '@shared/constants';
import { resolveLanguage } from '@shared/i18n';
import { LLM_PROVIDERS, SPEECH_PROVIDERS, speechCutsAtPauses, speechModelOf, speechTokenSlot, speechTranslatesTo, translationSetupGap, type LlmTokenSlot } from '@shared/llm';
import type { Settings } from '@shared/types';
import type { AnimeHandlerDependencies } from './ipc/registerAnimeHandlers';
import { AniCliLocator, type AniPrograms, type AniTools } from './services/aniCliLocator';
import { AniCliService } from './services/aniCliService';
import { subtitleLabels } from './services/aniSubtitles';
import { AnimeDb } from './services/animeDb';
import { AnimeCoverService } from './services/animeCovers';
import { fallbackProviders } from './services/covers/coverChain';
import { loadSchedule, SCHEDULE_CACHE_MS } from './services/animeSchedule';
import { AnimeDownloadQueue } from './services/animeDownloadQueue';
import { AnimeAiringService } from './services/animeAiring';
import { AnimeUpdateChecker } from './services/animeUpdateChecker';
import { AutoSubtitleTranslator, autoTranslateTarget } from './services/autoSubtitles';
import { JsonStore } from './services/jsonStore';
import { animeBaseDirectory, isInsideDirectory, removeDirectories, removeEmptyDirectories } from './services/animeFiles';
import { migrateAnimeFolder, type MigrationFileSystem } from './services/animeMigration';
import { executableName, type BinaryResolver } from './services/binaryResolver';
import type { AniCliCheck, ProgramTools } from './services/tools/programTools';
import { probeAniCli } from './services/aniUpdateProbe';
import type { MediaSource } from './services/mediaProtocol';
import { createStreamHandler, STREAM_USER_AGENT, StreamSessions } from './services/streamProxy';
import { removeFiles } from './services/partialFiles';
import { refreshEpisodeMetadata } from './services/episodeMetadata';
import { importLibrary } from './services/libraryImport';
import { scanLibraryFolder, type ScanFileSystem } from './services/libraryScan';
import { createFfmpegRunner, type AudioFiles, type FfmpegRunner } from './services/audioExtractor';
import { checkLibraryAudio, videoHasAudio } from './services/audioCheck';
import { repairLibraryEpisodes } from './services/episodeRepair';
import { repairImageHeader } from './services/imageHeaderRepair';
import { completeWithLlm, type LlmFetch } from './services/llmProviders';
import { transcribeWithGemini } from './services/geminiSpeech';
import { transcribeTextWithSpeechService, transcribeWithSpeechService } from './services/speechProviders';
import { estimateSubtitleGeneration, generateEpisodeSubtitle, type SpeechAccess } from './services/subtitleGeneration';
import { SubtitleGenerationQueue } from './services/subtitleGenerationQueue';
import { checkSubtitles } from './services/subtitleCheck';
import { canBeTranslated, estimateSubtitleTranslation, translateEpisodeSubtitle, type LlmAccess } from './services/subtitleTranslation';
import { createTranslatedBatches } from './services/subtitleTranslator';
import { SubtitleTranslationQueue } from './services/subtitleTranslationQueue';
import { defaultSubtitleFileSystem, importSubtitle, listSubtitleTracks, resolveSubtitlePath, type SubtitleFileSystem } from './services/subtitleFiles';

// A file the player has just let go of can still be held for a moment (Windows will not delete it then): what is left is
// removed again after this long.
export const REMOVE_RETRY_MS = 500;

export interface AnimeRuntimeOptions {
    platform: NodeJS.Platform;
    // userData: the library lives in <dataDir>/anime.
    dataDir: string;
    // resources/ani-scripts (inside the package once built): the script that runs ani-cli with its stand-ins.
    scriptsDir: string;
    // The programs the app installed (ani-cli, the shell and the curl it runs on, deno and ffmpeg).
    programs: Pick<ProgramTools, 'pathOf'>;
    defaultDownloadDir: string;
    resolver: BinaryResolver;
    getSettings: () => Settings;
    // The language of the system, which the interface (and so the subtitles) follows when it is set to "device".
    systemLocale: string;
    // A different ani-cli to run instead of the one the app installs (used by the end-to-end tests).
    customScriptPath?: () => string;
    // How files and folders are deleted (the tests replace it).
    remover?: { files: (paths: string[]) => void; folders: (paths: string[]) => void; emptyFolders?: (paths: string[]) => void };
    // How long to wait before removing again what could not be removed at first (the tests make it short).
    removeRetryMs?: number;
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
    // Saves the automatic translation of the new episodes off in the settings (once the provider refused or the settings lack what it needs).
    disableAutoTranslate?: () => void;
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
    // The address that stands in for the services of covers asked when AniList has none (used by the end-to-end tests; see FallbackOptions).
    coverFallbackUrl?: string;
    // When the look for new episodes happens: that long after the app opens, and again that often (used by the end-to-end tests).
    checkTimes?: { firstMs: number; everyMs: number };
    send: (channel: string, payload?: unknown) => void;
}

export interface AnimeRuntime {
    db: AnimeDb;
    queue: AnimeDownloadQueue;
    handlers: AnimeHandlerDependencies;
    media: MediaSource;
    // Answers the requests of the player for a stream that is being watched without downloading it.
    streamHandler: (request: Request) => Promise<Response>;
    // Starts the automatic look for new episodes of the anime of the library (it is not started by creating the runtime), and ends it.
    startBackgroundChecks: () => void;
    stopBackgroundChecks: () => void;
    // The settings were saved or a token changed: the automatic translation of the new episodes is turned off when it cannot work.
    enforceAutoTranslateSetup: () => void;
    // Tries a new script of ani-cli for real before an update makes it the one in use (see aniUpdateProbe.ts).
    checkScript: AniCliCheck;
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
    const installed: AniPrograms = {
        anicli: () => {
            return options.programs.pathOf('anicli');
        },
        busybox: () => {
            return options.programs.pathOf('busybox');
        },
        curl: () => {
            return options.programs.pathOf('curl');
        }
    };
    const locator = new AniCliLocator({ scriptsDir: options.scriptsDir, dataDir: animeDir }, installed, undefined, options.platform);
    const customScriptPath = options.customScriptPath ?? ((): string => {
        return '';
    });
    const aniSubtitleLabels = (): string[] => {
        const settings = options.getSettings();
        return subtitleLabels(settings.animeSubtitles, resolveLanguage(settings.language, options.systemLocale));
    };
    const aniTools = (): AniTools => {
        const settings = options.getSettings();
        return {
            ytdlp: options.resolver.ytdlp(settings),
            ffmpeg: options.resolver.ffmpeg(settings),
            deno: options.programs.pathOf('deno'),
            ffprobe: options.programs.pathOf('ffmpeg', `bin/${executableName('ffprobe', options.platform)}`)
        };
    };
    const service = new AniCliService({ locator, customScriptPath, subtitleLabels: aniSubtitleLabels, tools: aniTools });
    // A new ani-cli is tried on its own (its own patched copy, links and history, in a folder apart) so nothing of the one in use is touched
    // while the update is checked.
    const checkScript: AniCliCheck = (scriptPath, onStep) => {
        const probeLocator = new AniCliLocator(
            { scriptsDir: options.scriptsDir, dataDir: join(animeDir, 'update-check') },
            {
                ...installed,
                anicli: () => {
                    return scriptPath;
                }
            },
            undefined,
            options.platform
        );
        const probeService = new AniCliService({
            locator: probeLocator,
            customScriptPath: () => {
                return '';
            },
            subtitleLabels: aniSubtitleLabels,
            tools: aniTools
        });
        return probeAniCli(probeService, onStep);
    };
    const queue = new AnimeDownloadQueue({
        db,
        sourceProvider: () => {
            return service.provider;
        },
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
        removeFile: (path) => {
            rmSync(path, { force: true });
        },
        onEpisodeDownloaded: (episodeId) => {
            refreshEpisodeMetadata(db, episodeId, options.subtitleFiles ?? defaultSubtitleFileSystem, options.platform);
            void autoTranslation.episodeDownloaded(episodeId);
        },
        hasAudio: (path) => {
            return videoHasAudio(path, runFfmpeg);
        },
        repairVideo: (path) => {
            return repairImageHeader(path, runFfmpeg);
        },
        onJobUpdate: (job) => {
            options.send(IPC.eventAnimeJob, job);
        },
        onLibraryChanged: () => {
            options.send(IPC.eventAnimeLibrary);
        },
        onHeldChange: (held) => {
            options.send(IPC.eventAnimeQueueHeld, held);
        }
    });
    // The episodes that were paused when the app closed are shown again, ready to go on or be cancelled.
    queue.restore();
    // The video of a downloaded episode, or null when it has none.
    const downloadedFile = (episodeId: number): string | null => {
        const episode = db.getEpisode(episodeId);
        return episode && episode.status === 'done' ? episode.filePath : null;
    };
    // The name of the series of an episode (the one the user gave the seasons, or the title of the anime), to help hear the names in it.
    const seriesTitleOf = (episodeId: number): string | null => {
        const episode = db.getEpisode(episodeId);
        const anime = episode === null ? null : db.getAnime(episode.animeId);
        return anime === null ? null : (anime.series ?? anime.title);
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
    // The batches already translated, shared by the translations and the subtitles made from the audio: one that failed half way goes on
    // from where it stopped when it is asked for again.
    const translatedBatches = createTranslatedBatches();
    const translations = new SubtitleTranslationQueue({
        run: (request, onProgress, signal): Promise<SubtitleTranslateResponse> => {
            const filePath = downloadedFile(request.episodeId);
            if (filePath === null) {
                return Promise.resolve({ ok: false, reason: 'missing' });
            }
            return translateEpisodeSubtitle(filePath, request, { llm: llmAccess, files: options.subtitleFiles, sleep: options.translationSleep, batches: translatedBatches }, onProgress, signal);
        },
        onJobUpdate: (job) => {
            options.send(IPC.eventSubtitleTranslation, job);
        }
    });
    // The language the subtitles are wanted in: the one of the anime subtitles of the settings (the automatic translation of the new episodes and
    // the translation of a season go into it).
    const translationTarget = (): TranslationLanguage => {
        const settings = options.getSettings();
        return autoTranslateTarget(settings.animeSubtitles, resolveLanguage(settings.language, options.systemLocale), settings.translateLanguage);
    };
    // The subtitles of the new episodes the check downloads are translated into the language of the anime subtitles, when the user wants that.
    const autoTranslation = new AutoSubtitleTranslator({
        isEnabled: () => {
            return options.getSettings().animeAutoTranslateNew;
        },
        setupGap: () => {
            const settings = options.getSettings();
            const hasToken = (options.getLlmToken?.(settings.translateProvider) ?? null) !== null;
            return translationSetupGap({ provider: settings.translateProvider, model: settings.translateModel, baseUrl: settings.translateBaseUrl }, hasToken);
        },
        target: translationTarget,
        tracks: (episodeId) => {
            const filePath = downloadedFile(episodeId);
            return filePath === null ? null : listSubtitleTracks(filePath, options.subtitleFiles);
        },
        translate: (request) => {
            return translations.enqueue(request);
        },
        cancel: (episodeId) => {
            translations.cancel(episodeId);
        },
        turnOff: (reason: AutoTranslateOffReason) => {
            options.disableAutoTranslate?.();
            options.send(IPC.eventAnimeAutoTranslateOff, reason);
        }
    });
    // What the service of speech to text of the settings is asked with; what the settings lack when it cannot be.
    const speechAccess = (): SpeechAccess => {
        const settings = options.getSettings();
        const token = options.getLlmToken?.(speechTokenSlot(settings.transcribeProvider)) ?? null;
        if (token === null) {
            return { ok: false, reason: 'no-token' };
        }
        const model = speechModelOf(settings.transcribeProvider, settings.transcribeModel);
        if (model.length === 0) {
            return { ok: false, reason: 'no-model' };
        }
        if (settings.transcribeBaseUrl.length === 0 && SPEECH_PROVIDERS[settings.transcribeProvider].defaultBaseUrl.length === 0) {
            return { ok: false, reason: 'no-address' };
        }
        return {
            ok: true,
            translatesTo: speechTranslatesTo(settings.transcribeProvider),
            cutsAtPauses: speechCutsAtPauses(settings.transcribeProvider),
            ask: (input) => {
                if (settings.transcribeProvider === 'gemini') {
                    return transcribeWithGemini({
                        baseUrl: settings.transcribeBaseUrl,
                        model,
                        token,
                        task: input.task,
                        audioLanguage: input.audioLanguage,
                        language: input.language,
                        audio: input.audio,
                        signal: input.signal
                    }, options.speechFetch);
                }
                if (speechCutsAtPauses(settings.transcribeProvider)) {
                    return transcribeTextWithSpeechService({
                        provider: settings.transcribeProvider,
                        baseUrl: settings.transcribeBaseUrl,
                        model,
                        token,
                        language: input.languageCode,
                        prompt: input.prompt ?? '',
                        audio: input.audio,
                        fileName: input.fileName,
                        signal: input.signal
                    }, options.speechFetch);
                }
                return transcribeWithSpeechService({
                    provider: settings.transcribeProvider,
                    baseUrl: settings.transcribeBaseUrl,
                    model,
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
            return generateEpisodeSubtitle(filePath, { ...request, title: seriesTitleOf(request.episodeId) }, { speech: speechAccess, translation: llmAccess, ffmpeg: runFfmpeg, audio: options.audioFiles, files: options.subtitleFiles, sleep: options.translationSleep, batches: translatedBatches }, onProgress, signal);
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
    // The anime folder is being migrated: the files are moving, so nothing is downloaded into it meanwhile.
    let migrating = false;
    // The audio of the library is being looked at: another look does not start meanwhile.
    let checkingAudio = false;
    let repairing = false;
    // Which anime have ended, from AniList: they are not looked at for new episodes. Brought up to date at the start of each look.
    const airing = new AnimeAiringService({
        db,
        url: options.scheduleUrl,
        // The screen of the library shows which ones ended: it reads the library again when that is learned.
        onChange: () => {
            options.send(IPC.eventAnimeLibrary);
        }
    });
    // When the last look for new episodes was made: kept apart from the library, so the app opened again soon after a look does not look again.
    const lastCheck = new JsonStore<{ lastCheckAt: number | null }>(join(animeDir, 'update-check.json'), { lastCheckAt: null });
    // Looks, every 3 hours, for episodes the source has listed for the anime of the library, and puts them in the library.
    const checker = new AnimeUpdateChecker({
        db,
        lastCheck: {
            read: () => {
                const stored = lastCheck.read().lastCheckAt;
                return typeof stored === 'number' ? stored : null;
            },
            write: (time) => {
                lastCheck.write({ lastCheckAt: time });
            }
        },
        search: (query, atLeast) => {
            return service.search(query, atLeast);
        },
        episodes: (query, index) => {
            return service.episodes(query, index);
        },
        isEnabled: () => {
            return options.getSettings().animeCheckNewEpisodes;
        },
        autoDownload: () => {
            return options.getSettings().animeAutoDownloadNew;
        },
        download: (animeId, episodes) => {
            if (!migrating) {
                autoTranslation.expect(episodes.map((number) => {
                    return db.ensureEpisode(animeId, number).id;
                }));
                queue.downloadEpisodes(animeId, episodes);
            }
        },
        onNewEpisodes: (news) => {
            options.send(IPC.eventAnimeNewEpisodes, news);
        },
        onLibraryChanged: () => {
            options.send(IPC.eventAnimeLibrary);
        },
        onProgress: (state) => {
            options.send(IPC.eventAnimeCheckState, state);
        },
        beforeCheck: () => {
            return airing.sync();
        },
        firstDelayMs: options.checkTimes?.firstMs,
        intervalMs: options.checkTimes?.everyMs
    });
    const streams = new StreamSessions();
    const covers = new AnimeCoverService({
        url: options.scheduleUrl,
        fallbacks: fallbackProviders('anime', { baseUrl: options.coverFallbackUrl }),
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
    return {
        db,
        queue,
        media,
        streamHandler: createStreamHandler(streams),
        startBackgroundChecks: () => {
            checker.start();
        },
        stopBackgroundChecks: () => {
            checker.stop();
        },
        enforceAutoTranslateSetup: () => {
            autoTranslation.enforceSetup();
        },
        checkScript,
        handlers: {
            service,
            covers,
            updates: checker,
            schedule: {
                list: listSchedule
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
            checkAudio: async () => {
                if (checkingAudio) {
                    return { ok: false, reason: 'busy' };
                }
                checkingAudio = true;
                try {
                    const summary = await checkLibraryAudio(db, {
                        fileSize,
                        hasAudio: (path) => {
                            return videoHasAudio(path, runFfmpeg);
                        }
                    });
                    return { ok: true, ...summary };
                } finally {
                    checkingAudio = false;
                }
            },
            repairEpisodes: async (episodeIds) => {
                if (repairing) {
                    return { ok: false, reason: 'busy' };
                }
                repairing = true;
                try {
                    const summary = await repairLibraryEpisodes(db, episodeIds, {
                        fileSize,
                        repair: (path) => {
                            return repairImageHeader(path, runFfmpeg);
                        },
                        hasAudio: (path) => {
                            return videoHasAudio(path, runFfmpeg);
                        }
                    });
                    return { ok: true, ...summary };
                } finally {
                    repairing = false;
                }
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
                migrating = true;
                try {
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
                } finally {
                    migrating = false;
                }
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
                    if (filePath === null) {
                        return { ok: false, reason: 'missing' };
                    }
                    return estimateSubtitleGeneration(filePath, runFfmpeg, { cutsAtPauses: speechCutsAtPauses(options.getSettings().transcribeProvider), audio: options.audioFiles });
                },
                cancelGeneration: (episodeId) => {
                    generations.cancel(episodeId);
                },
                jobs: () => {
                    return { translations: translations.list(), generations: generations.list() };
                },
                translate: (request) => {
                    return translations.enqueue(request);
                },
                translatable: (episodeIds) => {
                    const language = translationTarget();
                    return {
                        language,
                        episodeIds: episodeIds.filter((episodeId) => {
                            const filePath = downloadedFile(episodeId);
                            return filePath !== null && canBeTranslated(filePath, language, options.subtitleFiles);
                        })
                    };
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
                        search: (query) => {
                            return service.search(query);
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
