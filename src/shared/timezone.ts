const HOUR_MS = 60 * 60 * 1000;
const INTO_NEXT_DAY_MS = 36 * HOUR_MS;

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

export function selectableTimeZones(inUse: string): string[] {
    const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    return [...new Set([...known, 'UTC', inUse])].sort((first, second) => {
        return first.localeCompare(second);
    });
}

interface WallClock {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

function wallClockOf(moment: number, timeZone: string): WallClock {
    const parts = formatterOf(timeZone).formatToParts(new Date(moment));
    const value = (type: Intl.DateTimeFormatPartTypes): number => {
        return Number(
            parts.find((part) => {
                return part.type === type;
            })?.value
        );
    };
    return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second') };
}

export function zoneOffsetMs(moment: number, timeZone: string): number {
    const { year, month, day, hour, minute, second } = wallClockOf(moment, timeZone);
    return Date.UTC(year, month - 1, day, hour, minute, second) - Math.floor(moment / 1000) * 1000;
}

export function startOfZonedDay(moment: number, timeZone: string): number {
    const { year, month, day } = wallClockOf(moment, timeZone);
    const midnight = Date.UTC(year, month - 1, day);
    const first = midnight - zoneOffsetMs(midnight, timeZone);
    return midnight - zoneOffsetMs(first, timeZone);
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
