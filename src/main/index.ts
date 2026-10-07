import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, screen, session, shell, type Display } from 'electron';
import { ANIME_MEDIA_SCHEME, ANIME_STREAM_SCHEME, isAnimeSupported } from '@shared/anime';
import { IPC } from '@shared/constants';
import { createAnimeRuntime } from './animeRuntime';
import { registerAnimeHandlers } from './ipc/registerAnimeHandlers';
import { registerHandlers } from './ipc/registerHandlers';
import { registerLlmHandlers } from './ipc/registerLlmHandlers';
import { JsonStore } from './services/jsonStore';
import { LlmTokenStore, type SecretCipher } from './services/llmTokenStore';
import { createDiagnosticLog, type DiagnosticLog } from './services/diagnosticLog';
import { attachWindowDiagnostics } from './services/windowDiagnostics';
import { AppUpdateService } from './services/appUpdateService';
import { BinaryResolver } from './services/binaryResolver';
import { sniffStreams } from './services/browserSniffer';
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
import { defaultFetchPage, scanPage } from './services/pageScanner';
import { defaultFetchPlaylist, dropVariantPlaylists } from './services/playlistFilter';
import { StreamFinder } from './services/streamFinder';
import { ignoreStdioErrors } from './services/stdioGuard';
import { checkTraySupport } from './services/trayAvailability';
import { TrayManager } from './services/trayManager';
import { createMediaHandler, defaultMediaFileSystem } from './services/mediaProtocol';
import { createQuitRequester, decideCloseAction, describePending } from './services/windowClose';
import { runYtdlp } from './services/ytdlpRunner';

const APP_ID = 'dev.lucas.pullwave';
const STARTUP_UPDATE_CHECK_DELAY_MS = 5000;
const PRODUCTION_CSP =
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.anilist.co; connect-src 'self' ${ANIME_STREAM_SCHEME}:; media-src 'self' blob: ${ANIME_MEDIA_SCHEME}: ${ANIME_STREAM_SCHEME}:`;

// The schemes the anime player reads files and streams through have to be declared before the app is ready (only where the
// anime section exists).
if (isAnimeSupported(process.platform)) {
    protocol.registerSchemesAsPrivileged([
        { scheme: ANIME_MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
        { scheme: ANIME_STREAM_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
    ]);
}

ignoreStdioErrors();
// Must run before the single-instance lock below, which is what creates the data folder.
migrateLegacyUserData(app.getPath('appData'), app.getPath('userData'));

let mainWindow: BrowserWindow | null = null;
let trayManager: TrayManager | null = null;
let requestQuit: (() => Promise<boolean>) | null = null;
let requestRestart: (() => Promise<boolean>) | null = null;
let quitting = false;
let diagnosticLog: DiagnosticLog | null = null;
let bridgeWarningShown = false;

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

function showWindow(): void {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
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

// PULLWAVE_E2E_DISPLAY opens the window, centred, on the primary monitor ('primary') or on the first one that is not the primary
// ('secondary'; the primary again when there is only one). The end-to-end tests set it, so the ones that resize the window run where
// they have room and the others where they do not get in the way of the person using the computer, and not on whichever monitor the
// system picks. Without it the system decides.
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

// The app opens on the primary monitor, wherever the system would have put it.
function startupDisplay(): Display {
    return e2eDisplay() ?? screen.getPrimaryDisplay();
}

function windowPosition(width: number, height: number): { x: number; y: number } {
    const area = startupDisplay().workArea;
    return { x: area.x + Math.max(0, Math.round((area.width - width) / 2)), y: area.y + Math.max(0, Math.round((area.height - height) / 2)) };
}

function createWindow(options: { hidden: boolean }): BrowserWindow {
    const window = new BrowserWindow({
        width: 1100,
        height: 780,
        show: !options.hidden,
        ...windowPosition(1100, 780),
        minWidth: 480,
        minHeight: 520,
        backgroundColor: '#07060f',
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
    // The app opens maximized (also when it starts out of sight, so it shows maximized from the tray). The end-to-end tests keep the
    // size above, which the layout ones depend on.
    if (e2eDisplay() === null) {
        window.maximize();
    }
    window.on('close', handleWindowClose);
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

// The system keyring keeps the tokens of the language models. A Linux without one makes Electron fall back to a key kept in the open
// ("basic_text"), which protects nothing, so then no token is saved. PULLWAVE_FAKE_SECRETS=1 keeps them as plain text (used by the end-to-end
// tests, which cannot depend on the keyring of the machine).
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

// The login entry is written for the app as it is installed; PULLWAVE_AUTOSTART_DIR points it at another folder and makes it work in a
// development run (used by the end-to-end tests).
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
    // Resolves once the tray is known to exist or not, which is what tells whether the window can start out of sight.
    trayReady: Promise<void>;
}

function bootstrap(): BootstrapResult {
    const dataDir = app.getPath('userData');
    const settingsStore = new SettingsStore(join(dataDir, 'settings.json'));
    const historyStore = new HistoryStore(join(dataDir, 'history.json'));
    const pausedStore = new PausedStore(join(dataDir, 'paused.json'));
    const llmTokens = new LlmTokenStore(new JsonStore(join(dataDir, 'llm-tokens.json'), {}), createSecretCipher());
    applyLanguage(settingsStore.get().language, app.getLocale());
    const resolver = new BinaryResolver({
        bundledDir: app.isPackaged ? join(process.resourcesPath, 'bin') : join(app.getAppPath(), 'resources', 'bin'),
        userBinDir: join(dataDir, 'bin')
    });
    const queue = new QueueManager({
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
        startRun: (binary, args, onProgress, onInfo, onWaiting, onPostProcess) => {
            return runYtdlp({ binary, args, onProgress, onInfo, onWaiting, onPostProcess, env: resolver.spawnEnv() });
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
        bundledDir: join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'bin'),
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
        // PULLWAVE_ANI_CLI replaces the ani-cli script that ships with the app (used by the end-to-end tests).
        customScriptPath: () => {
            return process.env.PULLWAVE_ANI_CLI ?? '';
        },
        // PULLWAVE_ANILIST_URL replaces the address of the schedule of the day (used by the end-to-end tests).
        scheduleUrl: process.env.PULLWAVE_ANILIST_URL,
        // PULLWAVE_IMPORT_DIR answers the question of which folder to import (used by the end-to-end tests).
        chooseLibraryFolder: async (startAt) => {
            if (process.env.PULLWAVE_IMPORT_DIR) {
                return process.env.PULLWAVE_IMPORT_DIR;
            }
            const options = { defaultPath: startAt, properties: ['openDirectory'] as Array<'openDirectory'> };
            const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
            return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        // PULLWAVE_MIGRATE_DIR answers the question of which folder to migrate the anime to (used by the end-to-end tests).
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
        return queue.pendingCount() + (anime?.queue.pendingCount() ?? 0);
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
    const streamFinder = new StreamFinder({
        scan: (url, signal) => {
            return scanPage(url, { fetchPage: defaultFetchPage }, signal);
        },
        sniff: sniffStreams,
        refine: (streams) => {
            return dropVariantPlaylists(streams, defaultFetchPlaylist);
        }
    });
    const browserCatalog = new BrowserCatalog(async () => {
        const environment: DetectionEnvironment = { platform: process.platform, homeDir: app.getPath('home'), env: process.env };
        // PULLWAVE_APPLICATION_DIRS replaces the folders holding the .desktop entries (used by the end-to-end tests).
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

    // Quitting asks live recordings to finish and gives them a moment to save their file before the app really exits.
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
            return Promise.all([queue.shutdown(), anime?.queue.shutdown()]);
        };
        if (queue.hasRunsToEnd() || anime?.queue.hasRunsToEnd()) {
            // Downloads that are running are cancelled and what they left behind is deleted before the app exits.
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
    registerLlmHandlers(ipcMain, { tokens: llmTokens });
    // Which anime of today's schedule the source has is looked up in the background, so it is known by the time the screen is opened.
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
        streamFinder,
        sendStreamProgress: (progress) => {
            sendToRenderer(IPC.eventStreamProgress, progress);
        },
        onSettingsSaved: (settings) => {
            applyLanguage(settings.language, app.getLocale());
            autostart.sync(settings.launchAtLogin);
            void manager.sync(settings.closeToTray).then(() => {
                return manager.rebuild();
            });
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
        }
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
        // Out of sight only when there is a tray icon to bring the window back from; otherwise it opens like any other start.
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
