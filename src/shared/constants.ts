import type { AudioFormat, BrowserName, LanguageCode, LanguageSetting, MaxResolution, Settings, StartTab, ThemeName, ThemeStyle, VideoContainer } from './types';

export const IPC = {
    settingsGet: 'settings:get',
    settingsSave: 'settings:save',
    queueAdd: 'queue:add',
    queueList: 'queue:list',
    queueCancel: 'queue:cancel',
    queueStop: 'queue:stop',
    queueRetry: 'queue:retry',
    queuePause: 'queue:pause',
    queueResume: 'queue:resume',
    queueClearPartials: 'queue:clear-partials',
    queueRemove: 'queue:remove',
    queueClearFinished: 'queue:clear-finished',
    historyList: 'history:list',
    historyClear: 'history:clear',
    binariesCheck: 'binaries:check',
    ytdlpUpdate: 'ytdlp:update',
    ytdlpReset: 'ytdlp:reset',
    appUpdateGet: 'app-update:get',
    appUpdateCheck: 'app-update:check',
    appUpdateDownload: 'app-update:download',
    appUpdateInstall: 'app-update:install',
    traySupport: 'tray:support',
    browsersList: 'browsers:list',
    streamFind: 'stream:find',
    streamCancel: 'stream:cancel',
    streamDownload: 'stream:download',
    dialogChooseDir: 'dialog:choose-dir',
    shellShowItem: 'shell:show-item',
    animeStatus: 'anime:status',
    animeSearch: 'anime:search',
    animeEpisodes: 'anime:episodes',
    animeDownload: 'anime:download',
    animeAddToLibrary: 'anime:add-to-library',
    animeDownloadMissing: 'anime:download-missing',
    animeLibrary: 'anime:library',
    animeJobs: 'anime:jobs',
    animeCancel: 'anime:cancel',
    animeRetry: 'anime:retry',
    animePause: 'anime:pause',
    animeResume: 'anime:resume',
    animeClearFinished: 'anime:clear-finished',
    animeRemoveEpisode: 'anime:remove-episode',
    animeRemoveAnime: 'anime:remove-anime',
    animeOpenFolder: 'anime:open-folder',
    animeOpenSeriesFolder: 'anime:open-series-folder',
    animeRenameSeries: 'anime:rename-series',
    animeSetSeries: 'anime:set-series',
    animeImportLibrary: 'anime:import-library',
    animeMigrateFolder: 'anime:migrate-folder',
    animeProgress: 'anime:progress',
    animeSubtitles: 'anime:subtitles',
    animeSubtitleImport: 'anime:subtitle-import',
    animeSubtitlesCheck: 'anime:subtitles-check',
    animeHistoryList: 'anime:history-list',
    animeHistoryRecord: 'anime:history-record',
    animeHistoryRemove: 'anime:history-remove',
    animeHistoryClear: 'anime:history-clear',
    animeUpdateCli: 'anime:update-cli',
    animeResetCli: 'anime:reset-cli',
    animeStreamOpen: 'anime:stream-open',
    animeStreamClose: 'anime:stream-close',
    animeSchedule: 'anime:schedule',
    animeCover: 'anime:cover',
    animeAvailability: 'anime:availability',
    eventAnimeJob: 'event:anime-job',
    eventAnimeLibrary: 'event:anime-library',
    eventAnimeMigration: 'event:anime-migration',
    eventAnimeCover: 'event:anime-cover',
    eventAnimeAvailability: 'event:anime-availability',
    eventJobUpdate: 'event:job-update',
    eventJobRemoved: 'event:job-removed',
    eventHistoryChanged: 'event:history-changed',
    eventAppUpdateState: 'event:app-update-state',
    eventStreamProgress: 'event:stream-progress'
} as const;

export const BROWSERS: readonly BrowserName[] = ['chrome', 'firefox', 'brave', 'chromium', 'edge', 'opera', 'vivaldi'];
export const RESOLUTIONS: readonly MaxResolution[] = ['best', '2160', '1440', '1080', '720', '480'];
export const VIDEO_CONTAINERS: readonly VideoContainer[] = ['mp4', 'mkv', 'webm'];
export const AUDIO_FORMATS: readonly AudioFormat[] = ['mp3', 'm4a', 'opus'];
export const THEMES: readonly ThemeName[] = [
    'device',
    'cyberpunk',
    'synthwave',
    'terminal',
    'dark',
    'tokyo-night',
    'nord',
    'dracula',
    'gruvbox',
    'amoled',
    'high-contrast',
    'light',
    'sakura'
];

// The style of every theme that can be applied ('device' is one of the two it follows).
export const THEME_STYLES: Readonly<Record<Exclude<ThemeName, 'device'>, ThemeStyle>> = {
    cyberpunk: 'neon',
    synthwave: 'neon',
    terminal: 'neon',
    dark: 'flat',
    'tokyo-night': 'flat',
    nord: 'flat',
    dracula: 'flat',
    gruvbox: 'flat',
    amoled: 'flat',
    'high-contrast': 'flat',
    light: 'flat',
    sakura: 'flat'
};
export const LANGUAGE_CODES: readonly LanguageCode[] = ['en', 'pt', 'es', 'zh', 'ja'];
export const START_TABS: readonly StartTab[] = ['downloads', 'anime'];
export const LANGUAGE_SETTINGS: readonly LanguageSetting[] = ['device', ...LANGUAGE_CODES];
export const FALLBACK_LANGUAGE: LanguageCode = 'en';

export const MIN_TITLE_LENGTH = 20;
export const MAX_TITLE_LENGTH = 200;
export const MIN_LIVE_END_CHECK_SECONDS = 1;
export const MAX_LIVE_END_CHECK_SECONDS = 120;
// Downloads run two at a time: this is not a setting.
export const CONCURRENT_DOWNLOADS = 2;

export const DEFAULT_SETTINGS: Settings = {
    downloadDir: '',
    useBrowserCookies: false,
    cookiesBrowser: 'firefox',
    cookiesBrowserDir: '',
    cookiesProfile: '',
    maxResolution: 'best',
    videoContainer: 'mp4',
    audioOnly: false,
    audioFormat: 'mp3',
    maxTitleLength: 80,
    restrictFilenames: false,
    deletePartialsOnFailure: true,
    downloadPlaylist: false,
    writeSubtitles: false,
    subtitleLangs: 'en,pt',
    autoSubtitles: false,
    embedSubtitles: false,
    rateLimit: '',
    maxConcurrent: CONCURRENT_DOWNLOADS,
    ytdlpPath: '',
    ffmpegPath: '',
    jsRuntime: '',
    checkUpdatesOnStart: true,
    closeToTray: false,
    liveFromStart: false,
    waitForLive: false,
    verifyLiveEnd: true,
    verifyLiveEndSeconds: 10,
    theme: 'device',
    language: 'device',
    startTab: 'downloads',
    extraArgs: '',
    animeDownloadDir: '',
    animeQuality: 'best',
    animeAudio: 'sub',
    animeSubtitles: 'auto'
};
