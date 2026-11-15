import { isValidTimeZone } from '@shared/timezone';

const TIME_ZONE_STORAGE_KEY = 'pullwave-schedule-time-zone';

export type AnimeScheduleView = 'day' | 'week';

export interface ScheduleChoice {
    timeZone: string | null;
}

function readItem(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function saveItem(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        return;
    }
}

export function readScheduleChoice(): ScheduleChoice {
    const timeZone = readItem(TIME_ZONE_STORAGE_KEY);
    return {
        timeZone: timeZone !== null && isValidTimeZone(timeZone) ? timeZone : null
    };
}

export function saveScheduleTimeZone(timeZone: string): void {
    saveItem(TIME_ZONE_STORAGE_KEY, timeZone);
}
