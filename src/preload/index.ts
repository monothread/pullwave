import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '@shared/constants';
import type { AnimeAvailability, AnimeCoverUpdate, AnimeJob, AnimeMigrationProgress, SubtitleGenerationJob, SubtitleTranslationJob } from '@shared/anime';
import type { AppUpdateState, CyberApi, DownloadJob, StreamFindProgress } from '@shared/types';

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
    const wrapped = (_event: IpcRendererEvent, payload: T): void => {
        listener(payload);
    };
    ipcRenderer.on(channel, wrapped);
    return (): void => {
        ipcRenderer.removeListener(channel, wrapped);
    };
}

const api: CyberApi = {
    getSettings: () => {
        return ipcRenderer.invoke(IPC.settingsGet);
    },
    saveSettings: (settings) => {
        return ipcRenderer.invoke(IPC.settingsSave, settings);
    },
    addDownload: (url, downloadDir, options) => {
        return ipcRenderer.invoke(IPC.queueAdd, url, downloadDir, options);
    },
    listJobs: () => {
        return ipcRenderer.invoke(IPC.queueList);
    },
    cancelJob: (id) => {
        return ipcRenderer.invoke(IPC.queueCancel, id);
    },
    pauseJob: (id) => {
        return ipcRenderer.invoke(IPC.queuePause, id);
    },
    resumeJob: (id) => {
        return ipcRenderer.invoke(IPC.queueResume, id);
    },
    stopJob: (id) => {
        return ipcRenderer.invoke(IPC.queueStop, id);
    },
    retryJob: (id) => {
        return ipcRenderer.invoke(IPC.queueRetry, id);
    },
    clearPartialFiles: (id) => {
        return ipcRenderer.invoke(IPC.queueClearPartials, id);
    },
    removeJob: (id) => {
        return ipcRenderer.invoke(IPC.queueRemove, id);
    },
    clearFinished: () => {
        return ipcRenderer.invoke(IPC.queueClearFinished);
    },
    listHistory: () => {
        return ipcRenderer.invoke(IPC.historyList);
    },
    clearHistory: () => {
        return ipcRenderer.invoke(IPC.historyClear);
    },
    checkBinaries: () => {
        return ipcRenderer.invoke(IPC.binariesCheck);
    },
    updateYtdlp: () => {
        return ipcRenderer.invoke(IPC.ytdlpUpdate);
    },
    resetYtdlp: () => {
        return ipcRenderer.invoke(IPC.ytdlpReset);
    },
    getAppUpdateState: () => {
        return ipcRenderer.invoke(IPC.appUpdateGet);
    },
    checkAppUpdate: () => {
        return ipcRenderer.invoke(IPC.appUpdateCheck);
    },
    downloadAppUpdate: () => {
        return ipcRenderer.invoke(IPC.appUpdateDownload);
    },
    installAppUpdate: () => {
        return ipcRenderer.invoke(IPC.appUpdateInstall);
    },
    getTraySupport: () => {
        return ipcRenderer.invoke(IPC.traySupport);
    },
    listBrowsers: (refresh) => {
        return ipcRenderer.invoke(IPC.browsersList, refresh);
    },
    findStreams: (jobId, deep) => {
        return ipcRenderer.invoke(IPC.streamFind, jobId, deep);
    },
    cancelStreamFind: (jobId) => {
        return ipcRenderer.invoke(IPC.streamCancel, jobId);
    },
    downloadStream: (candidateId) => {
        return ipcRenderer.invoke(IPC.streamDownload, candidateId);
    },
    chooseDirectory: () => {
        return ipcRenderer.invoke(IPC.dialogChooseDir);
    },
    showItemInFolder: (path) => {
        return ipcRenderer.invoke(IPC.shellShowItem, path);
    },
    getAnimeStatus: () => {
        return ipcRenderer.invoke(IPC.animeStatus);
    },
    searchAnime: (query, audio) => {
        return ipcRenderer.invoke(IPC.animeSearch, query, audio);
    },
    listAnimeEpisodes: (query, index, audio) => {
        return ipcRenderer.invoke(IPC.animeEpisodes, query, index, audio);
    },
    downloadAnime: (request) => {
        return ipcRenderer.invoke(IPC.animeDownload, request);
    },
    listAnimeLibrary: () => {
        return ipcRenderer.invoke(IPC.animeLibrary);
    },
    listAnimeHistory: () => {
        return ipcRenderer.invoke(IPC.animeHistoryList);
    },
    recordAnimeHistory: (request) => {
        return ipcRenderer.invoke(IPC.animeHistoryRecord, request);
    },
    removeAnimeHistory: (id) => {
        return ipcRenderer.invoke(IPC.animeHistoryRemove, id);
    },
    clearAnimeHistory: () => {
        return ipcRenderer.invoke(IPC.animeHistoryClear);
    },
    listAnimeJobs: () => {
        return ipcRenderer.invoke(IPC.animeJobs);
    },
    cancelAnimeJob: (episodeId) => {
        return ipcRenderer.invoke(IPC.animeCancel, episodeId);
    },
    pauseAnimeJob: (episodeId) => {
        return ipcRenderer.invoke(IPC.animePause, episodeId);
    },
    resumeAnimeJob: (episodeId) => {
        return ipcRenderer.invoke(IPC.animeResume, episodeId);
    },
    retryAnimeJob: (episodeId) => {
        return ipcRenderer.invoke(IPC.animeRetry, episodeId);
    },
    clearFinishedAnimeJobs: () => {
        return ipcRenderer.invoke(IPC.animeClearFinished);
    },
    removeAnimeEpisode: (episodeId) => {
        return ipcRenderer.invoke(IPC.animeRemoveEpisode, episodeId);
    },
    removeAnime: (animeId) => {
        return ipcRenderer.invoke(IPC.animeRemoveAnime, animeId);
    },
    openAnimeFolder: (animeId) => {
        return ipcRenderer.invoke(IPC.animeOpenFolder, animeId);
    },
    openAnimeSeriesFolder: (animeId) => {
        return ipcRenderer.invoke(IPC.animeOpenSeriesFolder, animeId);
    },
    addAnimeToLibrary: (request) => {
        return ipcRenderer.invoke(IPC.animeAddToLibrary, request);
    },
    downloadMissingAnime: (animeIds) => {
        return ipcRenderer.invoke(IPC.animeDownloadMissing, animeIds);
    },
    renameAnimeSeries: (animeIds, name) => {
        return ipcRenderer.invoke(IPC.animeRenameSeries, animeIds, name);
    },
    setAnimeSeries: (animeId, series, season, seasonName) => {
        return ipcRenderer.invoke(IPC.animeSetSeries, animeId, series, season, seasonName);
    },
    importAnimeLibrary: () => {
        return ipcRenderer.invoke(IPC.animeImportLibrary);
    },
    migrateAnimeFolder: () => {
        return ipcRenderer.invoke(IPC.animeMigrateFolder);
    },
    saveAnimeProgress: (update) => {
        return ipcRenderer.invoke(IPC.animeProgress, update);
    },
    listAnimeSubtitles: (episodeId) => {
        return ipcRenderer.invoke(IPC.animeSubtitles, episodeId);
    },
    checkAnimeSubtitles: (episodeId) => {
        return ipcRenderer.invoke(IPC.animeSubtitlesCheck, episodeId);
    },
    importAnimeSubtitle: (episodeId) => {
        return ipcRenderer.invoke(IPC.animeSubtitleImport, episodeId);
    },
    translateAnimeSubtitle: (request) => {
        return ipcRenderer.invoke(IPC.animeSubtitleTranslate, request);
    },
    estimateAnimeSubtitleTranslation: (request) => {
        return ipcRenderer.invoke(IPC.animeSubtitleTranslateEstimate, request);
    },
    translateAnimeSubtitles: (request) => {
        return ipcRenderer.invoke(IPC.animeSubtitleTranslateMany, request);
    },
    cancelAnimeSubtitleTranslation: (episodeId) => {
        return ipcRenderer.invoke(IPC.animeSubtitleTranslateCancel, episodeId);
    },
    generateAnimeSubtitle: (request) => {
        return ipcRenderer.invoke(IPC.animeSubtitleGenerate, request);
    },
    estimateAnimeSubtitleGeneration: (episodeId) => {
        return ipcRenderer.invoke(IPC.animeSubtitleGenerateEstimate, episodeId);
    },
    cancelAnimeSubtitleGeneration: (episodeId) => {
        return ipcRenderer.invoke(IPC.animeSubtitleGenerateCancel, episodeId);
    },
    getLlmStatus: () => {
        return ipcRenderer.invoke(IPC.llmStatus);
    },
    setLlmToken: (provider, token) => {
        return ipcRenderer.invoke(IPC.llmTokenSet, provider, token);
    },
    clearLlmToken: (provider) => {
        return ipcRenderer.invoke(IPC.llmTokenClear, provider);
    },
    updateAniCli: () => {
        return ipcRenderer.invoke(IPC.animeUpdateCli);
    },
    resetAniCli: () => {
        return ipcRenderer.invoke(IPC.animeResetCli);
    },
    openAnimeStream: (request) => {
        return ipcRenderer.invoke(IPC.animeStreamOpen, request);
    },
    closeAnimeStream: (sessionId) => {
        return ipcRenderer.invoke(IPC.animeStreamClose, sessionId);
    },
    listAnimeSchedule: (request) => {
        return ipcRenderer.invoke(IPC.animeSchedule, request);
    },
    findAnimeCover: (title) => {
        return ipcRenderer.invoke(IPC.animeCover, title);
    },
    checkAnimeAvailability: (targets) => {
        return ipcRenderer.invoke(IPC.animeAvailability, targets);
    },
    onSubtitleGenerationUpdate: (listener) => {
        return subscribe<SubtitleGenerationJob>(IPC.eventSubtitleGeneration, listener);
    },
    onSubtitleTranslationUpdate: (listener) => {
        return subscribe<SubtitleTranslationJob>(IPC.eventSubtitleTranslation, listener);
    },
    onAnimeJobUpdate: (listener) => {
        return subscribe<AnimeJob>(IPC.eventAnimeJob, listener);
    },
    onAnimeLibraryChanged: (listener) => {
        return subscribe<undefined>(IPC.eventAnimeLibrary, () => {
            listener();
        });
    },
    onAnimeMigrationProgress: (listener) => {
        return subscribe<AnimeMigrationProgress>(IPC.eventAnimeMigration, listener);
    },
    onAnimeCoverUpdate: (listener) => {
        return subscribe<AnimeCoverUpdate>(IPC.eventAnimeCover, listener);
    },
    onAnimeAvailability: (listener) => {
        return subscribe<AnimeAvailability>(IPC.eventAnimeAvailability, listener);
    },
    onJobUpdate: (listener) => {
        return subscribe<DownloadJob>(IPC.eventJobUpdate, listener);
    },
    onJobRemoved: (listener) => {
        return subscribe<string>(IPC.eventJobRemoved, listener);
    },
    onAppUpdateState: (listener) => {
        return subscribe<AppUpdateState>(IPC.eventAppUpdateState, listener);
    },
    onStreamFindProgress: (listener) => {
        return subscribe<StreamFindProgress>(IPC.eventStreamProgress, listener);
    },
    onHistoryChanged: (listener) => {
        return subscribe<undefined>(IPC.eventHistoryChanged, () => {
            listener();
        });
    }
};

contextBridge.exposeInMainWorld('api', api);
