import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isAnimeSupported, type AnimeScheduleRequest, type AutoTranslateOffReason, type SubtitleGenerateResponse, type SubtitleTranslateResponse, type TranslationLanguage } from '@shared/anime';
import { IPC } from '@shared/constants';
import { resolveLanguage } from '@shared/i18n';
import { LLM_PROVIDERS, SPEECH_PROVIDERS, speechCutsAtPauses, speechModelOf, speechPartSeconds, speechTokenSlot, speechTranslatesTo, translationSetupGap, type LlmTokenSlot } from '@shared/llm';
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
import { AutoSubtitleTranslator } from './services/autoSubtitles';
import { translationTargetOf } from '@shared/subtitleTarget';
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
import { defaultSubtitleFileSystem, deleteTranslatedSubtitle, importSubtitle, listSubtitleTracks, resolveSubtitlePath, type SubtitleFileSystem } from './services/subtitleFiles';

export const REMOVE_RETRY_MS = 500;

export interface AnimeRuntimeOptions {
    platform: NodeJS.Platform;
    dataDir: string;
    scriptsDir: string;
    programs: Pick<ProgramTools, 'pathOf'>;
    defaultDownloadDir: string;
    resolver: BinaryResolver;
    getSettings: () => Settings;
    systemLocale: string;
    customScriptPath?: () => string;
    remover?: { files: (paths: string[]) => void; folders: (paths: string[]) => void; emptyFolders?: (paths: string[]) => void };
    removeRetryMs?: number;
    chooseLibraryFolder?: (startAt: string) => Promise<string | null>;
    scanFiles?: ScanFileSystem;
    chooseMigrationFolder?: (startAt: string) => Promise<string | null>;
    saveAnimeDirectory?: (directory: string) => void;
    disableAutoTranslate?: () => void;
    migrationFiles?: MigrationFileSystem;
    openFolder?: (path: string) => void;
    chooseSubtitleFile?: () => Promise<string | null>;
    subtitleFiles?: SubtitleFileSystem;
    fetchSubtitleText?: (url: string, referer: string | null) => Promise<string | null>;
    getLlmToken?: (slot: LlmTokenSlot) => string | null;
    llmFetch?: LlmFetch;
    speechFetch?: LlmFetch;
    runFfmpeg?: FfmpegRunner;
    audioFiles?: AudioFiles;
    translationSleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
    scheduleUrl?: string;
    coverFallbackUrl?: string;
    checkTimes?: { firstMs: number; everyMs: number };
    send: (channel: string, payload?: unknown) => void;
}

export interface AnimeRuntime {
    db: AnimeDb;
    queue: AnimeDownloadQueue;
    handlers: AnimeHandlerDependencies;
    media: MediaSource;
    streamHandler: (request: Request) => Promise<Response>;
    startBackgroundChecks: () => void;
    stopBackgroundChecks: () => void;
    enforceAutoTranslateSetup: () => void;
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

export const SUBTITLE_FETCH_TIMEOUT_MS = 10000;

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

export function createAnimeRuntime(options: AnimeRuntimeOptions): AnimeRuntime | null {
    if (!isAnimeSupported(options.platform)) {
        return null;
    }
    const animeDir = join(options.dataDir, 'anime');
    const db = new AnimeDb(join(animeDir, 'anime.db'));
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
        onLibraryEntryChanged: (animeId) => {
            options.send(IPC.eventAnimeLibraryEntry, animeId);
        },
        onHeldChange: (held) => {
            options.send(IPC.eventAnimeQueueHeld, held);
        }
    });
    queue.restore();
    const downloadedFile = (episodeId: number): string | null => {
        const episode = db.getEpisode(episodeId);
        return episode && episode.status === 'done' ? episode.filePath : null;
    };
    const seriesTitleOf = (episodeId: number): string | null => {
        const episode = db.getEpisode(episodeId);
        const anime = episode === null ? null : db.getAnime(episode.animeId);
        return anime === null ? null : (anime.series ?? anime.title);
    };
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
    const translationTarget = (): TranslationLanguage => {
        const settings = options.getSettings();
        return translationTargetOf(settings.animeSubtitles, resolveLanguage(settings.language, options.systemLocale));
    };
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
        const partSeconds = speechPartSeconds(settings.transcribeProvider);
        return {
            ok: true,
            translatesTo: speechTranslatesTo(settings.transcribeProvider),
            cutsAtPauses: speechCutsAtPauses(settings.transcribeProvider),
            partSeconds,
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
                        maxSeconds: partSeconds,
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
    let migrating = false;
    let checkingAudio = false;
    let repairing = false;
    const airing = new AnimeAiringService({
        db,
        url: options.scheduleUrl,
        onChange: () => {
            options.send(IPC.eventAnimeLibrary);
        }
    });
    const lastCheck = new JsonStore<{ lastCheckAt: number | null }>(join(animeDir, 'update-check.json'), { lastCheckAt: null });
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
        sourceProvider: () => {
            return service.provider;
        },
        isEnabled: () => {
            return options.getSettings().animeCheckNewEpisodes;
        },
        autoDownload: () => {
            return options.getSettings().animeAutoDownloadNew;
        },
        download: (animeId, episodes) => {
            if (!migrating) {
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
                    const provider = options.getSettings().transcribeProvider;
                    return estimateSubtitleGeneration(filePath, runFfmpeg, {
                        cutsAtPauses: speechCutsAtPauses(provider),
                        partSeconds: speechPartSeconds(provider),
                        audio: options.audioFiles
                    });
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
                deleteTranslated: (episodeId, trackId) => {
                    const filePath = downloadedFile(episodeId);
                    return filePath === null ? { ok: false, reason: 'missing' } : deleteTranslatedSubtitle(filePath, trackId, options.subtitleFiles);
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
