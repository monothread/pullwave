import { DEFAULT_SETTINGS } from '@shared/constants';
import type { AnimeAddResponse, AnimeAvailability, AnimeRenameSeriesResponse, AnimeCoverUpdate, AnimeHistoryEntry, AnimeImportResponse, AnimeSubtitleCheckResponse, AnimeMigrationProgress, AnimeMigrationResponse, AnimeSeriesResponse, AnimeJob, AnimeScheduleResponse, AnimeSubtitleImportResponse, AnimeSubtitleTrack, LibraryAnime, SubtitleEstimateResponse, SubtitleGenerateEstimateResponse, SubtitleGenerateResponse, SubtitleGenerationJob, SubtitleTranslateResponse, SubtitleTranslationJob } from '@shared/anime';
import type { LlmStatus } from '@shared/llm';
import type { MangaApi, MangaCloudflareActivity, MangaJob, MangaServerStatus } from '@shared/manga';
import type { ToolState } from '@shared/tools';
import type { AppUpdateState, CyberApi, DownloadJob, StreamFindProgress } from '@shared/types';

export type MockMangaApi = { [K in keyof MangaApi]: ReturnType<typeof vi.fn> };

export interface MockApiHandle {
    api: { [K in Exclude<keyof CyberApi, 'manga'>]: ReturnType<typeof vi.fn> } & { manga: MockMangaApi };
    emitMangaTool: (state: ToolState) => void;
    emitMangaServer: (status: MangaServerStatus) => void;
    emitMangaCloudflare: (active: MangaCloudflareActivity[]) => void;
    emitMangaJob: (job: MangaJob) => void;
    emitMangaLibraryChanged: () => void;
    emitJobUpdate: (job: DownloadJob) => void;
    emitJobRemoved: (id: string) => void;
    emitHistoryChanged: () => void;
    emitAppUpdateState: (state: AppUpdateState) => void;
    emitStreamProgress: (progress: StreamFindProgress) => void;
    emitAnimeJob: (job: AnimeJob) => void;
    emitAnimeLibraryChanged: () => void;
    emitAnimeMigrationProgress: (progress: AnimeMigrationProgress) => void;
    emitAnimeCover: (update: AnimeCoverUpdate) => void;
    emitAnimeAvailability: (availability: AnimeAvailability) => void;
    emitSubtitleTranslation: (job: SubtitleTranslationJob) => void;
    emitSubtitleGeneration: (job: SubtitleGenerationJob) => void;
    unsubscribers: Array<ReturnType<typeof vi.fn>>;
}

export const APP_UPDATE_IDLE: AppUpdateState = { status: 'idle', currentVersion: '0.1.0', version: null, percent: 0, message: null };

export function createMockApi(): MockApiHandle {
    const jobListeners: Array<(job: DownloadJob) => void> = [];
    const removedListeners: Array<(id: string) => void> = [];
    const historyListeners: Array<() => void> = [];
    const appUpdateListeners: Array<(state: AppUpdateState) => void> = [];
    const streamProgressListeners: Array<(progress: StreamFindProgress) => void> = [];
    const animeJobListeners: Array<(job: AnimeJob) => void> = [];
    const animeLibraryListeners: Array<() => void> = [];
    const animeMigrationListeners: Array<(progress: AnimeMigrationProgress) => void> = [];
    const animeCoverListeners: Array<(update: AnimeCoverUpdate) => void> = [];
    const animeAvailabilityListeners: Array<(availability: AnimeAvailability) => void> = [];
    const subtitleTranslationListeners: Array<(job: SubtitleTranslationJob) => void> = [];
    const subtitleGenerationListeners: Array<(job: SubtitleGenerationJob) => void> = [];
    const mangaToolListeners: Array<(state: ToolState) => void> = [];
    const mangaServerListeners: Array<(status: MangaServerStatus) => void> = [];
    const mangaCloudflareListeners: Array<(active: MangaCloudflareActivity[]) => void> = [];
    const mangaJobListeners: Array<(job: MangaJob) => void> = [];
    const mangaLibraryListeners: Array<() => void> = [];
    const unsubscribers: Array<ReturnType<typeof vi.fn>> = [];

    function subscribe<T>(listeners: T[], listener: T): () => void {
        listeners.push(listener);
        const unsubscribe = vi.fn();
        unsubscribers.push(unsubscribe);
        return unsubscribe;
    }

    const manga: MockMangaApi = {
        // Like the anime section, the manga section is off until a test turns it on.
        status: vi.fn(async () => {
            return { supported: false, tool: null, helper: null, helperProblem: null, helperExternal: false, server: 'stopped', serverError: null };
        }),
        install: vi.fn(async () => {
            return null;
        }),
        stores: vi.fn(async () => {
            return { ok: true, value: [] };
        }),
        addStore: vi.fn(async (indexUrl: string) => {
            return { ok: true, value: { indexUrl, name: indexUrl } };
        }),
        removeStore: vi.fn(async () => {
            return { ok: true, value: null };
        }),
        extensions: vi.fn(async () => {
            return { ok: true, value: [] };
        }),
        updateAllExtensions: vi.fn(async () => {
            return { ok: true, value: 0 };
        }),
        installHelper: vi.fn(async () => {
            return undefined;
        }),
        removeHelper: vi.fn(async () => {
            return undefined;
        }),
        changeExtension: vi.fn(async () => {
            return { ok: true, value: null };
        }),
        sources: vi.fn(async () => {
            return { ok: true, value: [] };
        }),
        readPages: vi.fn(async () => {
            return { ok: true, value: { pages: [], local: false } };
        }),
        sourceFilters: vi.fn(async () => {
            return { ok: true, value: [] };
        }),
        sourcePreferences: vi.fn(async () => {
            return { ok: true, value: [] };
        }),
        setSourcePreference: vi.fn(async () => {
            return { ok: true, value: [] };
        }),
        list: vi.fn(async () => {
            return { ok: true, value: { items: [], hasNextPage: false } };
        }),
        details: vi.fn(async () => {
            return { ok: false, error: { code: 'NOT_FOUND', message: 'not set up' } };
        }),
        addToLibrary: vi.fn(async () => {
            return null;
        }),
        download: vi.fn(async () => {
            return null;
        }),
        downloadMissing: vi.fn(async () => {return undefined}),
        library: vi.fn(async () => {
            return [];
        }),
        jobs: vi.fn(async () => {
            return [];
        }),
        cancel: vi.fn(async () => {return undefined}),
        retry: vi.fn(async () => {return undefined}),
        pause: vi.fn(async () => {return undefined}),
        resume: vi.fn(async () => {return undefined}),
        clearFinished: vi.fn(async () => {return undefined}),
        removeChapter: vi.fn(async () => {return undefined}),
        removeManga: vi.fn(async () => {return undefined}),
        openFolder: vi.fn(async () => {return undefined}),
        onToolState: vi.fn((listener: (state: ToolState) => void) => {
            return subscribe(mangaToolListeners, listener);
        }),
        onServerStatus: vi.fn((listener: (status: MangaServerStatus) => void) => {
            return subscribe(mangaServerListeners, listener);
        }),
        onCloudflareActivity: vi.fn((listener: (active: MangaCloudflareActivity[]) => void) => {
            return subscribe(mangaCloudflareListeners, listener);
        }),
        onJobUpdate: vi.fn((listener: (job: MangaJob) => void) => {
            return subscribe(mangaJobListeners, listener);
        }),
        onLibraryChanged: vi.fn((listener: () => void) => {
            return subscribe(mangaLibraryListeners, listener);
        })
    };

    const api: MockApiHandle['api'] = {
        manga,
        getSettings: vi.fn(async () => {
            return DEFAULT_SETTINGS;
        }),
        saveSettings: vi.fn(async (settings) => {
            return settings;
        }),
        addDownload: vi.fn(async () => {
            return { ok: true, job: null, message: null };
        }),
        listJobs: vi.fn(async () => {
            return [];
        }),
        cancelJob: vi.fn(async () => {
            return undefined;
        }),
        pauseJob: vi.fn(async () => {
            return undefined;
        }),
        resumeJob: vi.fn(async () => {
            return undefined;
        }),
        stopJob: vi.fn(async () => {
            return undefined;
        }),
        retryJob: vi.fn(async () => {
            return undefined;
        }),
        clearPartialFiles: vi.fn(async () => {
            return undefined;
        }),
        removeJob: vi.fn(async () => {
            return undefined;
        }),
        clearFinished: vi.fn(async () => {
            return undefined;
        }),
        listHistory: vi.fn(async () => {
            return [];
        }),
        clearHistory: vi.fn(async () => {
            return undefined;
        }),
        checkBinaries: vi.fn(async () => {
            return {
                ytdlp: { found: true, path: '/app/bin/yt-dlp', version: '2026.08.19', source: 'bundled' },
                ffmpeg: { found: true, path: '/app/bin/ffmpeg', version: '7.0', source: 'bundled' }
            };
        }),
        updateYtdlp: vi.fn(async () => {
            return { ok: true, output: 'Updated' };
        }),
        resetYtdlp: vi.fn(async () => {
            return { ok: true, output: 'Using the bundled yt-dlp' };
        }),
        getAppUpdateState: vi.fn(async () => {
            return APP_UPDATE_IDLE;
        }),
        checkAppUpdate: vi.fn(async () => {
            return undefined;
        }),
        downloadAppUpdate: vi.fn(async () => {
            return undefined;
        }),
        installAppUpdate: vi.fn(async () => {
            return undefined;
        }),
        findStreams: vi.fn(async () => {
            return { ok: false, candidates: [], message: 'No video stream was found.', usedBrowser: true };
        }),
        cancelStreamFind: vi.fn(async () => {
            return undefined;
        }),
        downloadStream: vi.fn(async () => {
            return { ok: true, job: null, message: null };
        }),
        getTraySupport: vi.fn(async () => {
            return { available: true, reason: null };
        }),
        listBrowsers: vi.fn(async () => {
            return [];
        }),
        chooseDirectory: vi.fn(async () => {
            return null;
        }),
        showItemInFolder: vi.fn(async () => {
            return undefined;
        }),
        getAnimeStatus: vi.fn(async () => {
            return { supported: false, available: false, aniCli: null };
        }),
        searchAnime: vi.fn(async () => {
            return { ok: true, results: [] };
        }),
        listAnimeEpisodes: vi.fn(async () => {
            return { ok: true, episodes: [] };
        }),
        downloadAnime: vi.fn(async (): Promise<{ ok: false; message: string }> => {
            return { ok: false, message: 'not mocked' };
        }),
        listAnimeLibrary: vi.fn(async (): Promise<LibraryAnime[]> => {
            return [];
        }),
        listAnimeHistory: vi.fn(async (): Promise<AnimeHistoryEntry[]> => {
            return [];
        }),
        recordAnimeHistory: vi.fn(async () => {
            return undefined;
        }),
        removeAnimeHistory: vi.fn(async () => {
            return undefined;
        }),
        clearAnimeHistory: vi.fn(async () => {
            return undefined;
        }),
        listAnimeJobs: vi.fn(async (): Promise<AnimeJob[]> => {
            return [];
        }),
        cancelAnimeJob: vi.fn(async () => {
            return undefined;
        }),
        pauseAnimeJob: vi.fn(async () => {
            return undefined;
        }),
        resumeAnimeJob: vi.fn(async () => {
            return undefined;
        }),
        retryAnimeJob: vi.fn(async () => {
            return undefined;
        }),
        clearFinishedAnimeJobs: vi.fn(async () => {
            return undefined;
        }),
        removeAnimeEpisode: vi.fn(async () => {
            return undefined;
        }),
        removeAnime: vi.fn(async () => {
            return undefined;
        }),
        openAnimeFolder: vi.fn(async () => {
            return undefined;
        }),
        openAnimeSeriesFolder: vi.fn(async () => {
            return undefined;
        }),
        addAnimeToLibrary: vi.fn(async (): Promise<AnimeAddResponse> => {
            return { ok: false, reason: 'invalid' };
        }),
        downloadMissingAnime: vi.fn(async () => {
            return undefined;
        }),
        renameAnimeSeries: vi.fn(async (): Promise<AnimeRenameSeriesResponse> => {
            return { ok: true };
        }),
        setAnimeSeries: vi.fn(async (): Promise<AnimeSeriesResponse> => {
            return { ok: true };
        }),
        importAnimeLibrary: vi.fn(async (): Promise<AnimeImportResponse> => {
            return { ok: false, reason: 'cancelled' };
        }),
        migrateAnimeFolder: vi.fn(async (): Promise<AnimeMigrationResponse> => {
            return { ok: false, reason: 'cancelled' };
        }),
        saveAnimeProgress: vi.fn(async () => {
            return undefined;
        }),
        listAnimeSubtitles: vi.fn(async (): Promise<AnimeSubtitleTrack[]> => {
            return [];
        }),
        checkAnimeSubtitles: vi.fn(async (): Promise<AnimeSubtitleCheckResponse> => {
            return { ok: true, added: [], tracks: [] };
        }),
        importAnimeSubtitle: vi.fn(async (): Promise<AnimeSubtitleImportResponse> => {
            return { ok: false, reason: 'cancelled' };
        }),
        translateAnimeSubtitle: vi.fn(async (): Promise<SubtitleTranslateResponse> => {
            return { ok: false, reason: 'missing' };
        }),
        estimateAnimeSubtitleTranslation: vi.fn(async (): Promise<SubtitleEstimateResponse> => {
            return { ok: false, reason: 'missing' };
        }),
        translateAnimeSubtitles: vi.fn(async (): Promise<number> => {
            return 0;
        }),
        cancelAnimeSubtitleTranslation: vi.fn(async () => {
            return undefined;
        }),
        generateAnimeSubtitle: vi.fn(async (): Promise<SubtitleGenerateResponse> => {
            return { ok: false, reason: 'missing' };
        }),
        estimateAnimeSubtitleGeneration: vi.fn(async (): Promise<SubtitleGenerateEstimateResponse> => {
            return { ok: false, reason: 'missing' };
        }),
        cancelAnimeSubtitleGeneration: vi.fn(async () => {
            return undefined;
        }),
        getLlmStatus: vi.fn(async (): Promise<LlmStatus> => {
            return { canStore: true, providers: [] };
        }),
        setLlmToken: vi.fn(async (): Promise<boolean> => {
            return true;
        }),
        clearLlmToken: vi.fn(async () => {
            return undefined;
        }),
        updateAniCli: vi.fn(async () => {
            return { ok: true, output: 'Updated ani-cli' };
        }),
        resetAniCli: vi.fn(async () => {
            return { ok: true, output: 'Using the bundled ani-cli' };
        }),
        openAnimeStream: vi.fn(async (): Promise<{ ok: true; stream: { sessionId: string; url: string; subtitleUrl: string | null } }> => {
            return { ok: true, stream: { sessionId: 's1', url: 'pullwave-stream://p/s1/abc', subtitleUrl: null } };
        }),
        closeAnimeStream: vi.fn(async () => {
            return undefined;
        }),
        findAnimeCover: vi.fn(async (): Promise<string | null> => {
            return null;
        }),
        listAnimeSchedule: vi.fn(async (): Promise<AnimeScheduleResponse> => {
            return { ok: true, entries: [] };
        }),
        checkAnimeAvailability: vi.fn(async (): Promise<AnimeAvailability[]> => {
            return [];
        }),
        onAnimeAvailability: vi.fn((listener: (availability: AnimeAvailability) => void) => {
            return subscribe(animeAvailabilityListeners, listener);
        }),
        onAnimeJobUpdate: vi.fn((listener: (job: AnimeJob) => void) => {
            return subscribe(animeJobListeners, listener);
        }),
        onAnimeLibraryChanged: vi.fn((listener: () => void) => {
            return subscribe(animeLibraryListeners, listener);
        }),
        onAnimeMigrationProgress: vi.fn((listener: (progress: AnimeMigrationProgress) => void) => {
            return subscribe(animeMigrationListeners, listener);
        }),
        onSubtitleTranslationUpdate: vi.fn((listener: (job: SubtitleTranslationJob) => void) => {
            return subscribe(subtitleTranslationListeners, listener);
        }),
        onSubtitleGenerationUpdate: vi.fn((listener: (job: SubtitleGenerationJob) => void) => {
            return subscribe(subtitleGenerationListeners, listener);
        }),
        onAnimeCoverUpdate: vi.fn((listener: (update: AnimeCoverUpdate) => void) => {
            return subscribe(animeCoverListeners, listener);
        }),
        onJobUpdate: vi.fn((listener: (job: DownloadJob) => void) => {
            return subscribe(jobListeners, listener);
        }),
        onJobRemoved: vi.fn((listener: (id: string) => void) => {
            return subscribe(removedListeners, listener);
        }),
        onAppUpdateState: vi.fn((listener: (state: AppUpdateState) => void) => {
            return subscribe(appUpdateListeners, listener);
        }),
        onStreamFindProgress: vi.fn((listener: (progress: StreamFindProgress) => void) => {
            return subscribe(streamProgressListeners, listener);
        }),
        onHistoryChanged: vi.fn((listener: () => void) => {
            return subscribe(historyListeners, listener);
        })
    };

    return {
        api,
        unsubscribers,
        emitMangaTool: (state) => {
            mangaToolListeners.forEach((listener) => {
                listener(state);
            });
        },
        emitMangaServer: (status) => {
            mangaServerListeners.forEach((listener) => {
                listener(status);
            });
        },
        emitMangaCloudflare: (active) => {
            mangaCloudflareListeners.forEach((listener) => {
                listener(active);
            });
        },
        emitMangaJob: (job) => {
            mangaJobListeners.forEach((listener) => {
                listener(job);
            });
        },
        emitMangaLibraryChanged: () => {
            mangaLibraryListeners.forEach((listener) => {
                listener();
            });
        },
        emitJobUpdate: (job) => {
            jobListeners.forEach((listener) => {
                listener(job);
            });
        },
        emitJobRemoved: (id) => {
            removedListeners.forEach((listener) => {
                listener(id);
            });
        },
        emitStreamProgress: (progress) => {
            streamProgressListeners.forEach((listener) => {
                listener(progress);
            });
        },
        emitAnimeJob: (job) => {
            animeJobListeners.forEach((listener) => {
                listener(job);
            });
        },
        emitAnimeMigrationProgress: (progress) => {
            animeMigrationListeners.forEach((listener) => {
                listener(progress);
            });
        },
        emitSubtitleGeneration: (job) => {
            subtitleGenerationListeners.forEach((listener) => {
                listener(job);
            });
        },
        emitSubtitleTranslation: (job) => {
            subtitleTranslationListeners.forEach((listener) => {
                listener(job);
            });
        },
        emitAnimeAvailability: (availability) => {
            animeAvailabilityListeners.forEach((listener) => {
                listener(availability);
            });
        },
        emitAnimeCover: (update) => {
            animeCoverListeners.forEach((listener) => {
                listener(update);
            });
        },
        emitAnimeLibraryChanged: () => {
            animeLibraryListeners.forEach((listener) => {
                listener();
            });
        },
        emitAppUpdateState: (state) => {
            appUpdateListeners.forEach((listener) => {
                listener(state);
            });
        },
        emitHistoryChanged: () => {
            historyListeners.forEach((listener) => {
                listener();
            });
        }
    };
}

export function installMockApi(): MockApiHandle {
    const handle = createMockApi();
    Object.defineProperty(window, 'api', { value: handle.api, configurable: true, writable: true });
    return handle;
}

export function makeJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
    return {
        id: 'job-1',
        url: 'https://example.com/v',
        status: 'running',
        title: 'Some Video',
        percent: 42.5,
        speed: '1.5MiB/s',
        eta: '00:10',
        filePath: null,
        error: null,
        createdAt: 1,
        pageUrl: null,
        live: false,
        elapsedSeconds: 0,
        downloadedBytes: 0,
        hasPartial: false,
        customized: false,
        waitingForLive: false,
        endCheck: null,
        merging: false,
        saving: false,
        postProcess: null,
        ...overrides
    };
}
