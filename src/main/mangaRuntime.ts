import { existsSync, mkdirSync, readdirSync, rmdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { IPC } from '@shared/constants';
import { isMangaSupported } from '@shared/manga';
import type { Settings } from '@shared/types';
import type { MangaHandlerDependencies } from './ipc/registerMangaHandlers';
import { MangaChapterDownloader } from './services/manga/mangaChapterDownloader';
import { MangaDb } from './services/manga/mangaDb';
import { MangaDownloadQueue } from './services/manga/mangaDownloadQueue';
import { COMIC_INFO_FILE, DEFAULT_MANGA_FOLDER, mangaDirectory } from './services/manga/mangaFiles';
import { createImageFetcher } from './services/manga/mangaImages';
import { LocalPages } from './services/manga/localPages';
import { createPageHandler } from './services/manga/mangaPageProtocol';
import { MangaReader } from './services/manga/mangaReader';
import { MangaService } from './services/manga/mangaService';
import { SuwayomiClient } from './services/manga/suwayomiClient';
import { CloudflareMonitor } from './services/tools/cloudflareMonitor';
import { FlareSolverrDocker, type FlareSolverrDockerDependencies } from './services/tools/flaresolverrDocker';
import { suwayomiSpec } from './services/tools/suwayomiRelease';
import { SuwayomiServer, type SuwayomiServerDependencies } from './services/tools/suwayomiServer';
import { ToolInstaller, type ToolInstallerDependencies } from './services/tools/toolInstaller';

export interface MangaRuntimeOptions {
    platform: NodeJS.Platform;
    arch: string;
    // userData: the library lives in <dataDir>/manga.
    dataDir: string;
    defaultDownloadDir: string;
    getSettings: () => Settings;
    send: (channel: string, payload?: unknown) => void;
    // Opens a folder in the file manager of the system (the tests replace it).
    openFolder: (path: string) => void;
    // A server that is already running: nothing is downloaded and nothing is started (used by the end-to-end tests).
    externalBaseUrl?: string | null;
    // How the program is downloaded and how the server is started (the tests replace them).
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
    // Serves the pages of the chapters of the library to the screen (registered for the scheme of the pages).
    pageHandler: (request: Request) => Promise<Response>;
    // Downloads the program in the background when it is not there (done when the app opens).
    prepare: () => void;
    // Whether the server or the container of the helper is up, which the app ends before it quits.
    hasProcessesToEnd: () => boolean;
    // Ends the downloads and the server (done when the app closes).
    shutdown: () => Promise<void>;
}

// The pages of a chapter are made by the app, so only what it made is deleted: a CBZ file, or a folder that has the ComicInfo.
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
        // The folder of the manga goes too when nothing else is in it.
        try {
            if (readdirSync(dirname(path)).length === 0) {
                rmdirSync(dirname(path));
            }
        } catch {
            return;
        }
    }
}

// Wires the manga section, or null where it does not exist.
export function createMangaRuntime(options: MangaRuntimeOptions): MangaRuntime | null {
    const spec = suwayomiSpec(options.platform, options.arch);
    const external = options.externalBaseUrl ?? null;
    if (!isMangaSupported(options.platform, options.arch) && external === null) {
        return null;
    }
    const root = join(options.dataDir, 'manga');
    const db = new MangaDb(join(root, 'manga.db'));
    // What was going on when the app last closed did not finish.
    db.failInterrupted();
    const installer = new ToolInstaller({
        rootDirectory: join(root, 'tools'),
        onState: (state) => {
            options.send(IPC.eventMangaTool, state);
        },
        ...options.toolDependencies
    });
    // FlareSolverr gets the server past the check of Cloudflare that some sites have. It runs in Docker (nothing to install besides Docker),
    // its image is pulled when the app opens and the container is started when the server starts; without it those sites answer that the
    // bypass is disabled. The user can give the address of a FlareSolverr of their own instead.
    const helper =
        isMangaSupported(options.platform, options.arch) && external === null
            ? new FlareSolverrDocker({
                  onState: (state) => {
                      options.send(IPC.eventMangaTool, state);
                  },
                  ...options.helperDependencies
              })
            : null;
    const externalHelper = (): string => {
        return options.getSettings().mangaFlaresolverrUrl;
    };
    // The server reaches FlareSolverr through a monitor, which tells the screen when a check of Cloudflare is going on.
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
        // The container is started first, so one that cannot start is told now and not at the first check.
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
    // The client and the service need each other: the client asks the service for the address of the server.
    const holder: { service: MangaService | null } = { service: null };
    const baseUrl = (): Promise<string> => {
        return holder.service!.requireServer();
    };
    const client = new SuwayomiClient({ baseUrl, fetchImpl: options.fetchImpl });
    const service = new MangaService({
        spec,
        helper,
        externalHelper,
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
    const queue = new MangaDownloadQueue({
        db,
        download: (downloadOptions) => {
            return downloader.download(downloadOptions);
        },
        getSettings: () => {
            const settings = options.getSettings();
            return { maxConcurrent: settings.maxConcurrent, mangaDirectory: settings.mangaDirectory, mangaFormat: settings.mangaFormat };
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
        onJobUpdate: (job) => {
            send(IPC.eventMangaJob, job);
        },
        onLibraryChanged: () => {
            send(IPC.eventMangaLibrary);
        }
    });
    const baseDirectory = (): string => {
        const configured = options.getSettings().mangaDirectory;
        return configured.length > 0 ? configured : join(options.defaultDownloadDir, DEFAULT_MANGA_FOLDER);
    };
    const localPages = new LocalPages();
    const fileOf = (chapterId: number): string | null => {
        const chapter = db.getChapter(chapterId);
        return chapter !== null && chapter.status === 'done' ? chapter.filePath : null;
    };
    const reader = new MangaReader({
        fileOf,
        localPages,
        remotePages: (chapterRemoteId) => {
            return service.pagesOf(chapterRemoteId);
        }
    });
    const handlers: MangaHandlerDependencies = {
        service,
        queue,
        db,
        reader,
        removeChapterFiles: (paths) => {
            paths.forEach(removeChapterPath);
        },
        folderOf: (mangaId) => {
            const manga = db.getLibraryManga(mangaId);
            if (manga === null) {
                return null;
            }
            const downloaded = manga.chapters.find((chapter) => {
                return chapter.status === 'done' && chapter.filePath !== null;
            });
            return downloaded?.filePath != null ? dirname(downloaded.filePath) : mangaDirectory(baseDirectory(), manga.title, options.platform);
        },
        openFolder: options.openFolder,
        onLibraryChanged: () => {
            send(IPC.eventMangaLibrary);
        }
    };
    return {
        service,
        queue,
        db,
        handlers,
        pageHandler: createPageHandler({
            fileOf,
            read: (path, index) => {
                return localPages.read(path, index);
            }
        }),
        hasProcessesToEnd: () => {
            return service.hasProcessesToEnd;
        },
        prepare: () => {
            void service.install();
        },
        shutdown: async () => {
            await Promise.all([queue.shutdown(), service.shutdown(), monitor?.stop()]);
        }
    };
}
