import type { MessageKey } from '@shared/i18n';
import type { LibraryManga, MangaChapterRecord, MangaChapterStatus, MangaErrorCode, MangaExtension, MangaJob, MangaStatus } from '@shared/manga';
import type { ToolErrorCode } from '@shared/tools';

// The store the app suggests: the one most extensions for Mihon and Tachiyomi come from.
// Shown in the field of the address of a store, as an example of one (the user is the one who adds stores).
export const STORE_PLACEHOLDER = 'https://example.com/extensions/index.min.json';

const ERROR_KEYS: Record<MangaErrorCode, MessageKey> = {
    SERVER_UNAVAILABLE: 'manga.error.SERVER_UNAVAILABLE',
    REQUEST_FAILED: 'manga.error.REQUEST_FAILED',
    API_ERROR: 'manga.error.API_ERROR',
    INVALID_RESPONSE: 'manga.error.INVALID_RESPONSE',
    INVALID_REQUEST: 'manga.error.INVALID_REQUEST',
    NOT_FOUND: 'manga.error.NOT_FOUND',
    EMPTY_CHAPTER: 'manga.error.EMPTY_CHAPTER',
    IMAGE: 'manga.error.IMAGE',
    DISK: 'manga.error.DISK',
    UNKNOWN: 'manga.error.UNKNOWN'
};

const TOOL_ERROR_KEYS: Record<ToolErrorCode, MessageKey> = {
    UNSUPPORTED_PLATFORM: 'manga.setup.error.UNSUPPORTED_PLATFORM',
    DOWNLOAD_FAILED: 'manga.setup.error.DOWNLOAD_FAILED',
    HASH_MISMATCH: 'manga.setup.error.HASH_MISMATCH',
    EXTRACT_FAILED: 'manga.setup.error.EXTRACT_FAILED',
    INCOMPLETE: 'manga.setup.error.INCOMPLETE',
    DISK: 'manga.setup.error.DISK',
    DOCKER_MISSING: 'manga.setup.error.DOCKER_MISSING'
};

const CHAPTER_STATUS_KEYS: Record<MangaChapterStatus, MessageKey> = {
    idle: 'manga.chapter.status.idle',
    queued: 'manga.chapter.status.queued',
    downloading: 'manga.chapter.status.downloading',
    paused: 'manga.chapter.status.paused',
    done: 'manga.chapter.status.done',
    error: 'manga.chapter.status.error',
    cancelled: 'manga.chapter.status.cancelled'
};

const JOB_STATUS_KEYS: Record<MangaJob['status'], MessageKey> = {
    queued: 'manga.jobs.status.queued',
    running: 'manga.jobs.status.running',
    paused: 'manga.jobs.status.paused',
    done: 'manga.jobs.status.done',
    error: 'manga.jobs.status.error',
    cancelled: 'manga.jobs.status.cancelled'
};

const MANGA_STATUS_KEYS: Record<MangaStatus, MessageKey> = {
    unknown: 'manga.detail.status.unknown',
    ongoing: 'manga.detail.status.ongoing',
    completed: 'manga.detail.status.completed',
    hiatus: 'manga.detail.status.hiatus',
    cancelled: 'manga.detail.status.cancelled'
};

export function mangaErrorKey(code: MangaErrorCode): MessageKey {
    return ERROR_KEYS[code];
}

export function toolErrorKey(code: ToolErrorCode): MessageKey {
    return TOOL_ERROR_KEYS[code];
}

// Whether the server says the site is behind Cloudflare (what it answers when its bypass is off, or when the bypass does not get through).
export function isCloudflareError(error: { message: string }): boolean {
    return /cloudflare/i.test(error.message);
}

export function chapterStatusKey(status: MangaChapterStatus): MessageKey {
    return CHAPTER_STATUS_KEYS[status];
}

export function jobStatusKey(status: MangaJob['status']): MessageKey {
    return JOB_STATUS_KEYS[status];
}

export function mangaStatusKey(status: MangaStatus): MessageKey {
    return MANGA_STATUS_KEYS[status];
}

// The manga of the library that is this one of a source (null when it is not there).
export function libraryEntry(library: readonly LibraryManga[], sourceId: string, remoteId: number): LibraryManga | null {
    return (
        library.find((manga) => {
            return manga.sourceId === sourceId && manga.remoteId === remoteId;
        }) ?? null
    );
}

// How many chapters of a manga of the library are downloaded.
export function downloadedCount(manga: Pick<LibraryManga, 'chapters'>): number {
    return manga.chapters.filter((chapter) => {
        return chapter.status === 'done';
    }).length;
}

// The state of a chapter of the source in the library (idle when the library does not have it).
export function chapterState(manga: LibraryManga | null, remoteId: number): MangaChapterRecord | null {
    return (
        manga?.chapters.find((chapter) => {
            return chapter.remoteId === remoteId;
        }) ?? null
    );
}

// The downloads that are waiting or going on.
export function activeJobCount(jobs: readonly MangaJob[]): number {
    return jobs.filter((job) => {
        return job.status === 'queued' || job.status === 'running';
    }).length;
}

export interface ExtensionFilter {
    query: string;
    lang: string;
    onlyInstalled: boolean;
}

export const ALL_LANGUAGES = 'all-languages';

// The extensions that match the text, the language and the installed-only choice, the installed ones first and then by name.
export function filterExtensions(extensions: readonly MangaExtension[], filter: ExtensionFilter): MangaExtension[] {
    const query = filter.query.trim().toLowerCase();
    return extensions
        .filter((extension) => {
            return (
                (query.length === 0 || extension.name.toLowerCase().includes(query)) &&
                (filter.lang === ALL_LANGUAGES || extension.lang === filter.lang) &&
                (!filter.onlyInstalled || extension.isInstalled)
            );
        })
        .sort((first, second) => {
            return Number(second.isInstalled) - Number(first.isInstalled) || first.name.localeCompare(second.name);
        });
}

// The languages the extensions are in, sorted.
export function extensionLanguages(extensions: readonly MangaExtension[]): string[] {
    return [...new Set(extensions.map((extension) => {
        return extension.lang;
    }))].sort();
}
