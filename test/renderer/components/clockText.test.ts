import { clockDatetime, formatClock } from '@renderer/components/clockText';

describe('formatClock', () => {
    const afternoon = new Date(2026, 10, 1, 14, 5, 30);
    const morning = new Date(2026, 10, 1, 9, 7, 0);

    it.each([
        ['en', afternoon, new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(afternoon)],
        ['pt', afternoon, '14:05'],
        ['es', afternoon, '14:05'],
        ['ja', afternoon, '14:05'],
        ['zh', morning, new Intl.DateTimeFormat('zh', { hour: '2-digit', minute: '2-digit' }).format(morning)]
    ] as const)('shows the hour and the minute in %s', (language, date, expected) => {
        expect(formatClock(date, language)).toBe(expected);
    });

    it('shows the English time with its period', () => {
        expect(formatClock(afternoon, 'en')).toMatch(/^02:05\sPM$/);
        expect(formatClock(morning, 'en')).toMatch(/^09:07\sAM$/);
    });

    it('never shows the seconds', () => {
        expect(formatClock(afternoon, 'pt')).not.toContain('30');
    });
});

describe('clockDatetime', () => {
    it.each([
        [new Date(2026, 10, 1, 14, 5, 30), '14:05'],
        [new Date(2026, 10, 1, 0, 0, 0), '00:00'],
        [new Date(2026, 10, 1, 9, 7, 59), '09:07'],
        [new Date(2026, 10, 1, 23, 59, 59), '23:59']
    ])('writes %s as %s', (date, expected) => {
        expect(clockDatetime(date)).toBe(expected);
    });
});
