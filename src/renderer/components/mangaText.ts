import type { MessageKey, Translator } from '@shared/i18n';
import { foldSeries } from '@shared/series';
import { hasChapterFile } from '@shared/manga';
import { groupByZonedDay, isSameZonedDay, machineTimeZone } from '@shared/timezone';
import type { LibraryManga, MangaChapter, MangaChapterMove, MangaCloudflareActivity, MangaChapterRecord, MangaDetailsWithChapters, MangaChapterStatus, MangaError, MangaErrorCode, MangaExtension, MangaJob, MangaSource, MangaStatus, MangaUpdateEntry } from '@shared/manga';
import type { ToolError, ToolErrorCode } from '@shared/tools';
import type { MangaReaderState, ReaderChapter } from '../store/mangaStore';
import { codedErrorReport, type ErrorReport } from './errorReport';

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
    DOCKER_MISSING: 'manga.setup.error.DOCKER_MISSING',
    INVALID: 'manga.setup.error.INVALID'
};

const CHAPTER_STATUS_KEYS: Record<MangaChapterStatus, MessageKey> = {
    idle: 'manga.chapter.status.idle',
    queued: 'manga.chapter.status.queued',
    downloading: 'manga.chapter.status.downloading',
    paused: 'manga.chapter.status.paused',
    done: 'manga.chapter.status.done',
    incomplete: 'manga.chapter.status.incomplete',
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

export function mangaErrorTextKey(error: MangaError): MessageKey {
    if (error.code === 'API_ERROR' && /Failed to find page list/i.test(error.message)) {
        return 'manga.error.noPageList';
    }
    return ERROR_KEYS[error.code];
}

export function toolErrorKey(code: ToolErrorCode): MessageKey {
    return TOOL_ERROR_KEYS[code];
}

export function toolErrorReport(t: Translator, error: ToolError): ErrorReport {
    return codedErrorReport(t(toolErrorKey(error.code)), error, error.message);
}

export function mangaErrorReport(t: Translator, error: MangaError, summary: string = t(mangaErrorTextKey(error))): ErrorReport {
    return codedErrorReport(summary, error, error.message);
}

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
        chapters: manga.chapters.map(toSourceChapter)
    };
}

function toSourceChapter(chapter: MangaChapterRecord): MangaChapter {
    return { remoteId: chapter.remoteId, name: chapter.name, number: chapter.number, dateUploaded: chapter.dateUploaded, scanlator: chapter.scanlator, sourceOrder: chapter.sourceOrder };
}

export function withLibraryChapters(chapters: readonly MangaChapter[], saved: Pick<LibraryManga, 'chapters'> | null): MangaChapter[] {
    if (saved === null) {
        return [...chapters];
    }
    const listed = new Set(
        chapters.map((chapter) => {
            return chapter.remoteId;
        })
    );
    const unlisted = saved.chapters
        .filter((chapter) => {
            return !listed.has(chapter.remoteId);
        })
        .map(toSourceChapter);
    return [...chapters, ...unlisted];
}

export function libraryChapterIds(library: readonly LibraryManga[]): Set<number> {
    const ids = new Set<number>();
    library.forEach((manga) => {
        manga.chapters.forEach((chapter) => {
            ids.add(chapter.remoteId);
        });
    });
    return ids;
}

export function chapterMovesByNumber(oldChapters: readonly MangaChapter[], currentChapters: ReadonlyArray<Pick<MangaChapterRecord, 'remoteId' | 'number'>>): MangaChapterMove[] {
    const byNumber = new Map<number, number | null>();
    currentChapters.forEach((chapter) => {
        if (chapter.number !== null) {
            byNumber.set(chapter.number, byNumber.has(chapter.number) ? null : chapter.remoteId);
        }
    });
    return oldChapters.flatMap((chapter) => {
        const to = chapter.number === null ? undefined : byNumber.get(chapter.number);
        return to === undefined || to === null ? [] : [{ from: chapter.remoteId, to }];
    });
}

export function libraryEntry(library: readonly LibraryManga[], sourceId: string, remoteId: number): LibraryManga | null {
    return (
        library.find((manga) => {
            return manga.sourceId === sourceId && manga.remoteId === remoteId;
        }) ?? null
    );
}

function foldTitle(title: string): string {
    return title.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function libraryEntriesByTitle(library: readonly LibraryManga[], title: string, sourceId: string): LibraryManga[] {
    const wanted = foldTitle(title);
    if (wanted.length === 0) {
        return [];
    }
    return library.filter((manga) => {
        return manga.sourceId !== sourceId && foldTitle(manga.title) === wanted;
    });
}

export function otherSourceNames(entries: readonly LibraryManga[], sources: readonly MangaSource[]): string[] {
    const names = entries.map((entry) => {
        return sources.find((source) => {
            return source.id === entry.sourceId;
        })?.name ?? entry.sourceId;
    });
    return [...new Set(names)];
}

export function sourceIsMissing(sources: readonly MangaSource[], sourcesStatus: 'idle' | 'loading' | 'ready' | 'error', sourceId: string): boolean {
    return (
        sourcesStatus === 'ready' &&
        sourceId !== LOCAL_SOURCE_ID &&
        !sources.some((source) => {
            return source.id === sourceId;
        })
    );
}

export function sourceLabelsOf(sources: readonly MangaSource[], mangas: readonly Pick<LibraryManga, 'sourceId'>[]): string[] {
    const labels = mangas.flatMap((manga) => {
        const source = sources.find((candidate) => {
            return candidate.id === manga.sourceId;
        });
        return source === undefined ? [] : [`${source.name} · ${source.lang.toUpperCase()}`];
    });
    return [...new Set(labels)];
}

export function downloadedCount(manga: Pick<LibraryManga, 'chapters'>): number {
    return manga.chapters.filter((chapter) => {
        return chapter.status === 'done';
    }).length;
}

export function chapterLabel(name: string, number: number | null): string {
    if (name.length > 0) {
        return name;
    }
    return number === null ? '' : `#${String(number)}`;
}

export function groupByDay<T>(entries: readonly T[], timeOf: (entry: T) => number, timeZone: string = machineTimeZone()): Array<{ day: number; entries: T[] }> {
    return groupByZonedDay(entries, timeOf, timeZone);
}

export function chapterState(manga: LibraryManga | null, remoteId: number): MangaChapterRecord | null {
    return (
        manga?.chapters.find((chapter) => {
            return chapter.remoteId === remoteId;
        }) ?? null
    );
}

export function canDownload(chapter: Pick<MangaChapterRecord, 'status'> | null): boolean {
    return chapter === null || (!hasChapterFile(chapter.status) && chapter.status !== 'queued' && chapter.status !== 'downloading' && chapter.status !== 'paused');
}

export function downloadablePicks(manga: LibraryManga | null, picked: readonly number[]): number[] {
    return picked.filter((remoteId) => {
        return canDownload(chapterState(manga, remoteId));
    });
}

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

function matchLanguage(wanted: string, available: readonly string[]): string | null {
    const lowered = wanted.toLowerCase();
    const primaryOf = (code: string): string => {
        return code.toLowerCase().split(/[-_]/)[0] ?? '';
    };
    const exact = available.find((code) => {
        return code.toLowerCase() === lowered;
    });
    if (exact !== undefined) {
        return exact;
    }
    const primary = primaryOf(wanted);
    return (
        available.find((code) => {
            return primaryOf(code) === primary;
        }) ?? null
    );
}

export function resolveMangaLanguage(setting: string, available: readonly string[], locale: string): string {
    if (setting === ALL_LANGUAGES) {
        return ALL_LANGUAGES;
    }
    if (setting !== '') {
        return matchLanguage(setting, available) ?? ALL_LANGUAGES;
    }
    return (locale === '' ? null : matchLanguage(locale, available)) ?? matchLanguage('en', available) ?? ALL_LANGUAGES;
}

const LOCAL_SOURCE_ID = '0';

export function isListed(contentWarning: MangaSource['contentWarning'], showAdult: boolean): boolean {
    return showAdult || contentWarning !== 'NSFW';
}

export function listedSources(sources: readonly MangaSource[], showAdult: boolean): MangaSource[] {
    return sources.filter((source) => {
        return isListed(source.contentWarning, showAdult);
    });
}

export function hiddenSourceIds(sources: readonly MangaSource[], showAdult: boolean): ReadonlySet<string> {
    return new Set(
        sources
            .filter((source) => {
                return !isListed(source.contentWarning, showAdult);
            })
            .map((source) => {
                return source.id;
            })
    );
}

export function withoutHiddenSources<T extends { sourceId: string }>(items: T[], hidden: ReadonlySet<string>): T[] {
    if (hidden.size === 0) {
        return items;
    }
    return items.filter((item) => {
        return !hidden.has(item.sourceId);
    });
}

export function withoutHiddenUpdates(updates: MangaUpdateEntry[], library: readonly LibraryManga[], hidden: ReadonlySet<string>): MangaUpdateEntry[] {
    if (hidden.size === 0) {
        return updates;
    }
    const hiddenMangaIds = new Set(
        library
            .filter((manga) => {
                return hidden.has(manga.sourceId);
            })
            .map((manga) => {
                return manga.id;
            })
    );
    return updates.filter((entry) => {
        return !hiddenMangaIds.has(entry.mangaId);
    });
}

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

export function extensionLanguages(extensions: readonly MangaExtension[]): string[] {
    return [...new Set(extensions.map((extension) => {
        return extension.lang;
    }))].sort();
}

export interface MangaLibraryGroup {
    key: string;
    series: string;
    entries: LibraryManga[];
}

export function compareNames(first: string, second: string): number {
    return first.localeCompare(second, undefined, { sensitivity: 'base', numeric: true });
}

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

export function seasonLabel(manga: Pick<LibraryManga, 'season' | 'seasonName'>, t: Translator): string {
    return manga.seasonName ?? t('anime.series.season', { number: manga.season ?? 1 });
}

function foldText(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function matchesSearch(text: string, search: string): boolean {
    const wanted = foldText(search.trim());
    return wanted.length === 0 || foldText(text).includes(wanted);
}

export function matchesManga(manga: Pick<LibraryManga, 'title' | 'series'>, search: string): boolean {
    return matchesSearch(manga.title, search) || (manga.series !== null && matchesSearch(manga.series, search));
}

export function inGroup(library: readonly LibraryManga[], groupId: number | null): LibraryManga[] {
    return library.filter((manga) => {
        return groupId === null ? manga.groupIds.length === 0 : manga.groupIds.includes(groupId);
    });
}

export function searchMatchesByTab(library: readonly LibraryManga[], groupIds: ReadonlyArray<number | null>, search: string): Map<number | null, number> {
    const counts = new Map<number | null, number>();
    if (search.trim().length === 0) {
        return counts;
    }
    groupIds.forEach((groupId) => {
        const count = groupLibrary(
            inGroup(library, groupId).filter((manga) => {
                return matchesManga(manga, search);
            })
        ).length;
        if (count > 0) {
            counts.set(groupId, count);
        }
    });
    return counts;
}

export function activeGroup(library: readonly LibraryManga[], groups: ReadonlyArray<{ id: number }>, chosen: number | null): number | null {
    if (chosen !== null || inGroup(library, null).length > 0) {
        return chosen;
    }
    return groups[0]?.id ?? null;
}

export function downloadedTotals(mangas: readonly LibraryManga[]): { done: number; total: number } {
    return mangas.reduce(
        (totals, manga) => {
            return { done: totals.done + downloadedCount(manga), total: totals.total + manga.chapters.length };
        },
        { done: 0, total: 0 }
    );
}

export function seriesNames(library: readonly LibraryManga[]): string[] {
    const seen = new Map<string, string>();
    library.forEach((manga) => {
        if (manga.series !== null && !seen.has(foldSeries(manga.series))) {
            seen.set(foldSeries(manga.series), manga.series);
        }
    });
    return [...seen.values()].sort(compareNames);
}

export function takenSeasons(library: readonly LibraryManga[], series: string, exceptMangaId: number): number[] {
    const wanted = foldSeries(series);
    return library.flatMap((manga) => {
        return manga.id !== exceptMangaId && manga.series !== null && manga.season !== null && wanted.length > 0 && foldSeries(manga.series) === wanted ? [manga.season] : [];
    });
}

export function nextSeason(taken: readonly number[]): number {
    return Math.max(0, ...taken) + 1;
}

export function continueIndex(chapters: ReadonlyArray<{ remoteId: number }>, isRead: (remoteId: number) => boolean, lastRemoteId: number | null): number {
    if (chapters.length === 0) {
        return -1;
    }
    const last = lastRemoteId === null ? -1 : chapters.findIndex((chapter) => {
        return chapter.remoteId === lastRemoteId;
    });
    if (last !== -1) {
        return last;
    }
    const firstUnread = chapters.findIndex((chapter) => {
        return !isRead(chapter.remoteId);
    });
    return firstUnread === -1 ? 0 : firstUnread;
}

export function isNewChapter(chapter: Pick<MangaChapterRecord, 'addedAt' | 'dateUploaded'>, now: number = Date.now(), timeZone: string = machineTimeZone()): boolean {
    const day = chapter.dateUploaded ?? chapter.addedAt;
    return day !== null && isSameZonedDay(day, now, timeZone);
}

export function newChapterCount(mangas: readonly LibraryManga[], now: number = Date.now(), timeZone: string = machineTimeZone()): number {
    return mangas.reduce((total, manga) => {
        return (
            total +
            manga.chapters.filter((chapter) => {
                return isNewChapter(chapter, now, timeZone);
            }).length
        );
    }, 0);
}

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

export function compareChaptersAscending(first: Pick<MangaChapter, 'remoteId' | 'number' | 'sourceOrder'>, second: Pick<MangaChapter, 'remoteId' | 'number' | 'sourceOrder'>): number {
    if (first.number !== null && second.number !== null && first.number !== second.number) {
        return first.number - second.number;
    }
    if ((first.number === null) !== (second.number === null)) {
        return first.number === null ? -1 : 1;
    }
    return first.sourceOrder - second.sourceOrder || first.remoteId - second.remoteId;
}

export function readerChapters(manga: Pick<LibraryManga, 'chapters'>): ReaderChapter[] {
    return [...manga.chapters]
        .sort((first, second) => {
            return first.sourceOrder - second.sourceOrder;
        })
        .map((chapter) => {
            return { remoteId: chapter.remoteId, libraryChapterId: chapter.id, name: chapter.name, number: chapter.number };
        });
}

export function adjacentSeason(library: readonly LibraryManga[], current: Pick<LibraryManga, 'sourceId' | 'remoteId'> | null | undefined, step: 1 | -1): LibraryManga | null {
    const manga = current
        ? library.find((candidate) => {
              return candidate.sourceId === current.sourceId && candidate.remoteId === current.remoteId;
          })
        : undefined;
    if (manga === undefined || manga.series === null || manga.season === null) {
        return null;
    }
    const series = foldSeries(manga.series);
    const seasons = library
        .filter((candidate) => {
            return candidate.season !== null && candidate.series !== null && foldSeries(candidate.series) === series;
        })
        .sort((first, second) => {
            return (first.season ?? 0) - (second.season ?? 0) || first.id - second.id;
        });
    const place = seasons.findIndex((season) => {
        return season.id === manga.id;
    });
    const neighbours = step === 1 ? seasons.slice(place + 1) : seasons.slice(0, place).reverse();
    return (
        neighbours.find((season) => {
            return season.chapters.length > 0;
        }) ?? null
    );
}

export function neighbourChapter(library: readonly LibraryManga[], reader: Pick<MangaReaderState, 'chapters' | 'index' | 'manga'>, step: 1 | -1): ReaderChapter | undefined {
    const inSeason = reader.chapters[reader.index + step];
    if (inSeason !== undefined) {
        return inSeason;
    }
    const season = adjacentSeason(library, reader.manga, step);
    if (season === null) {
        return undefined;
    }
    const chapters = readerChapters(season);
    return step === 1 ? chapters[0] : chapters[chapters.length - 1];
}
