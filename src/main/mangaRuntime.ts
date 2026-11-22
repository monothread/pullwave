import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { IPC } from '@shared/constants';
import { hasChapterFile, isMangaSupported } from '@shared/manga';
import type { Settings, SiteBrowser } from '@shared/types';
import type { MangaHandlerDependencies } from './ipc/registerMangaHandlers';
import { isInsideDirectory } from './services/animeFiles';
import { MangaChapterDownloader } from './services/manga/mangaChapterDownloader';
import { MangaDb } from './services/manga/mangaDb';
import { MangaDownloadQueue } from './services/manga/mangaDownloadQueue';
import { importMangaLibrary } from './services/manga/mangaLibraryImport';
import { scanMangaLibraryFolder, type MangaScanFileSystem } from './services/manga/mangaLibraryScan';
import { defaultMangaMetadataFiles, MANGA_METADATA_FILE, refreshMangaMetadata, refreshMangaMetadataFor, type MangaMetadataFiles } from './services/manga/mangaMetadata';
import { migrateMangaFolder, renameMangaFolder, type MangaMigrationFileSystem } from './services/manga/mangaMigration';
import { MangaUpdateChecker } from './services/manga/mangaUpdateChecker';
import { COMIC_INFO_FILE, DEFAULT_MANGA_FOLDER, isCompletePage, mangaDirectory } from './services/manga/mangaFiles';
import { createImageFetcher } from './services/manga/mangaImages';
import { LocalPages } from './services/manga/localPages';
import { MangaCovers } from './services/manga/mangaCovers';
import { CoverChain, fallbackProviders } from './services/covers/coverChain';
import { MangaIcons } from './services/manga/mangaIcons';
import { createMangaProtocolHandler } from './services/manga/mangaPageProtocol';
import { MangaReader } from './services/manga/mangaReader';
import { MangaRepair } from './services/manga/mangaRepair';
import { MangaService } from './services/manga/mangaService';
import { SuwayomiClient } from './services/manga/suwayomiClient';
import { CloudflareMonitor } from './services/tools/cloudflareMonitor';
import { FlareSolverrDocker, type FlareSolverrDockerDependencies } from './services/tools/flaresolverrDocker';
import { SUWAYOMI_SELECTED_FILE, suwayomiSpec } from './services/tools/suwayomiRelease';
import { MangaToolUpdates } from './services/manga/mangaToolUpdates';
import { readSelectedFlareSolverr } from './services/tools/flaresolverrUpdate';
import { SuwayomiServer, type SuwayomiServerDependencies } from './services/tools/suwayomiServer';
import { ToolInstaller, type ToolInstallerDependencies } from './services/tools/toolInstaller';

export interface MangaRuntimeOptions {
    platform: NodeJS.Platform;
    arch: string;
    dataDir: string;
    defaultDownloadDir: string;
    getSettings: () => Settings;
    send: (channel: string, payload?: unknown) => void;
    openFolder: (path: string) => void;
    checkTimes?: { firstMs: number; everyMs: number };
    openSite?: (url: string, browser: SiteBrowser) => void;
    chooseLibraryFolder?: (startAt: string) => Promise<string | null>;
    chooseMigrationFolder?: (startAt: string) => Promise<string | null>;
    saveMangaDirectory?: (directory: string) => void;
    migrationFiles?: MangaMigrationFileSystem;
    metadataFiles?: MangaMetadataFiles;
    scanFiles?: MangaScanFileSystem;
    externalBaseUrl?: string | null;
    coverFallbackUrl?: string;
    toolDependencies?: Partial<ToolInstallerDependencies>;
    serverDependencies?: Partial<SuwayomiServerDependencies>;
    helperDependencies?: FlareSolverrDockerDependencies;
    fetchImpl?: typeof fetch;
}

export interface MangaRuntime {
    service: MangaService;
    queue: MangaDownloadQueue;
    db: MangaDb;
    handlers: MangaHandlerDependencies;
    checker: MangaUpdateChecker;
    updates: MangaToolUpdates;
    pageHandler: (request: Request) => Promise<Response>;
    prepare: () => void;
    hasProcessesToEnd: () => boolean;
    shutdown: () => Promise<void>;
}

function pathSize(path: string): number | null {
    try {
        const stats = statSync(path);
        if (stats.isFile()) {
            return stats.size;
        }
        if (stats.isDirectory()) {
            return readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
                if (!entry.isFile()) {
                    return total;
                }
                const entrySize = pathSize(join(path, entry.name));
                return total + (entrySize ?? 0);
            }, 0);
        }
        return null;
    } catch {
        return null;
    }
}

function removeChapterPath(path: string): void {
    let stats;
    try {
        stats = statSync(path);
    } catch {
        return;
    }
    const isArchive = stats.isFile() && path.toLowerCase().endsWith('.cbz');
    const isOwnFolder = stats.isDirectory() && existsSync(join(path, COMIC_INFO_FILE));
    if (isArchive || isOwnFolder) {
        rmSync(path, { recursive: true, force: true });
        try {
            const parent = dirname(path);
            const remaining = readdirSync(parent);
            if (remaining.length === 0) {
                rmdirSync(parent);
                return;
            }
            if (remaining.length === 1 && remaining[0] === MANGA_METADATA_FILE) {
                rmSync(join(parent, MANGA_METADATA_FILE), { force: true });
                rmdirSync(parent);
            }
        } catch {
            return;
        }
    }
}

function isRealPathInside(child: string, parent: string, platform: NodeJS.Platform): boolean {
    if (!isInsideDirectory(child, parent, platform)) {
        return false;
    }
    try {
        const realParent = realpathSync(parent);
        const realChild = realpathSync(child);
        return isInsideDirectory(realChild, realParent, platform);
    } catch {
        return false;
    }
}

function removeMetadataIfRegularFile(metadataPath: string): void {
    try {
        const stats = lstatSync(metadataPath);
        if (stats.isFile() && !stats.isSymbolicLink()) {
            rmSync(metadataPath, { force: true });
        }
    } catch {
        return;
    }
}

function countCompletePages(workDirectory: string): number {
    try {
        return readdirSync(workDirectory).filter(isCompletePage).length;
    } catch {
        return 0;
    }
}

export function forgetSelectedServer(toolsDirectory: string, remove: (path: string) => void = (path) => {
    rmSync(path, { force: true });
}): void {
    [SUWAYOMI_SELECTED_FILE, `${SUWAYOMI_SELECTED_FILE}.part`].forEach((name) => {
        try {
            remove(join(toolsDirectory, name));
        } catch {
            return;
        }
    });
}

export function createMangaRuntime(options: MangaRuntimeOptions): MangaRuntime | null {
    const external = options.externalBaseUrl ?? null;
    if (!isMangaSupported(options.platform, options.arch) && external === null) {
        return null;
    }
    const root = join(options.dataDir, 'manga');
    forgetSelectedServer(join(root, 'tools'));
    const flaresolverrFile = join(root, 'tools', 'flaresolverr-selected.json');
    const spec = suwayomiSpec(options.platform, options.arch);
    const db = new MangaDb(join(root, 'manga.db'));
    db.failInterrupted();
    const installer = new ToolInstaller({
        rootDirectory: join(root, 'tools'),
        onState: (state) => {
            options.send(IPC.eventMangaTool, state);
        },
        ...options.toolDependencies
    });
    const helper =
        isMangaSupported(options.platform, options.arch) && external === null
            ? new FlareSolverrDocker({
                  onState: (state) => {
                      options.send(IPC.eventMangaTool, state);
                  },
                  version: readSelectedFlareSolverr(flaresolverrFile) ?? undefined,
                  ...options.helperDependencies
              })
            : null;
    const externalHelper = (): string => {
        return options.getSettings().mangaFlaresolverrUrl;
    };
    const monitor =
        helper === null
            ? null
            : new CloudflareMonitor({
                  target: () => {
                      const own = externalHelper();
                      return own.length > 0 ? Promise.resolve(own) : helper.ensureRunning();
                  },
                  onChange: (active) => {
                      options.send(IPC.eventMangaCloudflare, active);
                  }
              });
    const helperUrl = async (): Promise<string | null> => {
        if (helper === null || monitor === null) {
            return null;
        }
        if (externalHelper().length === 0 && !options.getSettings().mangaFlaresolverrEnabled) {
            return null;
        }
        if (externalHelper().length === 0) {
            if (!helper.isReady) {
                return null;
            }
            await helper.ensureRunning();
        }
        return monitor.start();
    };
    const server = new SuwayomiServer({
        spec: spec ?? suwayomiSpec('linux', 'x64')!,
        installDirectory: spec === null ? '' : installer.directoryOf(spec),
        dataDirectory: join(root, 'server'),
        platform: options.platform,
        onStatus: (status) => {
            options.send(IPC.eventMangaServer, status);
        },
        helperUrl,
        ...options.serverDependencies
    });
    const holder: { service: MangaService | null } = { service: null };
    const baseUrl = (): Promise<string> => {
        return holder.service!.requireServer();
    };
    const client = new SuwayomiClient({ baseUrl, fetchImpl: options.fetchImpl });
    const service = new MangaService({
        spec,
        helper,
        externalHelper,
        helperEnabled: () => {
            return options.getSettings().mangaFlaresolverrEnabled;
        },
        helperUrl,
        tool: installer,
        server,
        client: () => {
            return client;
        },
        externalBaseUrl: external
    });
    holder.service = service;
    const downloader = new MangaChapterDownloader({
        pages: (chapterRemoteId) => {
            return service.pagesOf(chapterRemoteId);
        },
        fetchImage: createImageFetcher({ baseUrl, fetchImpl: options.fetchImpl })
    });
    const send = options.send;
    const notifyLibraryChanged = (): void => {
        send(IPC.eventMangaLibrary);
    };
    const notifyLibraryEntryChanged = (mangaId: number): void => {
        send(IPC.eventMangaLibraryEntry, mangaId);
    };
    const refreshMetadata = (mangaId: number): void => {
        refreshMangaMetadata(db, mangaId, options.metadataFiles ?? defaultMangaMetadataFiles, options.platform);
    };
    const queue = new MangaDownloadQueue({
        db,
        download: (downloadOptions) => {
            return downloader.download(downloadOptions);
        },
        getSettings: () => {
            const settings = options.getSettings();
            return { mangaDirectory: settings.mangaDirectory, mangaFormat: settings.mangaFormat };
        },
        defaultDownloadDir: options.defaultDownloadDir,
        platform: options.platform,
        ensureDirectory: (path) => {
            mkdirSync(path, { recursive: true });
        },
        pathExists: existsSync,
        removePath: (path) => {
            rmSync(path, { recursive: true, force: true });
        },
        countCompletePages,
        onJobUpdate: (job) => {
            send(IPC.eventMangaJob, job);
        },
        onLibraryChanged: notifyLibraryChanged,
        onLibraryEntryChanged: notifyLibraryEntryChanged,
        onChapterDownloaded: refreshMetadata,
        onHeldChange: (held) => {
            send(IPC.eventMangaQueueHeld, held);
        }
    });
    queue.restore();
    const baseDirectory = (): string => {
        const configured = options.getSettings().mangaDirectory;
        return configured.length > 0 ? configured : join(options.defaultDownloadDir, DEFAULT_MANGA_FOLDER);
    };
    const localPages = new LocalPages();
    const icons = new MangaIcons({
        directory: join(root, 'icons'),
        baseUrl: () => {
            return service.baseUrl;
        },
        fetchImpl: options.fetchImpl
    });
    const covers = new MangaCovers({
        directory: join(root, 'covers'),
        db,
        baseUrl: () => {
            return service.baseUrl;
        },
        fetchImpl: options.fetchImpl,
        fallback: new CoverChain('manga', fallbackProviders('manga', { baseUrl: options.coverFallbackUrl, fetchFn: options.fetchImpl }))
    });
    const fileOf = (chapterId: number): string | null => {
        const chapter = db.getChapter(chapterId);
        return chapter !== null && hasChapterFile(chapter.status) ? chapter.filePath : null;
    };
    const reader = new MangaReader({
        fileOf,
        incompletePageCount: (chapterId) => {
            const chapter = db.getChapter(chapterId);
            return chapter?.status === 'incomplete' ? chapter.pageCount : null;
        },
        localPages,
        remotePages: (chapterRemoteId) => {
            return service.pagesOf(chapterRemoteId);
        }
    });
    const repair = new MangaRepair({
        db,
        repair: (repairOptions, signal) => {
            return downloader.repair(repairOptions, signal);
        },
        pathExists: existsSync,
        onLibraryEntryChanged: notifyLibraryEntryChanged,
        onChapterRepaired: refreshMetadata
    });
    const updates = new MangaToolUpdates({
        flaresolverrFile,
        helper: () => {
            return helper !== null && externalHelper().length === 0 && options.getSettings().mangaFlaresolverrEnabled ? helper : null;
        },
        helperChanged: () => {
            return service.applyHelper();
        },
        fetchImpl: options.fetchImpl
    });
    const handlers: MangaHandlerDependencies = {
        service,
        updates,
        covers,
        icons,
        checkNewChapters: (mangaId) => {
            return mangaId === null ? checker.checkNow('manual') : checker.checkManga(mangaId);
        },
        checkState: () => {
            return checker.state();
        },
        queue,
        db,
        reader,
        repair,
        removeChapterFiles: (paths) => {
            paths.forEach(removeChapterPath);
        },
        folderOf: (mangaId) => {
            const manga = db.getLibraryManga(mangaId);
            if (manga === null) {
                return null;
            }
            const downloaded = manga.chapters.find((chapter) => {
                return hasChapterFile(chapter.status) && chapter.filePath !== null;
            });
            return downloaded?.filePath != null ? dirname(downloaded.filePath) : mangaDirectory(baseDirectory(), manga.title, options.platform);
        },
        openFolder: options.openFolder,
        openSite: (url) => {
            options.openSite?.(url, options.getSettings().mangaSiteBrowser);
        },
        migrateFolder: async () => {
            const currentDirectory = baseDirectory();
            const chosen = await (options.chooseMigrationFolder?.(currentDirectory) ?? Promise.resolve(null));
            if (chosen === null) {
                return { ok: false, reason: 'cancelled' };
            }
            const outcome = await migrateMangaFolder({
                db,
                files: options.migrationFiles,
                platform: options.platform,
                currentDirectory,
                newDirectory: chosen,
                saveDirectory: (directory) => {
                    options.saveMangaDirectory?.(directory);
                },
                onProgress: (progress) => {
                    send(IPC.eventMangaMigration, progress);
                }
            });
            if (outcome.ok) {
                db.list().forEach((manga) => {
                    if (
                        manga.chapters.some((chapter) => {
                            return hasChapterFile(chapter.status) && chapter.filePath !== null;
                        })
                    ) {
                        refreshMangaMetadataFor(manga, options.metadataFiles ?? defaultMangaMetadataFiles, options.platform);
                    }
                });
            }
            return outcome.ok ? { ...outcome, destination: chosen } : outcome;
        },
        importLibrary: async () => {
            const initialBase = baseDirectory();
            const chosen = await (options.chooseLibraryFolder?.(initialBase) ?? Promise.resolve(null));
            if (chosen === null) {
                return { ok: false, reason: 'cancelled' };
            }
            const currentBase = baseDirectory();
            const allowed = options.scanFiles === undefined ? isRealPathInside(chosen, currentBase, options.platform) : isInsideDirectory(chosen, currentBase, options.platform);
            if (!allowed) {
                return { ok: false, reason: 'outside', folder: currentBase };
            }
            const scan = await scanMangaLibraryFolder(chosen, options.scanFiles, options.platform);
            const summary = importMangaLibrary(db, scan, {
                pathSize,
                onMangaSaved: refreshMetadata
            });
            return { ok: true, ...summary };
        },
        refreshMetadata,
        cleanupStaleMetadata: (folders) => {
            if (folders.length === 0) {
                return;
            }
            const activeFolders = new Set<string>();
            db.list().forEach((manga) => {
                manga.chapters.forEach((chapter) => {
                    if (hasChapterFile(chapter.status) && chapter.filePath !== null) {
                        activeFolders.add(dirname(chapter.filePath));
                    }
                });
            });
            new Set(folders).forEach((folder) => {
                if (activeFolders.has(folder)) {
                    return;
                }
                removeMetadataIfRegularFile(join(folder, MANGA_METADATA_FILE));
                try {
                    if (readdirSync(folder).length === 0) {
                        rmdirSync(folder);
                    }
                } catch {
                    return;
                }
            });
        },
        renameFolder: (manga, title) => {
            return renameMangaFolder({
                db,
                files: options.migrationFiles,
                platform: options.platform,
                manga,
                currentFolder: mangaDirectory(baseDirectory(), manga.title, options.platform),
                newFolder: mangaDirectory(baseDirectory(), title, options.platform)
            });
        },
        onLibraryChanged: notifyLibraryChanged
    };
    const checker = new MangaUpdateChecker({
        db,
        fetchManga: async (remoteId) => {
            const result = await service.details(remoteId);
            if (!result.ok) {
                throw new Error(result.error.message);
            }
            return result.value;
        },
        installedSourceIds: async () => {
            const sources = await service.sources();
            return sources.ok
                ? new Set(
                      sources.value.map((source) => {
                          return source.id;
                      })
                  )
                : null;
        },
        isEnabled: () => {
            return options.getSettings().mangaCheckNewChapters;
        },
        firstDelayMs: options.checkTimes?.firstMs,
        intervalMs: options.checkTimes?.everyMs,
        autoDownload: () => {
            return options.getSettings().mangaAutoDownloadNew;
        },
        download: (mangaId, chapterRemoteIds) => {
            queue.downloadChapters(mangaId, chapterRemoteIds);
        },
        onNewChapters: (news) => {
            send(IPC.eventMangaNewChapters, news);
        },
        onLibraryChanged: notifyLibraryChanged,
        onProgress: (state) => {
            send(IPC.eventMangaCheckState, state);
        }
    });
    return {
        service,
        queue,
        db,
        handlers,
        checker,
        updates,
        pageHandler: createMangaProtocolHandler(
            {
                fileOf,
                read: (path, index) => {
                    return localPages.read(path, index);
                }
            },
            {
                fileOf: (mangaId) => {
                    return covers.fileOf(mangaId);
                },
                read: (path) => {
                    return covers.read(path);
                }
            },
            {
                fileOf: (key) => {
                    return icons.fileOf(key);
                },
                read: (path) => {
                    return icons.read(path);
                }
            }
        ),
        hasProcessesToEnd: () => {
            return service.hasProcessesToEnd;
        },
        prepare: () => {
            void service.install().then(() => {
                if (spec !== null && installer.isReady(spec)) {
                    installer.removeOthers(spec);
                    if (db.wasUsed) {
                        service.warmUp();
                    }
                }
            });
            checker.start();
        },
        shutdown: async () => {
            checker.stop();
            await Promise.all([queue.shutdown(), repair.shutdown(), service.shutdown(), monitor?.stop()]);
        }
    };
}
