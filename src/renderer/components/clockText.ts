import type { LanguageCode } from '@shared/types';

export function formatClock(date: Date, language: LanguageCode): string {
    return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function clockDatetime(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
