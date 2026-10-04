import { isValidTimeZone } from '@shared/timezone';

const TIME_ZONE_STORAGE_KEY = 'pullwave-schedule-time-zone';

// How much of the schedule is shown: the day of today, or the week that starts with it.
export type AnimeScheduleView = 'day' | 'week';

// The view is not kept: the schedule always opens on the day. Only the time zone is.
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

// The time zone the user chose the last time, or null when none was chosen (or it is not valid any more).
export function readScheduleChoice(): ScheduleChoice {
    const timeZone = readItem(TIME_ZONE_STORAGE_KEY);
    return {
        timeZone: timeZone !== null && isValidTimeZone(timeZone) ? timeZone : null
    };
}

export function saveScheduleTimeZone(timeZone: string): void {
    saveItem(TIME_ZONE_STORAGE_KEY, timeZone);
}
