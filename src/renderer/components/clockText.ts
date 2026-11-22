import { machineTimeZone, wallClockOf } from '@shared/timezone';
import type { LanguageCode } from '@shared/types';
import { formatShortTime } from './dateFormat';

export function formatClock(date: Date, language: LanguageCode, timeZone: string = machineTimeZone()): string {
    return formatShortTime(date.getTime(), language, timeZone);
}

export function clockDatetime(date: Date, timeZone: string = machineTimeZone()): string {
    const { hour, minute } = wallClockOf(date.getTime(), timeZone);
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
