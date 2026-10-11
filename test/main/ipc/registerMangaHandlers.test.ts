import type { LibraryManga, MangaChapter, MangaJob, MangaStatusInfo } from '@shared/manga';
import { IPC } from '@shared/constants';
import { registerMangaHandlers, type MangaHandlerDependencies } from '@main/ipc/registerMangaHandlers';
import type { IpcMainLike } from '@main/ipc/registerHandlers';
import type { ChapterDownloadHandle, ChapterDownloadOptions } from '@main/services/manga/mangaChapterDownloader';
import { MangaDb } from '@main/services/manga/mangaDb';
import { MangaDownloadQueue } from '@main/services/manga/mangaDownloadQueue';

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
    IPC.mangaLibrary,
    IPC.mangaList,
    IPC.mangaOpenFolder,
    IPC.mangaPause,
    IPC.mangaRemoveChapter,
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
    IPC.mangaStores
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

function setup(options: { baseUrl?: string | null; folder?: string | null } = {}) {
    const db = new MangaDb(':memory:', () => {
        return 1000;
    });
    const downloads: ChapterDownloadOptions[] = [];
    const removedFiles: string[][] = [];
    const opened: string[] = [];
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
        details: vi.fn(() => {
            return Promise.resolve({ ok: false as const, error: { code: 'NOT_FOUND' as const, message: 'none' } });
        }),
        warmUp: vi.fn(),
        baseUrl: options.baseUrl === undefined ? BASE : options.baseUrl
    };
    const reader = {
        pages: vi.fn(() => {
            return Promise.resolve({ ok: true as const, value: { pages: ['pullwave-manga://page/3/0'], local: true } });
        })
    };
    const deps: MangaHandlerDependencies = {
        service,
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
        onLibraryChanged: () => {
            libraryChanges.count += 1;
        }
    };
    const ipc = makeIpc();
    registerMangaHandlers(ipc.ipcMain, deps);
    return { ...ipc, db, queue, service, reader, downloads, removedFiles, opened, libraryChanges };
}

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
        expect(ipc.call(IPC.mangaHelperInstall)).toBeUndefined();
        expect(ipc.call(IPC.mangaHelperRemove)).toBeUndefined();
        expect(ipc.call(IPC.mangaAddToLibrary)).toBeNull();
        expect(ipc.call(IPC.mangaDownload)).toBeNull();
        expect(ipc.call(IPC.mangaLibrary)).toEqual([]);
        expect(ipc.call(IPC.mangaJobs)).toEqual([]);
        [IPC.mangaDownloadMissing, IPC.mangaCancel, IPC.mangaRetry, IPC.mangaPause, IPC.mangaResume, IPC.mangaClearFinished, IPC.mangaRemoveChapter, IPC.mangaRemoveManga, IPC.mangaOpenFolder].forEach((channel) => {
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

    it('removes a chapter: stops it, deletes its file and tells the library changed', () => {
        const { call, db, queue, removedFiles, libraryChanges } = setup();
        call(IPC.mangaAddToLibrary, REQUEST);
        const chapterId = db.chaptersOf(1)[0]!.id;
        db.markDone(chapterId, '/m/One Piece/Chapter 2.cbz', 10, 2);
        const forget = vi.spyOn(queue, 'forget');
        const before = libraryChanges.count;
        call(IPC.mangaRemoveChapter, chapterId);
        expect(forget).toHaveBeenCalledWith([chapterId]);
        expect(removedFiles).toEqual([['/m/One Piece/Chapter 2.cbz']]);
        expect(db.getChapter(chapterId)).toBeNull();
        expect(libraryChanges.count).toBe(before + 1);
    });

    it('removes a chapter that has no file without deleting anything', () => {
        const { call, db, removedFiles } = setup();
        call(IPC.mangaAddToLibrary, REQUEST);
        call(IPC.mangaRemoveChapter, db.chaptersOf(1)[0]!.id);
        expect(removedFiles).toEqual([[]]);
    });

    it('ignores the removal of a chapter or a manga that is not there', () => {
        const { call, removedFiles, libraryChanges } = setup();
        call(IPC.mangaRemoveChapter, 999);
        call(IPC.mangaRemoveChapter, 'x');
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
