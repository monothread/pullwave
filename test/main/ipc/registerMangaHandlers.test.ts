import type { LibraryManga, MangaChapter, MangaDetails, MangaDetailsWithChapters, MangaJob, MangaMigrationResponse, MangaResult, MangaStatusInfo } from '@shared/manga';
import { IPC } from '@shared/constants';
import { registerMangaHandlers, type MangaHandlerDependencies } from '@main/ipc/registerMangaHandlers';
import type { IpcMainLike } from '@main/ipc/registerHandlers';
import type { ChapterDownloadHandle, ChapterDownloadOptions } from '@main/services/manga/mangaChapterDownloader';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MangaCovers } from '@main/services/manga/mangaCovers';
import { MangaDb } from '@main/services/manga/mangaDb';
import { MangaDownloadQueue } from '@main/services/manga/mangaDownloadQueue';
import { cleanTempDirs, makeTempDir } from '../../helpers/tempDir';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function makeIpc(): { ipcMain: IpcMainLike; call: (channel: string, ...args: unknown[]) => unknown; channels: () => string[] } {
    const handlers = new Map<string, Handler>();
    return {
        ipcMain: {
            handle: (channel, listener) => {
                handlers.set(channel, listener);
            }
        },
        call: (channel, ...args) => {
            const handler = handlers.get(channel);
            if (!handler) {
                throw new Error(`No handler for ${channel}`);
            }
            return handler({}, ...args);
        },
        channels: () => {
            return [...handlers.keys()].sort();
        }
    };
}

const MANGA_CHANNELS = [
    IPC.mangaAddToLibrary,
    IPC.mangaCancel,
    IPC.mangaClearFinished,
    IPC.mangaDetails,
    IPC.mangaDownload,
    IPC.mangaDownloadMissing,
    IPC.mangaExtensionChange,
    IPC.mangaExtensions,
    IPC.mangaExtensionsUpdateAll,
    IPC.mangaHelperInstall,
    IPC.mangaHelperRemove,
    IPC.mangaInstall,
    IPC.mangaJobs,
    IPC.mangaGroupCreate,
    IPC.mangaGroupDelete,
    IPC.mangaGroupMembers,
    IPC.mangaGroupRename,
    IPC.mangaGroups,
    IPC.mangaMigrateFolder,
    IPC.mangaMigrateSource,
    IPC.mangaOpenSite,
    IPC.mangaRenameSeries,
    IPC.mangaSetSeries,
    IPC.mangaLibrary,
    IPC.mangaList,
    IPC.mangaOpenFolder,
    IPC.mangaPause,
    IPC.mangaRemoveDownload,
    IPC.mangaRemoveManga,
    IPC.mangaResume,
    IPC.mangaRetry,
    IPC.mangaSourcePreferenceSet,
    IPC.mangaSourceFilters,
    IPC.mangaReadPages,
    IPC.mangaSourcePreferences,
    IPC.mangaSources,
    IPC.mangaStatus,
    IPC.mangaStoreAdd,
    IPC.mangaStoreRemove,
    IPC.mangaStores,
    IPC.mangaToolsCheck,
    IPC.mangaServerUpdate,
    IPC.mangaServerReset,
    IPC.mangaHelperUpdate,
    IPC.mangaRestart,
    IPC.mangaHealth
].sort();

const BASE = 'http://127.0.0.1:4321';
const READY_STATUS: MangaStatusInfo = { supported: true, tool: null, helper: null, helperProblem: null, helperExternal: false, server: 'running', serverError: null };

function chapter(remoteId: number): MangaChapter {
    return { remoteId, name: `Chapter ${remoteId}`, number: remoteId, dateUploaded: null, scanlator: null, sourceOrder: remoteId };
}

const REQUEST = {
    manga: { remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: `${BASE}/api/v1/manga/7/thumbnail` },
    details: { remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: `${BASE}/api/v1/manga/7/thumbnail`, author: 'Oda', artist: null, description: null, genres: ['Action'], status: 'ongoing' },
    chapters: [chapter(1), chapter(2)]
};

function setup(options: { baseUrl?: string | null; folder?: string | null; migrate?: () => Promise<MangaMigrationResponse>; coverFetch?: (url: string) => Promise<Response> } = {}) {
    const db = new MangaDb(':memory:', () => {
        return 1000;
    });
    const downloads: ChapterDownloadOptions[] = [];
    const removedFiles: string[][] = [];
    const opened: string[] = [];
    const sites: string[] = [];
    const libraryChanges = { count: 0 };
    const queue = new MangaDownloadQueue({
        db,
        download: (downloadOptions): ChapterDownloadHandle => {
            downloads.push(downloadOptions);
            return { result: new Promise(() => {return undefined}), cancel: vi.fn() };
        },
        getSettings: () => {
            return { maxConcurrent: 2, mangaDirectory: '', mangaFormat: 'cbz' };
        },
        defaultDownloadDir: '/home/me/Downloads',
        platform: 'linux',
        ensureDirectory: () => {return undefined},
        pathExists: () => {
            return false;
        },
        removePath: () => {return undefined},
        onJobUpdate: () => {return undefined},
        onLibraryChanged: () => {
            libraryChanges.count += 1;
        }
    });
    const service = {
        status: vi.fn((): MangaStatusInfo => {
            return READY_STATUS;
        }),
        install: vi.fn(() => {
            return Promise.resolve(null);
        }),
        stores: vi.fn(() => {
            return Promise.resolve({ ok: true as const, value: [] });
        }),
        addStore: vi.fn((indexUrl: string) => {
            return Promise.resolve({ ok: true as const, value: { indexUrl, name: 'K' } });
        }),
        removeStore: vi.fn(() => {
            return Promise.resolve({ ok: true as const, value: null });
        }),
        extensions: vi.fn(() => {
            return Promise.resolve({ ok: true as const, value: [] });
        }),
        changeExtension: vi.fn(() => {
            return Promise.resolve({ ok: true as const, value: null });
        }),
        updateAllExtensions: vi.fn(() => {
            return Promise.resolve({ ok: true as const, value: 2 });
        }),
        installHelper: vi.fn(() => {
            return Promise.resolve();
        }),
        removeHelper: vi.fn(() => {
            return Promise.resolve();
        }),
        sources: vi.fn(() => {
            return Promise.resolve({ ok: true as const, value: [] });
        }),
        sourcePreferences: vi.fn(() => {
            return Promise.resolve({ ok: true as const, value: [] });
        }),
        sourceFilters: vi.fn(() => {
            return Promise.resolve({ ok: true as const, value: [] });
        }),
        setSourcePreference: vi.fn(() => {
            return Promise.resolve({ ok: true as const, value: [] });
        }),
        list: vi.fn(() => {
            return Promise.resolve({ ok: true as const, value: { items: [], hasNextPage: false } });
        }),
        details: vi.fn((): Promise<MangaResult<MangaDetailsWithChapters>> => {
            return Promise.resolve({ ok: false, error: { code: 'NOT_FOUND', message: 'none' } });
        }),
        health: vi.fn(() => {
            return Promise.resolve({ server: { state: 'healthy' as const, version: 'v1', message: null, external: false }, helper: null });
        }),
        warmUp: vi.fn(),
        baseUrl: options.baseUrl === undefined ? BASE : options.baseUrl
    };
    const reader = {
        pages: vi.fn(() => {
            return Promise.resolve({ ok: true as const, value: { pages: ['pullwave-manga://page/3/0'], local: true } });
        })
    };
    const updates = {
        check: vi.fn(() => {
            return Promise.resolve({ suwayomi: { current: 'v1', latest: 'v2', error: null, updatable: true, chosen: false, bundled: 'v1', restartNeeded: false }, flaresolverr: null });
        }),
        updateServer: vi.fn(() => {
            return Promise.resolve({ ok: true as const, version: 'v2' });
        }),
        resetServer: vi.fn(),
        updateHelper: vi.fn(() => {
            return Promise.resolve({ ok: false as const, reason: 'not-installed' as const, message: null });
        })
    };
    const restarts = { count: 0 };
    const coverRequests: string[] = [];
    const covers = new MangaCovers({
        directory: join(makeTempDir(), 'covers'),
        db,
        baseUrl: () => {
            return service.baseUrl;
        },
        fetchImpl: ((input: string | URL | Request) => {
            coverRequests.push(String(input));
            return options.coverFetch === undefined ? Promise.reject(new Error('offline')) : options.coverFetch(String(input));
        }) as typeof fetch
    });
    const deps: MangaHandlerDependencies = {
        service,
        updates,
        covers,
        restartApp: () => {
            restarts.count += 1;
        },
        queue,
        db,
        reader,
        removeChapterFiles: (paths) => {
            removedFiles.push(paths);
        },
        folderOf: () => {
            return options.folder === undefined ? '/home/me/Downloads/Pullwave Manga/One Piece' : options.folder;
        },
        openFolder: (path) => {
            opened.push(path);
        },
        openSite: (url) => {
            sites.push(url);
        },
        migrateFolder: () => {
            return options.migrate === undefined ? Promise.resolve<MangaMigrationResponse>({ ok: true, chapters: 2, files: 2, destination: '/new' }) : options.migrate();
        },
        onLibraryChanged: () => {
            libraryChanges.count += 1;
        }
    };
    const ipc = makeIpc();
    registerMangaHandlers(ipc.ipcMain, deps);
    return { ...ipc, db, queue, service, reader, downloads, removedFiles, opened, sites, libraryChanges, updates, restarts, covers, coverRequests };
}

afterEach(() => {
    cleanTempDirs();
});

describe('registerMangaHandlers', () => {
    it('registers every channel of the manga section', () => {
        expect(setup().channels()).toEqual(MANGA_CHANNELS);
    });

    it('answers that the section does not exist where it does not', async () => {
        const ipc = makeIpc();
        registerMangaHandlers(ipc.ipcMain, null);
        expect(ipc.channels()).toEqual(MANGA_CHANNELS);
        expect(ipc.call(IPC.mangaStatus)).toEqual({ supported: false, tool: null, helper: null, helperProblem: null, helperExternal: false, server: 'stopped', serverError: null });
        expect(ipc.call(IPC.mangaInstall)).toBeNull();
        const unsupported = { ok: false, error: { code: 'UNKNOWN', message: 'The manga section is only available on Linux and Windows (64 bits).' } };
        [IPC.mangaStores, IPC.mangaStoreAdd, IPC.mangaStoreRemove, IPC.mangaExtensions, IPC.mangaExtensionChange, IPC.mangaSources, IPC.mangaSourcePreferences, IPC.mangaSourcePreferenceSet, IPC.mangaSourceFilters, IPC.mangaList, IPC.mangaDetails].forEach((channel) => {
            expect(ipc.call(channel)).toEqual(unsupported);
        });
        expect(ipc.call(IPC.mangaExtensionsUpdateAll)).toEqual(unsupported);
        expect(ipc.call(IPC.mangaOpenSite)).toBeUndefined();
        expect(ipc.call(IPC.mangaToolsCheck)).toEqual({ suwayomi: { current: '', latest: null, error: null, updatable: false, chosen: false, bundled: '', restartNeeded: false }, flaresolverr: null });
        expect(ipc.call(IPC.mangaServerUpdate)).toEqual({ ok: false, reason: 'unsupported', message: null });
        expect(ipc.call(IPC.mangaHelperUpdate)).toEqual({ ok: false, reason: 'unsupported', message: null });
        expect(ipc.call(IPC.mangaServerReset)).toBeUndefined();
        expect(ipc.call(IPC.mangaRestart)).toBeUndefined();
        expect(ipc.call(IPC.mangaHealth)).toEqual({ server: { state: 'not-installed', version: null, message: null, external: false }, helper: null });
        expect(ipc.call(IPC.mangaSetSeries)).toEqual({ ok: false, reason: 'invalid' });
        expect(ipc.call(IPC.mangaRenameSeries)).toEqual({ ok: false, reason: 'invalid' });
        expect(ipc.call(IPC.mangaGroups)).toEqual([]);
        expect(ipc.call(IPC.mangaGroupCreate)).toEqual({ ok: false, reason: 'invalid' });
        expect(ipc.call(IPC.mangaGroupRename)).toEqual({ ok: false, reason: 'invalid' });
        expect(ipc.call(IPC.mangaGroupDelete)).toBeUndefined();
        expect(ipc.call(IPC.mangaGroupMembers)).toBeUndefined();
        expect(ipc.call(IPC.mangaMigrateSource)).toEqual({ ok: false, reason: 'invalid' });
        expect(ipc.call(IPC.mangaMigrateFolder)).toEqual({ ok: false, reason: 'failed' });
        expect(ipc.call(IPC.mangaHelperInstall)).toBeUndefined();
        expect(ipc.call(IPC.mangaHelperRemove)).toBeUndefined();
        expect(ipc.call(IPC.mangaAddToLibrary)).toBeNull();
        expect(ipc.call(IPC.mangaDownload)).toBeNull();
        expect(ipc.call(IPC.mangaLibrary)).toEqual([]);
        expect(ipc.call(IPC.mangaJobs)).toEqual([]);
        [IPC.mangaDownloadMissing, IPC.mangaCancel, IPC.mangaRetry, IPC.mangaPause, IPC.mangaResume, IPC.mangaClearFinished, IPC.mangaRemoveDownload, IPC.mangaRemoveManga, IPC.mangaOpenFolder].forEach((channel) => {
            expect(ipc.call(channel)).toBeUndefined();
        });
    });
});

describe('the extension channels', () => {
    it('answers the status and installs on request', async () => {
        const { call, service } = setup();
        expect(call(IPC.mangaStatus)).toEqual(READY_STATUS);
        await expect(call(IPC.mangaInstall)).resolves.toBeNull();
        expect(service.install).toHaveBeenCalledTimes(1);
    });

    it('updates every extension that has an update, and installs or removes the helper for Cloudflare', async () => {
        const { call, service } = setup();
        await expect(call(IPC.mangaExtensionsUpdateAll)).resolves.toEqual({ ok: true, value: 2 });
        expect(service.updateAllExtensions).toHaveBeenCalledTimes(1);
        await call(IPC.mangaHelperInstall);
        expect(service.installHelper).toHaveBeenCalledTimes(1);
        await call(IPC.mangaHelperRemove);
        expect(service.removeHelper).toHaveBeenCalledTimes(1);
    });

    it('lists, adds and removes stores', async () => {
        const { call, service } = setup();
        await call(IPC.mangaStores);
        expect(service.stores).toHaveBeenCalledTimes(1);
        await expect(call(IPC.mangaStoreAdd, ' https://a.example/index.min.json ')).resolves.toEqual({ ok: true, value: { indexUrl: 'https://a.example/index.min.json', name: 'K' } });
        expect(service.addStore).toHaveBeenCalledWith('https://a.example/index.min.json');
        await call(IPC.mangaStoreRemove, 'https://a.example/index.min.json');
        expect(service.removeStore).toHaveBeenCalledWith('https://a.example/index.min.json');
    });

    it.each([['ftp://a/b'], ['javascript:alert(1)'], [''], [5], [null]])('refuses the store address %j', (address) => {
        const { call, service } = setup();
        const invalid = { ok: false, error: { code: 'INVALID_REQUEST' } };
        expect(call(IPC.mangaStoreAdd, address)).toMatchObject(invalid);
        expect(call(IPC.mangaStoreRemove, address)).toMatchObject(invalid);
        expect(service.addStore).not.toHaveBeenCalled();
        expect(service.removeStore).not.toHaveBeenCalled();
    });

    it('lists the extensions, refreshing only when asked to with true', async () => {
        const { call, service } = setup();
        await call(IPC.mangaExtensions, true);
        await call(IPC.mangaExtensions, 'yes');
        await call(IPC.mangaExtensions);
        expect(service.extensions.mock.calls).toEqual([[true], [false], [false]]);
    });

    it('installs, updates and removes an extension', async () => {
        const { call, service } = setup();
        await call(IPC.mangaExtensionChange, 'eu.kanade.x', 'install');
        expect(service.changeExtension).toHaveBeenCalledWith('eu.kanade.x', 'install');
    });

    it.each([[5, 'install'], ['a b', 'install'], ['eu.kanade.x', 'delete'], ['eu.kanade.x', null], [null, null]])('refuses the extension change %j %j', (pkg, action) => {
        const { call, service } = setup();
        expect(call(IPC.mangaExtensionChange, pkg, action)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
        expect(service.changeExtension).not.toHaveBeenCalled();
    });

    it('lists the sources', async () => {
        const { call, service } = setup();
        await call(IPC.mangaSources);
        expect(service.sources).toHaveBeenCalledTimes(1);
    });
});

describe('reading a chapter', () => {
    it('gives the pages of the chapter on the server, or of its file when it is in the library', async () => {
        const { call, reader } = setup();
        await expect(call(IPC.mangaReadPages, { chapterRemoteId: 11, libraryChapterId: 3 })).resolves.toEqual({ ok: true, value: { pages: ['pullwave-manga://page/3/0'], local: true } });
        expect(reader.pages).toHaveBeenCalledWith({ chapterRemoteId: 11, libraryChapterId: 3 });
        await call(IPC.mangaReadPages, { chapterRemoteId: 12 });
        expect(reader.pages).toHaveBeenLastCalledWith({ chapterRemoteId: 12, libraryChapterId: null });
    });

    it.each([[null], ['x'], [{}], [{ chapterRemoteId: 0 }], [{ chapterRemoteId: 1, libraryChapterId: 'a' }], [{ chapterRemoteId: 1, libraryChapterId: 0 }]])('refuses %j', (request) => {
        const { call, reader } = setup();
        expect(call(IPC.mangaReadPages, request)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST', message: 'The chapter is not valid.' } });
        expect(reader.pages).not.toHaveBeenCalled();
    });
});

describe('the filters of a source', () => {
    it('reads them by the id of the source', async () => {
        const { call, service } = setup();
        await expect(call(IPC.mangaSourceFilters, '123')).resolves.toEqual({ ok: true, value: [] });
        expect(service.sourceFilters).toHaveBeenCalledWith('123');
    });

    it.each([[5], ['abc'], [null], ['']])('refuses the source %j', (sourceId) => {
        const { call, service } = setup();
        expect(call(IPC.mangaSourceFilters, sourceId)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST', message: 'The source is not valid.' } });
        expect(service.sourceFilters).not.toHaveBeenCalled();
    });
});

describe('the settings of a source', () => {
    it('reads them by the id of the source', async () => {
        const { call, service } = setup();
        await call(IPC.mangaSourcePreferences, '123');
        expect(service.sourcePreferences).toHaveBeenCalledWith('123');
    });

    it.each([[5], ['abc'], [null], ['']])('refuses the source %j', (sourceId) => {
        const { call, service } = setup();
        expect(call(IPC.mangaSourcePreferences, sourceId)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST', message: 'The source is not valid.' } });
        expect(service.sourcePreferences).not.toHaveBeenCalled();
    });

    it('changes one of them', async () => {
        const { call, service } = setup();
        await call(IPC.mangaSourcePreferenceSet, { sourceId: '123', position: 0, type: 'text', value: 'http://x:4567' });
        expect(service.setSourcePreference).toHaveBeenCalledWith({ sourceId: '123', position: 0, type: 'text', value: 'http://x:4567' });
    });

    it.each([[null], [{ sourceId: '123', position: 0, type: 'switch', value: 'on' }], [{ sourceId: 'x', position: 0, type: 'text', value: 'a' }], [{ sourceId: '1', position: -3, type: 'text', value: 'a' }]])('refuses the change %j', (change) => {
        const { call, service } = setup();
        expect(call(IPC.mangaSourcePreferenceSet, change)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST', message: 'The change to the setting is not valid.' } });
        expect(service.setSourcePreference).not.toHaveBeenCalled();
    });
});

describe('the browsing channels', () => {
    it('lists the mangas of a source', async () => {
        const { call, service } = setup();
        await call(IPC.mangaList, { sourceId: '123', kind: 'search', page: 2, query: ' naruto ' });
        expect(service.list).toHaveBeenCalledWith({ sourceId: '123', kind: 'search', page: 2, query: 'naruto' });
    });

    it.each([[null], [{ sourceId: 'x', kind: 'popular', page: 1 }], [{ sourceId: '1', kind: 'nope', page: 1 }], [{ sourceId: '1', kind: 'popular', page: 0 }]])('refuses the request %j', (request) => {
        const { call, service } = setup();
        expect(call(IPC.mangaList, request)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST', message: 'The request for the list is not valid.' } });
        expect(service.list).not.toHaveBeenCalled();
    });

    it('refuses a search with nothing to search for', () => {
        const { call, service } = setup();
        expect(call(IPC.mangaList, { sourceId: '1', kind: 'search', page: 1, query: '   ' })).toMatchObject({ ok: false, error: { message: 'The search is empty.' } });
        expect(call(IPC.mangaList, { sourceId: '1', kind: 'search', page: 1, query: '', filters: [] })).toMatchObject({ ok: false, error: { message: 'The search is empty.' } });
        expect(service.list).not.toHaveBeenCalled();
    });

    it('accepts a search with no text when it has filters, and passes them on', async () => {
        const { call, service } = setup();
        const filters = [{ type: 'checkbox', name: 'Has chapters', value: true }];
        await call(IPC.mangaList, { sourceId: '1', kind: 'search', page: 1, query: '', filters });
        expect(service.list).toHaveBeenCalledWith({ sourceId: '1', kind: 'search', page: 1, query: '', filters });
    });

    it('refuses a request whose filters are not valid', () => {
        const { call, service } = setup();
        expect(call(IPC.mangaList, { sourceId: '1', kind: 'search', page: 1, query: 'x', filters: [{ type: 'slider', name: 'x' }] })).toMatchObject({ ok: false, error: { message: 'The request for the list is not valid.' } });
        expect(service.list).not.toHaveBeenCalled();
    });

    it('gives the details of a manga', async () => {
        const { call, service } = setup();
        await expect(call(IPC.mangaDetails, 7)).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
        expect(service.details).toHaveBeenCalledWith(7);
        expect(call(IPC.mangaDetails, 'x')).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST', message: 'The manga is not valid.' } });
        expect(call(IPC.mangaDetails, 0)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    });
});

describe('the library channels', () => {
    it('downloads chapters: keeps the cover as a path, starts the first and gives the manga with the cover of the moment', () => {
        const { call, db, downloads } = setup();
        const result = call(IPC.mangaDownload, REQUEST) as LibraryManga;
        expect(result).toMatchObject({ title: 'One Piece', author: 'Oda', thumbnailUrl: `${BASE}/api/v1/manga/7/thumbnail` });
        expect(result.chapters.map((item) => {
            return [item.remoteId, item.status];
        })).toEqual([[2, 'queued'], [1, 'downloading']]);
        expect(db.list()[0]?.thumbnailUrl).toBe('/api/v1/manga/7/thumbnail');
        expect(downloads).toHaveLength(1);
        expect(downloads[0]?.chapterRemoteId).toBe(1);
    });

    it('puts a manga in the library without downloading anything', () => {
        const { call, db, downloads } = setup();
        const result = call(IPC.mangaAddToLibrary, REQUEST) as LibraryManga;
        expect(result.chapters.map((item) => {
            return item.status;
        })).toEqual(['idle', 'idle']);
        expect(db.list()[0]).toMatchObject({ thumbnailUrl: '/api/v1/manga/7/thumbnail', author: 'Oda' });
        expect(downloads).toHaveLength(0);
    });

    it.each([[null], ['x'], [{ manga: REQUEST.manga, chapters: [] }], [{ chapters: REQUEST.chapters }]])('refuses to download or add %j', (request) => {
        const { call, db } = setup();
        expect(call(IPC.mangaDownload, request)).toBeNull();
        expect(call(IPC.mangaAddToLibrary, request)).toBeNull();
        expect(db.list()).toEqual([]);
    });

    it('downloads what is missing of the mangas it is given, ignoring ids that are not ids', () => {
        const { call, db, downloads } = setup();
        call(IPC.mangaAddToLibrary, REQUEST);
        const id = db.list()[0]!.id;
        call(IPC.mangaDownloadMissing, [id, id, 'x', 0, 999]);
        // The oldest chapter goes first, and a source gives one chapter at a time.
        expect(downloads.map((item) => {
            return item.chapterRemoteId;
        })).toEqual([1]);
    });

    it('lists the library with the covers completed with the server of the moment', () => {
        const { call, service } = setup();
        call(IPC.mangaAddToLibrary, REQUEST);
        const library = call(IPC.mangaLibrary) as LibraryManga[];
        expect(library).toHaveLength(1);
        expect(library[0]?.thumbnailUrl).toBe(`${BASE}/api/v1/manga/7/thumbnail`);
        expect(service.warmUp).not.toHaveBeenCalled();
    });

    it('starts the server in the background when the covers need it, and gives them when it is up', () => {
        const { call, service, db } = setup({ baseUrl: null });
        db.upsertManga({ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: '/api/v1/manga/7/thumbnail' });
        db.upsertManga({ remoteId: 8, sourceId: '123', title: 'Bleach', thumbnailUrl: 'https://cdn.example/b.jpg' });
        const library = call(IPC.mangaLibrary) as LibraryManga[];
        expect(service.warmUp).toHaveBeenCalledTimes(1);
        expect(library.map((manga) => {
            return [manga.title, manga.thumbnailUrl];
        })).toEqual([['Bleach', 'https://cdn.example/b.jpg'], ['One Piece', null]]);
    });

    it('does not start the server for a library whose covers are whole addresses', () => {
        const { call, service, db } = setup({ baseUrl: null });
        db.upsertManga({ remoteId: 8, sourceId: '123', title: 'Bleach', thumbnailUrl: 'https://cdn.example/b.jpg' });
        db.upsertManga({ remoteId: 9, sourceId: '123', title: 'No cover', thumbnailUrl: null });
        call(IPC.mangaLibrary);
        expect(service.warmUp).not.toHaveBeenCalled();
    });

    it('lists the jobs', () => {
        const { call } = setup();
        call(IPC.mangaDownload, REQUEST);
        expect((call(IPC.mangaJobs) as MangaJob[]).map((job) => {
            return [job.chapterName, job.status];
        })).toEqual([['Chapter 1', 'running'], ['Chapter 2', 'queued']]);
    });

    it('pauses, resumes, cancels and retries by the id of a chapter, and ignores an id that is not one', () => {
        const { call, queue, db } = setup();
        call(IPC.mangaDownload, REQUEST);
        const spies = {
            cancel: vi.spyOn(queue, 'cancel'),
            retry: vi.spyOn(queue, 'retry'),
            pause: vi.spyOn(queue, 'pause'),
            resume: vi.spyOn(queue, 'resume')
        };
        const id = db.chaptersOf(1)[0]!.id;
        call(IPC.mangaCancel, id);
        call(IPC.mangaRetry, id);
        call(IPC.mangaPause, id);
        call(IPC.mangaResume, id);
        call(IPC.mangaCancel, 'x');
        call(IPC.mangaPause, 0);
        expect(spies.cancel.mock.calls).toEqual([[id]]);
        expect(spies.retry.mock.calls).toEqual([[id]]);
        expect(spies.pause.mock.calls).toEqual([[id]]);
        expect(spies.resume.mock.calls).toEqual([[id]]);
    });

    it('clears what is over', () => {
        const { call, queue } = setup();
        const spy = vi.spyOn(queue, 'clearFinished');
        call(IPC.mangaClearFinished);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('removes the download of a chapter: stops it, deletes its file, keeps the chapter as not downloaded and tells the library changed', () => {
        const { call, db, queue, removedFiles, libraryChanges } = setup();
        call(IPC.mangaAddToLibrary, REQUEST);
        const chapterId = db.chaptersOf(1)[0]!.id;
        db.markDone(chapterId, '/m/One Piece/Chapter 2.cbz', 10, 2);
        const forget = vi.spyOn(queue, 'forget');
        const before = libraryChanges.count;
        call(IPC.mangaRemoveDownload, chapterId);
        expect(forget).toHaveBeenCalledWith([chapterId]);
        expect(removedFiles).toEqual([['/m/One Piece/Chapter 2.cbz']]);
        expect(db.getChapter(chapterId)).toMatchObject({ status: 'idle', filePath: null });
        expect(libraryChanges.count).toBe(before + 1);
    });

    it('does nothing for a chapter that is not downloaded', () => {
        const { call, db, removedFiles, libraryChanges } = setup();
        call(IPC.mangaAddToLibrary, REQUEST);
        const before = libraryChanges.count;
        call(IPC.mangaRemoveDownload, db.chaptersOf(1)[0]!.id);
        expect(removedFiles).toEqual([]);
        expect(libraryChanges.count).toBe(before);
        expect(db.chaptersOf(1)).toHaveLength(2);
    });

    it('ignores the removal of a chapter or a manga that is not there', () => {
        const { call, removedFiles, libraryChanges } = setup();
        call(IPC.mangaRemoveDownload, 999);
        call(IPC.mangaRemoveDownload, 'x');
        call(IPC.mangaRemoveManga, 999);
        call(IPC.mangaRemoveManga, null);
        expect(removedFiles).toEqual([]);
        expect(libraryChanges.count).toBe(0);
    });

    it('removes a manga with all its chapters and their files', () => {
        const { call, db, queue, removedFiles } = setup();
        call(IPC.mangaAddToLibrary, REQUEST);
        const [first, second] = db.chaptersOf(1);
        db.markDone(first!.id, '/m/1.cbz', 1, 1);
        db.markDone(second!.id, '/m/2.cbz', 1, 1);
        const forget = vi.spyOn(queue, 'forget');
        call(IPC.mangaRemoveManga, 1);
        expect(forget).toHaveBeenCalledWith([first!.id, second!.id]);
        expect(removedFiles).toEqual([['/m/1.cbz', '/m/2.cbz']]);
        expect(db.getManga(1)).toBeNull();
    });

    it('opens the folder of a manga', () => {
        const { call, opened } = setup();
        call(IPC.mangaOpenFolder, 1);
        expect(opened).toEqual(['/home/me/Downloads/Pullwave Manga/One Piece']);
    });

    it('opens nothing when the folder is not known or the id is not an id', () => {
        const { call, opened } = setup({ folder: null });
        call(IPC.mangaOpenFolder, 1);
        call(IPC.mangaOpenFolder, 'x');
        expect(opened).toEqual([]);
    });
});

describe('the site and the folder of the mangas', () => {
    it('opens the page of a manga in the browser, only when it is an http or https address', () => {
        const { call, sites } = setup();
        call(IPC.mangaOpenSite, 'https://dex.example/manga/one-piece');
        call(IPC.mangaOpenSite, 'http://dex.example/a');
        call(IPC.mangaOpenSite, 'file:///etc/passwd');
        call(IPC.mangaOpenSite, 'javascript:alert(1)');
        call(IPC.mangaOpenSite, '');
        call(IPC.mangaOpenSite, 5);
        call(IPC.mangaOpenSite, null);
        expect(sites).toEqual(['https://dex.example/manga/one-piece', 'http://dex.example/a']);
    });

    it('looks for the latest versions of the server and of the helper', async () => {
        const { call, updates } = setup();
        await expect(call(IPC.mangaToolsCheck)).resolves.toEqual({ suwayomi: { current: 'v1', latest: 'v2', error: null, updatable: true, chosen: false, bundled: 'v1', restartNeeded: false }, flaresolverr: null });
        expect(updates.check).toHaveBeenCalledTimes(1);
        expect(updates.check).toHaveBeenCalledWith();
    });

    it('updates the server, goes back to the version the app ships with, and updates the helper', async () => {
        const { call, updates } = setup();
        await expect(call(IPC.mangaServerUpdate)).resolves.toEqual({ ok: true, version: 'v2' });
        expect(updates.updateServer).toHaveBeenCalledTimes(1);
        expect(call(IPC.mangaServerReset)).toBeUndefined();
        expect(updates.resetServer).toHaveBeenCalledTimes(1);
        await expect(call(IPC.mangaHelperUpdate)).resolves.toEqual({ ok: false, reason: 'not-installed', message: null });
        expect(updates.updateHelper).toHaveBeenCalledTimes(1);
    });

    it('restarts the app when the screen asks for it', () => {
        const { call, restarts } = setup();
        expect(call(IPC.mangaRestart)).toBeUndefined();
        expect(restarts.count).toBe(1);
    });

    it('asks the service for the health, starting what is stopped only when the screen says so', async () => {
        const { call, service } = setup();
        const healthy = { server: { state: 'healthy', version: 'v1', message: null, external: false }, helper: null };
        await expect(call(IPC.mangaHealth, true)).resolves.toEqual(healthy);
        await expect(call(IPC.mangaHealth, false)).resolves.toEqual(healthy);
        await expect(call(IPC.mangaHealth, 'yes')).resolves.toEqual(healthy);
        await expect(call(IPC.mangaHealth)).resolves.toEqual(healthy);
        expect(service.health.mock.calls).toEqual([[true], [false], [false], [false]]);
    });

    it('migrates the folder and tells the screen the library changed', async () => {
        const { call, libraryChanges } = setup();
        await expect(call(IPC.mangaMigrateFolder)).resolves.toEqual({ ok: true, chapters: 2, files: 2, destination: '/new' });
        expect(libraryChanges.count).toBe(1);
    });

    it('answers the reason when the migration does not happen', async () => {
        const { call } = setup({
            migrate: () => {
                return Promise.resolve({ ok: false, reason: 'cancelled' });
            }
        });
        await expect(call(IPC.mangaMigrateFolder)).resolves.toEqual({ ok: false, reason: 'cancelled' });
    });

    it('does not migrate while a chapter is being downloaded', async () => {
        const { call, queue, db, service } = setup();
        const migrate = vi.spyOn(queue, 'pendingCount').mockReturnValue(1);
        await expect(call(IPC.mangaMigrateFolder)).resolves.toEqual({ ok: false, reason: 'busy' });
        migrate.mockRestore();
        expect(db.list()).toEqual([]);
        expect(service.status).not.toHaveBeenCalled();
    });

    it('does one migration at a time, and starts nothing while the files are moved', async () => {
        let finish: (value: MangaMigrationResponse) => void = () => {return undefined};
        const { call, db, queue, downloads } = setup({
            migrate: () => {
                return new Promise((resolve) => {
                    finish = resolve;
                });
            }
        });
        const first = call(IPC.mangaMigrateFolder);
        await expect(call(IPC.mangaMigrateFolder)).resolves.toEqual({ ok: false, reason: 'busy' });
        // Downloads, retries, resumes and removals wait.
        expect(call(IPC.mangaDownload, REQUEST)).toBeNull();
        call(IPC.mangaDownloadMissing, [1]);
        call(IPC.mangaRetry, 1);
        call(IPC.mangaResume, 1);
        call(IPC.mangaRemoveDownload, 1);
        call(IPC.mangaRemoveManga, 1);
        expect(downloads).toEqual([]);
        expect(queue.list()).toEqual([]);
        expect(db.list()).toEqual([]);
        finish({ ok: true, chapters: 0, files: 0, destination: '/new' });
        await first;
        // Once it is over, the downloads work again.
        expect(call(IPC.mangaDownload, REQUEST)).not.toBeNull();
    });

    it('lets a download be paused or cancelled while the files are moved', async () => {
        let finish: (value: MangaMigrationResponse) => void = () => {return undefined};
        const { call, queue } = setup({
            migrate: () => {
                return new Promise((resolve) => {
                    finish = resolve;
                });
            }
        });
        const pause = vi.spyOn(queue, 'pause');
        const cancel = vi.spyOn(queue, 'cancel');
        const retry = vi.spyOn(queue, 'retry');
        const first = call(IPC.mangaMigrateFolder);
        call(IPC.mangaPause, 4);
        call(IPC.mangaCancel, 5);
        call(IPC.mangaRetry, 6);
        expect(pause).toHaveBeenCalledWith(4);
        expect(cancel).toHaveBeenCalledWith(5);
        expect(retry).not.toHaveBeenCalled();
        finish({ ok: false, reason: 'cancelled' });
        await first;
    });

    it('lets the next migration happen after one failed with an error', async () => {
        const { call } = setup({
            migrate: () => {
                return Promise.reject(new Error('disk'));
            }
        });
        await expect(call(IPC.mangaMigrateFolder)).rejects.toThrow('disk');
        await expect(call(IPC.mangaMigrateFolder)).rejects.toThrow('disk');
    });
});

describe('series, groups and the move to another source', () => {
    function addManga(context: ReturnType<typeof setup>, remoteId: number, title: string): number {
        return context.db.upsertManga({ remoteId, sourceId: '123', title, thumbnailUrl: `${BASE}/api/v1/manga/${remoteId}/thumbnail` }).id;
    }

    it('joins a manga to a series and tells the screen the library changed', () => {
        const context = setup();
        const id = addManga(context, 7, 'Frieren');
        expect(context.call(IPC.mangaSetSeries, { mangaId: id, series: ' Sousou  no Frieren ', season: 2, seasonName: 'Beyond' })).toEqual({ ok: true });
        expect(context.db.getManga(id)).toMatchObject({ series: 'Sousou no Frieren', season: 2, seasonName: 'Beyond' });
        expect(context.libraryChanges.count).toBe(1);
        expect(context.call(IPC.mangaSetSeries, { mangaId: id, series: null })).toEqual({ ok: true });
        expect(context.db.getManga(id)).toMatchObject({ series: null, season: null });
    });

    it('refuses a season another manga of the series has, and suggests the next one', () => {
        const context = setup();
        const first = addManga(context, 7, 'Frieren');
        const second = addManga(context, 8, 'Frieren 2');
        context.call(IPC.mangaSetSeries, { mangaId: first, series: 'Frieren', season: 1, seasonName: null });
        context.call(IPC.mangaSetSeries, { mangaId: second, series: 'Frieren', season: 2, seasonName: null });
        expect(context.call(IPC.mangaSetSeries, { mangaId: second, series: 'FRIEREN', season: 1, seasonName: null })).toEqual({ ok: false, reason: 'season-taken', suggested: 2 });
        expect(context.db.getManga(second)?.season).toBe(2);
    });

    it.each([[{ mangaId: 999, series: 'A', season: 1, seasonName: null }], [{ mangaId: 1, series: '', season: 1 }], [{ series: 'A', season: 1 }], ['x'], [null]])('refuses the series request %j', (request) => {
        const context = setup();
        addManga(context, 7, 'Frieren');
        expect(context.call(IPC.mangaSetSeries, request)).toEqual({ ok: false, reason: 'invalid' });
        expect(context.libraryChanges.count).toBe(0);
    });

    it('renames a series for the mangas in it', () => {
        const context = setup();
        const first = addManga(context, 7, 'Frieren');
        const second = addManga(context, 8, 'Frieren 2');
        context.call(IPC.mangaSetSeries, { mangaId: first, series: 'Frieren', season: 1, seasonName: null });
        context.call(IPC.mangaSetSeries, { mangaId: second, series: 'Frieren', season: 2, seasonName: null });
        expect(context.call(IPC.mangaRenameSeries, [first, second, 'x', -1], '  Sousou no Frieren ')).toEqual({ ok: true });
        expect(context.db.getManga(first)?.series).toBe('Sousou no Frieren');
        expect(context.db.getManga(second)).toMatchObject({ series: 'Sousou no Frieren', season: 2 });
    });

    it('says which season clashes when the new name is a series that has it', () => {
        const context = setup();
        const first = addManga(context, 7, 'A1');
        const second = addManga(context, 8, 'B1');
        context.call(IPC.mangaSetSeries, { mangaId: first, series: 'A', season: 1, seasonName: null });
        context.call(IPC.mangaSetSeries, { mangaId: second, series: 'B', season: 1, seasonName: null });
        expect(context.call(IPC.mangaRenameSeries, [second], 'A')).toEqual({ ok: false, reason: 'season-taken', manga: 'B1', season: 1, suggested: 2 });
    });

    it.each([[[], 'A'], [[1], ''], [[1], 5], ['x', 'A'], [[1], 'x'.repeat(101)]])('refuses to rename a series with %j and %j', (ids, name) => {
        const context = setup();
        addManga(context, 7, 'Frieren');
        expect(context.call(IPC.mangaRenameSeries, ids, name)).toEqual({ ok: false, reason: 'invalid' });
    });

    it('makes, lists, renames and deletes groups', () => {
        const context = setup();
        expect(context.call(IPC.mangaGroupCreate, '  Manhwas ')).toEqual({ ok: true, group: { id: 1, name: 'Manhwas' } });
        expect(context.call(IPC.mangaGroups)).toEqual([{ id: 1, name: 'Manhwas' }]);
        expect(context.call(IPC.mangaGroupRename, 1, 'Webtoons')).toEqual({ ok: true, group: { id: 1, name: 'Webtoons' } });
        context.call(IPC.mangaGroupDelete, 1);
        expect(context.call(IPC.mangaGroups)).toEqual([]);
        expect(context.libraryChanges.count).toBe(1);
    });

    it('refuses a group name that is empty, too long or taken, and a group that is not there', () => {
        const context = setup();
        context.call(IPC.mangaGroupCreate, 'Mangas');
        expect(context.call(IPC.mangaGroupCreate, '   ')).toEqual({ ok: false, reason: 'invalid' });
        expect(context.call(IPC.mangaGroupCreate, 'x'.repeat(61))).toEqual({ ok: false, reason: 'invalid' });
        expect(context.call(IPC.mangaGroupCreate, 'MANGAS')).toEqual({ ok: false, reason: 'taken' });
        context.call(IPC.mangaGroupCreate, 'Other');
        expect(context.call(IPC.mangaGroupRename, 2, 'mangas')).toEqual({ ok: false, reason: 'taken' });
        expect(context.call(IPC.mangaGroupRename, 99, 'Fine')).toEqual({ ok: false, reason: 'not-found' });
        expect(context.call(IPC.mangaGroupRename, 0, 'Fine')).toEqual({ ok: false, reason: 'invalid' });
        expect(context.call(IPC.mangaGroupRename, 2, '')).toEqual({ ok: false, reason: 'invalid' });
        expect(context.call(IPC.mangaGroups)).toHaveLength(2);
    });

    it('puts mangas in a group and takes them out', () => {
        const context = setup();
        const id = addManga(context, 7, 'Frieren');
        context.call(IPC.mangaGroupCreate, 'Mangas');
        context.call(IPC.mangaGroupMembers, 1, [id, 'x'], true);
        expect(context.db.groupIdsOf(id)).toEqual([1]);
        context.call(IPC.mangaGroupMembers, 1, [id], false);
        expect(context.db.groupIdsOf(id)).toEqual([]);
        expect(context.libraryChanges.count).toBe(2);
    });

    it('ignores a change of members that is not valid', () => {
        const context = setup();
        const id = addManga(context, 7, 'Frieren');
        context.call(IPC.mangaGroupCreate, 'Mangas');
        context.call(IPC.mangaGroupMembers, 0, [id], true);
        context.call(IPC.mangaGroupMembers, 1, [id], 'yes');
        context.call(IPC.mangaGroupDelete, 'x');
        expect(context.db.groupIdsOf(id)).toEqual([]);
        expect(context.libraryChanges.count).toBe(0);
    });

    describe('moving a manga to another source', () => {
        const TARGET = {
            manga: { remoteId: 70, sourceId: '999', title: 'One Piece', thumbnailUrl: `${BASE}/api/v1/manga/70/thumbnail` },
            details: null,
            chapters: [chapter(1), chapter(3)]
        };

        function withChapters(context: ReturnType<typeof setup>): number {
            const id = addManga(context, 7, 'One Piece');
            context.db.registerChapters(id, [chapter(1), chapter(2)]);
            return id;
        }

        it('moves it, tells how many chapters matched, were added and were dropped, and gives the manga as the screen shows it', () => {
            const context = setup();
            const id = withChapters(context);
            const response = context.call(IPC.mangaMigrateSource, { mangaId: id, target: TARGET }) as { ok: true; manga: LibraryManga; matched: number; added: number; dropped: number };
            expect(response).toMatchObject({ ok: true, matched: 1, added: 1, dropped: 1 });
            expect(response.manga).toMatchObject({ id, sourceId: '999', remoteId: 70, thumbnailUrl: `${BASE}/api/v1/manga/70/thumbnail` });
            expect(context.db.getManga(id)).toMatchObject({ sourceId: '999', remoteId: 70, thumbnailUrl: '/api/v1/manga/70/thumbnail' });
            expect(context.libraryChanges.count).toBe(1);
        });

        it.each([
            ['the manga is not there', { mangaId: 999 }, 'not-found'],
            ['the other manga is the same one', { mangaId: 0, same: true }, 'same'],
            ['the other manga is in the library already', { mangaId: 0, taken: true }, 'exists']
        ])('says why when %s', (_name, options, reason) => {
            const context = setup();
            const id = withChapters(context);
            if ('taken' in options) {
                context.db.upsertManga({ remoteId: 70, sourceId: '999', title: 'Already', thumbnailUrl: null });
            }
            const target = 'same' in options ? { ...TARGET, manga: { ...TARGET.manga, sourceId: '123', remoteId: 7 } } : TARGET;
            const mangaId = options.mangaId === 0 ? id : options.mangaId;
            expect(context.call(IPC.mangaMigrateSource, { mangaId, target })).toEqual({ ok: false, reason });
            expect(context.libraryChanges.count).toBe(0);
        });

        it.each([[{ mangaId: 1 }], [{ mangaId: 1, target: { manga: { remoteId: 70 }, chapters: [] } }], [{ target: TARGET }], ['x'], [null]])('refuses the request %j', (request) => {
            const context = setup();
            withChapters(context);
            expect(context.call(IPC.mangaMigrateSource, request)).toEqual({ ok: false, reason: 'invalid' });
        });

        it('is busy while the manga has a chapter waiting or being downloaded', () => {
            const context = setup();
            const id = withChapters(context);
            context.queue.enqueue({ manga: { remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: null }, details: null, chapters: [chapter(2)] });
            expect(context.call(IPC.mangaMigrateSource, { mangaId: id, target: TARGET })).toEqual({ ok: false, reason: 'busy' });
            expect(context.db.getManga(id)).toMatchObject({ sourceId: '123', remoteId: 7 });
        });

        it('is not busy because of the downloads of another manga', () => {
            const context = setup();
            const id = withChapters(context);
            context.queue.enqueue({ manga: { remoteId: 8, sourceId: '123', title: 'Bleach', thumbnailUrl: null }, details: null, chapters: [chapter(1)] });
            expect(context.call(IPC.mangaMigrateSource, { mangaId: id, target: TARGET })).toMatchObject({ ok: true });
        });

        it('is busy while the folder is being moved', async () => {
            let finish: (value: MangaMigrationResponse) => void = () => {return undefined};
            const context = setup({
                migrate: () => {
                    return new Promise((resolve) => {
                        finish = resolve;
                    });
                }
            });
            const id = withChapters(context);
            const moving = context.call(IPC.mangaMigrateFolder);
            expect(context.call(IPC.mangaMigrateSource, { mangaId: id, target: TARGET })).toEqual({ ok: false, reason: 'busy' });
            finish({ ok: false, reason: 'cancelled' });
            await moving;
            expect(context.call(IPC.mangaMigrateSource, { mangaId: id, target: TARGET })).toMatchObject({ ok: true });
        });
    });
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

async function untilCoverKept(context: ReturnType<typeof setup>, mangaId: number): Promise<void> {
    await vi.waitFor(() => {
        expect(context.db.coverHash(mangaId)).not.toBeNull();
    });
}

describe('the covers that the app keeps', () => {
    const jpeg = (): Promise<Response> => {
        return Promise.resolve(new Response(JPEG));
    };

    it('takes the cover when a manga is added to the library, and tells the screen when it is kept', async () => {
        const context = setup({ coverFetch: jpeg });
        const added = context.call(IPC.mangaAddToLibrary, REQUEST) as LibraryManga;
        expect(added.thumbnailUrl).toBe(`${BASE}/api/v1/manga/7/thumbnail`);
        await untilCoverKept(context, added.id);
        expect(context.coverRequests).toEqual([`${BASE}/api/v1/manga/7/thumbnail`]);
        await vi.waitFor(() => {
            expect(context.libraryChanges.count).toBeGreaterThanOrEqual(1);
        });
        const library = context.call(IPC.mangaLibrary) as LibraryManga[];
        expect(library[0]?.thumbnailUrl).toMatch(new RegExp(`^pullwave-manga://cover/${String(added.id)}\\?v=[0-9a-f]{12}$`));
    });

    it('takes the cover when a manga is downloaded', async () => {
        const context = setup({ coverFetch: jpeg });
        const added = context.call(IPC.mangaDownload, REQUEST) as LibraryManga;
        await untilCoverKept(context, added.id);
        expect(context.coverRequests).toEqual([`${BASE}/api/v1/manga/7/thumbnail`]);
    });

    it('leaves the library as it was when the cover does not come', async () => {
        const context = setup();
        const added = context.call(IPC.mangaAddToLibrary, REQUEST) as LibraryManga;
        await vi.waitFor(() => {
            expect(context.coverRequests).toHaveLength(1);
        });
        expect(context.db.coverHash(added.id)).toBeNull();
        expect(context.libraryChanges.count).toBe(0);
        expect((context.call(IPC.mangaLibrary) as LibraryManga[])[0]?.thumbnailUrl).toBe(`${BASE}/api/v1/manga/7/thumbnail`);
    });

    it('does not send the address of a cover it keeps to the library when the window sends the manga back', async () => {
        const context = setup({ coverFetch: jpeg });
        const added = context.call(IPC.mangaAddToLibrary, REQUEST) as LibraryManga;
        await untilCoverKept(context, added.id);
        const shown = (context.call(IPC.mangaLibrary) as LibraryManga[])[0]!.thumbnailUrl!;
        context.call(IPC.mangaAddToLibrary, { ...REQUEST, manga: { ...REQUEST.manga, thumbnailUrl: shown }, details: { ...REQUEST.details, thumbnailUrl: shown } });
        expect(context.db.getManga(added.id)?.thumbnailUrl).toBe('/api/v1/manga/7/thumbnail');
        context.call(IPC.mangaDownload, { ...REQUEST, manga: { ...REQUEST.manga, thumbnailUrl: shown }, details: null });
        expect(context.db.getManga(added.id)?.thumbnailUrl).toBe('/api/v1/manga/7/thumbnail');
    });

    it('takes the covers the library lacks when it is listed with the server running, and tells the screen', async () => {
        const context = setup({ coverFetch: jpeg });
        const id = context.db.upsertManga({ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: '/api/v1/manga/7/thumbnail' }).id;
        const library = context.call(IPC.mangaLibrary) as LibraryManga[];
        expect(library[0]?.thumbnailUrl).toBe(`${BASE}/api/v1/manga/7/thumbnail`);
        expect(context.service.warmUp).not.toHaveBeenCalled();
        await untilCoverKept(context, id);
        await vi.waitFor(() => {
            expect(context.libraryChanges.count).toBe(1);
        });
        expect((context.call(IPC.mangaLibrary) as LibraryManga[])[0]?.thumbnailUrl).toContain('pullwave-manga://cover/');
        expect(context.coverRequests).toEqual([`${BASE}/api/v1/manga/7/thumbnail`]);
    });

    it('lists the library with the covers it keeps even when the server is not running', async () => {
        const context = setup({ coverFetch: jpeg, baseUrl: null });
        const id = context.db.upsertManga({ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: 'https://cdn.example/a.jpg' }).id;
        await context.covers.refresh(id);
        const library = context.call(IPC.mangaLibrary) as LibraryManga[];
        expect(library[0]?.thumbnailUrl).toMatch(new RegExp(`^pullwave-manga://cover/${String(id)}\\?v=[0-9a-f]{12}$`));
        expect(context.service.warmUp).not.toHaveBeenCalled();
    });

    it('does not start the server for covers that are already kept', async () => {
        const context = setup({ coverFetch: jpeg, baseUrl: null });
        const id = context.db.upsertManga({ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: 'https://cdn.example/a.jpg' }).id;
        context.call(IPC.mangaLibrary);
        await untilCoverKept(context, id);
        context.call(IPC.mangaLibrary);
        expect(context.service.warmUp).not.toHaveBeenCalled();
        expect(context.coverRequests).toEqual(['https://cdn.example/a.jpg']);
    });

    it('starts the server in the background for the covers that are paths of it, and asks for none while it is not running', () => {
        const context = setup({ baseUrl: null });
        context.db.upsertManga({ remoteId: 7, sourceId: '123', title: 'One Piece', thumbnailUrl: '/api/v1/manga/7/thumbnail' });
        context.call(IPC.mangaLibrary);
        expect(context.service.warmUp).toHaveBeenCalledTimes(1);
        expect(context.coverRequests).toEqual([]);
    });

    describe('when the source is visited', () => {
        const FRESH: MangaDetails = { ...REQUEST.details, status: 'ongoing', url: null, thumbnailUrl: `${BASE}/api/v1/manga/7/thumbnail?v=2` };

        it('keeps the new address of the cover of a manga of the library and takes the cover again', async () => {
            const context = setup({ coverFetch: jpeg });
            const added = context.call(IPC.mangaAddToLibrary, REQUEST) as LibraryManga;
            await untilCoverKept(context, added.id);
            context.coverRequests.length = 0;
            context.service.details.mockResolvedValueOnce({ ok: true as const, value: { details: FRESH, chapters: [] } });
            await expect(context.call(IPC.mangaDetails, 7)).resolves.toEqual({ ok: true, value: { details: FRESH, chapters: [] } });
            expect(context.db.getManga(added.id)?.thumbnailUrl).toBe('/api/v1/manga/7/thumbnail?v=2');
            await vi.waitFor(() => {
                expect(context.coverRequests).toEqual([`${BASE}/api/v1/manga/7/thumbnail?v=2`]);
            });
        });

        it('tells the screen when the cover changed, and keeps the old one when the new one does not come', async () => {
            let image = JPEG;
            const context = setup({
                coverFetch: () => {
                    return Promise.resolve(new Response(image));
                }
            });
            const added = context.call(IPC.mangaAddToLibrary, REQUEST) as LibraryManga;
            await untilCoverKept(context, added.id);
            await vi.waitFor(() => {
                expect(context.libraryChanges.count).toBe(1);
            });
            const before = context.covers.urlOf(added.id);
            image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
            context.service.details.mockResolvedValueOnce({ ok: true as const, value: { details: FRESH, chapters: [] } });
            await context.call(IPC.mangaDetails, 7);
            await vi.waitFor(() => {
                expect(context.libraryChanges.count).toBe(2);
            });
            expect(context.covers.urlOf(added.id)).not.toBe(before);
        });

        it('does nothing about the cover of a manga that is not in the library, or when the source fails', async () => {
            const context = setup({ coverFetch: jpeg });
            context.service.details.mockResolvedValueOnce({ ok: true as const, value: { details: FRESH, chapters: [] } });
            await context.call(IPC.mangaDetails, 7);
            await context.call(IPC.mangaDetails, 7);
            expect(context.coverRequests).toEqual([]);
            const added = context.call(IPC.mangaAddToLibrary, REQUEST) as LibraryManga;
            await untilCoverKept(context, added.id);
            context.coverRequests.length = 0;
            await context.call(IPC.mangaDetails, 7);
            expect(context.coverRequests).toEqual([]);
            expect(context.db.getManga(added.id)?.thumbnailUrl).toBe('/api/v1/manga/7/thumbnail');
        });
    });

    it('deletes the cover with the manga', async () => {
        const context = setup({ coverFetch: jpeg });
        const added = context.call(IPC.mangaAddToLibrary, REQUEST) as LibraryManga;
        await untilCoverKept(context, added.id);
        const path = context.covers.fileOf(added.id)!;
        context.call(IPC.mangaRemoveManga, added.id);
        expect(existsSync(path)).toBe(false);
    });

    it('takes the cover of the other source when the manga is moved to it', async () => {
        const context = setup({ coverFetch: jpeg });
        const added = context.call(IPC.mangaAddToLibrary, REQUEST) as LibraryManga;
        await untilCoverKept(context, added.id);
        context.coverRequests.length = 0;
        context.call(IPC.mangaMigrateSource, {
            mangaId: added.id,
            target: { manga: { remoteId: 70, sourceId: '999', title: 'One Piece', thumbnailUrl: `${BASE}/api/v1/manga/70/thumbnail` }, details: null, chapters: [chapter(1)] }
        });
        await vi.waitFor(() => {
            expect(context.coverRequests).toEqual([`${BASE}/api/v1/manga/70/thumbnail`]);
        });
    });
});
