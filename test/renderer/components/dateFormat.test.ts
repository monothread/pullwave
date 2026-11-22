import { createDayLabeler, formatDate, formatDateTime, formatDayLabel, formatShortTime } from '@renderer/components/dateFormat';
import { startOfZonedDay } from '@shared/timezone';

const MOMENT = Date.UTC(2026, 9, 3, 23, 30, 0);

describe('dateFormat', () => {
    it('formats dates in the requested language and time zone', () => {
        expect(formatDate(MOMENT, 'en', 'UTC')).toBe(new Date(MOMENT).toLocaleDateString('en', { timeZone: 'UTC' }));
        expect(formatDate(MOMENT, 'en', 'Asia/Tokyo')).toBe(new Date(MOMENT).toLocaleDateString('en', { timeZone: 'Asia/Tokyo' }));
        expect(formatDate(MOMENT, 'pt', 'America/Sao_Paulo')).toBe(new Date(MOMENT).toLocaleDateString('pt', { timeZone: 'America/Sao_Paulo' }));
        expect(formatDate(MOMENT, 'en', 'Asia/Tokyo')).not.toBe(formatDate(MOMENT, 'en', 'America/Sao_Paulo'));
    });

    it.each(['en', 'pt', 'es', 'zh', 'ja'] as const)('formats date and time identically to toLocaleString in %s', (language) => {
        expect(formatDateTime(MOMENT, language, 'UTC')).toBe(new Date(MOMENT).toLocaleString(language, { timeZone: 'UTC' }));
        expect(formatDateTime(MOMENT, language, 'Asia/Tokyo')).toBe(new Date(MOMENT).toLocaleString(language, { timeZone: 'Asia/Tokyo' }));
    });

    it('formats short times in the requested language and time zone', () => {
        expect(formatShortTime(MOMENT, 'pt', 'UTC')).toBe('23:30');
        expect(formatShortTime(MOMENT, 'pt', 'Asia/Tokyo')).toBe('08:30');
        expect(formatShortTime(MOMENT, 'pt', 'America/Sao_Paulo')).toBe('20:30');
    });

    it('labels today, yesterday and older dates in the requested language and time zone', () => {
        const labels = { today: 'Today', yesterday: 'Yesterday' };
        const today = Date.UTC(2026, 9, 4);
        const yesterday = Date.UTC(2026, 9, 3);
        const older = Date.UTC(2026, 9, 1);

        expect(formatDayLabel(today, today, yesterday, labels, 'en', 'UTC')).toBe('Today');
        expect(formatDayLabel(yesterday, today, yesterday, labels, 'en', 'UTC')).toBe('Yesterday');
        expect(formatDayLabel(older, today, yesterday, labels, 'en', 'UTC')).toBe(formatDate(older, 'en', 'UTC'));
    });

    it('creates a day labeler anchored to the configured time zone', () => {
        const openedAt = Date.UTC(2026, 9, 7, 16, 0, 0);
        const label = createDayLabeler(openedAt, { today: 'Today', yesterday: 'Yesterday' }, 'en', 'Asia/Tokyo');
        const tokyoToday = startOfZonedDay(openedAt, 'Asia/Tokyo');
        const tokyoYesterday = startOfZonedDay(Date.UTC(2026, 9, 7, 14, 0, 0), 'Asia/Tokyo');
        const older = startOfZonedDay(Date.UTC(2026, 9, 3, 20, 0, 0), 'Asia/Tokyo');

        expect(label(tokyoToday)).toBe('Today');
        expect(label(tokyoYesterday)).toBe('Yesterday');
        expect(label(older)).toBe(formatDate(older, 'en', 'Asia/Tokyo'));
    });
});
