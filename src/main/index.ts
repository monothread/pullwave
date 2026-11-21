import { appendFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, safeStorage, screen, session, shell, type Display } from 'electron';
import { MANGA_PAGE_SCHEME } from '@shared/manga';
import { ANIME_MEDIA_SCHEME, ANIME_STREAM_SCHEME, isAnimeSupported } from '@shared/anime';
import { CUT_MEDIA_SCHEME } from '@shared/cut';
import { EXPLORER_MEDIA_SCHEME } from '@shared/explorer';
import { VIDEO_DIALOG_EXTENSIONS } from '@shared/mediaExtensions';
import { IPC, VIDEO_THUMBNAIL_SCHEME } from '@shared/constants';
import { DEFAULT_THEME_CHOICE } from '@shared/themeChoice';
import type { ThemeChoice } from '@shared/types';
import { createAnimeRuntime } from './animeRuntime';
import { registerAnimeHandlers } from './ipc/registerAnimeHandlers';
import { registerMangaHandlers } from './ipc/registerMangaHandlers';
import { registerCutHandlers } from './ipc/registerCutHandlers';
import { registerConvertHandlers } from './ipc/registerConvertHandlers';
import { registerMergeHandlers } from './ipc/registerMergeHandlers';
import { registerExplorerHandlers } from './ipc/registerExplorerHandlers';
import { registerProgramHandlers } from './ipc/registerProgramHandlers';
import { ConvertService } from './services/convertService';
import { CutPreview, createCutMediaHandler } from './services/cutPreview';
import { CutService, createFfmpegRunner } from './services/cutService';
import { MergeService } from './services/mergeService';
import { ExplorerService, createExplorerMediaHandler } from './services/explorerService';
import { ExplorerThumbnails } from './services/explorerThumbnails';
import { removeLegacyBinaries } from './services/tools/legacyBinaries';
import { ProgramTools } from './services/tools/programTools';
import { createMangaRuntime } from './mangaRuntime';
import { registerHandlers } from './ipc/registerHandlers';
import { registerLlmHandlers } from './ipc/registerLlmHandlers';
import { registerLogHandlers, type LogWatchers } from './ipc/registerLogHandlers';
import { processLogs } from './services/logHub';
import { VideoThumbnails } from './services/videoThumbnails';
import { JsonStore } from './services/jsonStore';
import { LlmTokenStore, type SecretCipher } from './services/llmTokenStore';
import { createDiagnosticLog, type DiagnosticLog } from './services/diagnosticLog';
import { attachWindowDiagnostics } from './services/windowDiagnostics';
import { paintWindowBackground, windowBackground } from './services/windowBackground';
import { AppUpdateService } from './services/appUpdateService';
import { BinaryResolver } from './services/binaryResolver';
import { BrowserCatalog } from './services/browserCatalog';
import { defaultFileProbe, detectBrowsers, type DetectionEnvironment } from './services/browserDetector';
import { listRegisteredBrowsers } from './services/browserRegistry';
import { defaultExecFile } from './services/binaryLocator';
import { Autostart, defaultAutostartFiles } from './services/autostart';
import { createElectronTray } from './services/electronTray';
import { getElectronUpdater } from './services/electronUpdater';
import { findPartialFiles, removeFiles } from './services/partialFiles';
import { applyLanguage, translateMain } from './services/language';
import { HistoryStore } from './services/historyStore';
import { PausedStore } from './services/pausedStore';
import { migrateLegacyUserData } from './services/legacyDataMigration';
import { restartApplication } from './services/relaunch';
import { mergeParts } from './services/partsMerger';
import { salvageRecording } from './services/recordingSalvage';
import { QueueManager } from './services/queueManager';
import { isAutostartLaunch, shouldStartHidden } from './services/startupLaunch';
import { SettingsStore } from './services/settingsStore';
import { launchProgram, openSiteIn } from './services/siteOpener';
import { ignoreStdioErrors } from './services/stdioGuard';
import { checkTraySupport } from './services/trayAvailability';
import { TrayManager } from './services/trayManager';
import { createMediaHandler, defaultMediaFileSystem } from './services/mediaProtocol';
import { createQuitRequester, decideCloseAction, describePending } from './services/windowClose';
import { runYtdlpLiveAware } from './services/liveHlsRunner';
import { watchMinimized } from './services/windowMinimized';

const APP_ID = 'dev.lucas.pullwave';
const STARTUP_UPDATE_CHECK_DELAY_MS = 5000;
const PRODUCTION_CSP =
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.anilist.co https://media.kitsu.app http://127.0.0.1:* ${MANGA_PAGE_SCHEME}: ${CUT_MEDIA_SCHEME}: ${EXPLORER_MEDIA_SCHEME}: ${VIDEO_THUMBNAIL_SCHEME}:; connect-src 'self' ${ANIME_STREAM_SCHEME}:; media-src 'self' blob: ${ANIME_MEDIA_SCHEME}: ${ANIME_STREAM_SCHEME}: ${CUT_MEDIA_SCHEME}: ${EXPLORER_MEDIA_SCHEME}:`;

protocol.registerSchemesAsPrivileged([
    { scheme: MANGA_PAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
    { scheme: CUT_MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
    { scheme: EXPLORER_MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
    { scheme: VIDEO_THUMBNAIL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
    ...(isAnimeSupported(process.platform)
        ? [
              { scheme: ANIME_MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
              { scheme: ANIME_STREAM_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
          ]
        : [])
]);

ignoreStdioErrors();
migrateLegacyUserData(app.getPath('appData'), app.getPath('userData'));

let mainWindow: BrowserWindow | null = null;
let trayManager: TrayManager | null = null;
let requestQuit: (() => Promise<boolean>) | null = null;
let requestRestart: (() => Promise<boolean>) | null = null;
let quitting = false;
let diagnosticLog: DiagnosticLog | null = null;
let logWatchers: LogWatchers | null = null;
let bridgeWarningShown = false;
let readThemeChoice: () => ThemeChoice = () => {
    return DEFAULT_THEME_CHOICE;
};

function warnAboutMissingBridge(reason: string): void {
    if (bridgeWarningShown) {
        return;
    }
    bridgeWarningShown = true;
    dialog.showErrorBox('PULLWAVE could not start its interface', `${reason}\n\nDetails were saved to:\n${diagnosticLog?.path ?? 'the diagnostic log'}`);
}

function iconPath(): string {
    return join(app.getAppPath(), 'resources', 'icon.png');
}

function applyContentSecurityPolicy(): void {
    if (process.env.ELECTRON_RENDERER_URL) {
        return;
    }
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [PRODUCTION_CSP] } });
    });
}

function maximizeUnlessTesting(window: BrowserWindow): void {
    if (e2eDisplay() === null && !window.isMaximized()) {
        window.maximize();
    }
}

function showWindow(): void {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    maximizeUnlessTesting(mainWindow);
    mainWindow.show();
    mainWindow.focus();
}

function toggleWindow(): void {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
        return;
    }
    showWindow();
}

function handleWindowClose(event: Electron.Event): void {
    const action = decideCloseAction({ quitting, canHideToTray: trayManager?.canHideToTray() ?? false });
    if (action === 'allow') {
        return;
    }
    event.preventDefault();
    if (action === 'hide') {
        mainWindow?.hide();
        return;
    }
    void requestQuit?.();
}

function e2eDisplay(): Display | null {
    const wanted = process.env.PULLWAVE_E2E_DISPLAY;
    const primary = screen.getPrimaryDisplay();
    if (wanted === 'primary') {
        return primary;
    }
    if (wanted === 'secondary') {
        return (
            screen.getAllDisplays().find((display) => {
                return display.id !== primary.id;
            }) ?? primary
        );
    }
    return null;
}

function startupDisplay(): Display {
    return e2eDisplay() ?? screen.getPrimaryDisplay();
}

function windowPosition(width: number, height: number): { x: number; y: number } {
    const area = startupDisplay().workArea;
    return { x: area.x + Math.max(0, Math.round((area.width - width) / 2)), y: area.y + Math.max(0, Math.round((area.height - height) / 2)) };
}

function repaintWindowBackground(): void {
    paintWindowBackground(mainWindow, readThemeChoice(), nativeTheme.shouldUseDarkColors);
}

function createWindow(options: { hidden: boolean }): BrowserWindow {
    const window = new BrowserWindow({
        width: 1100,
        height: 780,
        show: !options.hidden,
        ...windowPosition(1100, 780),
        minWidth: 480,
        minHeight: 520,
        backgroundColor: windowBackground(readThemeChoice(), nativeTheme.shouldUseDarkColors),
        title: 'PULLWAVE',
        autoHideMenuBar: true,
        icon: iconPath(),
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });
    window.webContents.setWindowOpenHandler(() => {
        return { action: 'deny' };
    });
    if (!options.hidden) {
        maximizeUnlessTesting(window);
    }
    window.on('close', handleWindowClose);
    const minimizedWatch = watchMinimized(window, (minimized) => {
        if (!window.isDestroyed()) {
            window.webContents.send(IPC.eventWindowMinimized, minimized);
        }
    });
    window.webContents.on('did-finish-load', () => {
        logWatchers?.stopAll();
        minimizedWatch.resend();
    });
    if (diagnosticLog) {
        attachWindowDiagnostics(window.webContents, diagnosticLog, { onBridgeMissing: warnAboutMissingBridge });
    }
    if (process.env.ELECTRON_RENDERER_URL) {
        void window.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
        void window.loadFile(join(__dirname, '../renderer/index.html'));
    }
    return window;
}

function sendToRenderer(channel: string, payload?: unknown): void {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    }
}

type PendingPrompt = 'quit' | 'restart';

async function confirmPending(prompt: PendingPrompt, pending: number): Promise<boolean> {
    const options: Electron.MessageBoxOptions = {
        type: 'warning',
        buttons: [translateMain(`dialog.${prompt}.action`), translateMain('dialog.cancel')],
        defaultId: 1,
        cancelId: 1,
        title: translateMain(`dialog.${prompt}.title`),
        message: describePending(pending),
        detail: translateMain(`dialog.${prompt}.detail`)
    };
    const result = mainWindow && !mainWindow.isDestroyed() ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options);
    return result.response === 0;
}

function scheduleStartupUpdateCheck(appUpdates: AppUpdateService, enabled: boolean): void {
    if (!app.isPackaged || !enabled) {
        return;
    }
    setTimeout(() => {
        void appUpdates.check();
    }, STARTUP_UPDATE_CHECK_DELAY_MS);
}

function createSecretCipher(): SecretCipher {
    if (process.env.PULLWAVE_FAKE_SECRETS === '1') {
        return {
            isAvailable: () => {
                return true;
            },
            encrypt: (text) => {
                return Buffer.from(text, 'utf-8');
            },
            decrypt: (data) => {
                return data.toString('utf-8');
            }
        };
    }
    return {
        isAvailable: () => {
            return safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text');
        },
        encrypt: (text) => {
            return safeStorage.encryptString(text);
        },
        decrypt: (data) => {
            return safeStorage.decryptString(data);
        }
    };
}

function createAutostart(): Autostart {
    const customDir = process.env.PULLWAVE_AUTOSTART_DIR;
    return new Autostart({
        platform: process.platform,
        canRegister: app.isPackaged || customDir !== undefined,
        command: process.env.APPIMAGE ?? process.execPath,
        autostartDir: customDir ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'autostart'),
        files: defaultAutostartFiles,
        setLoginItem: (enabled, args) => {
            app.setLoginItemSettings({ openAtLogin: enabled, args });
        }
    });
}

interface BootstrapResult {
    startMinimized: boolean;
    trayReady: Promise<void>;
}

function bootstrap(): BootstrapResult {
    const dataDir = app.getPath('userData');
    const settingsStore = new SettingsStore(join(dataDir, 'settings.json'));
    readThemeChoice = () => {
        return settingsStore.get();
    };
    const historyStore = new HistoryStore(join(dataDir, 'history.json'));
    const pausedStore = new PausedStore(join(dataDir, 'paused.json'));
    const llmTokens = new LlmTokenStore(new JsonStore(join(dataDir, 'llm-tokens.json'), {}), createSecretCipher());
    applyLanguage(settingsStore.get().language, app.getLocale());
    const programs = new ProgramTools({
        rootDirectory: process.env.PULLWAVE_TOOLS_DIR ?? join(dataDir, 'tools'),
        customPath: (id) => {
            const settings = settingsStore.get();
            switch (id) {
                case 'ytdlp':
                case 'deno':
                    return settings.ytdlpPath;
                case 'ffmpeg':
                    return settings.ffmpegPath;
                case 'anicli':
                    return process.env.PULLWAVE_ANI_CLI ?? '';
                default:
                    return '';
            }
        },
        onState: (state) => {
            sendToRenderer(IPC.eventProgramTool, state);
        },
        onUpdateState: (state) => {
            sendToRenderer(IPC.eventProgramUpdate, state);
        },
        checkAniCli: () => {
            return anime?.checkScript ?? null;
        }
    });
    const resolver = new BinaryResolver(programs);
    const videoThumbnails = new VideoThumbnails();
    protocol.handle(VIDEO_THUMBNAIL_SCHEME, (request) => {
        return videoThumbnails.respond(request.url);
    });
    const queue = new QueueManager({
        thumbnails: videoThumbnails,
        getSettings: () => {
            return settingsStore.get();
        },
        defaultDownloadDir: app.getPath('downloads'),
        resolveYtdlpPath: (settings) => {
            return resolver.ytdlp(settings).path;
        },
        resolveFfmpegLocation: (settings) => {
            return resolver.ffmpegLocation(settings);
        },
        salvageRecording: (filePath) => {
            return salvageRecording({ ffmpegBinary: resolver.ffmpeg(settingsStore.get()).path, filePath });
        },
        mergeParts: (paths) => {
            return mergeParts({ ffmpegBinary: resolver.ffmpeg(settingsStore.get()).path, paths });
        },
        findPartialFiles: (finalPath) => {
            return findPartialFiles(finalPath);
        },
        deleteFiles: (paths) => {
            removeFiles(paths);
        },
        startRun: (binary, args, onProgress, onInfo, onWaiting, onPostProcess, onThumbnail, onParts) => {
            return runYtdlpLiveAware({ binary, args, onProgress, onInfo, onWaiting, onPostProcess, onThumbnail, onParts, env: resolver.spawnEnv(), ffmpegBinary: resolver.ffmpeg(settingsStore.get()).path });
        },
        pausedStorage: pausedStore,
        addHistory: (entry) => {
            historyStore.add(entry);
        },
        onJobUpdate: (job) => {
            sendToRenderer(IPC.eventJobUpdate, job);
        },
        onJobRemoved: (id) => {
            sendToRenderer(IPC.eventJobRemoved, id);
        },
        onHistoryChanged: () => {
            sendToRenderer(IPC.eventHistoryChanged);
        }
    });
    const anime = createAnimeRuntime({
        platform: process.platform,
        dataDir,
        programs,
        scriptsDir: join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'ani-scripts'),
        defaultDownloadDir: app.getPath('downloads'),
        systemLocale: app.getLocale(),
        resolver,
        getSettings: () => {
            return settingsStore.get();
        },
        getLlmToken: (provider) => {
            return llmTokens.get(provider);
        },
        customScriptPath: () => {
            return process.env.PULLWAVE_ANI_CLI ?? '';
        },
        scheduleUrl: process.env.PULLWAVE_ANILIST_URL,
        coverFallbackUrl: process.env.PULLWAVE_COVER_FALLBACK_URL,
        checkTimes: Number(process.env.PULLWAVE_ANIME_CHECK_MS) > 0 ? { firstMs: Number(process.env.PULLWAVE_ANIME_CHECK_MS), everyMs: Number(process.env.PULLWAVE_ANIME_CHECK_MS) } : undefined,
        chooseLibraryFolder: async (startAt) => {
            if (process.env.PULLWAVE_IMPORT_DIR) {
                return process.env.PULLWAVE_IMPORT_DIR;
            }
            const options = { defaultPath: startAt, properties: ['openDirectory'] as Array<'openDirectory'> };
            const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
            return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        chooseMigrationFolder: async (startAt) => {
            if (process.env.PULLWAVE_MIGRATE_DIR) {
                return process.env.PULLWAVE_MIGRATE_DIR;
            }
            const options = { defaultPath: startAt, properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> };
            const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
            return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        saveAnimeDirectory: (directory) => {
            settingsStore.save({ ...settingsStore.get(), animeDownloadDir: directory });
        },
        disableAutoTranslate: () => {
            settingsStore.save({ ...settingsStore.get(), animeAutoTranslateNew: false });
        },
        openFolder: (path) => {
            void shell.openPath(path);
        },
        chooseSubtitleFile: async () => {
            const options = {
                properties: ['openFile'] as Array<'openFile'>,
                filters: [{ name: 'Subtitles', extensions: ['vtt', 'srt'] }]
            };
            const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
            return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        send: sendToRenderer
    });
    const manga = createMangaRuntime({
        platform: process.platform,
        arch: process.arch,
        dataDir,
        defaultDownloadDir: app.getPath('downloads'),
        getSettings: () => {
            return settingsStore.get();
        },
        send: sendToRenderer,
        openFolder: (path) => {
            void shell.openPath(path);
        },
        openSite: (url, browser) => {
            if (process.env.PULLWAVE_MANGA_OPEN_LOG) {
                appendFileSync(process.env.PULLWAVE_MANGA_OPEN_LOG, `${browser} ${url}\n`);
                return;
            }
            void openSiteIn(url, browser, {
                platform: process.platform,
                env: process.env,
                exists: existsSync,
                launch: launchProgram,
                openDefault: (address) => {
                    void shell.openExternal(address);
                }
            });
        },
        chooseMigrationFolder: async (startAt) => {
            if (process.env.PULLWAVE_MANGA_MIGRATE_DIR) {
                return process.env.PULLWAVE_MANGA_MIGRATE_DIR;
            }
            const options = { defaultPath: startAt, properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> };
            const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
            return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        saveMangaDirectory: (directory) => {
            settingsStore.save({ ...settingsStore.get(), mangaDirectory: directory });
        },
        checkTimes: Number(process.env.PULLWAVE_MANGA_CHECK_MS) > 0 ? { firstMs: Number(process.env.PULLWAVE_MANGA_CHECK_MS), everyMs: Number(process.env.PULLWAVE_MANGA_CHECK_MS) } : undefined,
        externalBaseUrl: process.env.PULLWAVE_MANGA_URL ?? null,
        coverFallbackUrl: process.env.PULLWAVE_COVER_FALLBACK_URL
    });
    if (manga) {
        protocol.handle(MANGA_PAGE_SCHEME, (request) => {
            return manga.pageHandler(request);
        });
    }
    if (anime) {
        const handleMedia = createMediaHandler(anime.media, defaultMediaFileSystem);
        protocol.handle(ANIME_MEDIA_SCHEME, (request) => {
            return handleMedia(request);
        });
        protocol.handle(ANIME_STREAM_SCHEME, (request) => {
            return anime.streamHandler(request);
        });
    }
    const pendingDownloads = (): number => {
        return queue.pendingCount() + (anime?.queue.pendingCount() ?? 0) + (manga?.queue.pendingCount() ?? 0);
    };
    const appUpdates = new AppUpdateService(
        getElectronUpdater(),
        { supported: app.isPackaged, currentVersion: app.getVersion() },
        (state) => {
            sendToRenderer(IPC.eventAppUpdateState, state);
        }
    );
    scheduleStartupUpdateCheck(appUpdates, settingsStore.get().checkUpdatesOnStart);

    requestQuit = createQuitRequester({
        pendingCount: pendingDownloads,
        confirm: (pending) => {
            return confirmPending('quit', pending);
        },
        quit: () => {
            app.quit();
        }
    });
    requestRestart = createQuitRequester({
        pendingCount: pendingDownloads,
        confirm: (pending) => {
            return confirmPending('restart', pending);
        },
        quit: () => {
            restartApplication({
                relaunch: (options) => {
                    app.relaunch(options);
                },
                env: process.env,
                argv: process.argv,
                pid: process.pid
            });
            app.quit();
        }
    });
    const manager = new TrayManager({
        checkSupport: () => {
            return checkTraySupport();
        },
        createTray: () => {
            return createElectronTray(iconPath(), {
                show: showWindow,
                toggle: toggleWindow,
                restart: () => {
                    if (pendingDownloads() > 0) {
                        showWindow();
                    }
                    void requestRestart?.();
                },
                quit: () => {
                    if (pendingDownloads() > 0) {
                        showWindow();
                    }
                    void requestQuit?.();
                }
            });
        }
    });
    const browserCatalog = new BrowserCatalog(async () => {
        const environment: DetectionEnvironment = { platform: process.platform, homeDir: app.getPath('home'), env: process.env };
        const applicationDirs = process.env.PULLWAVE_APPLICATION_DIRS?.split(delimiter);
        const registered = await listRegisteredBrowsers(
            { ...environment, applicationDirs },
            { listFiles: defaultFileProbe.listFiles, readText: defaultFileProbe.readText, exec: defaultExecFile }
        );
        return detectBrowsers(environment, defaultFileProbe, registered);
    });
    trayManager = manager;
    const trayReady = manager.sync(settingsStore.get().closeToTray);
    const autostart = createAutostart();
    autostart.sync(settingsStore.get().launchAtLogin);

    let shutdownDone = false;
    let shuttingDown = false;
    app.on('before-quit', (event) => {
        quitting = true;
        if (shutdownDone) {
            return;
        }
        if (shuttingDown) {
            event.preventDefault();
            return;
        }
        const endAll = (): Promise<unknown> => {
            cutter.cancel();
            explorerThumbnails.cancelPending();
            explorerThumbnails.cancelPreview();
            anime?.stopBackgroundChecks();
            return Promise.all([queue.shutdown(), converter.shutdown(), merger.shutdown(), anime?.queue.shutdown(), manga?.shutdown()]);
        };
        if (
            queue.hasRunsToEnd() ||
            converter.hasActiveRun() ||
            merger.hasActiveRun() ||
            anime?.queue.hasRunsToEnd() ||
            manga?.queue.hasRunsToEnd() ||
            manga?.hasProcessesToEnd()
        ) {
            event.preventDefault();
            shuttingDown = true;
            void endAll().finally(() => {
                shutdownDone = true;
                app.quit();
            });
            return;
        }
        shutdownDone = true;
        void endAll();
    });

    registerAnimeHandlers(ipcMain, anime ? anime.handlers : null);
    registerMangaHandlers(ipcMain, manga ? manga.handlers : null);
    removeLegacyBinaries(dataDir, [settingsStore.get().ytdlpPath, settingsStore.get().ffmpegPath, process.env.PULLWAVE_ANI_CLI ?? '']);
    registerProgramHandlers(ipcMain, { programs });
    const cutter = new CutService({
        runFfmpeg: () => {
            return createFfmpegRunner(resolver.ffmpeg(settingsStore.get()).path);
        },
        chooseFile: async () => {
            if (process.env.PULLWAVE_CUT_FILE) {
                return process.env.PULLWAVE_CUT_FILE;
            }
            const options = {
                properties: ['openFile'] as Array<'openFile'>,
                filters: [
                    { name: 'Video and audio', extensions: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'flv', 'ts', 'wmv', 'mp3', 'm4a', 'aac', 'opus', 'ogg', 'oga', 'flac', 'wav'] },
                    { name: 'All files', extensions: ['*'] }
                ]
            };
            const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
            return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        outputRoot: () => {
            return settingsStore.get().downloadDir;
        },
        audioFormat: () => {
            return settingsStore.get().audioFormat;
        },
        send: (run) => {
            sendToRenderer(IPC.eventCutProgress, run);
        }
    });
    const cutPreview = new CutPreview({
        runFfmpeg: () => {
            return createFfmpegRunner(resolver.ffmpeg(settingsStore.get()).path);
        },
        directory: join(dataDir, 'cut-preview')
    });
    const handleCutMedia = createCutMediaHandler(cutPreview, defaultMediaFileSystem);
    protocol.handle(CUT_MEDIA_SCHEME, (request) => {
        return handleCutMedia(request);
    });
    const tryAppPath = (name: 'downloads' | 'home' | 'videos' | 'music'): string => {
        try {
            return app.getPath(name);
        } catch {
            return '';
        }
    };
    const converter = new ConvertService({
        runFfmpeg: () => {
            return createFfmpegRunner(resolver.ffmpeg(settingsStore.get()).path);
        },
        chooseFiles: async () => {
            if (process.env.PULLWAVE_CONVERT_FILES) {
                return process.env.PULLWAVE_CONVERT_FILES.split(delimiter).filter((entry) => {
                    return entry.length > 0;
                });
            }
            const options = {
                properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
                filters: [
                    { name: 'Videos', extensions: VIDEO_DIALOG_EXTENSIONS },
                    { name: 'All files', extensions: ['*'] }
                ]
            };
            const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
            return result.canceled ? null : result.filePaths;
        },
        downloadsDir: () => {
            return settingsStore.get().downloadDir || tryAppPath('downloads') || homedir();
        },
        send: (run) => {
            sendToRenderer(IPC.eventConvertProgress, run);
        }
    });
    const merger = new MergeService({
        runFfmpeg: () => {
            return createFfmpegRunner(resolver.ffmpeg(settingsStore.get()).path);
        },
        chooseFiles: async () => {
            if (process.env.PULLWAVE_MERGE_FILES) {
                return process.env.PULLWAVE_MERGE_FILES.split(delimiter).filter((entry) => {
                    return entry.length > 0;
                });
            }
            const options = {
                properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
                filters: [
                    { name: 'Videos', extensions: VIDEO_DIALOG_EXTENSIONS },
                    { name: 'All files', extensions: ['*'] }
                ]
            };
            const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
            return result.canceled ? null : result.filePaths;
        },
        downloadsDir: () => {
            return settingsStore.get().downloadDir || tryAppPath('downloads') || homedir();
        },
        send: (run) => {
            sendToRenderer(IPC.eventMergeProgress, run);
        }
    });
    const explorerThumbnails = new ExplorerThumbnails({
        runFfmpeg: () => {
            return createFfmpegRunner(resolver.ffmpeg(settingsStore.get()).path);
        },
        cacheDirectory: join(dataDir, 'explorer-thumbs'),
        previewDirectory: join(dataDir, 'explorer-preview')
    });
    const explorer = new ExplorerService({
        defaultDirectory: () => {
            const configured = settingsStore.get().downloadDir;
            if (configured.length > 0 && existsSync(configured)) {
                return configured;
            }
            const downloads = tryAppPath('downloads');
            if (downloads.length > 0 && existsSync(downloads)) {
                return downloads;
            }
            return tryAppPath('home') || homedir();
        },
        trashItem: (path) => {
            return shell.trashItem(path);
        },
        openExternal: (path) => {
            return shell.openPath(path);
        },
        thumbnails: explorerThumbnails
    });
    const handleExplorerMedia = createExplorerMediaHandler(explorer, explorerThumbnails, defaultMediaFileSystem);
    protocol.handle(EXPLORER_MEDIA_SCHEME, (request) => {
        return handleExplorerMedia(request);
    });
    app.on('will-quit', () => {
        cutPreview.dispose();
        explorerThumbnails.dispose();
        [manga?.db, anime?.db].forEach((db) => {
            try {
                db?.checkpoint();
            } catch {
                return;
            }
        });
    });
    registerCutHandlers(ipcMain, cutter, cutPreview);
    registerConvertHandlers(ipcMain, converter);
    registerMergeHandlers(ipcMain, merger);
    registerExplorerHandlers(ipcMain, explorer);
    logWatchers = registerLogHandlers(ipcMain, { hub: processLogs, send: sendToRenderer });
    if (process.env.PULLWAVE_NO_TOOLS !== '1') {
        void programs.prepare();
    }
    manga?.prepare();
    registerLlmHandlers(ipcMain, {
        tokens: llmTokens,
        onChanged: () => {
            anime?.enforceAutoTranslateSetup();
        }
    });
    anime?.startBackgroundChecks();
    registerHandlers({
        ipcMain,
        settingsStore,
        historyStore,
        queue,
        resolver,
        appUpdates,
        refreshTraySupport: () => {
            return manager.refreshSupport();
        },
        browserCatalog,
        onSettingsSaved: (settings) => {
            applyLanguage(settings.language, app.getLocale());
            repaintWindowBackground();
            autostart.sync(settings.launchAtLogin);
            void manager.sync(settings.closeToTray).then(() => {
                return manager.rebuild();
            });
            void manga?.service.applyHelper();
            anime?.enforceAutoTranslateSetup();
        },
        animeFolderLocked: () => {
            return anime !== null && anime.db.list().length > 0;
        },
        chooseDirectory: async () => {
            const options = { properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> };
            const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
            return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        showItemInFolder: (path) => {
            shell.showItemInFolder(path);
        },
        defaultDownloadDir: app.getPath('downloads')
    });
    return { startMinimized: settingsStore.get().startMinimized, trayReady };
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        showWindow();
    });

    void app.whenReady().then(() => {
        if (process.platform === 'win32') {
            app.setAppUserModelId(APP_ID);
        }
        diagnosticLog = createDiagnosticLog(join(app.getPath('userData'), 'diagnostic.log'));
        applyContentSecurityPolicy();
        const autostart = isAutostartLaunch(process.argv);
        const { startMinimized, trayReady } = bootstrap();
        const hidden = shouldStartHidden({ autostart, startMinimized });
        mainWindow = createWindow({ hidden });
        nativeTheme.on('updated', repaintWindowBackground);
        void trayReady.then(() => {
            if (hidden && !trayManager?.canHideToTray()) {
                showWindow();
            }
        });
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                mainWindow = createWindow({ hidden: false });
            }
        });
    });

    app.on('window-all-closed', () => {
        app.quit();
    });
}
