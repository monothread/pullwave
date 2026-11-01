import type { AnimeHistoryEntry, AnimeJob, LibraryAnime } from '@shared/anime';
import type { MangaJob, ReadingEntry } from '@shared/manga';
import type { DownloadJob } from '@shared/types';
import { libraryEntry, nextDownloadedEpisode } from '../components/animeText';

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
        const anime = entry.episode === null ? null : libraryEntry(library, entry.title, entry.audio);
        const item = anime === null ? null : episodeToContinue(library, anime, entry);
        if (item !== null && !seen.has(item.animeId)) {
            seen.add(item.animeId);
            items.push(item);
        }
    }
    return items;
}

// The mangas read most recently, with how far their last chapter was read.
export function continueReading(history: readonly ReadingEntry[], limit: number = CONTINUE_LIMIT): ContinueReadingItem[] {
    return [...history]
        .sort((first, second) => {
            return second.readAt - first.readAt;
        })
        .slice(0, limit)
        .map((entry) => {
            return { entry, progress: entry.pageCount > 0 ? Math.min(1, (entry.page + 1) / entry.pageCount) : 0 };
        });
}

function isActive(status: string): status is ActiveDownloadItem['status'] {
    return ACTIVE_STATUSES.has(status);
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
