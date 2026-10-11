import { IPC } from '@shared/constants';
import type { LibraryManga, MangaGroup, MangaGroupResponse, MangaJob, MangaMigrationResponse, MangaRenameSeriesResponse, MangaResult, MangaSeriesResponse, MangaSourceMigrationResponse, MangaStatusInfo } from '@shared/manga';
import type { MangaDb } from '../services/manga/mangaDb';
import type { MangaReader } from '../services/manga/mangaReader';
import type { MangaDownloadQueue } from '../services/manga/mangaDownloadQueue';
import { asDownloadRequest, asExtensionAction, asGroupName, asId, asIds, asListRequest, asPackageName, asPreferenceChange, asReadRequest, asSeriesRequest, asSourceId, asSourceMigrationRequest, asStoreUrl } from '../services/manga/mangaRequests';
import { cleanSeriesName } from '@shared/series';
import type { MangaService } from '../services/manga/mangaService';
import { fromStoredAddress, toStoredAddress } from '../services/manga/serverAddress';
import type { IpcMainLike } from './registerHandlers';

export interface MangaHandlerDependencies {
    service: Pick<MangaService, 'status' | 'install' | 'installHelper' | 'removeHelper' | 'updateAllExtensions' | 'stores' | 'addStore' | 'removeStore' | 'extensions' | 'changeExtension' | 'sources' | 'list' | 'details' | 'warmUp' | 'sourcePreferences' | 'sourceFilters' | 'setSourcePreference'> & {
        readonly baseUrl: string | null;
    };
    queue: MangaDownloadQueue;
    db: MangaDb;
    reader: Pick<MangaReader, 'pages'>;
    // Deletes the files (CBZ files and folders of images) of chapters; only what the app made is deleted.
    removeChapterFiles: (paths: string[]) => void;
    // The folder the chapters of a manga are in, or null when none is known.
    folderOf: (mangaId: number) => string | null;
    openFolder: (path: string) => void;
    // Opens an address in the browser of the system (the handler only gives it http and https addresses).
    openSite: (url: string) => void;
    // Asks for the folder the chapters are moved to and moves them there (see mangaMigration.ts).
    migrateFolder: () => Promise<MangaMigrationResponse>;
    onLibraryChanged: () => void;
}

const UNSUPPORTED_STATUS: MangaStatusInfo = { supported: false, tool: null, helper: null, helperProblem: null, helperExternal: false, server: 'stopped', serverError: null };
const UNSUPPORTED_MESSAGE = 'The manga section is only available on Linux and Windows (64 bits).';

function failure(code: 'INVALID_REQUEST' | 'UNKNOWN', message: string): { ok: false; error: { code: typeof code; message: string } } {
    return { ok: false, error: { code, message } };
}

function invalid(message: string): MangaResult<never> {
    return failure('INVALID_REQUEST', message);
}

// The channels of a system where the manga section does not exist answer that it does not.
function registerUnsupported(ipcMain: IpcMainLike): void {
    const unsupported = failure('UNKNOWN', UNSUPPORTED_MESSAGE);
    ipcMain.handle(IPC.mangaStatus, (): MangaStatusInfo => {
        return UNSUPPORTED_STATUS;
    });
    ipcMain.handle(IPC.mangaInstall, () => {
        return null;
    });
    [IPC.mangaHelperInstall, IPC.mangaHelperRemove, IPC.mangaOpenSite].forEach((channel) => {
        ipcMain.handle(channel, () => {
            return undefined;
        });
    });
    ipcMain.handle(IPC.mangaMigrateFolder, (): MangaMigrationResponse => {
        return { ok: false, reason: 'failed' };
    });
    [IPC.mangaSetSeries, IPC.mangaRenameSeries].forEach((channel) => {
        ipcMain.handle(channel, (): MangaSeriesResponse => {
            return { ok: false, reason: 'invalid' };
        });
    });
    ipcMain.handle(IPC.mangaGroups, (): MangaGroup[] => {
        return [];
    });
    [IPC.mangaGroupCreate, IPC.mangaGroupRename].forEach((channel) => {
        ipcMain.handle(channel, (): MangaGroupResponse => {
            return { ok: false, reason: 'invalid' };
        });
    });
    [IPC.mangaGroupDelete, IPC.mangaGroupMembers].forEach((channel) => {
        ipcMain.handle(channel, () => {
            return undefined;
        });
    });
    ipcMain.handle(IPC.mangaMigrateSource, (): MangaSourceMigrationResponse => {
        return { ok: false, reason: 'invalid' };
    });
    ipcMain.handle(IPC.mangaExtensionsUpdateAll, () => {
        return unsupported;
    });
    [IPC.mangaStores, IPC.mangaStoreAdd, IPC.mangaStoreRemove, IPC.mangaExtensions, IPC.mangaExtensionChange, IPC.mangaSources, IPC.mangaSourcePreferences, IPC.mangaSourcePreferenceSet, IPC.mangaSourceFilters, IPC.mangaReadPages, IPC.mangaList, IPC.mangaDetails].forEach((channel) => {
        ipcMain.handle(channel, () => {
            return unsupported;
        });
    });
    [IPC.mangaAddToLibrary, IPC.mangaDownload].forEach((channel) => {
        ipcMain.handle(channel, () => {
            return null;
        });
    });
    [IPC.mangaLibrary, IPC.mangaJobs].forEach((channel) => {
        ipcMain.handle(channel, () => {
            return [];
        });
    });
    [
        IPC.mangaDownloadMissing,
        IPC.mangaCancel,
        IPC.mangaRetry,
        IPC.mangaPause,
        IPC.mangaResume,
        IPC.mangaClearFinished,
        IPC.mangaRemoveChapter,
        IPC.mangaRemoveManga,
        IPC.mangaOpenFolder
    ].forEach((channel) => {
        ipcMain.handle(channel, () => {
            return undefined;
        });
    });
}

export function registerMangaHandlers(ipcMain: IpcMainLike, deps: MangaHandlerDependencies | null): void {
    if (deps === null) {
        registerUnsupported(ipcMain);
        return;
    }
    const { service, queue, db, reader, removeChapterFiles } = deps;
    let migrating = false;

    // The covers are kept as paths of the server (its port changes), and given with the server of the moment.
    function present(manga: LibraryManga): LibraryManga {
        return { ...manga, thumbnailUrl: fromStoredAddress(manga.thumbnailUrl, service.baseUrl) };
    }

    function store<T extends { thumbnailUrl: string | null }>(value: T): T {
        return { ...value, thumbnailUrl: toStoredAddress(value.thumbnailUrl, service.baseUrl) };
    }

    function removeFilesOf(paths: Array<string | null>): void {
        removeChapterFiles(
            paths.filter((path): path is string => {
                return path !== null;
            })
        );
    }

    ipcMain.handle(IPC.mangaStatus, (): MangaStatusInfo => {
        return service.status();
    });
    ipcMain.handle(IPC.mangaInstall, () => {
        return service.install();
    });
    ipcMain.handle(IPC.mangaHelperInstall, async () => {
        await service.installHelper();
    });
    ipcMain.handle(IPC.mangaHelperRemove, async () => {
        await service.removeHelper();
    });
    ipcMain.handle(IPC.mangaExtensionsUpdateAll, () => {
        return service.updateAllExtensions();
    });
    ipcMain.handle(IPC.mangaStores, () => {
        return service.stores();
    });
    ipcMain.handle(IPC.mangaStoreAdd, (_event, indexUrl) => {
        const address = asStoreUrl(indexUrl);
        return address === null ? invalid('The address of the store must start with http:// or https://.') : service.addStore(address);
    });
    ipcMain.handle(IPC.mangaStoreRemove, (_event, indexUrl) => {
        const address = asStoreUrl(indexUrl);
        return address === null ? invalid('The address of the store is not valid.') : service.removeStore(address);
    });
    ipcMain.handle(IPC.mangaExtensions, (_event, refresh) => {
        return service.extensions(refresh === true);
    });
    ipcMain.handle(IPC.mangaExtensionChange, (_event, pkgName, action) => {
        const pkg = asPackageName(pkgName);
        const chosen = asExtensionAction(action);
        return pkg === null || chosen === null ? invalid('The extension or the action is not valid.') : service.changeExtension(pkg, chosen);
    });
    ipcMain.handle(IPC.mangaSources, () => {
        return service.sources();
    });
    ipcMain.handle(IPC.mangaSourcePreferences, (_event, sourceId) => {
        const id = asSourceId(sourceId);
        return id === null ? invalid('The source is not valid.') : service.sourcePreferences(id);
    });
    ipcMain.handle(IPC.mangaReadPages, (_event, request) => {
        const checked = asReadRequest(request);
        return checked === null ? invalid('The chapter is not valid.') : reader.pages(checked);
    });
    ipcMain.handle(IPC.mangaSourceFilters, (_event, sourceId) => {
        const id = asSourceId(sourceId);
        return id === null ? invalid('The source is not valid.') : service.sourceFilters(id);
    });
    ipcMain.handle(IPC.mangaSourcePreferenceSet, (_event, change) => {
        const checked = asPreferenceChange(change);
        return checked === null ? invalid('The change to the setting is not valid.') : service.setSourcePreference(checked);
    });
    ipcMain.handle(IPC.mangaList, (_event, request) => {
        const checked = asListRequest(request);
        if (checked === null) {
            return invalid('The request for the list is not valid.');
        }
        // A search can have no text when it has filters (genres, tags, status...).
        if (checked.kind === 'search' && checked.query.length === 0 && (checked.filters ?? []).length === 0) {
            return invalid('The search is empty.');
        }
        return service.list(checked);
    });
    ipcMain.handle(IPC.mangaDetails, (_event, remoteId) => {
        const id = asId(remoteId);
        return id === null ? invalid('The manga is not valid.') : service.details(id);
    });
    ipcMain.handle(IPC.mangaAddToLibrary, (_event, request) => {
        const checked = asDownloadRequest(request);
        if (checked === null) {
            return null;
        }
        const manga = queue.addToLibrary({
            ...checked,
            manga: store(checked.manga),
            details: checked.details === null ? null : store(checked.details)
        });
        return manga === null ? null : present(manga);
    });
    ipcMain.handle(IPC.mangaDownload, (_event, request) => {
        const checked = asDownloadRequest(request);
        if (checked === null || migrating) {
            return null;
        }
        const manga = queue.enqueue({
            ...checked,
            manga: store(checked.manga),
            details: checked.details === null ? null : store(checked.details)
        });
        return manga === null ? null : present(manga);
    });
    ipcMain.handle(IPC.mangaDownloadMissing, (_event, mangaIds) => {
        if (!migrating) {
            queue.downloadMissing(asIds(mangaIds));
        }
    });
    ipcMain.handle(IPC.mangaLibrary, (): LibraryManga[] => {
        const library = db.list();
        if (service.baseUrl === null && library.some((manga) => {
            return manga.thumbnailUrl?.startsWith('/') === true;
        })) {
            // The covers need the server: it is started now, and the screen is told when it is ready.
            service.warmUp();
        }
        return library.map(present);
    });
    ipcMain.handle(IPC.mangaJobs, (): MangaJob[] => {
        return queue.list();
    });
    const byChapter: Array<[string, 'cancel' | 'retry' | 'pause' | 'resume']> = [
        [IPC.mangaCancel, 'cancel'],
        [IPC.mangaRetry, 'retry'],
        [IPC.mangaPause, 'pause'],
        [IPC.mangaResume, 'resume']
    ];
    byChapter.forEach(([channel, action]) => {
        ipcMain.handle(channel, (_event, chapterId) => {
            const id = asId(chapterId);
            // Nothing is started while the files are being moved.
            if (id !== null && (!migrating || action === 'cancel' || action === 'pause')) {
                queue[action](id);
            }
        });
    });
    ipcMain.handle(IPC.mangaClearFinished, () => {
        queue.clearFinished();
    });
    ipcMain.handle(IPC.mangaRemoveChapter, (_event, chapterId) => {
        const id = asId(chapterId);
        if (id === null || migrating || db.getChapter(id) === null) {
            return;
        }
        queue.forget([id]);
        removeFilesOf([db.removeChapter(id)]);
        deps.onLibraryChanged();
    });
    ipcMain.handle(IPC.mangaRemoveManga, (_event, mangaId) => {
        const id = asId(mangaId);
        if (id === null || migrating || db.getManga(id) === null) {
            return;
        }
        queue.forget(
            db.chaptersOf(id).map((chapter) => {
                return chapter.id;
            })
        );
        removeFilesOf(db.removeManga(id));
        deps.onLibraryChanged();
    });
    ipcMain.handle(IPC.mangaOpenFolder, (_event, mangaId) => {
        const id = asId(mangaId);
        const folder = id === null ? null : deps.folderOf(id);
        if (folder !== null) {
            deps.openFolder(folder);
        }
    });
    ipcMain.handle(IPC.mangaSetSeries, (_event, request): MangaSeriesResponse => {
        const checked = asSeriesRequest(request);
        if (checked === null || db.getManga(checked.mangaId) === null) {
            return { ok: false, reason: 'invalid' };
        }
        if (!db.setSeries(checked.mangaId, checked.series, checked.season, checked.seasonName)) {
            return { ok: false, reason: 'season-taken', suggested: db.firstFreeSeason(checked.series ?? '', [checked.mangaId]) };
        }
        deps.onLibraryChanged();
        return { ok: true };
    });
    ipcMain.handle(IPC.mangaRenameSeries, (_event, mangaIds, series): MangaRenameSeriesResponse => {
        const ids = asIds(mangaIds);
        const name = typeof series === 'string' ? cleanSeriesName(series) : null;
        if (ids.length === 0 || name === null) {
            return { ok: false, reason: 'invalid' };
        }
        const outcome = db.renameSeries(ids, name);
        if (!outcome.ok) {
            return { ok: false, reason: 'season-taken', manga: outcome.manga, season: outcome.season, suggested: outcome.suggested };
        }
        deps.onLibraryChanged();
        return { ok: true };
    });
    ipcMain.handle(IPC.mangaGroups, (): MangaGroup[] => {
        return db.listGroups();
    });
    ipcMain.handle(IPC.mangaGroupCreate, (_event, name): MangaGroupResponse => {
        const cleaned = asGroupName(name);
        if (cleaned === null) {
            return { ok: false, reason: 'invalid' };
        }
        const group = db.createGroup(cleaned);
        return group === null ? { ok: false, reason: 'taken' } : { ok: true, group };
    });
    ipcMain.handle(IPC.mangaGroupRename, (_event, groupId, name): MangaGroupResponse => {
        const id = asId(groupId);
        const cleaned = asGroupName(name);
        if (id === null || cleaned === null) {
            return { ok: false, reason: 'invalid' };
        }
        if (db.getGroup(id) === null) {
            return { ok: false, reason: 'not-found' };
        }
        const group = db.renameGroup(id, cleaned);
        return group === null ? { ok: false, reason: 'taken' } : { ok: true, group };
    });
    ipcMain.handle(IPC.mangaGroupDelete, (_event, groupId) => {
        const id = asId(groupId);
        if (id !== null) {
            db.deleteGroup(id);
            deps.onLibraryChanged();
        }
    });
    ipcMain.handle(IPC.mangaGroupMembers, (_event, groupId, mangaIds, member) => {
        const id = asId(groupId);
        if (id !== null && typeof member === 'boolean') {
            db.setGroupMembers(id, asIds(mangaIds), member);
            deps.onLibraryChanged();
        }
    });
    ipcMain.handle(IPC.mangaMigrateSource, (_event, request): MangaSourceMigrationResponse => {
        const checked = asSourceMigrationRequest(request);
        if (checked === null) {
            return { ok: false, reason: 'invalid' };
        }
        // Not while the files are being moved, or while the manga is being downloaded.
        const downloading = queue.list().some((job) => {
            return job.mangaId === checked.mangaId && (job.status === 'queued' || job.status === 'running' || job.status === 'paused');
        });
        if (migrating || downloading) {
            return { ok: false, reason: 'busy' };
        }
        const outcome = db.moveToSource(checked.mangaId, {
            manga: store(checked.target.manga),
            details: checked.target.details === null ? null : store(checked.target.details),
            chapters: checked.target.chapters
        });
        if (!outcome.ok) {
            return { ok: false, reason: outcome.reason };
        }
        deps.onLibraryChanged();
        const manga = db.getLibraryManga(checked.mangaId);
        return manga === null ? { ok: false, reason: 'not-found' } : { ok: true, manga: present(manga), matched: outcome.matched, added: outcome.added, dropped: outcome.dropped };
    });
    ipcMain.handle(IPC.mangaOpenSite, (_event, url) => {
        const address = asStoreUrl(url);
        if (address !== null) {
            deps.openSite(address);
        }
    });
    // The files are moved one migration at a time, and never while a chapter is being downloaded (nor is one started meanwhile).
    ipcMain.handle(IPC.mangaMigrateFolder, async (): Promise<MangaMigrationResponse> => {
        if (migrating || queue.pendingCount() > 0) {
            return { ok: false, reason: 'busy' };
        }
        migrating = true;
        try {
            const result = await deps.migrateFolder();
            deps.onLibraryChanged();
            return result;
        } finally {
            migrating = false;
        }
    });
}
