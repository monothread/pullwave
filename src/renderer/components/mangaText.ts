import type { MessageKey, Translator } from '@shared/i18n';
import { foldSeries } from '@shared/series';
import type { LibraryManga, MangaChapterRecord, MangaChapterStatus, MangaErrorCode, MangaExtension, MangaJob, MangaSource, MangaStatus } from '@shared/manga';
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

// Whether something with this content warning is listed: the ones for adults only when the user asked for them.
export function isListed(contentWarning: MangaSource['contentWarning'], showAdult: boolean): boolean {
    return showAdult || contentWarning !== 'NSFW';
}

// The sources that are listed (the ones for adults only when the user asked for them).
export function listedSources(sources: readonly MangaSource[], showAdult: boolean): MangaSource[] {
    return sources.filter((source) => {
        return isListed(source.contentWarning, showAdult);
    });
}

// The extensions that match the text, the language and the installed-only choice (the ones for adults only when the user asked for them),
// the installed ones first and then by name.
export function filterExtensions(extensions: readonly MangaExtension[], filter: ExtensionFilter, showAdult: boolean): MangaExtension[] {
    const query = filter.query.trim().toLowerCase();
    return extensions
        .filter((extension) => {
            return (
                (query.length === 0 || extension.name.toLowerCase().includes(query)) &&
                (filter.lang === ALL_LANGUAGES || extension.lang === filter.lang) &&
                (!filter.onlyInstalled || extension.isInstalled) &&
                isListed(extension.contentWarning, showAdult)
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

// One card of the library: a series with its seasons in order. Every manga is in one: a manga that was never joined to a series is the
// only season of a series with its own title.
export interface MangaLibraryGroup {
    key: string;
    // The name of the series.
    series: string;
    entries: LibraryManga[];
}

// Alphabetical order for names: no matter the case or the accents, and numbers by their value ("Naruto 2" before "Naruto 10").
export function compareNames(first: string, second: string): number {
    return first.localeCompare(second, undefined, { sensitivity: 'base', numeric: true });
}

// Joins the mangas of the library that are seasons of one series (the same name, whatever the case or the accents); a manga that has no
// series is a series of its own. The cards are in alphabetical order and the seasons of a series by their place in it.
export function groupLibrary(library: readonly LibraryManga[]): MangaLibraryGroup[] {
    const groups: MangaLibraryGroup[] = [];
    const bySeries = new Map<string, MangaLibraryGroup>();
    library.forEach((manga) => {
        if (manga.series === null || manga.season === null) {
            groups.push({ key: `manga-${String(manga.id)}`, series: manga.title, entries: [manga] });
            return;
        }
        const key = foldSeries(manga.series);
        const found = bySeries.get(key);
        if (found) {
            found.entries.push(manga);
            return;
        }
        const created: MangaLibraryGroup = { key: `series-${key}`, series: manga.series, entries: [manga] };
        bySeries.set(key, created);
        groups.push(created);
    });
    groups.forEach((group) => {
        group.entries.sort((first, second) => {
            return (first.season ?? 0) - (second.season ?? 0) || first.id - second.id;
        });
    });
    return groups.sort((first, second) => {
        return compareNames(first.series, second.series);
    });
}

// The label of a manga inside its series: the name the user gave it, otherwise "SEASON N" from its place in the series.
export function seasonLabel(manga: Pick<LibraryManga, 'season' | 'seasonName'>, t: Translator): string {
    return manga.seasonName ?? t('anime.series.season', { number: manga.season ?? 1 });
}

function foldText(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// Whether a text matches what was typed in the search of the library: no matter the case or the accents; an empty search matches all.
export function matchesSearch(text: string, search: string): boolean {
    const wanted = foldText(search.trim());
    return wanted.length === 0 || foldText(text).includes(wanted);
}

// The mangas of the library that are in the group (every manga when no group is chosen).
export function inGroup(library: readonly LibraryManga[], groupId: number | null): LibraryManga[] {
    return groupId === null
        ? [...library]
        : library.filter((manga) => {
              return manga.groupIds.includes(groupId);
          });
}

// How many chapters of the mangas are downloaded, and how many there are.
export function downloadedTotals(mangas: readonly LibraryManga[]): { done: number; total: number } {
    return mangas.reduce(
        (totals, manga) => {
            return { done: totals.done + downloadedCount(manga), total: totals.total + manga.chapters.length };
        },
        { done: 0, total: 0 }
    );
}

// The names of the series the library has, once each.
export function seriesNames(library: readonly LibraryManga[]): string[] {
    const seen = new Map<string, string>();
    library.forEach((manga) => {
        if (manga.series !== null && !seen.has(foldSeries(manga.series))) {
            seen.set(foldSeries(manga.series), manga.series);
        }
    });
    return [...seen.values()].sort(compareNames);
}

// Which chapter "continue reading" opens, among the chapters in reading order: the one the manga was left on when it is not read yet,
// otherwise the first that is not read, otherwise the first (everything is read: it starts again). Gives -1 for no chapters.
export function continueIndex(chapters: ReadonlyArray<{ remoteId: number }>, isRead: (remoteId: number) => boolean, lastRemoteId: number | null): number {
    if (chapters.length === 0) {
        return -1;
    }
    const last = lastRemoteId === null ? -1 : chapters.findIndex((chapter) => {
        return chapter.remoteId === lastRemoteId;
    });
    if (last !== -1 && !isRead(lastRemoteId ?? 0)) {
        return last;
    }
    const firstUnread = chapters.findIndex((chapter) => {
        return !isRead(chapter.remoteId);
    });
    return firstUnread === -1 ? 0 : firstUnread;
}

// Whether a chapter arrived in the library today (the chapters a manga comes with are not new).
export function isNewChapter(chapter: Pick<MangaChapterRecord, 'addedAt'>, now: number = Date.now()): boolean {
    return chapter.addedAt !== null && new Date(chapter.addedAt).toDateString() === new Date(now).toDateString();
}

// How many chapters of the mangas are new today.
export function newChapterCount(mangas: readonly LibraryManga[], now: number = Date.now()): number {
    return mangas.reduce((total, manga) => {
        return (
            total +
            manga.chapters.filter((chapter) => {
                return isNewChapter(chapter, now);
            }).length
        );
    }, 0);
}
