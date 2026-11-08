import type { AnimeHistoryEntry } from '@shared/anime';
import type { ReadingEntry } from '@shared/manga';
import type { HistoryEntry } from '@shared/types';
import { makeReading } from '../../helpers/homeFixtures';
import { dayNumber, DAY_MS, greetingPeriod, streakDays, weekStats } from '@renderer/home/statsData';

// Noon on the 7th of November 2026, in the local time of the machine, so the days below never depend on the time zone.
const NOW = new Date(2026, 10, 7, 12, 0, 0).getTime();

function daysAgo(days: number, hour = 12): number {
    return new Date(2026, 10, 7 - days, hour, 0, 0).getTime();
}

function download(finishedAt: number, status: HistoryEntry['status'] = 'done'): HistoryEntry {
    return { id: `d${String(finishedAt)}${status}`, url: 'https://example.com/v', title: 'Video', filePath: null, status, errorTitle: null, finishedAt };
}

function watched(openedAt: number, episode: string | null = '1'): AnimeHistoryEntry {
    return { id: openedAt, title: 'Anime', query: 'anime', searchIndex: 0, audio: 'sub', episode, openedAt, watchedAt: episode === null ? null : openedAt };
}

function read(readAt: number): ReadingEntry {
    return makeReading({ id: readAt, readAt });
}

describe('dayNumber', () => {
    it('gives the same number to two moments of one local day and the next number to the next day', () => {
        expect(dayNumber(daysAgo(0, 0))).toBe(dayNumber(daysAgo(0, 23)));
        expect(dayNumber(daysAgo(0, 0)) - dayNumber(daysAgo(1, 23))).toBe(1);
    });
});

describe('streakDays', () => {
    it('is zero with no activity', () => {
        expect(streakDays([], NOW)).toBe(0);
    });

    it('counts the days in a row up to today', () => {
        expect(streakDays([daysAgo(0), daysAgo(1), daysAgo(2)], NOW)).toBe(3);
    });

    it('keeps the streak alive when today is still empty but yesterday had activity', () => {
        expect(streakDays([daysAgo(1), daysAgo(2)], NOW)).toBe(2);
    });

    it('is zero when the last activity was two days ago or more', () => {
        expect(streakDays([daysAgo(2), daysAgo(3)], NOW)).toBe(0);
    });

    it('stops at the first empty day', () => {
        expect(streakDays([daysAgo(0), daysAgo(1), daysAgo(3)], NOW)).toBe(2);
    });

    it('counts a day once however many things happened in it', () => {
        expect(streakDays([daysAgo(0, 1), daysAgo(0, 9), daysAgo(0, 20)], NOW)).toBe(1);
    });
});

describe('weekStats', () => {
    it('is all zero with nothing in the histories', () => {
        expect(weekStats({ history: [], animeHistory: [], readingHistory: [], now: NOW })).toEqual({ downloads: 0, watched: 0, read: 0, streak: 0 });
    });

    it('counts what happened in the last seven days of each history', () => {
        const stats = weekStats({
            history: [download(daysAgo(0)), download(daysAgo(3)), download(daysAgo(6, 13))],
            animeHistory: [watched(daysAgo(1)), watched(daysAgo(2))],
            readingHistory: [read(daysAgo(0))],
            now: NOW
        });
        expect(stats).toEqual({ downloads: 3, watched: 2, read: 1, streak: 4 });
    });

    it('leaves out what is older than a week, what failed, what was only opened and what is in the future', () => {
        const stats = weekStats({
            history: [download(daysAgo(8)), download(daysAgo(1), 'error')],
            animeHistory: [watched(daysAgo(1), null), watched(NOW + DAY_MS)],
            readingHistory: [read(daysAgo(7, 11))],
            now: NOW
        });
        expect(stats).toEqual({ downloads: 0, watched: 0, read: 0, streak: 0 });
    });
});

describe('greetingPeriod', () => {
    it.each([
        [0, 'night'], [4, 'night'], [5, 'morning'], [11, 'morning'], [12, 'afternoon'], [17, 'afternoon'], [18, 'evening'], [22, 'evening'], [23, 'night']
    ] as const)('puts the hour %i in the %s', (hour, period) => {
        expect(greetingPeriod(hour)).toBe(period);
    });
});
