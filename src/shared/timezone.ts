const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const INTO_NEXT_DAY_MS = 36 * HOUR_MS;

export const DEVICE_TIME_ZONE = 'device';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterOf(timeZone: string): Intl.DateTimeFormat {
    const known = formatters.get(timeZone);
    if (known !== undefined) {
        return known;
    }
    const created = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric'
    });
    formatters.set(timeZone, created);
    return created;
}

export function machineTimeZone(): string {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function isValidTimeZone(timeZone: string): boolean {
    try {
        formatterOf(timeZone);
        return true;
    } catch {
        return false;
    }
}

export function resolveTimeZone(setting: string): string {
    if (setting !== DEVICE_TIME_ZONE && isValidTimeZone(setting)) {
        return setting;
    }
    return machineTimeZone();
}

export function selectableTimeZones(inUse: string): string[] {
    const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    return [...new Set([...known, 'UTC', inUse])].sort((first, second) => {
        return first.localeCompare(second);
    });
}

export function timeZoneOptions(inUse: string): string[] {
    const zones = selectableTimeZones(inUse === DEVICE_TIME_ZONE ? 'UTC' : inUse);
    return [DEVICE_TIME_ZONE, ...zones];
}

export interface WallClock {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

export function wallClockOf(moment: number, timeZone: string): WallClock {
    const parts = formatterOf(timeZone).formatToParts(new Date(moment));
    const clock: WallClock = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
    parts.forEach((part) => {
        switch (part.type) {
            case 'year':
                clock.year = Number(part.value);
                break;
            case 'month':
                clock.month = Number(part.value);
                break;
            case 'day':
                clock.day = Number(part.value);
                break;
            case 'hour':
                clock.hour = Number(part.value) % 24;
                break;
            case 'minute':
                clock.minute = Number(part.value);
                break;
            case 'second':
                clock.second = Number(part.value);
                break;
            default:
                break;
        }
    });
    return clock;
}

export function zoneOffsetMs(moment: number, timeZone: string): number {
    const { year, month, day, hour, minute, second } = wallClockOf(moment, timeZone);
    return Date.UTC(year, month - 1, day, hour, minute, second) - Math.floor(moment / 1000) * 1000;
}

export function startOfZonedDay(moment: number, timeZone: string): number {
    const { year, month, day } = wallClockOf(moment, timeZone);
    const midnight = Date.UTC(year, month - 1, day);
    const first = midnight - zoneOffsetMs(midnight, timeZone);
    const second = midnight - zoneOffsetMs(first, timeZone);
    const resolved = wallClockOf(second, timeZone);
    if (resolved.year === year && resolved.month === month && resolved.day === day) {
        return second;
    }
    return first;
}

export function previousZonedDay(startOfDay: number, timeZone: string): number {
    return startOfZonedDay(startOfDay - 1, timeZone);
}

export function zonedDayNumber(moment: number, timeZone: string): number {
    const { year, month, day } = wallClockOf(moment, timeZone);
    return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

export function isSameZonedDay(first: number, second: number, timeZone: string): boolean {
    return zonedDayNumber(first, timeZone) === zonedDayNumber(second, timeZone);
}

export function zonedHour(moment: number, timeZone: string): number {
    return wallClockOf(moment, timeZone).hour;
}

export function zonedDayLimits(moment: number, timeZone: string, count: number): number[] {
    const limits: number[] = [];
    let start = startOfZonedDay(moment, timeZone);
    for (let day = 0; day <= count; day += 1) {
        limits.push(Math.floor(start / 1000));
        start = startOfZonedDay(start + INTO_NEXT_DAY_MS, timeZone);
    }
    return limits;
}

export function groupByZonedDay<T>(entries: readonly T[], timeOf: (entry: T) => number, timeZone: string): Array<{ day: number; entries: T[] }> {
    const groups: Array<{ day: number; entries: T[] }> = [];
    let lastDayNumber: number | null = null;
    entries.forEach((entry) => {
        const moment = timeOf(entry);
        const number = zonedDayNumber(moment, timeZone);
        const last = groups.at(-1);
        if (last !== undefined && lastDayNumber === number) {
            last.entries.push(entry);
        } else {
            lastDayNumber = number;
            groups.push({ day: startOfZonedDay(moment, timeZone), entries: [entry] });
        }
    });
    return groups;
}
