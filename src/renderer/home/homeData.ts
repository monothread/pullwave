import type { AnimeHistoryEntry, AnimeJob, LibraryAnime } from '@shared/anime';
import type { LibraryManga, MangaChapterRecord, MangaJob, ReadingEntry } from '@shared/manga';
import type { DownloadJob } from '@shared/types';
import { episodeToResume, libraryEntry, type PlayableEpisode } from '../components/animeText';
import { adjacentSeason, compareChaptersAscending } from '../components/mangaText';
import { progressKey } from '../components/readerPrefs';

export const CONTINUE_LIMIT = 12;

export interface ContinueWatchingItem {
    animeId: number;
    episodeId: number;
    title: string;
    episode: string;
    progress: number;
}

export interface ContinueReadingItem {
    entry: ReadingEntry;
    progress: number;
}

export type ActiveDownloadKind = 'video' | 'anime' | 'manga';

export interface ActiveDownloadItem {
    key: string;
    kind: ActiveDownloadKind;
    title: string;
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

function itemOf({ anime, episode }: PlayableEpisode): ContinueWatchingItem {
    return { animeId: anime.id, episodeId: episode.id, title: anime.title, episode: episode.number, progress: progressOf(episode.positionSeconds, episode.durationSeconds) };
}

function resumeFromHistory(library: readonly LibraryAnime[], entry: AnimeHistoryEntry): PlayableEpisode | null {
    const anime = entry.episode === null ? null : libraryEntry(library, entry.title);
    return anime === null || entry.episode === null ? null : episodeToResume(library, anime, entry.episode);
}

export function continueWatching(library: readonly LibraryAnime[], history: readonly AnimeHistoryEntry[], limit: number = CONTINUE_LIMIT): ContinueWatchingItem[] {
    const items: ContinueWatchingItem[] = [];
    const seen = new Set<number>();
    for (const entry of history) {
        if (items.length >= limit) {
            break;
        }
        const playable = resumeFromHistory(library, entry);
        if (playable !== null && !seen.has(playable.anime.id)) {
            seen.add(playable.anime.id);
            items.push(itemOf(playable));
        }
    }
    return items;
}

type ChapterReadCheck = (mangaTitle: string, chapterRemoteId: number) => boolean;

function finishedReading(entry: ReadingEntry, isRead: ChapterReadCheck): boolean {
    return (entry.pageCount > 0 && entry.page >= entry.pageCount - 1) || isRead(entry.title, entry.chapterRemoteId);
}

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
