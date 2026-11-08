import { clickZone, MIDDLE_STRIP_FROM, MIDDLE_STRIP_TO, SIDE_SHARE_ONE_PAGE, SIDE_SHARE_TWO_PAGES } from '@renderer/components/readerClickZones';

describe('the numbers of the zones', () => {
    it('are a strip of a fifth in the middle, two fifths of a side with one page and a quarter with two', () => {
        expect(MIDDLE_STRIP_FROM).toBe(0.4);
        expect(MIDDLE_STRIP_TO).toBe(0.6);
        expect(SIDE_SHARE_ONE_PAGE).toBe(0.4);
        expect(SIDE_SHARE_TWO_PAGES).toBe(0.25);
    });
});

describe('clickZone with one page, from the left', () => {
    it.each([
        [0, 'previous'],
        [0.2, 'previous'],
        [0.39, 'previous'],
        [0.4, 'middle'],
        [0.5, 'middle'],
        [0.6, 'middle'],
        [0.61, 'next'],
        [0.8, 'next'],
        [1, 'next']
    ])('puts %j in the zone %s', (fraction, zone) => {
        expect(clickZone(fraction, false, 'ltr')).toBe(zone);
    });
});

describe('clickZone with one page, from the right', () => {
    it.each([
        [0, 'next'],
        [0.39, 'next'],
        [0.5, 'middle'],
        [0.61, 'previous'],
        [1, 'previous']
    ])('puts %j in the zone %s', (fraction, zone) => {
        expect(clickZone(fraction, false, 'rtl')).toBe(zone);
    });
});

describe('clickZone with two pages, from the left', () => {
    it.each([
        [0, 'previous'],
        [0.1, 'previous'],
        [0.24, 'previous'],
        [0.25, 'none'],
        [0.3, 'none'],
        [0.39, 'none'],
        [0.4, 'middle'],
        [0.5, 'middle'],
        [0.6, 'middle'],
        [0.61, 'none'],
        [0.75, 'none'],
        [0.76, 'next'],
        [0.9, 'next'],
        [1, 'next']
    ])('puts %j in the zone %s', (fraction, zone) => {
        expect(clickZone(fraction, true, 'ltr')).toBe(zone);
    });
});

describe('clickZone with two pages, from the right', () => {
    it.each([
        [0, 'next'],
        [0.24, 'next'],
        [0.3, 'none'],
        [0.5, 'middle'],
        [0.7, 'none'],
        [0.76, 'previous'],
        [1, 'previous']
    ])('puts %j in the zone %s', (fraction, zone) => {
        expect(clickZone(fraction, true, 'rtl')).toBe(zone);
    });
});

describe('clickZone for a click that has no place', () => {
    it('is no zone when the box has no width (the fraction is not a number)', () => {
        expect(clickZone(Number.NaN, false, 'ltr')).toBe('none');
        expect(clickZone(Number.NaN, true, 'rtl')).toBe('none');
    });
});
