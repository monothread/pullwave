import type { AnimeHistoryEntry, AnimeJob, LibraryAnime } from '@shared/anime';
import type { LibraryManga, MangaChapterRecord, MangaJob, ReadingEntry } from '@shared/manga';
import type { DownloadJob } from '@shared/types';
import { libraryEntry, nextDownloadedEpisode } from '../components/animeText';
import { adjacentSeason, compareChaptersAscending } from '../components/mangaText';
import { progressKey } from '../components/readerPrefs';

// What the home screen and the highlights read from the stores: what to go on with and the downloads going on. Nothing here asks the main
// process for anything.

// How many titles to go on with are read at most.
export const CONTINUE_LIMIT = 12;

// An episode to go on watching: the one left half way, or the next downloaded one after the last watched.
export interface ContinueWatchingItem {
    animeId: number;
    episodeId: number;
    title: string;
    episode: string;
    // How much of the episode was watched, from 0 to 1.
    progress: number;
}

export interface ContinueReadingItem {
    entry: ReadingEntry;
    // How far the chapter was read, from 0 to 1.
    progress: number;
}

export type ActiveDownloadKind = 'video' | 'anime' | 'manga';

// A download that is running, waiting or paused, from any section.
export interface ActiveDownloadItem {
    key: string;
    kind: ActiveDownloadKind;
    title: string;
    // The episode or the chapter; null for a video.
    detail: string | null;
    percent: number;
    status: 'queued' | 'running' | 'paused';
}

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['queued', 'running', 'paused']);

function progressOf(position: number, duration: number): number {
    if (duration <= 0) {
        return 0;
    }
    return Math.min(1, Math.max(0, position / duration));
}

// The episode of an entry of the history to go on with: the one it stopped on when it was left half way, else the next downloaded one.
function episodeToContinue(library: readonly LibraryAnime[], anime: LibraryAnime, entry: AnimeHistoryEntry): ContinueWatchingItem | null {
    const current = anime.episodes.find((episode) => {
        return episode.number === entry.episode;
    });
    if (current === undefined) {
        return null;
    }
    if (current.status === 'done' && !current.watched && !current.fileMissing) {
        return { animeId: anime.id, episodeId: current.id, title: anime.title, episode: current.number, progress: progressOf(current.positionSeconds, current.durationSeconds) };
    }
    const next = nextDownloadedEpisode(library, anime, current);
    if (next === null || next.episode.watched || next.episode.fileMissing) {
        return null;
    }
    return { animeId: next.anime.id, episodeId: next.episode.id, title: next.anime.title, episode: next.episode.number, progress: progressOf(next.episode.positionSeconds, next.episode.durationSeconds) };
}

// The episodes to go on watching, from the anime watched most recently, one per anime.
export function continueWatching(library: readonly LibraryAnime[], history: readonly AnimeHistoryEntry[], limit: number = CONTINUE_LIMIT): ContinueWatchingItem[] {
    const items: ContinueWatchingItem[] = [];
    const seen = new Set<number>();
    for (const entry of history) {
        if (items.length >= limit) {
            break;
        }
        const anime = entry.episode === null ? null : libraryEntry(library, entry.title);
        const item = anime === null ? null : episodeToContinue(library, anime, entry);
        if (item !== null && !seen.has(item.animeId)) {
            seen.add(item.animeId);
            items.push(item);
        }
    }
    return items;
}

// Whether a chapter of a manga was marked as read (the keys are the ones the reader and the page of the manga write).
type ChapterReadCheck = (mangaTitle: string, chapterRemoteId: number) => boolean;

// Whether the chapter of an entry of the history was read to the end: left on its last page, or marked as read.
function finishedReading(entry: ReadingEntry, isRead: ChapterReadCheck): boolean {
    return (entry.pageCount > 0 && entry.page >= entry.pageCount - 1) || isRead(entry.title, entry.chapterRemoteId);
}

// The first chapter of a manga that is not read, after the one given (from the first when none is given), in the order of its list. Null
// when there is none, or when the chapter given is not in the manga any more.
function firstUnreadAfter(manga: LibraryManga, afterRemoteId: number | null, isRead: ChapterReadCheck): MangaChapterRecord | null {
    const ordered = [...manga.chapters].sort(compareChaptersAscending);
    const place = afterRemoteId === null ? -1 : ordered.findIndex((chapter) => {
        return chapter.remoteId === afterRemoteId;
    });
    if (afterRemoteId !== null && place === -1) {
        return null;
    }
    return (
        ordered.slice(place + 1).find((chapter) => {
            return !isRead(manga.title, chapter.remoteId);
        }) ?? null
    );
}

// The entry pointed at another chapter (of the same manga or of its next season), not started yet.
function atChapter(entry: ReadingEntry, manga: LibraryManga, chapter: MangaChapterRecord): ReadingEntry {
    return {
        ...entry,
        sourceId: manga.sourceId,
        mangaRemoteId: manga.remoteId,
        title: manga.title,
        thumbnailUrl: manga.thumbnailUrl,
        libraryMangaId: manga.id,
        chapterRemoteId: chapter.remoteId,
        chapterName: chapter.name,
        chapterNumber: chapter.number,
        page: 0,
        pageCount: chapter.pageCount
    };
}

// What to go on with after a chapter read to the end: the next chapter not read of the manga, else the first one not read of its next
// season. Null when there is none (the manga is up to date, or finished) or the manga is not in the library.
function nextChapterEntry(entry: ReadingEntry, library: readonly LibraryManga[], isRead: ChapterReadCheck): ReadingEntry | null {
    const manga = library.find((candidate) => {
        return candidate.id === entry.libraryMangaId;
    });
    if (manga === undefined) {
        return null;
    }
    const inSeason = firstUnreadAfter(manga, entry.chapterRemoteId, isRead);
    if (inSeason !== null) {
        return atChapter(entry, manga, inSeason);
    }
    const season = adjacentSeason(library, manga, 1);
    const first = season === null ? null : firstUnreadAfter(season, null, isRead);
    return season === null || first === null ? null : atChapter(entry, season, first);
}

function readingProgress(entry: ReadingEntry): number {
    return entry.pageCount > 0 ? Math.min(1, (entry.page + 1) / entry.pageCount) : 0;
}

// The mangas read most recently, with how far their chapter was read. A chapter read to the end (to its last page, or marked as read) is not
// one to go on with: its place goes to the next chapter not read (not started yet), or the manga is left out when there is none. A manga
// shows once, where it was read last.
export function continueReading(history: readonly ReadingEntry[], library: readonly LibraryManga[], readKeys: readonly string[], limit: number = CONTINUE_LIMIT): ContinueReadingItem[] {
    const read = new Set(readKeys);
    const isRead: ChapterReadCheck = (mangaTitle, chapterRemoteId) => {
        return read.has(progressKey(mangaTitle, chapterRemoteId));
    };
    const seen = new Set<string>();
    const items: ContinueReadingItem[] = [];
    const recentFirst = [...history].sort((first, second) => {
        return second.readAt - first.readAt;
    });
    for (const original of recentFirst) {
        if (items.length >= limit) {
            break;
        }
        const entry = finishedReading(original, isRead) ? nextChapterEntry(original, library, isRead) : original;
        const mangaKey = entry === null ? '' : `${entry.sourceId}|${String(entry.mangaRemoteId)}`;
        if (entry !== null && !seen.has(mangaKey)) {
            seen.add(mangaKey);
            items.push({ entry, progress: readingProgress(entry) });
        }
    }
    return items;
}

function isActive(status: string): status is ActiveDownloadItem['status'] {
    return ACTIVE_STATUSES.has(status);
}

// How many downloads of a section are running, waiting and paused.
export interface StatusCounts {
    running: number;
    queued: number;
    paused: number;
}

export function statusCounts(jobs: ReadonlyArray<{ status: string }>): StatusCounts {
    const counts: StatusCounts = { running: 0, queued: 0, paused: 0 };
    jobs.forEach((job) => {
        if (isActive(job.status)) {
            counts[job.status] += 1;
        }
    });
    return counts;
}

export function activeTotal(counts: StatusCounts): number {
    return counts.running + counts.queued + counts.paused;
}

// Every download that is not over, of the three sections: the running ones first, then the waiting ones, then the paused ones.
export function activeDownloads(videos: readonly DownloadJob[], episodes: readonly AnimeJob[], chapters: readonly MangaJob[]): ActiveDownloadItem[] {
    const items: ActiveDownloadItem[] = [];
    videos.forEach((job) => {
        if (isActive(job.status)) {
            items.push({ key: `video-${job.id}`, kind: 'video', title: job.title ?? job.url, detail: null, percent: job.percent, status: job.status });
        }
    });
    episodes.forEach((job) => {
        if (isActive(job.status)) {
            items.push({ key: `anime-${job.episodeId}`, kind: 'anime', title: job.animeTitle, detail: job.episode, percent: job.percent, status: job.status });
        }
    });
    chapters.forEach((job) => {
        if (isActive(job.status)) {
            items.push({ key: `manga-${job.chapterId}`, kind: 'manga', title: job.mangaTitle, detail: job.chapterName, percent: job.percent, status: job.status });
        }
    });
    const order: Record<ActiveDownloadItem['status'], number> = { running: 0, queued: 1, paused: 2 };
    return items
        .map((item, index) => {
            return { item, index };
        })
        .sort((first, second) => {
            return order[first.item.status] - order[second.item.status] || first.index - second.index;
        })
        .map(({ item }) => {
            return item;
        });
}
