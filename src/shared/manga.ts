import type { ToolState } from './tools';

// The manga section: what the extension server (Suwayomi) answers, and what the library and the downloads of chapters report.
// Shared by the main process and the screen.

export const MANGA_STATUSES = ['unknown', 'ongoing', 'completed', 'hiatus', 'cancelled'] as const;
export type MangaStatus = (typeof MANGA_STATUSES)[number];

export const CONTENT_WARNINGS = ['SAFE', 'MIXED', 'NSFW'] as const;
export type ContentWarning = (typeof CONTENT_WARNINGS)[number];

// ---------------------------------------------------------------------------------------------------------------------
// Extensions and sources
// ---------------------------------------------------------------------------------------------------------------------

// A list of extensions the server reads (the address of its index).
export interface MangaExtensionStore {
    indexUrl: string;
    name: string;
}

// The versions of the library of extensions the server runs (the ones outside of it are refused when installed).
export const EXTENSION_LIB_MIN = 1.3;
export const EXTENSION_LIB_MAX = 1.6;

// Whether the server can run an extension made for this version of the library (true when the store does not say).
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
    // The store no longer lists it.
    isObsolete: boolean;
    iconUrl: string | null;
    contentWarning: ContentWarning;
    storeIndexUrl: string | null;
    // The version of the library of extensions it was made for, when the store says.
    extensionLib: string | null;
    // The server can run it (its library version is one the server supports).
    isCompatible: boolean;
}

// A site an installed extension reads.
export interface MangaSource {
    id: string;
    name: string;
    lang: string;
    iconUrl: string | null;
    supportsLatest: boolean;
    // The source has settings the user can change (some need them before they work).
    isConfigurable: boolean;
    contentWarning: ContentWarning;
    extensionPkg: string | null;
    // The store the extension of the source comes from.
    storeIndexUrl: string | null;
}

// One setting of a source, as the server describes it. `position` is its place in the list of the source, which is how a change names
// it.
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

// ---------------------------------------------------------------------------------------------------------------------
// Mangas, chapters and pages
// ---------------------------------------------------------------------------------------------------------------------

export interface MangaSummary {
    // The number the server knows the manga by.
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
    // The page of the manga on the site of the source.
    url: string | null;
    author: string | null;
    artist: string | null;
    description: string | null;
    genres: string[];
    status: MangaStatus;
}

export interface MangaChapter {
    // The number the server knows the chapter by.
    remoteId: number;
    name: string;
    // The number of the chapter when the source tells it (used to order and to name the file).
    number: number | null;
    // Milliseconds since 1970 when known.
    dateUploaded: number | null;
    scanlator: string | null;
    // The place of the chapter in the list of its source, as the server numbers it: the oldest chapter has the lowest number and the newest
    // the highest.
    sourceOrder: number;
}

export interface MangaDetailsWithChapters {
    details: MangaDetails;
    chapters: MangaChapter[];
}

// A filter of the search of a source (genres, tags, status, order...), as the extension describes it. Its place in its list names it when
// it is sent back. The value is the one it has now (what the extension starts with, or what the user chose).
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
    // The filters of a search, as the user left them (none: the extension's own).
    filters?: MangaFilter[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------------------------------

export type MangaErrorCode =
    | 'SERVER_UNAVAILABLE'
    | 'REQUEST_FAILED'
    | 'API_ERROR'
    | 'INVALID_RESPONSE'
    | 'INVALID_REQUEST'
    | 'NOT_FOUND'
    // Download of a chapter:
    | 'EMPTY_CHAPTER'
    | 'IMAGE'
    | 'DISK'
    | 'UNKNOWN';

export interface MangaError {
    code: MangaErrorCode;
    message: string;
}

export type MangaResult<T> = { ok: true; value: T } | { ok: false; error: MangaError };

// ---------------------------------------------------------------------------------------------------------------------
// The library and the downloads
// ---------------------------------------------------------------------------------------------------------------------

export const MANGA_CHAPTER_STATUSES = ['idle', 'queued', 'downloading', 'paused', 'done', 'error', 'cancelled'] as const;
export type MangaChapterStatus = (typeof MANGA_CHAPTER_STATUSES)[number];

export const MANGA_OUTPUT_FORMATS = ['cbz', 'folder'] as const;
export type MangaOutputFormat = (typeof MANGA_OUTPUT_FORMATS)[number];

export interface MangaRecord {
    id: number;
    sourceId: string;
    remoteId: number;
    title: string;
    thumbnailUrl: string | null;
    // The page of the manga on the site of the source, when the source told it.
    url: string | null;
    author: string | null;
    artist: string | null;
    description: string | null;
    genres: string[];
    status: MangaStatus;
    createdAt: number;
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
}

export interface LibraryManga extends MangaRecord {
    chapters: MangaChapterRecord[];
}

export interface MangaJob {
    chapterId: number;
    mangaId: number;
    mangaTitle: string;
    chapterName: string;
    sourceId: string;
    status: 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled';
    // Pages downloaded so far and in all (0 until the source has told how many there are).
    pagesDone: number;
    pageCount: number;
    // 0 to 100.
    percent: number;
    error: MangaError | null;
}

export interface MangaDownloadRequest {
    manga: MangaSummary;
    // What the source says about the manga, when it is known (it goes into the ComicInfo of each chapter).
    details: MangaDetails | null;
    chapters: MangaChapter[];
}

// ---------------------------------------------------------------------------------------------------------------------
// What the screen can ask of the main process
// ---------------------------------------------------------------------------------------------------------------------

export type MangaServerStatus = 'stopped' | 'starting' | 'running' | 'error';

// Why the helper for Cloudflare cannot be used right now (when it is downloaded and should be).
export interface MangaHelperProblem {
    // `no-docker`: Docker, which runs it, is not installed or not running. `start-failed`: its image could not be pulled or it did not start.
    code: 'no-docker' | 'start-failed';
    message: string;
}

export interface MangaStatusInfo {
    // Whether the manga section exists on this system (Linux and Windows, 64 bits).
    supported: boolean;
    // The program that runs the extensions: downloaded when the app opens.
    tool: ToolState | null;
    // The program that gets past the check of Cloudflare, which some sites have (downloaded too; the sites that have none work without it).
    helper: ToolState | null;
    helperProblem: MangaHelperProblem | null;
    // The user gave the address of a FlareSolverr of their own: the app does not download or start one.
    helperExternal: boolean;
    server: MangaServerStatus;
    serverError: string | null;
}

// A check of Cloudflare that is going on (the helper is solving it in a browser, which can take a minute).
export interface MangaCloudflareActivity {
    id: number;
    // The site it is for.
    host: string;
    startedAt: number;
}

// The scheme the screen reads the pages of a chapter that was downloaded through: `pullwave-manga://page/<chapter id>/<page number>`.
export const MANGA_PAGE_SCHEME = 'pullwave-manga';

export function localPageUrl(chapterId: number, index: number): string {
    return `${MANGA_PAGE_SCHEME}://page/${String(chapterId)}/${String(index)}`;
}

// A chapter to read: the one on the server and, when it is in the library, the one of the library (its file is read when it is there).
export interface MangaReadRequest {
    chapterRemoteId: number;
    libraryChapterId: number | null;
}

export interface MangaReadPages {
    // The addresses of the pages, in reading order.
    pages: string[];
    // The pages come from the downloaded file and not from the source.
    local: boolean;
}

export type ExtensionAction = 'install' | 'uninstall' | 'update';

// ---------------------------------------------------------------------------------------------------------------------
// Moving the library to another folder
// ---------------------------------------------------------------------------------------------------------------------

export interface MangaMigrationProgress {
    // Files copied so far, and the files to copy in all.
    done: number;
    total: number;
}

export type MangaMigrationFailure = 'cancelled' | 'busy' | 'same' | 'inside' | 'conflict' | 'failed';

export type MangaMigrationResponse = { ok: true; chapters: number; files: number; destination: string } | { ok: false; reason: MangaMigrationFailure };

// New chapters that the hourly check found in the mangas of the library.
export interface MangaNewChapters {
    // How many chapters were added to the library, and the titles of the mangas that got them.
    count: number;
    titles: string[];
}

export interface MangaApi {
    status: () => Promise<MangaStatusInfo>;
    // Downloads the program again after it failed.
    install: () => Promise<ToolState | null>;
    stores: () => Promise<MangaResult<MangaExtensionStore[]>>;
    addStore: (indexUrl: string) => Promise<MangaResult<MangaExtensionStore>>;
    removeStore: (indexUrl: string) => Promise<MangaResult<null>>;
    // `refresh` asks the stores for their lists again first.
    extensions: (refresh: boolean) => Promise<MangaResult<MangaExtension[]>>;
    changeExtension: (pkgName: string, action: ExtensionAction) => Promise<MangaResult<null>>;
    // Updates every installed extension that has an update; answers with how many were updated.
    updateAllExtensions: () => Promise<MangaResult<number>>;
    // Installs the helper for sites behind Cloudflare (needs Docker), or removes it.
    installHelper: () => Promise<void>;
    removeHelper: () => Promise<void>;
    sources: () => Promise<MangaResult<MangaSource[]>>;
    // The settings of a source, and a change to one of them (answered with the settings as they are now).
    sourcePreferences: (sourceId: string) => Promise<MangaResult<MangaSourcePreference[]>>;
    // The pages of a chapter: from its file when it was downloaded, from the source when not.
    readPages: (request: MangaReadRequest) => Promise<MangaResult<MangaReadPages>>;
    // The filters a source offers for its search.
    sourceFilters: (sourceId: string) => Promise<MangaResult<MangaFilter[]>>;
    setSourcePreference: (change: MangaPreferenceChange) => Promise<MangaResult<MangaSourcePreference[]>>;
    list: (request: MangaListRequest) => Promise<MangaResult<MangaListing>>;
    details: (remoteId: number) => Promise<MangaResult<MangaDetailsWithChapters>>;
    // Puts a manga in the library with the chapters given, none of them downloaded.
    addToLibrary: (request: MangaDownloadRequest) => Promise<LibraryManga | null>;
    download: (request: MangaDownloadRequest) => Promise<LibraryManga | null>;
    downloadMissing: (mangaIds: number[]) => Promise<void>;
    library: () => Promise<LibraryManga[]>;
    jobs: () => Promise<MangaJob[]>;
    cancel: (chapterId: number) => Promise<void>;
    retry: (chapterId: number) => Promise<void>;
    pause: (chapterId: number) => Promise<void>;
    resume: (chapterId: number) => Promise<void>;
    clearFinished: () => Promise<void>;
    removeChapter: (chapterId: number) => Promise<void>;
    removeManga: (mangaId: number) => Promise<void>;
    openFolder: (mangaId: number) => Promise<void>;
    // Opens the page of a manga on the site of its source, in the browser of the system (only an http or https address is opened).
    openSite: (url: string) => Promise<void>;
    // Asks for a folder and moves the downloaded chapters there, then says how it went.
    migrateFolder: () => Promise<MangaMigrationResponse>;
    onMigrationProgress: (listener: (progress: MangaMigrationProgress) => void) => () => void;
    // The hourly check added chapters to the library.
    onNewChapters: (listener: (news: MangaNewChapters) => void) => () => void;
    onToolState: (listener: (state: ToolState) => void) => () => void;
    onServerStatus: (listener: (status: MangaServerStatus) => void) => () => void;
    // The checks of Cloudflare that are going on, every time they change (an empty list when none is).
    onCloudflareActivity: (listener: (active: MangaCloudflareActivity[]) => void) => () => void;
    onJobUpdate: (listener: (job: MangaJob) => void) => () => void;
    onLibraryChanged: (listener: () => void) => () => void;
}

// Where the manga section exists.
export function isMangaSupported(platform: string, arch: string): boolean {
    return arch === 'x64' && (platform === 'linux' || platform === 'win32');
}
