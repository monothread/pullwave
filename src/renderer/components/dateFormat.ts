import { previousZonedDay, startOfZonedDay } from '@shared/timezone';

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const shortTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function cachedFormatter(cache: Map<string, Intl.DateTimeFormat>, key: string, create: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
    const known = cache.get(key);
    if (known !== undefined) {
        return known;
    }
    const created = create();
    cache.set(key, created);
    return created;
}

export function formatDate(moment: number, language: string, timeZone: string): string {
    const formatter = cachedFormatter(dateFormatters, `${language}|${timeZone}`, () => {
        return new Intl.DateTimeFormat(language, { timeZone });
    });
    return formatter.format(new Date(moment));
}

export function formatDateTime(moment: number, language: string, timeZone: string): string {
    const formatter = cachedFormatter(dateTimeFormatters, `${language}|${timeZone}`, () => {
        return new Intl.DateTimeFormat(language, {
            timeZone,
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric'
        });
    });
    return formatter.format(new Date(moment));
}

export function formatShortTime(moment: number, language: string, timeZone: string): string {
    const formatter = cachedFormatter(shortTimeFormatters, `${language}|${timeZone}`, () => {
        return new Intl.DateTimeFormat(language, { timeZone, hour: '2-digit', minute: '2-digit' });
    });
    return formatter.format(new Date(moment));
}

export interface DayLabels {
    today: string;
    yesterday: string;
}

export function formatDayLabel(day: number, today: number, yesterday: number, labels: DayLabels, language: string, timeZone: string): string {
    if (day === today) {
        return labels.today;
    }
    if (day === yesterday) {
        return labels.yesterday;
    }
    return formatDate(day, language, timeZone);
}

export function createDayLabeler(openedAt: number, labels: DayLabels, language: string, timeZone: string): (day: number) => string {
    const today = startOfZonedDay(openedAt, timeZone);
    const yesterday = previousZonedDay(today, timeZone);
    return (day: number): string => {
        return formatDayLabel(day, today, yesterday, labels, language, timeZone);
    };
}
