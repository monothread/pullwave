import type { ToolState } from './tools';
import type { ErrorDetails } from './errorDetails';

export const MANGA_STATUSES = ['unknown', 'ongoing', 'completed', 'hiatus', 'cancelled'] as const;
export type MangaStatus = (typeof MANGA_STATUSES)[number];

export const CONTENT_WARNINGS = ['SAFE', 'MIXED', 'NSFW'] as const;
export type ContentWarning = (typeof CONTENT_WARNINGS)[number];

export interface MangaExtensionStore {
    indexUrl: string;
    name: string;
}

export const EXTENSION_LIB_MIN = 1.3;
export const EXTENSION_LIB_MAX = 1.6;

export function isExtensionLibSupported(extensionLib: string | null): boolean {
    if (extensionLib === null) {
        return true;
    }
    const version = Number.parseFloat(extensionLib);
    return Number.isFinite(version) && version >= EXTENSION_LIB_MIN && version <= EXTENSION_LIB_MAX;
}

export interface MangaExtension {
    pkgName: string;
    name: string;
    lang: string;
    versionName: string;
    isInstalled: boolean;
    hasUpdate: boolean;
    isObsolete: boolean;
    iconUrl: string | null;
    contentWarning: ContentWarning;
    storeIndexUrl: string | null;
    extensionLib: string | null;
    isCompatible: boolean;
}

export interface MangaSource {
    id: string;
    name: string;
    lang: string;
    iconUrl: string | null;
    supportsLatest: boolean;
    isConfigurable: boolean;
    contentWarning: ContentWarning;
    extensionPkg: string | null;
    storeIndexUrl: string | null;
}

interface MangaPreferenceBase {
    position: number;
    key: string;
    title: string;
    summary: string;
    enabled: boolean;
}

export type MangaSourcePreference =
    | (MangaPreferenceBase & { type: 'text'; value: string })
    | (MangaPreferenceBase & { type: 'list'; value: string; entries: string[]; entryValues: string[] })
    | (MangaPreferenceBase & { type: 'switch'; value: boolean })
    | (MangaPreferenceBase & { type: 'checkbox'; value: boolean })
    | (MangaPreferenceBase & { type: 'multiselect'; value: string[]; entries: string[]; entryValues: string[] });

export type MangaPreferenceType = MangaSourcePreference['type'];
export type MangaPreferenceValue = string | boolean | string[];

export interface MangaPreferenceChange {
    sourceId: string;
    position: number;
    type: MangaPreferenceType;
    value: MangaPreferenceValue;
}

export interface MangaSummary {
    remoteId: number;
    sourceId: string;
    title: string;
    thumbnailUrl: string | null;
}

export interface MangaListing {
    items: MangaSummary[];
    hasNextPage: boolean;
}

export interface MangaDetails extends MangaSummary {
    url: string | null;
    author: string | null;
    artist: string | null;
    description: string | null;
    genres: string[];
    status: MangaStatus;
}

export interface MangaChapter {
    remoteId: number;
    name: string;
    number: number | null;
    dateUploaded: number | null;
    scanlator: string | null;
    sourceOrder: number;
}

export interface MangaDetailsWithChapters {
    details: MangaDetails;
    chapters: MangaChapter[];
}

export const MANGA_TRI_STATES = ['ignore', 'include', 'exclude'] as const;
export type MangaTriState = (typeof MANGA_TRI_STATES)[number];

export type MangaFilter =
    | { type: 'header'; name: string }
    | { type: 'separator'; name: string }
    | { type: 'text'; name: string; value: string }
    | { type: 'checkbox'; name: string; value: boolean }
    | { type: 'tristate'; name: string; value: MangaTriState }
    | { type: 'select'; name: string; options: string[]; value: number }
    | { type: 'sort'; name: string; options: string[]; value: { index: number; ascending: boolean } }
    | { type: 'group'; name: string; filters: MangaFilter[] };

export const MANGA_LIST_KINDS = ['popular', 'latest', 'search'] as const;
export type MangaListKind = (typeof MANGA_LIST_KINDS)[number];

export interface MangaListRequest {
    sourceId: string;
    kind: MangaListKind;
    page: number;
    query: string;
    filters?: MangaFilter[];
}

export type MangaErrorCode =
    | 'SERVER_UNAVAILABLE'
    | 'REQUEST_FAILED'
    | 'API_ERROR'
    | 'INVALID_RESPONSE'
    | 'INVALID_REQUEST'
    | 'NOT_FOUND'
    | 'EMPTY_CHAPTER'
    | 'IMAGE'
    | 'DISK'
    | 'UNKNOWN';

export interface MangaError {
    code: MangaErrorCode;
    message: string;
    details?: ErrorDetails;
}

export type MangaResult<T> = { ok: true; value: T } | { ok: false; error: MangaError };

export const MANGA_CHAPTER_STATUSES = ['idle', 'queued', 'downloading', 'paused', 'done', 'incomplete', 'error', 'cancelled'] as const;
export type MangaChapterStatus = (typeof MANGA_CHAPTER_STATUSES)[number];

export function hasChapterFile(status: MangaChapterStatus): boolean {
    return status === 'done' || status === 'incomplete';
}

export const MANGA_OUTPUT_FORMATS = ['cbz', 'folder'] as const;
export type MangaOutputFormat = (typeof MANGA_OUTPUT_FORMATS)[number];

export interface MangaRecord {
    id: number;
    sourceId: string;
    remoteId: number;
    title: string;
    thumbnailUrl: string | null;
    url: string | null;
    author: string | null;
    artist: string | null;
    description: string | null;
    genres: string[];
    status: MangaStatus;
    createdAt: number;
    series: string | null;
    season: number | null;
    seasonName: string | null;
}

export interface MangaChapterRecord {
    id: number;
    mangaId: number;
    remoteId: number;
    name: string;
    number: number | null;
    dateUploaded: number | null;
    scanlator: string | null;
    sourceOrder: number;
    status: MangaChapterStatus;
    pageCount: number;
    filePath: string | null;
    sizeBytes: number | null;
    error: MangaError | null;
    downloadedAt: number | null;
    addedAt: number | null;
}

export interface LibraryManga extends MangaRecord {
    chapters: MangaChapterRecord[];
    groupIds: number[];
}

export interface MangaGroup {
    id: number;
    name: string;
}

export const MAX_GROUP_NAME_LENGTH = 60;

export type MangaGroupDirection = 'up' | 'down';

export interface MangaSeriesRequest {
    mangaId: number;
    series: string | null;
    season: number | null;
    seasonName: string | null;
}

export type MangaSeriesResponse = { ok: true } | { ok: false; reason: 'invalid' } | { ok: false; reason: 'season-taken'; suggested: number };

export type MangaRenameSeriesResponse =
    | { ok: true }
    | { ok: false; reason: 'invalid' }
    | { ok: false; reason: 'season-taken'; manga: string; season: number; suggested: number };

export type MangaGroupResponse = { ok: true; group: MangaGroup } | { ok: false; reason: 'invalid' | 'taken' | 'not-found' };

export interface MangaSourceMigrationRequest {
    mangaId: number;
    target: MangaDownloadRequest;
}

export type MangaSourceMigrationFailure = 'invalid' | 'not-found' | 'same' | 'exists' | 'busy';

export type MangaSourceMigrationResponse =
    | { ok: true; manga: LibraryManga; matched: number; added: number; dropped: number }
    | { ok: false; reason: MangaSourceMigrationFailure };

export interface MangaJob {
    chapterId: number;
    mangaId: number;
    mangaTitle: string;
    chapterName: string;
    sourceId: string;
    status: 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled';
    pagesDone: number;
    pageCount: number;
    percent: number;
    bytesPerSecond: number | null;
    etaSeconds: number | null;
    error: MangaError | null;
    missingPages: number;
}

export interface MangaDownloadRequest {
    manga: MangaSummary;
    details: MangaDetails | null;
    chapters: MangaChapter[];
}

export type MangaServerStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface MangaHelperProblem {
    code: 'no-docker' | 'start-failed';
    message: string;
}

export interface MangaStatusInfo {
    supported: boolean;
    tool: ToolState | null;
    helper: ToolState | null;
    helperProblem: MangaHelperProblem | null;
    helperExternal: boolean;
    server: MangaServerStatus;
    serverError: string | null;
}

export interface MangaCloudflareActivity {
    id: number;
    host: string;
    startedAt: number;
}

export const MANGA_PAGE_SCHEME = 'pullwave-manga';

export function localPageUrl(chapterId: number, index: number): string {
    return `${MANGA_PAGE_SCHEME}://page/${String(chapterId)}/${String(index)}`;
}

export function localCoverUrl(mangaId: number, version: string): string {
    return `${MANGA_PAGE_SCHEME}://cover/${String(mangaId)}?v=${version}`;
}

export interface MangaReadRequest {
    chapterRemoteId: number;
    libraryChapterId: number | null;
}

export interface MangaReadPages {
    pages: string[];
    local: boolean;
    missing: number[];
}

export interface MangaRepairResult {
    missing: number[];
}

export type ExtensionAction = 'install' | 'uninstall' | 'update';

export interface ToolVersionInfo {
    current: string;
    latest: string | null;
    error: string | null;
    updatable: boolean;
}

export interface MangaToolVersions {
    flaresolverr: ToolVersionInfo | null;
}

export type MangaToolUpdateFailure = 'current' | 'failed' | 'busy' | 'not-installed' | 'unsupported';

export type MangaToolUpdateResult = { ok: true; version: string } | { ok: false; reason: MangaToolUpdateFailure; message: string | null };

export const HEALTH_STATES = ['healthy', 'starting', 'stopped', 'unhealthy', 'not-installed'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

export interface ComponentHealth {
    state: HealthState;
    version: string | null;
    message: string | null;
    external: boolean;
}

export interface MangaHealth {
    server: ComponentHealth;
    helper: ComponentHealth | null;
}

export interface MangaMigrationProgress {
    done: number;
    total: number;
}

export type MangaMigrationFailure = 'cancelled' | 'busy' | 'same' | 'inside' | 'conflict' | 'failed';

export type MangaMigrationResponse = { ok: true; chapters: number; files: number; destination: string } | { ok: false; reason: MangaMigrationFailure };

export interface MangaNewChapters {
    count: number;
    titles: string[];
}

export const ARRIVAL_ORIGINS = ['auto', 'manual', 'move'] as const;
export type ArrivalOrigin = (typeof ARRIVAL_ORIGINS)[number];

export interface MangaUpdateEntry {
    id: number;
    mangaId: number;
    mangaTitle: string;
    thumbnailUrl: string | null;
    chapterId: number;
    chapterRemoteId: number;
    chapterName: string;
    chapterNumber: number | null;
    dateUploaded: number | null;
    foundAt: number;
    origin: ArrivalOrigin;
    status: MangaChapterStatus;
}

export interface MangaCheckState {
    running: boolean;
    origin: ArrivalOrigin | null;
    done: number;
    total: number;
    current: string | null;
}

export const IDLE_MANGA_CHECK_STATE: MangaCheckState = { running: false, origin: null, done: 0, total: 0, current: null };

export type MangaCheckResponse = { ok: true; count: number; titles: string[]; failed: number; skipped: number } | { ok: false; error: MangaError };

export interface ReadingRecord {
    sourceId: string;
    mangaRemoteId: number;
    title: string;
    thumbnailUrl: string | null;
    chapterRemoteId: number;
    chapterName: string;
    chapterNumber: number | null;
    page: number;
    pageCount: number;
}

export interface ReadingEntry extends ReadingRecord {
    id: number;
    readAt: number;
    libraryMangaId: number | null;
}

export interface MangaApi {
    status: () => Promise<MangaStatusInfo>;
    install: () => Promise<ToolState | null>;
    stores: () => Promise<MangaResult<MangaExtensionStore[]>>;
    addStore: (indexUrl: string) => Promise<MangaResult<MangaExtensionStore>>;
    removeStore: (indexUrl: string) => Promise<MangaResult<null>>;
    extensions: (refresh: boolean) => Promise<MangaResult<MangaExtension[]>>;
    changeExtension: (pkgName: string, action: ExtensionAction) => Promise<MangaResult<null>>;
    updateAllExtensions: () => Promise<MangaResult<number>>;
    installHelper: () => Promise<void>;
    removeHelper: () => Promise<void>;
    sources: () => Promise<MangaResult<MangaSource[]>>;
    sourcePreferences: (sourceId: string) => Promise<MangaResult<MangaSourcePreference[]>>;
    readPages: (request: MangaReadRequest) => Promise<MangaResult<MangaReadPages>>;
    sourceFilters: (sourceId: string) => Promise<MangaResult<MangaFilter[]>>;
    setSourcePreference: (change: MangaPreferenceChange) => Promise<MangaResult<MangaSourcePreference[]>>;
    list: (request: MangaListRequest) => Promise<MangaResult<MangaListing>>;
    details: (remoteId: number) => Promise<MangaResult<MangaDetailsWithChapters>>;
    addToLibrary: (request: MangaDownloadRequest) => Promise<LibraryManga | null>;
    download: (request: MangaDownloadRequest) => Promise<LibraryManga | null>;
    downloadMissing: (mangaIds: number[]) => Promise<void>;
    library: () => Promise<LibraryManga[]>;
    libraryEntry: (mangaId: number) => Promise<LibraryManga | null>;
    jobs: () => Promise<MangaJob[]>;
    cancel: (chapterId: number) => Promise<void>;
    retry: (chapterId: number) => Promise<void>;
    repairChapter: (chapterId: number, pageIndex: number | null) => Promise<MangaResult<MangaRepairResult>>;
    pause: (chapterId: number) => Promise<void>;
    resume: (chapterId: number) => Promise<void>;
    pauseAll: () => Promise<void>;
    resumeAll: () => Promise<void>;
    pauseMangas: (mangaIds: number[]) => Promise<void>;
    resumeMangas: (mangaIds: number[]) => Promise<void>;
    cancelMangas: (mangaIds: number[]) => Promise<void>;
    queueHeld: () => Promise<boolean>;
    clearFinished: () => Promise<void>;
    removeDownload: (chapterId: number) => Promise<void>;
    removeManga: (mangaId: number) => Promise<void>;
    openFolder: (mangaId: number) => Promise<void>;
    openSite: (url: string) => Promise<void>;
    updates: () => Promise<MangaUpdateEntry[]>;
    clearUpdates: () => Promise<void>;
    checkNewChapters: (mangaId: number | null) => Promise<MangaCheckResponse>;
    checkState: () => Promise<MangaCheckState>;
    recordReading: (record: ReadingRecord) => Promise<void>;
    readingHistory: () => Promise<ReadingEntry[]>;
    removeReading: (id: number) => Promise<void>;
    clearReading: () => Promise<void>;
    migrateFolder: () => Promise<MangaMigrationResponse>;
    setSeries: (request: MangaSeriesRequest) => Promise<MangaSeriesResponse>;
    renameSeries: (mangaIds: number[], series: string) => Promise<MangaRenameSeriesResponse>;
    groups: () => Promise<MangaGroup[]>;
    createGroup: (name: string) => Promise<MangaGroupResponse>;
    renameGroup: (groupId: number, name: string) => Promise<MangaGroupResponse>;
    deleteGroup: (groupId: number) => Promise<void>;
    moveGroup: (groupId: number, direction: MangaGroupDirection) => Promise<void>;
    setGroupMembers: (groupId: number, mangaIds: number[], member: boolean) => Promise<void>;
    migrateSource: (request: MangaSourceMigrationRequest) => Promise<MangaSourceMigrationResponse>;
    checkToolUpdates: () => Promise<MangaToolVersions>;
    updateHelper: () => Promise<MangaToolUpdateResult>;
    health: (start: boolean) => Promise<MangaHealth>;
    restartPrograms: () => Promise<MangaHealth>;
    onMigrationProgress: (listener: (progress: MangaMigrationProgress) => void) => () => void;
    onNewChapters: (listener: (news: MangaNewChapters) => void) => () => void;
    onCheckState: (listener: (state: MangaCheckState) => void) => () => void;
    onToolState: (listener: (state: ToolState) => void) => () => void;
    onServerStatus: (listener: (status: MangaServerStatus) => void) => () => void;
    onCloudflareActivity: (listener: (active: MangaCloudflareActivity[]) => void) => () => void;
    onJobUpdate: (listener: (job: MangaJob) => void) => () => void;
    onQueueHeld: (listener: (held: boolean) => void) => () => void;
    onLibraryChanged: (listener: () => void) => () => void;
    onLibraryEntryChanged: (listener: (mangaId: number) => void) => () => void;
}

export function isMangaSupported(platform: string, arch: string): boolean {
    return arch === 'x64' && (platform === 'linux' || platform === 'win32');
}
