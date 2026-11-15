import type { ErrorDetails } from './errorDetails';
import type {
    AnimeAiringOverride,
    AnimeCheckResponse,
    AnimeCheckState,
    AnimeCoverUpdate,
    AnimeDownloadRequest,
    AnimeDownloadResponse,
    AnimeEpisodesResponse,
    AnimeHistoryEntry,
    AnimeHistoryRequest,
    AnimeAudioCheckResponse,
    AnimeRepairResponse,
    AnimeImportResponse,
    AnimeJob,
    AnimeMigrationProgress,
    AnimeNewEpisodes,
    AutoTranslateOffReason,
    SubtitleJobs,
    SubtitleTranslatableResponse,
    AnimeMigrationResponse,
    AnimeProgressUpdate,
    AnimeScheduleRequest,
    AnimeScheduleResponse,
    AnimeSeriesResponse,
    AnimeAddRequest,
    AnimeAddResponse,
    AnimeRenameSeriesResponse,
    AnimeSearchResponse,
    AnimeStatus,
    AnimeSubtitleCheckResponse,
    AnimeSubtitleImportResponse,
    SubtitleEstimateRequest,
    SubtitleGenerateEstimateResponse,
    SubtitleGenerateRequest,
    SubtitleGenerateResponse,
    SubtitleGenerationJob,
    SubtitleEstimateResponse,
    SubtitleTranslateManyRequest,
    SubtitleTranslateRequest,
    SubtitleTranslateResponse,
    SubtitleTranslationJob,
    AnimeSubtitleTrack,
    AnimeStreamRequest,
    AnimeStreamResponse,
    AnimeUpdateEntry,
    AnimeQuality,
    AnimeSubtitleSetting,
    LibraryAnime
} from './anime';
import type { CutApi } from './cut';
import type { LogsApi } from './logs';
import type { MangaApi, MangaOutputFormat } from './manga';
import type { ProgramResetResult, ProgramsStatus, ProgramUpdateResult, ProgramVersions } from './programs';
import type { ProgramId, ToolState } from './tools';
import type { LlmProviderId, LlmStatus, LlmTokenSlot, SpeechProviderId } from './llm';

export type VideoContainer = 'mp4' | 'mkv' | 'webm';
export type AudioFormat = 'mp3' | 'm4a' | 'opus';
export interface DownloadOptions {
    maxResolution?: MaxResolution;
    videoContainer?: VideoContainer;
    audioOnly?: boolean;
    audioFormat?: AudioFormat;
    liveFromStart?: boolean;
    waitForLive?: boolean;
    verifyLiveEnd?: boolean;
    verifyLiveEndSeconds?: number;
}

export interface LinkRequest {
    url: string;
    downloadDir: string | null;
    options: DownloadOptions;
}

export type ThemeName =
    | 'device'
    | 'cyberpunk'
    | 'synthwave'
    | 'terminal'
    | 'neon-tokyo'
    | 'acid-rain'
    | 'amber-city'
    | 'ultraviolet'
    | 'pink-noir'
    | 'cyber-gold'
    | 'ice-neon'
    | 'neon-tokyo-light'
    | 'dark'
    | 'tokyo-night'
    | 'nord'
    | 'dracula'
    | 'gruvbox'
    | 'amoled'
    | 'high-contrast'
    | 'light'
    | 'sakura'
    | 'sakura-dark';
export type ThemeStyle = 'neon' | 'flat';
export type LanguageCode = 'en' | 'pt' | 'es' | 'zh' | 'ja';
export type LanguageSetting = 'device' | LanguageCode;
export type BrowserName = 'chrome' | 'firefox' | 'brave' | 'chromium' | 'edge' | 'opera' | 'vivaldi';
export interface BrowserProfile {
    id: string;
    name: string;
}

export interface DetectedBrowser {
    label: string;
    engine: BrowserName;
    dataDir: string;
    profiles: BrowserProfile[];
}
export type SiteBrowser = 'default' | BrowserName;
export type MaxResolution = 'best' | '2160' | '1440' | '1080' | '720' | '480';

export type HomeSection = 'downloads' | 'anime' | 'manga';

export interface Settings {
    downloadDir: string;
    useBrowserCookies: boolean;
    cookiesBrowser: BrowserName;
    cookiesBrowserDir: string;
    cookiesProfile: string;
    maxResolution: MaxResolution;
    videoContainer: VideoContainer;
    audioOnly: boolean;
    audioFormat: AudioFormat;
    maxTitleLength: number;
    restrictFilenames: boolean;
    deletePartialsOnFailure: boolean;
    downloadPlaylist: boolean;
    writeSubtitles: boolean;
    subtitleLangs: string;
    autoSubtitles: boolean;
    embedSubtitles: boolean;
    rateLimit: string;
    maxConcurrent: number;
    ytdlpPath: string;
    ffmpegPath: string;
    jsRuntime: string;
    checkUpdatesOnStart: boolean;
    closeToTray: boolean;
    launchAtLogin: boolean;
    startMinimized: boolean;
    liveFromStart: boolean;
    waitForLive: boolean;
    verifyLiveEnd: boolean;
    verifyLiveEndSeconds: number;
    theme: ThemeName;
    language: LanguageSetting;
    extraArgs: string;
    animeDownloadDir: string;
    animeQuality: AnimeQuality;
    animeSubtitles: AnimeSubtitleSetting;
    animeCheckNewEpisodes: boolean;
    animeAutoDownloadNew: boolean;
    animeAutoTranslateNew: boolean;
    mangaDirectory: string;
    mangaFormat: MangaOutputFormat;
    mangaFlaresolverrUrl: string;
    mangaFlaresolverrEnabled: boolean;
    mangaShowAdult: boolean;
    mangaLanguage: string;
    mangaCheckNewChapters: boolean;
    mangaAutoDownloadNew: boolean;
    mangaSiteBrowser: SiteBrowser;
    translateProvider: LlmProviderId;
    translateModel: string;
    translateBaseUrl: string;
    transcribeProvider: SpeechProviderId;
    transcribeModel: string;
    transcribeBaseUrl: string;
}

export type ErrorCode =
    | 'NETWORK'
    | 'UNAVAILABLE'
    | 'FORMAT_UNAVAILABLE'
    | 'LOGIN_REQUIRED'
    | 'FFMPEG_MISSING'
    | 'FILENAME_TOO_LONG'
    | 'FORBIDDEN'
    | 'OUTDATED'
    | 'BINARY_MISSING'
    | 'UNKNOWN';

export interface DownloadError {
    code: ErrorCode;
    title: string;
    hint: string;
    raw: string;
    details?: ErrorDetails;
}

export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled';

export interface LiveEndCheck {
    secondsLeft: number;
    totalSeconds: number;
}

export interface DownloadJob {
    id: string;
    url: string;
    status: JobStatus;
    title: string | null;
    percent: number;
    speed: string;
    eta: string;
    filePath: string | null;
    error: DownloadError | null;
    createdAt: number;
    pageUrl: string | null;
    live: boolean;
    elapsedSeconds: number;
    downloadedBytes: number;
    hasPartial: boolean;
    customized: boolean;
    waitingForLive: boolean;
    endCheck: LiveEndCheck | null;
    merging: boolean;
    saving: boolean;
    postProcess: string | null;
    postProcessSteps: string[];
    thumbnail: string | null;
    parts: DownloadPart[] | null;
}

export type DownloadPartKind = 'video' | 'audio' | 'other';

export interface DownloadPart {
    kind: DownloadPartKind;
    percent: number;
}

export interface ProgressInfo {
    percent: number;
    speed: string;
    eta: string;
    title: string;
    downloadedBytes: number | null;
    elapsedSeconds: number | null;
    live: boolean;
    formatId: string;
}

export interface FormatPart {
    formatId: string;
    kind: DownloadPartKind;
}

export interface PostProcessEvent {
    status: 'started' | 'finished';
    processor: string;
}

export interface DownloadInfo {
    live: boolean;
    filePath: string;
}

export interface StreamSource {
    url: string;
    protocol: string;
    headers: Record<string, string>;
}

export interface LiveStreamInfo {
    live: boolean;
    sources: StreamSource[];
}

export interface HistoryEntry {
    id: string;
    url: string;
    title: string;
    filePath: string | null;
    status: 'done' | 'error';
    errorTitle: string | null;
    finishedAt: number;
}

export type BinarySource = 'custom' | 'installed';

export interface BinaryInfo {
    found: boolean;
    path: string;
    version: string | null;
    source: BinarySource;
}

export interface BinariesStatus {
    ytdlp: BinaryInfo;
    ffmpeg: BinaryInfo;
}

export interface UpdateResult {
    ok: boolean;
    output: string;
}

export interface AddJobResult {
    ok: boolean;
    job: DownloadJob | null;
    message: string | null;
}

export type AppUpdateStatus =
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'unsupported';

export interface AppUpdateState {
    status: AppUpdateStatus;
    currentVersion: string;
    version: string | null;
    percent: number;
    message: string | null;
}

export type DiskSection = 'anime' | 'manga';

export type DiskSiblingPlacement = 'same-disk' | 'other-disk' | 'overlap';

export interface DiskSibling {
    section: DiskSection;
    directory: string;
    bytes: number;
    placement: DiskSiblingPlacement;
}

export interface DiskUsage {
    directory: string;
    totalBytes: number;
    freeBytes: number;
    folderBytes: number;
    sibling: DiskSibling;
}

export interface TraySupport {
    available: boolean;
    reason: string | null;
}

export interface ProgramsApi {
    status: () => Promise<ProgramsStatus>;
    install: (id: ProgramId) => Promise<ToolState>;
    reinstall: (id: ProgramId) => Promise<ToolState>;
    check: () => Promise<ProgramVersions>;
    update: (id: ProgramId) => Promise<ProgramUpdateResult>;
    reset: (id: ProgramId) => Promise<ProgramResetResult>;
    onToolState: (listener: (state: ToolState) => void) => () => void;
    onUpdateState: (listener: (state: ToolState) => void) => () => void;
}

export interface CyberApi {
    manga: MangaApi;
    getSettings: () => Promise<Settings>;
    saveSettings: (settings: Settings) => Promise<Settings>;
    addDownload: (url: string, downloadDir?: string, options?: DownloadOptions) => Promise<AddJobResult>;
    listJobs: () => Promise<DownloadJob[]>;
    cancelJob: (id: string) => Promise<void>;
    pauseJob: (id: string) => Promise<void>;
    resumeJob: (id: string) => Promise<void>;
    stopJob: (id: string) => Promise<void>;
    retryJob: (id: string) => Promise<void>;
    clearPartialFiles: (id: string) => Promise<void>;
    removeJob: (id: string) => Promise<void>;
    clearFinished: () => Promise<void>;
    listHistory: () => Promise<HistoryEntry[]>;
    clearHistory: () => Promise<void>;
    checkBinaries: () => Promise<BinariesStatus>;
    programs: ProgramsApi;
    cut: CutApi;
    logs: LogsApi;
    getAppUpdateState: () => Promise<AppUpdateState>;
    checkAppUpdate: () => Promise<void>;
    downloadAppUpdate: () => Promise<void>;
    installAppUpdate: () => Promise<void>;
    getTraySupport: () => Promise<TraySupport>;
    listBrowsers: (refresh?: boolean) => Promise<DetectedBrowser[]>;
    chooseDirectory: () => Promise<string | null>;
    showItemInFolder: (path: string) => Promise<void>;
    getDiskUsage: (section: DiskSection) => Promise<DiskUsage | null>;
    getAnimeStatus: () => Promise<AnimeStatus>;
    searchAnime: (query: string, loaded?: number) => Promise<AnimeSearchResponse>;
    listAnimeEpisodes: (query: string, index: number) => Promise<AnimeEpisodesResponse>;
    downloadAnime: (request: AnimeDownloadRequest) => Promise<AnimeDownloadResponse>;
    listAnimeLibrary: () => Promise<LibraryAnime[]>;
    getAnimeLibraryEntry: (animeId: number) => Promise<LibraryAnime | null>;
    listAnimeHistory: () => Promise<AnimeHistoryEntry[]>;
    recordAnimeHistory: (request: AnimeHistoryRequest) => Promise<void>;
    removeAnimeHistory: (id: number) => Promise<void>;
    clearAnimeHistory: () => Promise<void>;
    listAnimeJobs: () => Promise<AnimeJob[]>;
    cancelAnimeJob: (episodeId: number) => Promise<void>;
    retryAnimeJob: (episodeId: number) => Promise<void>;
    redownloadAnimeEpisode: (episodeId: number) => Promise<void>;
    redownloadAnimeEpisodes: (episodeIds: number[]) => Promise<void>;
    pauseAnimeJob: (episodeId: number) => Promise<void>;
    resumeAnimeJob: (episodeId: number) => Promise<void>;
    clearFinishedAnimeJobs: () => Promise<void>;
    pauseAllAnimeJobs: () => Promise<void>;
    resumeAllAnimeJobs: () => Promise<void>;
    animeQueueHeld: () => Promise<boolean>;
    pauseAnimes: (animeIds: number[]) => Promise<void>;
    resumeAnimes: (animeIds: number[]) => Promise<void>;
    cancelAnimes: (animeIds: number[]) => Promise<void>;
    removeAnimeEpisode: (episodeId: number) => Promise<void>;
    removeAnime: (animeId: number) => Promise<void>;
    openAnimeFolder: (animeId: number) => Promise<void>;
    openAnimeSeriesFolder: (animeId: number) => Promise<void>;
    addAnimeToLibrary: (request: AnimeAddRequest) => Promise<AnimeAddResponse>;
    downloadMissingAnime: (animeIds: number[]) => Promise<void>;
    renameAnimeSeries: (animeIds: number[], name: string) => Promise<AnimeRenameSeriesResponse>;
    setAnimeSeries: (animeId: number, series: string | null, season: number | null, seasonName: string | null) => Promise<AnimeSeriesResponse>;
    importAnimeLibrary: () => Promise<AnimeImportResponse>;
    checkAnimeAudio: () => Promise<AnimeAudioCheckResponse>;
    repairAnimeEpisodes: (episodeIds: number[]) => Promise<AnimeRepairResponse>;
    migrateAnimeFolder: () => Promise<AnimeMigrationResponse>;
    saveAnimeProgress: (update: AnimeProgressUpdate) => Promise<void>;
    listAnimeSubtitles: (episodeId: number) => Promise<AnimeSubtitleTrack[]>;
    importAnimeSubtitle: (episodeId: number) => Promise<AnimeSubtitleImportResponse>;
    checkAnimeSubtitles: (episodeId: number) => Promise<AnimeSubtitleCheckResponse>;
    translateAnimeSubtitle: (request: SubtitleTranslateRequest) => Promise<SubtitleTranslateResponse>;
    estimateAnimeSubtitleTranslation: (request: SubtitleEstimateRequest) => Promise<SubtitleEstimateResponse>;
    translateAnimeSubtitles: (request: SubtitleTranslateManyRequest) => Promise<number>;
    listTranslatableEpisodes: (episodeIds: number[]) => Promise<SubtitleTranslatableResponse>;
    cancelAnimeSubtitleTranslation: (episodeId: number | null) => Promise<void>;
    generateAnimeSubtitle: (request: SubtitleGenerateRequest) => Promise<SubtitleGenerateResponse>;
    estimateAnimeSubtitleGeneration: (episodeId: number) => Promise<SubtitleGenerateEstimateResponse>;
    cancelAnimeSubtitleGeneration: (episodeId: number) => Promise<void>;
    listSubtitleJobs: () => Promise<SubtitleJobs>;
    getLlmStatus: () => Promise<LlmStatus>;
    setLlmToken: (slot: LlmTokenSlot, token: string) => Promise<boolean>;
    clearLlmToken: (slot: LlmTokenSlot) => Promise<void>;
    onSubtitleTranslationUpdate: (listener: (job: SubtitleTranslationJob) => void) => () => void;
    onSubtitleGenerationUpdate: (listener: (job: SubtitleGenerationJob) => void) => () => void;
    openAnimeStream: (request: AnimeStreamRequest) => Promise<AnimeStreamResponse>;
    closeAnimeStream: (sessionId: string) => Promise<void>;
    listAnimeSchedule: (request: AnimeScheduleRequest) => Promise<AnimeScheduleResponse>;
    findAnimeCover: (title: string) => Promise<string | null>;
    listAnimeUpdates: () => Promise<AnimeUpdateEntry[]>;
    clearAnimeUpdates: () => Promise<void>;
    checkNewAnimeEpisodes: (animeId: number | null) => Promise<AnimeCheckResponse>;
    setAnimeAiring: (animeId: number, override: AnimeAiringOverride | null) => Promise<void>;
    getAnimeCheckState: () => Promise<AnimeCheckState>;
    onAnimeJobUpdate: (listener: (job: AnimeJob) => void) => () => void;
    onAnimeQueueHeld: (listener: (held: boolean) => void) => () => void;
    onAnimeLibraryChanged: (listener: () => void) => () => void;
    onAnimeLibraryEntryChanged: (listener: (animeId: number) => void) => () => void;
    onAnimeMigrationProgress: (listener: (progress: AnimeMigrationProgress) => void) => () => void;
    onAnimeCoverUpdate: (listener: (update: AnimeCoverUpdate) => void) => () => void;
    onAnimeNewEpisodes: (listener: (news: AnimeNewEpisodes) => void) => () => void;
    onAnimeAutoTranslateOff: (listener: (reason: AutoTranslateOffReason) => void) => () => void;
    onAnimeCheckState: (listener: (state: AnimeCheckState) => void) => () => void;
    onJobUpdate: (listener: (job: DownloadJob) => void) => () => void;
    onJobRemoved: (listener: (id: string) => void) => () => void;
    onHistoryChanged: (listener: () => void) => () => void;
    onAppUpdateState: (listener: (state: AppUpdateState) => void) => () => void;
    onWindowMinimized: (listener: (minimized: boolean) => void) => () => void;
}
