import { isAbsolute } from 'node:path';
import { IPC } from '@shared/constants';
import type {
    AddJobResult,
    AppUpdateState,
    BinariesStatus,
    DetectedBrowser,
    HistoryEntry,
    Settings,
    StreamFindProgress,
    StreamFindResult,
    TraySupport,
    UpdateResult
} from '@shared/types';
import { checkBinaries } from '../services/binaryLocator';
import type { BinaryResolver } from '../services/binaryResolver';
import { sanitizeDownloadOptions } from '../services/settingsSanitizer';
import type { RequestExtras } from '../services/ytdlpArgsBuilder';
import { translateMain } from '../services/language';
import { discardOutdatedUpdate, resetYtdlp, updateYtdlp } from '../services/updater';
import type { BrowserCatalog } from '../services/browserCatalog';
import type { AppUpdateService } from '../services/appUpdateService';
import type { HistoryStore } from '../services/historyStore';
import type { QueueManager } from '../services/queueManager';
import type { SettingsStore } from '../services/settingsStore';
import type { StreamFinder } from '../services/streamFinder';

export interface IpcMainLike {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void;
}

export interface HandlerDependencies {
    ipcMain: IpcMainLike;
    settingsStore: SettingsStore;
    historyStore: HistoryStore;
    queue: QueueManager;
    resolver: BinaryResolver;
    appUpdates: AppUpdateService;
    refreshTraySupport: () => Promise<TraySupport>;
    browserCatalog: BrowserCatalog;
    streamFinder: StreamFinder;
    sendStreamProgress: (progress: StreamFindProgress) => void;
    onSettingsSaved: (settings: Settings) => void;
    chooseDirectory: () => Promise<string | null>;
    // Whether the folder of the anime is fixed in the settings: with anime in the library it only changes by a migration, which
    // moves them too.
    animeFolderLocked?: () => boolean;
    showItemInFolder: (path: string) => void;
}

function asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

export function registerHandlers(deps: HandlerDependencies): void {
    const { ipcMain, settingsStore, historyStore, queue } = deps;

    // A change of the folder of the anime is ignored while it is locked (the rest of the settings is saved as usual).
    function keepLockedAnimeFolder(input: unknown): unknown {
        if (!deps.animeFolderLocked?.() || typeof input !== 'object' || input === null) {
            return input;
        }
        return { ...input, animeDownloadDir: settingsStore.get().animeDownloadDir };
    }

    ipcMain.handle(IPC.settingsGet, (): Settings => {
        return settingsStore.get();
    });
    ipcMain.handle(IPC.settingsSave, (_event, input): Settings => {
        const saved = settingsStore.save(keepLockedAnimeFolder(input));
        deps.onSettingsSaved(saved);
        return saved;
    });
    ipcMain.handle(IPC.queueAdd, (_event, url, downloadDir, options) => {
        const directory = asString(downloadDir);
        const chosen = sanitizeDownloadOptions(options);
        const extras: RequestExtras = {
            ...(directory.length > 0 && isAbsolute(directory) ? { downloadDir: directory } : {}),
            ...(Object.keys(chosen).length > 0 ? { options: chosen } : {})
        };
        return Object.keys(extras).length > 0 ? queue.add(asString(url), extras) : queue.add(asString(url));
    });
    ipcMain.handle(IPC.queueList, () => {
        return queue.list();
    });
    ipcMain.handle(IPC.queueCancel, (_event, id): void => {
        queue.cancel(asString(id));
    });
    ipcMain.handle(IPC.queuePause, (_event, id): void => {
        queue.pause(asString(id));
    });
    ipcMain.handle(IPC.queueResume, (_event, id): void => {
        queue.resume(asString(id));
    });
    ipcMain.handle(IPC.queueStop, (_event, id): void => {
        queue.stop(asString(id));
    });
    ipcMain.handle(IPC.queueRetry, (_event, id): void => {
        queue.retry(asString(id));
    });
    ipcMain.handle(IPC.queueClearPartials, (_event, id): void => {
        queue.clearPartials(asString(id));
    });
    ipcMain.handle(IPC.queueRemove, (_event, id): void => {
        queue.remove(asString(id));
    });
    ipcMain.handle(IPC.queueClearFinished, (): void => {
        queue.clearFinished();
    });
    ipcMain.handle(IPC.historyList, (): HistoryEntry[] => {
        return historyStore.list();
    });
    ipcMain.handle(IPC.historyClear, (): void => {
        historyStore.clear();
    });
    // Once per run, before the binaries are first looked at: an updated yt-dlp that the app has since outdone (or that no longer runs) is
    // dropped, so the bundled one is the one used.
    let outdatedUpdateChecked: Promise<boolean> | null = null;
    ipcMain.handle(IPC.binariesCheck, async (): Promise<BinariesStatus> => {
        outdatedUpdateChecked ??= discardOutdatedUpdate(settingsStore.get(), deps.resolver).catch(() => {
            return false;
        });
        await outdatedUpdateChecked;
        return checkBinaries(settingsStore.get(), deps.resolver);
    });
    ipcMain.handle(IPC.ytdlpUpdate, (): Promise<UpdateResult> => {
        return updateYtdlp(settingsStore.get(), deps.resolver);
    });
    ipcMain.handle(IPC.ytdlpReset, (): UpdateResult => {
        return resetYtdlp(deps.resolver);
    });
    ipcMain.handle(IPC.appUpdateGet, (): AppUpdateState => {
        return deps.appUpdates.getState();
    });
    ipcMain.handle(IPC.appUpdateCheck, (): Promise<void> => {
        return deps.appUpdates.check();
    });
    ipcMain.handle(IPC.appUpdateDownload, (): Promise<void> => {
        return deps.appUpdates.download();
    });
    ipcMain.handle(IPC.appUpdateInstall, (): void => {
        deps.appUpdates.install();
    });
    ipcMain.handle(IPC.traySupport, (): Promise<TraySupport> => {
        return deps.refreshTraySupport();
    });
    ipcMain.handle(IPC.browsersList, (_event, refresh): Promise<DetectedBrowser[]> => {
        return deps.browserCatalog.list(refresh === true);
    });
    ipcMain.handle(IPC.streamFind, (_event, jobId, deep): Promise<StreamFindResult> | StreamFindResult => {
        const job = queue.getJob(asString(jobId));
        if (!job) {
            return { ok: false, candidates: [], message: translateMain('stream.noDownload'), usedBrowser: false };
        }
        // A download that came from a stream search is searched again on the page it came from, for a fresh address.
        return deps.streamFinder.find(job.id, job.pageUrl ?? job.url, deep === true, (stage) => {
            deps.sendStreamProgress({ jobId: job.id, stage });
        });
    });
    ipcMain.handle(IPC.streamCancel, (_event, jobId): void => {
        deps.streamFinder.cancel(asString(jobId));
    });
    ipcMain.handle(IPC.streamDownload, (_event, candidateId): AddJobResult => {
        const candidate = deps.streamFinder.getCandidate(asString(candidateId));
        if (!candidate) {
            return { ok: false, job: null, message: translateMain('stream.noLongerAvailable') };
        }
        return queue.add(candidate.url, {
            referer: candidate.referer,
            userAgent: candidate.userAgent,
            cookie: candidate.cookie ?? undefined,
            title: candidate.title ?? undefined,
            ipFamily: candidate.ipFamily ?? undefined,
            pageUrl: candidate.pageUrl
        });
    });
    ipcMain.handle(IPC.dialogChooseDir, (): Promise<string | null> => {
        return deps.chooseDirectory();
    });
    ipcMain.handle(IPC.shellShowItem, (_event, path): void => {
        const target = asString(path);
        if (target.length > 0) {
            deps.showItemInFolder(target);
        }
    });
}
