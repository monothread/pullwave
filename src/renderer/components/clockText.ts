import type { LanguageCode } from '@shared/types';

// The hour and the minute in the way of the language of the interface (14:05, 2:05 PM...).
export function formatClock(date: Date, language: LanguageCode): string {
    return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(date);
}

// The time in the form of the datetime attribute of <time> (HH:MM, 24 hours).
export function clockDatetime(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
