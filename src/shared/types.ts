import type {
    AnimeAvailability,
    AnimeAvailabilityTarget,
    AnimeCoverUpdate,
    AnimeDownloadRequest,
    AnimeDownloadResponse,
    AnimeEpisodesResponse,
    AnimeHistoryEntry,
    AnimeHistoryRequest,
    AnimeImportResponse,
    AnimeJob,
    AnimeMigrationProgress,
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
    TranslationLanguage,
    AnimeSubtitleTrack,
    AnimeStreamRequest,
    AnimeStreamResponse,
    AnimeAudio,
    AnimeQuality,
    AnimeSubtitleSetting,
    LibraryAnime
} from './anime';
import type { LlmProviderId, LlmStatus, LlmTokenSlot, SpeechProviderId } from './llm';

export type VideoContainer = 'mp4' | 'mkv' | 'webm';
export type AudioFormat = 'mp3' | 'm4a' | 'opus';
// Settings that can be chosen for one download only. A missing field follows the setting.
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

// A link to download, optionally into a folder other than the one in the settings and with options of its own.
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
    | 'dark'
    | 'tokyo-night'
    | 'nord'
    | 'dracula'
    | 'gruvbox'
    | 'amoled'
    | 'high-contrast'
    | 'light'
    | 'sakura';
// How a theme looks: 'neon' keeps the glow, the scanlines and the cut corners of the default theme; 'flat' has none of them.
export type ThemeStyle = 'neon' | 'flat';
export type LanguageCode = 'en' | 'pt' | 'es' | 'zh' | 'ja';
export type LanguageSetting = 'device' | LanguageCode;
export type BrowserName = 'chrome' | 'firefox' | 'brave' | 'chromium' | 'edge' | 'opera' | 'vivaldi';
// A browser profile that has cookies: `id` is its folder inside the browser's data folder.
export interface BrowserProfile {
    id: string;
    name: string;
}

// A browser found on this system: `engine` tells yt-dlp how to decrypt its cookies, `dataDir` is where its profiles live.
export interface DetectedBrowser {
    label: string;
    engine: BrowserName;
    dataDir: string;
    profiles: BrowserProfile[];
}
export type MaxResolution = 'best' | '2160' | '1440' | '1080' | '720' | '480';

// The tab the app opens on when it starts.
export type StartTab = 'downloads' | 'anime';

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
    // Always CONCURRENT_DOWNLOADS (2 downloads run at a time); it is not shown in the settings.
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
    startTab: StartTab;
    extraArgs: string;
    // Anime section (Linux and Windows).
    animeDownloadDir: string;
    animeQuality: AnimeQuality;
    animeAudio: AnimeAudio;
    animeSubtitles: AnimeSubtitleSetting;
    // Translating subtitles with a language model: which provider, which model, an address instead of the one of the provider (empty
    // for the one of the provider) and the language it translates into. The token is not here: it is kept apart, encrypted.
    translateProvider: LlmProviderId;
    translateModel: string;
    translateBaseUrl: string;
    translateLanguage: TranslationLanguage;
    // Making the subtitle of an episode that has none from its audio: the service of speech to text (OpenAI's protocol or Gemini), its model and an
    // address instead of the one of the service (empty for the one of the service). Its token is kept apart too. The language that is spoken is
    // not a setting: it is asked for each time, in the window that makes the subtitle.
    transcribeProvider: SpeechProviderId;
    transcribeModel: string;
    transcribeBaseUrl: string;
}

export type ErrorCode =
    | 'NETWORK'
    | 'UNAVAILABLE'
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
}

export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled';

// A live stream that seems to have ended is checked for a few seconds before the download is considered finished.
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
    // Unfinished files of this download are still in the folder (after an error or a cancel).
    hasPartial: boolean;
    // The download has options of its own that replace some settings.
    customized: boolean;
    // yt-dlp is waiting for a scheduled live stream to start.
    waitingForLive: boolean;
    // Set while the app checks whether a live stream really ended.
    endCheck: LiveEndCheck | null;
    // The parts of a live recording that was resumed are being joined into one file.
    merging: boolean;
    // STOP & SAVE was asked and the recording is being closed into its file.
    saving: boolean;
    // Name of the yt-dlp post-processor (ffmpeg step after the download, such as ExtractAudio or Merger) that is running.
    postProcess: string | null;
}

export interface ProgressInfo {
    percent: number;
    speed: string;
    eta: string;
    title: string;
    downloadedBytes: number | null;
    elapsedSeconds: number | null;
    live: boolean;
}

// yt-dlp reports when each post-processor (the steps that run after the bytes are downloaded) starts and finishes.
export interface PostProcessEvent {
    status: 'started' | 'finished';
    processor: string;
}

export interface DownloadInfo {
    live: boolean;
    filePath: string;
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

export type BinarySource = 'custom' | 'updated' | 'bundled' | 'system';

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

export interface TraySupport {
    available: boolean;
    reason: string | null;
}

export type StreamKind = 'hls' | 'dash' | 'mp4' | 'webm' | 'other';
export type StreamSource = 'page' | 'network';
export type StreamFindStage = 'scanning' | 'watching';

export interface StreamCandidate {
    id: string;
    url: string;
    kind: StreamKind;
    source: StreamSource;
    host: string;
    title: string | null;
    duplicates: number;
}

export interface StreamFindResult {
    ok: boolean;
    candidates: StreamCandidate[];
    message: string | null;
    usedBrowser: boolean;
}

export interface StreamFindProgress {
    jobId: string;
    stage: StreamFindStage;
}

export interface CyberApi {
    getSettings: () => Promise<Settings>;
    saveSettings: (settings: Settings) => Promise<Settings>;
    addDownload: (url: string, downloadDir?: string, options?: DownloadOptions) => Promise<AddJobResult>;
    listJobs: () => Promise<DownloadJob[]>;
    cancelJob: (id: string) => Promise<void>;
    // Stops a download keeping what was downloaded so far, and continues it from there later.
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
    updateYtdlp: () => Promise<UpdateResult>;
    // Goes back to the yt-dlp that ships with the app, removing the one an update saved.
    resetYtdlp: () => Promise<UpdateResult>;
    getAppUpdateState: () => Promise<AppUpdateState>;
    checkAppUpdate: () => Promise<void>;
    downloadAppUpdate: () => Promise<void>;
    installAppUpdate: () => Promise<void>;
    getTraySupport: () => Promise<TraySupport>;
    listBrowsers: (refresh?: boolean) => Promise<DetectedBrowser[]>;
    findStreams: (jobId: string, deep: boolean) => Promise<StreamFindResult>;
    cancelStreamFind: (jobId: string) => Promise<void>;
    downloadStream: (candidateId: string) => Promise<AddJobResult>;
    chooseDirectory: () => Promise<string | null>;
    showItemInFolder: (path: string) => Promise<void>;
    getAnimeStatus: () => Promise<AnimeStatus>;
    searchAnime: (query: string, audio: AnimeAudio) => Promise<AnimeSearchResponse>;
    listAnimeEpisodes: (query: string, index: number, audio: AnimeAudio) => Promise<AnimeEpisodesResponse>;
    downloadAnime: (request: AnimeDownloadRequest) => Promise<AnimeDownloadResponse>;
    listAnimeLibrary: () => Promise<LibraryAnime[]>;
    listAnimeHistory: () => Promise<AnimeHistoryEntry[]>;
    recordAnimeHistory: (request: AnimeHistoryRequest) => Promise<void>;
    removeAnimeHistory: (id: number) => Promise<void>;
    clearAnimeHistory: () => Promise<void>;
    listAnimeJobs: () => Promise<AnimeJob[]>;
    cancelAnimeJob: (episodeId: number) => Promise<void>;
    retryAnimeJob: (episodeId: number) => Promise<void>;
    pauseAnimeJob: (episodeId: number) => Promise<void>;
    resumeAnimeJob: (episodeId: number) => Promise<void>;
    clearFinishedAnimeJobs: () => Promise<void>;
    removeAnimeEpisode: (episodeId: number) => Promise<void>;
    removeAnime: (animeId: number) => Promise<void>;
    // Opens the folder the videos of an anime of the library are in.
    openAnimeFolder: (animeId: number) => Promise<void>;
    // Opens the folder of the series an anime of the library is in (the folder of the anime itself when it has none of its own).
    openAnimeSeriesFolder: (animeId: number) => Promise<void>;
    // Puts an anime in the library with all its episodes, none of them downloaded.
    addAnimeToLibrary: (request: AnimeAddRequest) => Promise<AnimeAddResponse>;
    // Queues every episode of these anime of the library that is not downloaded yet.
    downloadMissingAnime: (animeIds: number[]) => Promise<void>;
    // Gives all these anime (the ones of a series) another series name.
    renameAnimeSeries: (animeIds: number[], name: string) => Promise<AnimeRenameSeriesResponse>;
    // Joins an anime to a series with a season number, or takes it out of one (null, null).
    setAnimeSeries: (animeId: number, series: string | null, season: number | null, seasonName: string | null) => Promise<AnimeSeriesResponse>;
    // Asks for a folder of anime and puts what is in it into the library.
    importAnimeLibrary: () => Promise<AnimeImportResponse>;
    // Asks for the folder the anime are moved to, copies them there, checks the copies, points the library and the settings to
    // the new folder and then removes the old files.
    migrateAnimeFolder: () => Promise<AnimeMigrationResponse>;
    saveAnimeProgress: (update: AnimeProgressUpdate) => Promise<void>;
    listAnimeSubtitles: (episodeId: number) => Promise<AnimeSubtitleTrack[]>;
    importAnimeSubtitle: (episodeId: number) => Promise<AnimeSubtitleImportResponse>;
    checkAnimeSubtitles: (episodeId: number) => Promise<AnimeSubtitleCheckResponse>;
    // Translates a subtitle of an episode with the language model of the settings and saves it next to the video.
    translateAnimeSubtitle: (request: SubtitleTranslateRequest) => Promise<SubtitleTranslateResponse>;
    // What translating a subtitle takes, to ask the user before spending their token.
    estimateAnimeSubtitleTranslation: (request: SubtitleEstimateRequest) => Promise<SubtitleEstimateResponse>;
    // Queues the translation of the subtitle of each of these episodes; gives how many were queued (the progress comes in
    // `onSubtitleTranslationUpdate`).
    translateAnimeSubtitles: (request: SubtitleTranslateManyRequest) => Promise<number>;
    // Cancels the translation of an episode, or all of them (null).
    cancelAnimeSubtitleTranslation: (episodeId: number | null) => Promise<void>;
    // Makes the subtitle of an episode from its audio with the service of speech to text of the settings and saves it next to the video.
    generateAnimeSubtitle: (request: SubtitleGenerateRequest) => Promise<SubtitleGenerateResponse>;
    // How long the audio is and in how many requests it goes, to ask the user before spending their token.
    estimateAnimeSubtitleGeneration: (episodeId: number) => Promise<SubtitleGenerateEstimateResponse>;
    cancelAnimeSubtitleGeneration: (episodeId: number) => Promise<void>;
    getLlmStatus: () => Promise<LlmStatus>;
    // Keeps the token of a provider (or of a service of speech to text, see `LlmTokenSlot`), encrypted; false when it was not kept.
    setLlmToken: (slot: LlmTokenSlot, token: string) => Promise<boolean>;
    clearLlmToken: (slot: LlmTokenSlot) => Promise<void>;
    onSubtitleTranslationUpdate: (listener: (job: SubtitleTranslationJob) => void) => () => void;
    onSubtitleGenerationUpdate: (listener: (job: SubtitleGenerationJob) => void) => () => void;
    updateAniCli: () => Promise<UpdateResult>;
    // Goes back to the ani-cli that ships with the app, removing the one an update saved.
    resetAniCli: () => Promise<UpdateResult>;
    openAnimeStream: (request: AnimeStreamRequest) => Promise<AnimeStreamResponse>;
    closeAnimeStream: (sessionId: string) => Promise<void>;
    listAnimeSchedule: (request: AnimeScheduleRequest) => Promise<AnimeScheduleResponse>;
    // The address of the cover of an anime, found by its title; null when there is none.
    findAnimeCover: (title: string) => Promise<string | null>;
    // Asks for the availability in the source of the anime of the schedule: what was checked less than an hour ago is answered at once, the rest
    // is checked in the background and told one by one (`onAnimeAvailability`).
    checkAnimeAvailability: (targets: AnimeAvailabilityTarget[]) => Promise<AnimeAvailability[]>;
    onAnimeJobUpdate: (listener: (job: AnimeJob) => void) => () => void;
    onAnimeLibraryChanged: (listener: () => void) => () => void;
    onAnimeMigrationProgress: (listener: (progress: AnimeMigrationProgress) => void) => () => void;
    // A cover that was checked again and changed.
    onAnimeCoverUpdate: (listener: (update: AnimeCoverUpdate) => void) => () => void;
    onAnimeAvailability: (listener: (availability: AnimeAvailability) => void) => () => void;
    onJobUpdate: (listener: (job: DownloadJob) => void) => () => void;
    onJobRemoved: (listener: (id: string) => void) => () => void;
    onHistoryChanged: (listener: () => void) => () => void;
    onAppUpdateState: (listener: (state: AppUpdateState) => void) => () => void;
    onStreamFindProgress: (listener: (progress: StreamFindProgress) => void) => () => void;
}
