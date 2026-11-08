import type { AnimeHistoryEntry, LibraryAnime } from '@shared/anime';
import type { LibraryManga, ReadingEntry } from '@shared/manga';
import { groupLibrary as groupAnime, type LibraryGroup } from '../components/animeText';
import { groupLibrary as groupManga, type MangaLibraryGroup } from '../components/mangaText';
import { continueReading, continueWatching } from '../home/homeData';

// What the carousel of the highlights shows (D-128): what was left half way first, then the titles that got something new in the last days.

// How long an episode or a chapter that arrived in the library counts as new for the highlights and the filter NEWS: seven days.
export const NEWS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// How many highlights the carousel shows at most.
export const SPOTLIGHT_LIMIT = 8;

export type SpotlightItem =
    | { key: string; kind: 'anime'; reason: 'continue'; title: string; coverTitle: string; animeId: number; episodeId: number; episode: string; progress: number }
    | { key: string; kind: 'anime'; reason: 'news'; title: string; coverTitle: string; groupKey: string; count: number }
    | { key: string; kind: 'manga'; reason: 'continue'; title: string; coverUrl: string | null; entry: ReadingEntry; progress: number }
    | { key: string; kind: 'manga'; reason: 'news'; title: string; coverUrl: string | null; group: MangaLibraryGroup; count: number };

// Whether something that arrived at `addedAt` (null: it came with the title) is still new at `now`.
export function isRecent(addedAt: number | null, now: number): boolean {
    return addedAt !== null && addedAt <= now && now - addedAt < NEWS_WINDOW_MS;
}

// How many episodes of these anime arrived in the last seven days, and when the last one did.
export function animeNews(entries: readonly LibraryAnime[], now: number): { count: number; latest: number } {
    let count = 0;
    let latest = 0;
    entries.forEach((anime) => {
        anime.episodes.forEach((episode) => {
            if (isRecent(episode.addedAt, now)) {
                count += 1;
                latest = Math.max(latest, episode.addedAt ?? 0);
            }
        });
    });
    return { count, latest };
}

// How many chapters of these mangas arrived in the last seven days, and when the last one did.
export function mangaNews(entries: readonly LibraryManga[], now: number): { count: number; latest: number } {
    let count = 0;
    let latest = 0;
    entries.forEach((manga) => {
        manga.chapters.forEach((chapter) => {
            if (isRecent(chapter.addedAt, now)) {
                count += 1;
                latest = Math.max(latest, chapter.addedAt ?? 0);
            }
        });
    });
    return { count, latest };
}

// The groups that got something new, the one that got it last first.
function withNews<T extends { key: string }>(groups: readonly T[], news: (group: T) => { count: number; latest: number }): Array<{ group: T; count: number }> {
    return groups
        .map((group) => {
            return { group, ...news(group) };
        })
        .filter((item) => {
            return item.count > 0;
        })
        .sort((first, second) => {
            return second.latest - first.latest;
        })
        .map(({ group, count }) => {
            return { group, count };
        });
}

// The highlights of the anime: the episodes to go on with, then the series with new episodes (a series already there to go on with is not
// repeated).
export function animeSpotlight(library: readonly LibraryAnime[], history: readonly AnimeHistoryEntry[], now: number, limit: number = SPOTLIGHT_LIMIT): SpotlightItem[] {
    const groups = groupAnime(library);
    const groupOf = (animeId: number): LibraryGroup | undefined => {
        return groups.find((group) => {
            return group.entries.some((anime) => {
                return anime.id === animeId;
            });
        });
    };
    const items: SpotlightItem[] = [];
    const used = new Set<string>();
    continueWatching(library, history).forEach((item) => {
        const group = groupOf(item.animeId);
        used.add(group?.key ?? `anime-${String(item.animeId)}`);
        items.push({ key: `anime-continue-${String(item.animeId)}`, kind: 'anime', reason: 'continue', title: item.title, coverTitle: item.title, animeId: item.animeId, episodeId: item.episodeId, episode: item.episode, progress: item.progress });
    });
    withNews(groups, (group) => {
        return animeNews(group.entries, now);
    }).forEach(({ group, count }) => {
        if (!used.has(group.key)) {
            items.push({ key: `anime-news-${group.key}`, kind: 'anime', reason: 'news', title: group.series, coverTitle: group.entries[0]?.title ?? group.series, groupKey: group.key, count });
        }
    });
    return items.slice(0, limit);
}

// The highlights of the manga: the chapters to go on with of mangas of the library (`readKeys`: the chapters marked as read), then the mangas
// with new chapters.
export function mangaSpotlight(library: readonly LibraryManga[], history: readonly ReadingEntry[], readKeys: readonly string[], now: number, limit: number = SPOTLIGHT_LIMIT): SpotlightItem[] {
    const groups = groupManga(library);
    const items: SpotlightItem[] = [];
    const used = new Set<number>();
    continueReading(
        history.filter((entry) => {
            return entry.libraryMangaId !== null;
        }),
        library,
        readKeys
    ).forEach(({ entry, progress }) => {
        used.add(entry.libraryMangaId ?? -1);
        items.push({ key: `manga-continue-${String(entry.id)}`, kind: 'manga', reason: 'continue', title: entry.title, coverUrl: entry.thumbnailUrl, entry, progress });
    });
    withNews(groups, (group) => {
        return mangaNews(group.entries, now);
    }).forEach(({ group, count }) => {
        const covered = group.entries.some((manga) => {
            return used.has(manga.id);
        });
        if (!covered) {
            items.push({ key: `manga-news-${group.key}`, kind: 'manga', reason: 'news', title: group.series, coverUrl: group.entries[0]?.thumbnailUrl ?? null, group, count });
        }
    });
    return items.slice(0, limit);
}

// The highlights of the home screen: the anime and the manga one of each in turn, in the order of the menu (the anime first).
export function mixSpotlight(anime: readonly SpotlightItem[], manga: readonly SpotlightItem[], limit: number = SPOTLIGHT_LIMIT): SpotlightItem[] {
    const mixed: SpotlightItem[] = [];
    for (let index = 0; index < Math.max(anime.length, manga.length); index++) {
        const fromAnime = anime[index];
        const fromManga = manga[index];
        if (fromAnime !== undefined) {
            mixed.push(fromAnime);
        }
        if (fromManga !== undefined) {
            mixed.push(fromManga);
        }
    }
    return mixed.slice(0, limit);
}

// The chips over the grid of a library: every title, the ones with something new, and (anime only) the ones whose releases are over or not.
export type LibraryFilter = 'all' | 'news' | 'complete' | 'ongoing';
// The order of the grid of a library: the titles added last, the ones watched or read last, or by name (A to Z or Z to A).
export type LibrarySort = 'recent' | 'last' | 'az' | 'za';

export const LIBRARY_SORTS: readonly LibrarySort[] = ['recent', 'last', 'az', 'za'];

interface SortableGroup<T> {
    series: string;
    entries: T[];
}

// When a group was put in the library: its newest season.
function addedAt<T extends { createdAt: number }>(group: SortableGroup<T>): number {
    return group.entries.reduce((newest, entry) => {
        return Math.max(newest, entry.createdAt);
    }, 0);
}

function byName(first: { series: string }, second: { series: string }): number {
    return first.series.localeCompare(second.series, undefined, { sensitivity: 'base', numeric: true });
}

// The groups of the library in the order chosen: the ones added last first, the ones watched or read last first (`lastSeen` says when; 0:
// never, and those go after, the ones added last first), or by name, from A or from Z.
export function sortGroups<T extends { createdAt: number }, G extends SortableGroup<T>>(groups: readonly G[], sort: LibrarySort, lastSeen: (group: G) => number): G[] {
    const sorted = [...groups];
    if (sort === 'az') {
        return sorted.sort(byName);
    }
    if (sort === 'za') {
        return sorted.sort((first, second) => {
            return byName(second, first);
        });
    }
    const byAdded = (first: G, second: G): number => {
        return addedAt(second) - addedAt(first) || byName(first, second);
    };
    if (sort === 'recent') {
        return sorted.sort(byAdded);
    }
    return sorted.sort((first, second) => {
        return lastSeen(second) - lastSeen(first) || byAdded(first, second);
    });
}

// When a season of these anime was last opened or watched (0: never), from the history of the anime section.
export function animeLastSeen(entries: readonly LibraryAnime[], history: readonly AnimeHistoryEntry[]): number {
    return history.reduce((latest, entry) => {
        const ofGroup = entries.some((anime) => {
            return anime.title === entry.title && anime.audio === entry.audio;
        });
        return ofGroup ? Math.max(latest, entry.openedAt) : latest;
    }, 0);
}

// When a season of these mangas was last read (0: never), from the history of reading.
export function mangaLastSeen(entries: readonly LibraryManga[], history: readonly ReadingEntry[]): number {
    const ids = new Set(
        entries.map((manga) => {
            return manga.id;
        })
    );
    return history.reduce((latest, entry) => {
        return entry.libraryMangaId !== null && ids.has(entry.libraryMangaId) ? Math.max(latest, entry.readAt) : latest;
    }, 0);
}

// Whether the releases of a series are over: every one of its seasons is complete (by AniList, or as the user said it). A series with a season
// that is still coming out, or that AniList knows nothing about, is not complete, so each series is in one of COMPLETE and ONGOING only.
export function animeGroupComplete(entries: readonly LibraryAnime[]): boolean {
    return entries.length > 0 && entries.every((anime) => {
        return anime.airing.complete;
    });
}

// Nothing is complete when the library has no such thing (the manga have no releases to be over).
function noneComplete(): boolean {
    return false;
}

// The groups the filter keeps: all of them, the ones with something new in the last seven days, the complete ones or all the others.
export function filterGroups<G>(groups: readonly G[], filter: LibraryFilter, newsOf: (group: G) => number, completeOf: (group: G) => boolean = noneComplete): G[] {
    switch (filter) {
        case 'all':
            return [...groups];
        case 'news':
            return groups.filter((group) => {
                return newsOf(group) > 0;
            });
        case 'complete':
            return groups.filter((group) => {
                return completeOf(group);
            });
        case 'ongoing':
            return groups.filter((group) => {
                return !completeOf(group);
            });
    }
}
