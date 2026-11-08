import type { AnimeHistoryEntry } from '@shared/anime';
import type { ReadingEntry } from '@shared/manga';
import type { HistoryEntry } from '@shared/types';

// The numbers of the week of the home screen. They are worked out from the histories the app already keeps (downloads,
// anime watched, chapters read): nothing new is stored and nothing is asked of the main process.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_DAYS = 7;

export interface WeekStats {
    downloads: number;
    watched: number;
    read: number;
    // The days in a row, ending today or yesterday, with something downloaded, watched or read.
    streak: number;
}

export interface StatsInput {
    history: readonly HistoryEntry[];
    animeHistory: readonly AnimeHistoryEntry[];
    readingHistory: readonly ReadingEntry[];
    now: number;
}

// The number of the local day a moment is in (days since the epoch of the local calendar), so a streak follows the calendar of the user.
export function dayNumber(moment: number): number {
    const date = new Date(moment);
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

function finishedDownloads(history: readonly HistoryEntry[]): number[] {
    return history
        .filter((entry) => {
            return entry.status === 'done';
        })
        .map((entry) => {
            return entry.finishedAt;
        });
}

function watchedEpisodes(history: readonly AnimeHistoryEntry[]): number[] {
    return history
        .filter((entry) => {
            return entry.episode !== null;
        })
        .map((entry) => {
            return entry.openedAt;
        });
}

function chaptersRead(history: readonly ReadingEntry[]): number[] {
    return history.map((entry) => {
        return entry.readAt;
    });
}

function inLastWeek(moments: readonly number[], now: number): number {
    return moments.filter((moment) => {
        return moment <= now && now - moment < WEEK_DAYS * DAY_MS;
    }).length;
}

// The days in a row with some activity. The streak is alive when today or yesterday has some (today may still be empty).
export function streakDays(moments: readonly number[], now: number): number {
    const days = new Set(
        moments.map((moment) => {
            return dayNumber(moment);
        })
    );
    const today = dayNumber(now);
    let cursor = days.has(today) ? today : today - 1;
    let streak = 0;
    while (days.has(cursor)) {
        streak += 1;
        cursor -= 1;
    }
    return streak;
}

export function weekStats({ history, animeHistory, readingHistory, now }: StatsInput): WeekStats {
    const downloads = finishedDownloads(history);
    const watched = watchedEpisodes(animeHistory);
    const read = chaptersRead(readingHistory);
    return {
        downloads: inLastWeek(downloads, now),
        watched: inLastWeek(watched, now),
        read: inLastWeek(read, now),
        streak: streakDays([...downloads, ...watched, ...read], now)
    };
}

export type GreetingPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

// Which part of the day an hour (0 to 23) is in.
export function greetingPeriod(hour: number): GreetingPeriod {
    if (hour >= 5 && hour < 12) {
        return 'morning';
    }
    if (hour >= 12 && hour < 18) {
        return 'afternoon';
    }
    if (hour >= 18 && hour < 23) {
        return 'evening';
    }
    return 'night';
}
