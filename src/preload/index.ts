import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '@shared/constants';
import type { AnimeAvailability, AnimeCoverUpdate, AnimeJob, AnimeMigrationProgress, SubtitleGenerationJob, SubtitleTranslationJob } from '@shared/anime';
import type { MangaCloudflareActivity, MangaJob, MangaMigrationProgress, MangaNewChapters, MangaServerStatus } from '@shared/manga';
import type { ToolState } from '@shared/tools';
import type { AppUpdateState, CyberApi, DownloadJob } from '@shared/types';

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
    const wrapped = (_event: IpcRendererEvent, payload: T): void => {
        listener(payload);
    };
    ipcRenderer.on(channel, wrapped);
    return (): void => {
        ipcRenderer.removeListener(channel, wrapped);
    };
}

const manga: CyberApi['manga'] = {
    status: () => {
        return ipcRenderer.invoke(IPC.mangaStatus);
    },
    install: () => {
        return ipcRenderer.invoke(IPC.mangaInstall);
    },
    installHelper: () => {
        return ipcRenderer.invoke(IPC.mangaHelperInstall);
    },
    removeHelper: () => {
        return ipcRenderer.invoke(IPC.mangaHelperRemove);
    },
    updateAllExtensions: () => {
        return ipcRenderer.invoke(IPC.mangaExtensionsUpdateAll);
    },
    stores: () => {
        return ipcRenderer.invoke(IPC.mangaStores);
    },
    addStore: (indexUrl) => {
        return ipcRenderer.invoke(IPC.mangaStoreAdd, indexUrl);
    },
    removeStore: (indexUrl) => {
        return ipcRenderer.invoke(IPC.mangaStoreRemove, indexUrl);
    },
    extensions: (refresh) => {
        return ipcRenderer.invoke(IPC.mangaExtensions, refresh);
    },
    changeExtension: (pkgName, action) => {
        return ipcRenderer.invoke(IPC.mangaExtensionChange, pkgName, action);
    },
    sources: () => {
        return ipcRenderer.invoke(IPC.mangaSources);
    },
    sourcePreferences: (sourceId) => {
        return ipcRenderer.invoke(IPC.mangaSourcePreferences, sourceId);
    },
    setSourcePreference: (change) => {
        return ipcRenderer.invoke(IPC.mangaSourcePreferenceSet, change);
    },
    readPages: (request) => {
        return ipcRenderer.invoke(IPC.mangaReadPages, request);
    },
    sourceFilters: (sourceId) => {
        return ipcRenderer.invoke(IPC.mangaSourceFilters, sourceId);
    },
    list: (request) => {
        return ipcRenderer.invoke(IPC.mangaList, request);
    },
    details: (remoteId) => {
        return ipcRenderer.invoke(IPC.mangaDetails, remoteId);
    },
    addToLibrary: (request) => {
        return ipcRenderer.invoke(IPC.mangaAddToLibrary, request);
    },
    download: (request) => {
        return ipcRenderer.invoke(IPC.mangaDownload, request);
    },
    downloadMissing: (mangaIds) => {
        return ipcRenderer.invoke(IPC.mangaDownloadMissing, mangaIds);
    },
    library: () => {
        return ipcRenderer.invoke(IPC.mangaLibrary);
    },
    jobs: () => {
        return ipcRenderer.invoke(IPC.mangaJobs);
    },
    cancel: (chapterId) => {
        return ipcRenderer.invoke(IPC.mangaCancel, chapterId);
    },
    retry: (chapterId) => {
        return ipcRenderer.invoke(IPC.mangaRetry, chapterId);
    },
    pause: (chapterId) => {
        return ipcRenderer.invoke(IPC.mangaPause, chapterId);
    },
    resume: (chapterId) => {
        return ipcRenderer.invoke(IPC.mangaResume, chapterId);
    },
    pauseAll: () => {
        return ipcRenderer.invoke(IPC.mangaPauseAll);
    },
    resumeAll: () => {
        return ipcRenderer.invoke(IPC.mangaResumeAll);
    },
    clearFinished: () => {
        return ipcRenderer.invoke(IPC.mangaClearFinished);
    },
    removeDownload: (chapterId) => {
        return ipcRenderer.invoke(IPC.mangaRemoveDownload, chapterId);
    },
    removeManga: (mangaId) => {
        return ipcRenderer.invoke(IPC.mangaRemoveManga, mangaId);
    },
    openFolder: (mangaId) => {
        return ipcRenderer.invoke(IPC.mangaOpenFolder, mangaId);
    },
    openSite: (url) => {
        return ipcRenderer.invoke(IPC.mangaOpenSite, url);
    },
    updates: () => {
        return ipcRenderer.invoke(IPC.mangaUpdates);
    },
    clearUpdates: () => {
        return ipcRenderer.invoke(IPC.mangaClearUpdates);
    },
    checkNewChapters: (mangaId) => {
        return ipcRenderer.invoke(IPC.mangaCheckNew, mangaId);
    },
    recordReading: (record) => {
        return ipcRenderer.invoke(IPC.mangaRecordReading, record);
    },
    readingHistory: () => {
        return ipcRenderer.invoke(IPC.mangaReadingHistory);
    },
    removeReading: (id) => {
        return ipcRenderer.invoke(IPC.mangaRemoveReading, id);
    },
    clearReading: () => {
        return ipcRenderer.invoke(IPC.mangaClearReading);
    },
    migrateFolder: () => {
        return ipcRenderer.invoke(IPC.mangaMigrateFolder);
    },
    setSeries: (request) => {
        return ipcRenderer.invoke(IPC.mangaSetSeries, request);
    },
    renameSeries: (mangaIds, series) => {
        return ipcRenderer.invoke(IPC.mangaRenameSeries, mangaIds, series);
    },
    groups: () => {
        return ipcRenderer.invoke(IPC.mangaGroups);
    },
    createGroup: (name) => {
        return ipcRenderer.invoke(IPC.mangaGroupCreate, name);
    },
    renameGroup: (groupId, name) => {
        return ipcRenderer.invoke(IPC.mangaGroupRename, groupId, name);
    },
    deleteGroup: (groupId) => {
        return ipcRenderer.invoke(IPC.mangaGroupDelete, groupId);
    },
    moveGroup: (groupId, direction) => {
        return ipcRenderer.invoke(IPC.mangaGroupMove, groupId, direction);
    },
    setGroupMembers: (groupId, mangaIds, member) => {
        return ipcRenderer.invoke(IPC.mangaGroupMembers, groupId, mangaIds, member);
    },
    migrateSource: (request) => {
        return ipcRenderer.invoke(IPC.mangaMigrateSource, request);
    },
    checkToolUpdates: () => {
        return ipcRenderer.invoke(IPC.mangaToolsCheck);
    },
    updateServer: () => {
        return ipcRenderer.invoke(IPC.mangaServerUpdate);
    },
    resetServerVersion: () => {
        return ipcRenderer.invoke(IPC.mangaServerReset);
    },
    updateHelper: () => {
        return ipcRenderer.invoke(IPC.mangaHelperUpdate);
    },
    restartApp: () => {
        return ipcRenderer.invoke(IPC.mangaRestart);
    },
    health: (start) => {
        return ipcRenderer.invoke(IPC.mangaHealth, start);
    },
    onServerUpdate: (listener) => {
        return subscribe<ToolState>(IPC.eventMangaServerUpdate, listener);
    },
    onMigrationProgress: (listener) => {
        return subscribe<MangaMigrationProgress>(IPC.eventMangaMigration, listener);
    },
    onNewChapters: (listener) => {
        return subscribe<MangaNewChapters>(IPC.eventMangaNewChapters, listener);
    },
    onToolState: (listener) => {
        return subscribe<ToolState>(IPC.eventMangaTool, listener);
    },
    onServerStatus: (listener) => {
        return subscribe<MangaServerStatus>(IPC.eventMangaServer, listener);
    },
    onCloudflareActivity: (listener) => {
        return subscribe<MangaCloudflareActivity[]>(IPC.eventMangaCloudflare, listener);
    },
    onJobUpdate: (listener) => {
        return subscribe<MangaJob>(IPC.eventMangaJob, listener);
    },
    onLibraryChanged: (listener) => {
        return subscribe<undefined>(IPC.eventMangaLibrary, () => {
            listener();
        });
    }
};

const programs: CyberApi['programs'] = {
    status: () => {
        return ipcRenderer.invoke(IPC.programsStatus);
    },
    install: (id) => {
        return ipcRenderer.invoke(IPC.programsInstall, id);
    },
    reinstall: (id) => {
        return ipcRenderer.invoke(IPC.programsReinstall, id);
    },
    check: () => {
        return ipcRenderer.invoke(IPC.programsCheck);
    },
    update: (id) => {
        return ipcRenderer.invoke(IPC.programsUpdate, id);
    },
    reset: (id) => {
        return ipcRenderer.invoke(IPC.programsReset, id);
    },
    onToolState: (listener) => {
        return subscribe<ToolState>(IPC.eventProgramTool, listener);
    },
    onUpdateState: (listener) => {
        return subscribe<ToolState>(IPC.eventProgramUpdate, listener);
    }
};

const api: CyberApi = {
    manga,
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
    programs,
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
    onHistoryChanged: (listener) => {
        return subscribe<undefined>(IPC.eventHistoryChanged, () => {
            listener();
        });
    }
};

contextBridge.exposeInMainWorld('api', api);
