import { IPC } from '@shared/constants';
import { hasChapterFile, IDLE_MANGA_CHECK_STATE } from '@shared/manga';
import type { ComponentHealth, LibraryManga, MangaCheckResponse, MangaCheckState, MangaUpdateEntry, ReadingEntry, MangaGroup, MangaHealth, MangaToolUpdateResult, MangaToolVersions, MangaGroupResponse, MangaJob, MangaMigrationResponse, MangaRenameSeriesResponse, MangaResult, MangaSeriesResponse, MangaSourceMigrationResponse, MangaStatusInfo } from '@shared/manga';
import type { MangaDb } from '../services/manga/mangaDb';
import type { MangaCovers } from '../services/manga/mangaCovers';
import type { MangaIcons } from '../services/manga/mangaIcons';
import { parseCoverUrl } from '../services/manga/mangaPageProtocol';
import type { MangaReader } from '../services/manga/mangaReader';
import type { MangaRepair } from '../services/manga/mangaRepair';
import type { MangaToolUpdates } from '../services/manga/mangaToolUpdates';
import type { MangaDownloadQueue } from '../services/manga/mangaDownloadQueue';
import { asDownloadRequest, asReadingRecord, asExtensionAction, asGroupName, asId, asIds, asPageIndex, asListRequest, asPackageName, asPreferenceChange, asReadRequest, asSeriesRequest, asSourceId, asSourceMigrationRequest, asStoreUrl } from '../services/manga/mangaRequests';
import { cleanSeriesName } from '@shared/series';
import type { MangaService } from '../services/manga/mangaService';
import { fromStoredAddress, toStoredAddress } from '../services/manga/serverAddress';
import type { IpcMainLike } from './registerHandlers';

export interface MangaHandlerDependencies {
    service: Pick<MangaService, 'status' | 'health' | 'install' | 'installHelper' | 'removeHelper' | 'updateAllExtensions' | 'stores' | 'addStore' | 'removeStore' | 'extensions' | 'changeExtension' | 'sources' | 'list' | 'details' | 'warmUp' | 'sourcePreferences' | 'sourceFilters' | 'setSourcePreference'> & {
        readonly baseUrl: string | null;
    };
    queue: MangaDownloadQueue;
    // Looks for newer versions of the server and of the helper, and moves to them.
    updates: Pick<MangaToolUpdates, 'check' | 'updateServer' | 'resetServer' | 'updateHelper'>;
    // Looks for new chapters, in one manga of the library or in all of them (null).
    checkNewChapters: (mangaId: number | null) => Promise<MangaCheckResponse>;
    // Whether a check of all the mangas is going on and how far it is.
    checkState: () => MangaCheckState;
    // The icons of the sources that are kept in the data folder.
    icons: Pick<MangaIcons, 'present'>;
    // The covers of the library that are kept in the data folder.
    covers: Pick<MangaCovers, 'urlOf' | 'refresh' | 'backfill' | 'remove' | 'needsServer' | 'pending'>;
    // Closes the app and opens it again.
    restartApp: () => void;
    db: MangaDb;
    reader: Pick<MangaReader, 'pages'>;
    // Downloads again the pages an incomplete chapter lacks.
    repair: Pick<MangaRepair, 'repair' | 'repairMissing'>;
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
    ipcMain.handle(IPC.mangaUpdates, (): MangaUpdateEntry[] => {
        return [];
    });
    ipcMain.handle(IPC.mangaReadingHistory, (): ReadingEntry[] => {
        return [];
    });
    ipcMain.handle(IPC.mangaCheckNew, (): MangaCheckResponse => {
        return unsupported;
    });
    ipcMain.handle(IPC.mangaCheckState, (): MangaCheckState => {
        return IDLE_MANGA_CHECK_STATE;
    });
    [IPC.mangaClearUpdates, IPC.mangaRecordReading, IPC.mangaRemoveReading, IPC.mangaClearReading].forEach((channel) => {
        ipcMain.handle(channel, () => {
            return undefined;
        });
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
    [IPC.mangaGroupDelete, IPC.mangaGroupMove, IPC.mangaGroupMembers].forEach((channel) => {
        ipcMain.handle(channel, () => {
            return undefined;
        });
    });
    ipcMain.handle(IPC.mangaMigrateSource, (): MangaSourceMigrationResponse => {
        return { ok: false, reason: 'invalid' };
    });
    ipcMain.handle(IPC.mangaToolsCheck, (): MangaToolVersions => {
        return { suwayomi: { current: '', latest: null, error: null, updatable: false, chosen: false, bundled: '', restartNeeded: false }, flaresolverr: null };
    });
    [IPC.mangaServerUpdate, IPC.mangaHelperUpdate].forEach((channel) => {
        ipcMain.handle(channel, (): MangaToolUpdateResult => {
            return { ok: false, reason: 'unsupported', message: null };
        });
    });
    [IPC.mangaServerReset, IPC.mangaRestart].forEach((channel) => {
        ipcMain.handle(channel, () => {
            return undefined;
        });
    });
    ipcMain.handle(IPC.mangaHealth, (): MangaHealth => {
        const none: ComponentHealth = { state: 'not-installed', version: null, message: null, external: false };
        return { server: none, helper: null };
    });
    ipcMain.handle(IPC.mangaExtensionsUpdateAll, () => {
        return unsupported;
    });
    [IPC.mangaStores, IPC.mangaStoreAdd, IPC.mangaStoreRemove, IPC.mangaExtensions, IPC.mangaExtensionChange, IPC.mangaSources, IPC.mangaSourcePreferences, IPC.mangaSourcePreferenceSet, IPC.mangaSourceFilters, IPC.mangaReadPages, IPC.mangaRepairChapter, IPC.mangaList, IPC.mangaDetails].forEach((channel) => {
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
    ipcMain.handle(IPC.mangaQueueHeld, () => {
        return false;
    });
    [
        IPC.mangaDownloadMissing,
        IPC.mangaCancel,
        IPC.mangaRetry,
        IPC.mangaPause,
        IPC.mangaResume,
        IPC.mangaPauseAll,
        IPC.mangaResumeAll,
        IPC.mangaClearFinished,
        IPC.mangaRemoveDownload,
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
    const { service, queue, db, reader, repair, removeChapterFiles, covers, icons, onLibraryChanged, checkNewChapters, checkState } = deps;
    let migrating = false;

    // The cover the app keeps is shown when there is one. Otherwise it is the one of the source, kept as a path of the server (its port
    // changes) and given with the server of the moment.
    function present(manga: LibraryManga): LibraryManga {
        return { ...manga, thumbnailUrl: covers.urlOf(manga.id) ?? fromStoredAddress(manga.thumbnailUrl, service.baseUrl) };
    }

    // What the window sends back goes to the library: the address of a cover the app keeps is not where the source has it, so the
    // address the library already has stays.
    function store<T extends { thumbnailUrl: string | null }>(value: T): T {
        const kept = value.thumbnailUrl === null ? null : parseCoverUrl(value.thumbnailUrl);
        if (kept !== null) {
            return { ...value, thumbnailUrl: db.getManga(kept.mangaId)?.thumbnailUrl ?? null };
        }
        return { ...value, thumbnailUrl: toStoredAddress(value.thumbnailUrl, service.baseUrl) };
    }

    // Takes the cover from the source in the background; the window is told when what is kept changed.
    function refreshCover(mangaId: number): void {
        void covers.refresh(mangaId).then((changed) => {
            if (changed) {
                onLibraryChanged();
            }
        });
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
    ipcMain.handle(IPC.mangaSources, async () => {
        const result = await service.sources();
        // The icons the app keeps are shown from the data folder; the others are taken in the background.
        return result.ok
            ? {
                  ...result,
                  value: result.value.map((source) => {
                      return { ...source, iconUrl: icons.present(source.iconUrl) };
                  })
              }
            : result;
    });
    ipcMain.handle(IPC.mangaSourcePreferences, (_event, sourceId) => {
        const id = asSourceId(sourceId);
        return id === null ? invalid('The source is not valid.') : service.sourcePreferences(id);
    });
    ipcMain.handle(IPC.mangaReadPages, (_event, request) => {
        const checked = asReadRequest(request);
        return checked === null ? invalid('The chapter is not valid.') : reader.pages(checked);
    });
    ipcMain.handle(IPC.mangaRepairChapter, (_event, chapterId, pageIndex) => {
        const id = asId(chapterId);
        const index = pageIndex === null ? null : asPageIndex(pageIndex);
        if (id === null || (pageIndex !== null && index === null)) {
            return invalid('The chapter is not valid.');
        }
        return repair.repair(id, index);
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
    ipcMain.handle(IPC.mangaDetails, async (_event, remoteId) => {
        const id = asId(remoteId);
        if (id === null) {
            return invalid('The manga is not valid.');
        }
        const result = await service.details(id);
        if (result.ok) {
            // The source was visited: a manga of the library takes the cover the source has now, when it is another one.
            const saved = db.findManga(result.value.details.sourceId, result.value.details.remoteId);
            if (saved !== null) {
                db.setThumbnail(saved.id, toStoredAddress(result.value.details.thumbnailUrl, service.baseUrl));
                refreshCover(saved.id);
            }
        }
        return result;
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
        if (manga !== null) {
            refreshCover(manga.id);
        }
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
        if (manga !== null) {
            refreshCover(manga.id);
        }
        return manga === null ? null : present(manga);
    });
    ipcMain.handle(IPC.mangaDownloadMissing, (_event, mangaIds) => {
        if (!migrating) {
            const ids = asIds(mangaIds);
            queue.downloadMissing(ids);
            // The chapters that lack pages are not downloaded again: the pages they lack are, in the background.
            void repair.repairMissing(ids);
        }
    });
    ipcMain.handle(IPC.mangaLibrary, (): LibraryManga[] => {
        const library = db.list();
        if (service.baseUrl === null && covers.needsServer) {
            // The covers the app does not keep yet need the server: it is started now, and the screen is told when it is ready.
            service.warmUp();
        }
        if (covers.pending(service.baseUrl !== null)) {
            void covers.backfill().then((changed) => {
                if (changed) {
                    onLibraryChanged();
                }
            });
        }
        return library.map(present);
    });
    ipcMain.handle(IPC.mangaJobs, (): MangaJob[] => {
        return queue.list();
    });
    ipcMain.handle(IPC.mangaQueueHeld, (): boolean => {
        return queue.isHeld();
    });
    const byChapter: Array<[string, 'cancel' | 'retry' | 'pause' | 'resume']> = [
        [IPC.mangaCancel, 'cancel'],
        [IPC.mangaRetry, 'retry'],
        [IPC.mangaPause, 'pause'],
        [IPC.mangaResume, 'resume']
    ];
    ipcMain.handle(IPC.mangaPauseAll, (): void => {
        queue.pauseAll();
    });
    ipcMain.handle(IPC.mangaResumeAll, (): void => {
        // Nothing is started while the files are being moved.
        if (!migrating) {
            queue.resumeAll();
        }
    });
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
    ipcMain.handle(IPC.mangaRemoveDownload, (_event, chapterId) => {
        const id = asId(chapterId);
        // Only a chapter that is downloaded has a download to remove: it stays in the library as one that is not downloaded.
        if (id === null || migrating || !hasChapterFile(db.getChapter(id)?.status ?? 'idle')) {
            return;
        }
        queue.forget([id]);
        removeFilesOf([db.removeDownload(id)]);
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
        covers.remove(id);
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
    ipcMain.handle(IPC.mangaGroupMove, (_event, groupId, direction) => {
        const id = asId(groupId);
        if (id !== null && (direction === 'up' || direction === 'down') && db.moveGroup(id, direction)) {
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
        // The cover is the one of the other source now.
        refreshCover(checked.mangaId);
        const manga = db.getLibraryManga(checked.mangaId);
        return manga === null ? { ok: false, reason: 'not-found' } : { ok: true, manga: present(manga), matched: outcome.matched, added: outcome.added, dropped: outcome.dropped };
    });
    ipcMain.handle(IPC.mangaToolsCheck, () => {
        return deps.updates.check();
    });
    ipcMain.handle(IPC.mangaServerUpdate, () => {
        return deps.updates.updateServer();
    });
    ipcMain.handle(IPC.mangaServerReset, () => {
        deps.updates.resetServer();
    });
    ipcMain.handle(IPC.mangaHelperUpdate, async () => {
        const result = await deps.updates.updateHelper();
        return result;
    });
    ipcMain.handle(IPC.mangaRestart, () => {
        deps.restartApp();
    });
    ipcMain.handle(IPC.mangaHealth, (_event, start) => {
        return service.health(start === true);
    });
    ipcMain.handle(IPC.mangaUpdates, (): MangaUpdateEntry[] => {
        return db.updates().map((entry) => {
            return { ...entry, thumbnailUrl: covers.urlOf(entry.mangaId) ?? fromStoredAddress(entry.thumbnailUrl, service.baseUrl) };
        });
    });
    ipcMain.handle(IPC.mangaClearUpdates, () => {
        db.clearUpdates();
    });
    ipcMain.handle(IPC.mangaCheckNew, (_event, mangaId): Promise<MangaCheckResponse> | MangaCheckResponse => {
        if (mangaId === null) {
            return checkNewChapters(null);
        }
        const id = asId(mangaId);
        return id === null ? failure('INVALID_REQUEST', 'The manga is not valid.') : checkNewChapters(id);
    });
    ipcMain.handle(IPC.mangaCheckState, (): MangaCheckState => {
        return checkState();
    });
    ipcMain.handle(IPC.mangaRecordReading, (_event, record) => {
        const checked = asReadingRecord(record);
        if (checked !== null) {
            db.recordReading(store(checked));
        }
    });
    ipcMain.handle(IPC.mangaReadingHistory, (): ReadingEntry[] => {
        return db.readingHistory().map((entry) => {
            const kept = entry.libraryMangaId === null ? null : covers.urlOf(entry.libraryMangaId);
            return { ...entry, thumbnailUrl: kept ?? fromStoredAddress(entry.thumbnailUrl, service.baseUrl) };
        });
    });
    ipcMain.handle(IPC.mangaRemoveReading, (_event, id) => {
        const checked = asId(id);
        if (checked !== null) {
            db.removeReading(checked);
        }
    });
    ipcMain.handle(IPC.mangaClearReading, () => {
        db.clearReading();
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
