import type { MessageKey, Translator } from '@shared/i18n';
import { foldSeries } from '@shared/series';
import type { LibraryManga, MangaCloudflareActivity, MangaChapterRecord, MangaDetailsWithChapters, MangaChapterStatus, MangaError, MangaErrorCode, MangaExtension, MangaJob, MangaSource, MangaStatus } from '@shared/manga';
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

// The text of an error for the user: the one of its code, except where the source is known to hand over no pages (the extension could not
// find the list of pages of the chapter).
export function mangaErrorTextKey(error: MangaError): MessageKey {
    if (error.code === 'API_ERROR' && /Failed to find page list/i.test(error.message)) {
        return 'manga.error.noPageList';
    }
    return ERROR_KEYS[error.code];
}

// Everything the backend said about the error, to be pasted where it is debugged.
export function technicalErrorText(error: MangaError): string {
    return `${error.code}\n${error.message}`;
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
// What the library knows of a manga, in the shape of what the source answers: the page of a manga of the library opens with it, with no
// need for the source.
export function localDetails(manga: LibraryManga): MangaDetailsWithChapters {
    return {
        details: {
            remoteId: manga.remoteId,
            sourceId: manga.sourceId,
            title: manga.title,
            thumbnailUrl: manga.thumbnailUrl,
            url: manga.url,
            author: manga.author,
            artist: manga.artist,
            description: manga.description,
            genres: manga.genres,
            status: manga.status
        },
        chapters: manga.chapters.map((chapter) => {
            return { remoteId: chapter.remoteId, name: chapter.name, number: chapter.number, dateUploaded: chapter.dateUploaded, scanlator: chapter.scanlator, sourceOrder: chapter.sourceOrder };
        })
    };
}

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

// What a chapter is called in a list: its name, or its number when it has none.
export function chapterLabel(name: string, number: number | null): string {
    if (name.length > 0) {
        return name;
    }
    return number === null ? '' : `#${String(number)}`;
}

// The entries of a list in the order they come, split by the day (of the computer) of the time each one has: `day` is the start of that
// day, in milliseconds.
export function groupByDay<T>(entries: readonly T[], timeOf: (entry: T) => number): Array<{ day: number; entries: T[] }> {
    const groups: Array<{ day: number; entries: T[] }> = [];
    entries.forEach((entry) => {
        const date = new Date(timeOf(entry));
        const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
        const last = groups.at(-1);
        if (last !== undefined && last.day === day) {
            last.entries.push(entry);
        } else {
            groups.push({ day, entries: [entry] });
        }
    });
    return groups;
}

// The state of a chapter of the source in the library (idle when the library does not have it).
export function chapterState(manga: LibraryManga | null, remoteId: number): MangaChapterRecord | null {
    return (
        manga?.chapters.find((chapter) => {
            return chapter.remoteId === remoteId;
        }) ?? null
    );
}

// Whether picking a chapter of the library for a download makes sense: not when it is downloaded already, or waiting or going on.
export function canDownload(chapter: Pick<MangaChapterRecord, 'status'> | null): boolean {
    return chapter === null || (chapter.status !== 'done' && chapter.status !== 'queued' && chapter.status !== 'downloading' && chapter.status !== 'paused');
}

// Of the chapters picked, the ones that a download would do something for.
export function downloadablePicks(manga: LibraryManga | null, picked: readonly number[]): number[] {
    return picked.filter((remoteId) => {
        return canDownload(chapterState(manga, remoteId));
    });
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

// The mangas of the library that are in the group; with no group chosen (the tab of all), the ones that are in no group: a manga that is
// put in a group leaves that tab.
export function inGroup(library: readonly LibraryManga[], groupId: number | null): LibraryManga[] {
    return library.filter((manga) => {
        return groupId === null ? manga.groupIds.length === 0 : manga.groupIds.includes(groupId);
    });
}

// The group the library is limited to: the one chosen, and when the tab of all is not there (every manga is in a group) the first group.
export function activeGroup(library: readonly LibraryManga[], groups: ReadonlyArray<{ id: number }>, chosen: number | null): number | null {
    if (chosen !== null || inGroup(library, null).length > 0) {
        return chosen;
    }
    return groups[0]?.id ?? null;
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

// The orders the other mangas of a series have (the manga being edited is left out).
export function takenSeasons(library: readonly LibraryManga[], series: string, exceptMangaId: number): number[] {
    const wanted = foldSeries(series);
    return library.flatMap((manga) => {
        return manga.id !== exceptMangaId && manga.series !== null && manga.season !== null && wanted.length > 0 && foldSeries(manga.series) === wanted ? [manga.season] : [];
    });
}

// The order after the last one the series has (the one the library offers when the order wanted is taken).
export function nextSeason(taken: readonly number[]): number {
    return Math.max(0, ...taken) + 1;
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

// Whether a chapter is new today: the day the source published it when the source says so, else the day it arrived in the library (the
// chapters a manga comes with have no day of arrival, so they are not new then).
export function isNewChapter(chapter: Pick<MangaChapterRecord, 'addedAt' | 'dateUploaded'>, now: number = Date.now()): boolean {
    const day = chapter.dateUploaded ?? chapter.addedAt;
    return day !== null && new Date(day).toDateString() === new Date(now).toDateString();
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

// ---- The check of Cloudflare, for the source the user is in ----

// A site name as it is compared: without the "www." in front.
function siteOf(host: string): string {
    return host.toLowerCase().replace(/^www\./, '');
}

function hostOfAddress(address: string | null): string | null {
    if (address === null) {
        return null;
    }
    try {
        return siteOf(new URL(address).hostname);
    } catch {
        return null;
    }
}

// Where the user is, as far as the sources go: the source of the manga being read or open, or else the one being browsed; and whether
// something of it is being asked for now. Nothing in the other screens (the library, the history, the settings...).
export interface SourceScope {
    sourceId: string | null;
    loading: boolean;
}

export interface SourceScopeState {
    view: string;
    browse: { sourceId: string | null; status: string; filtersStatus: string; loadingMore: boolean };
    sourceSettings: { status: string };
    selection: { manga: { sourceId: string }; status: string } | null;
    selectionRefresh: { loading: boolean };
    reader: { status: string; manga?: { sourceId: string } | null };
}

export function sourceScope(state: SourceScopeState): SourceScope {
    if (state.reader.status !== 'closed') {
        return { sourceId: state.reader.manga?.sourceId ?? state.selection?.manga.sourceId ?? null, loading: state.reader.status === 'loading' };
    }
    if (state.selection !== null) {
        return { sourceId: state.selection.manga.sourceId, loading: state.selection.status === 'loading' || state.selectionRefresh.loading };
    }
    if (state.view === 'browse' && state.browse.sourceId !== null) {
        return { sourceId: state.browse.sourceId, loading: state.browse.status === 'loading' || state.browse.filtersStatus === 'loading' || state.browse.loadingMore || state.sourceSettings.status === 'loading' };
    }
    return { sourceId: null, loading: false };
}

// The checks of Cloudflare that are about the source the user is in. The site of a check says which source it is for when the library has a
// manga of that site (its page on the site is kept); when the site is not known, the check is taken for the one of the source that is being
// asked for (nothing else asks the sources for what is not in the library). Never a check that is about another source.
export function checksForSource(checks: readonly MangaCloudflareActivity[], scope: SourceScope, library: readonly LibraryManga[], openPage: string | null): MangaCloudflareActivity[] {
    if (scope.sourceId === null) {
        return [];
    }
    const sources = new Map<string, string>();
    library.forEach((manga) => {
        const site = hostOfAddress(manga.url);
        if (site !== null) {
            sources.set(site, manga.sourceId);
        }
    });
    const open = hostOfAddress(openPage);
    if (open !== null) {
        sources.set(open, scope.sourceId);
    }
    return checks.filter((check) => {
        const known = sources.get(siteOf(check.host));
        return known === undefined ? scope.loading : known === scope.sourceId;
    });
}
