import { isValidTimeZone, machineTimeZone, selectableTimeZones, startOfZonedDay, zoneOffsetMs, zonedDayLimits } from '@shared/timezone';

const HOUR = 3_600_000;
const MOMENT = Date.UTC(2026, 9, 3, 15, 30);

describe('machineTimeZone', () => {
    it('is the time zone the system says it is in, and a valid one', () => {
        expect(machineTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
        expect(isValidTimeZone(machineTimeZone())).toBe(true);
    });
});

describe('isValidTimeZone', () => {
    it.each(['UTC', 'Asia/Tokyo', 'America/Sao_Paulo', 'Europe/Lisbon', 'Asia/Kolkata'])('accepts %s', (zone) => {
        expect(isValidTimeZone(zone)).toBe(true);
    });

    it.each(['Mars/Base', '', 'Tokyo', 'UTC+9'])('refuses "%s"', (zone) => {
        expect(isValidTimeZone(zone)).toBe(false);
    });
});

describe('selectableTimeZones', () => {
    it('has the time zones the system knows, UTC and the one in use', () => {
        const zones = selectableTimeZones('Asia/Tokyo');
        expect(zones).toContain('Asia/Tokyo');
        expect(zones).toContain('America/Sao_Paulo');
        expect(zones).toContain('Europe/Lisbon');
        expect(zones).toContain('UTC');
    });

    it('keeps the one in use even when the system does not list it', () => {
        expect(selectableTimeZones('Custom/Zone')).toContain('Custom/Zone');
    });

    it('does not repeat any and is in alphabetical order', () => {
        const zones = selectableTimeZones('UTC');
        expect(new Set(zones).size).toBe(zones.length);
        expect(zones).toEqual(
            [...zones].sort((first, second) => {
                return first.localeCompare(second);
            })
        );
    });
});

describe('zoneOffsetMs', () => {
    it.each([
        ['UTC', 0],
        ['Asia/Tokyo', 9 * HOUR],
        ['Asia/Kolkata', 5.5 * HOUR],
        ['America/Sao_Paulo', -3 * HOUR],
        ['Europe/Lisbon', 1 * HOUR]
    ])('is the offset of %s in October', (zone, offset) => {
        expect(zoneOffsetMs(MOMENT, zone)).toBe(offset);
    });

    it('follows the change of the clock', () => {
        expect(zoneOffsetMs(Date.UTC(2026, 0, 15, 12), 'America/New_York')).toBe(-5 * HOUR);
        expect(zoneOffsetMs(Date.UTC(2026, 6, 15, 12), 'America/New_York')).toBe(-4 * HOUR);
    });

    it('ignores the milliseconds of the moment', () => {
        expect(zoneOffsetMs(MOMENT + 789, 'Asia/Tokyo')).toBe(9 * HOUR);
    });
});

describe('startOfZonedDay', () => {
    it('is the midnight of the day the moment is in, in the time zone', () => {
        expect(startOfZonedDay(MOMENT, 'UTC')).toBe(Date.UTC(2026, 9, 3));
        expect(startOfZonedDay(MOMENT, 'Asia/Tokyo')).toBe(Date.UTC(2026, 9, 3, 15));
        expect(startOfZonedDay(MOMENT, 'America/Sao_Paulo')).toBe(Date.UTC(2026, 9, 3, 3));
        expect(startOfZonedDay(MOMENT, 'Asia/Kolkata')).toBe(Date.UTC(2026, 9, 3, 18, 30) - 24 * HOUR);
    });

    it('is the same for every moment of the day, from its first to its last millisecond', () => {
        const start = Date.UTC(2026, 9, 3, 3);
        expect(startOfZonedDay(start, 'America/Sao_Paulo')).toBe(start);
        expect(startOfZonedDay(start + 24 * HOUR - 1, 'America/Sao_Paulo')).toBe(start);
        expect(startOfZonedDay(start - 1, 'America/Sao_Paulo')).toBe(start - 24 * HOUR);
    });

    it('is the midnight of the time zone even on the day the clock changes', () => {
        expect(startOfZonedDay(Date.UTC(2026, 2, 8, 18), 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 5));
        expect(startOfZonedDay(Date.UTC(2026, 10, 1, 18), 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 4));
    });
});

describe('zonedDayLimits', () => {
    it('gives where the day starts and where it ends, in seconds', () => {
        expect(zonedDayLimits(MOMENT, 'Asia/Tokyo', 1)).toEqual([Date.UTC(2026, 9, 3, 15) / 1000, Date.UTC(2026, 9, 4, 15) / 1000]);
    });

    it('gives one more limit than the days asked for, one day apart', () => {
        const limits = zonedDayLimits(MOMENT, 'UTC', 7);
        expect(limits).toHaveLength(8);
        expect(limits[0]).toBe(Date.UTC(2026, 9, 3) / 1000);
        limits.slice(1).forEach((limit, position) => {
            expect(limit - (limits[position] as number)).toBe(86_400);
        });
        expect(limits.at(-1)).toBe(Date.UTC(2026, 9, 10) / 1000);
    });

    it('has days that are not 24 hours long where the clock changes', () => {
        const spring = zonedDayLimits(Date.UTC(2026, 2, 7, 18), 'America/New_York', 3);
        expect(
            spring.slice(1).map((limit, position) => {
                return (limit - (spring[position] as number)) / 3600;
            })
        ).toEqual([24, 23, 24]);
        const autumn = zonedDayLimits(Date.UTC(2026, 9, 31, 18), 'America/New_York', 3);
        expect(
            autumn.slice(1).map((limit, position) => {
                return (limit - (autumn[position] as number)) / 3600;
            })
        ).toEqual([24, 25, 24]);
    });

    it('gives no day when none is asked for: only where the first would start', () => {
        expect(zonedDayLimits(MOMENT, 'UTC', 0)).toEqual([Date.UTC(2026, 9, 3) / 1000]);
    });

    it('goes over the end of the month and of the year', () => {
        const limits = zonedDayLimits(Date.UTC(2026, 11, 30, 12), 'UTC', 3);
        expect(limits).toEqual([Date.UTC(2026, 11, 30) / 1000, Date.UTC(2026, 11, 31) / 1000, Date.UTC(2027, 0, 1) / 1000, Date.UTC(2027, 0, 2) / 1000]);
    });
});
