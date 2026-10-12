import {
    chapterStartScrollTop,
    endZoneProgress,
    startZoneProgress,
    ZONE_ARM_BELOW,
    ZONE_DWELL_MS,
    ZONE_FULL,
    ZONE_HEIGHT_RATIO,
    ZONE_MIN_HEIGHT,
    zoneHeight
} from '@renderer/components/chapterZones';

describe('the numbers of the zones between chapters', () => {
    it('are the ones the screen and the tests rely on', () => {
        expect(ZONE_DWELL_MS).toBe(500);
        expect(ZONE_HEIGHT_RATIO).toBe(0.6);
        expect(ZONE_MIN_HEIGHT).toBe(240);
        expect(ZONE_FULL).toBe(0.98);
        expect(ZONE_ARM_BELOW).toBe(0.15);
    });
});

describe('zoneHeight', () => {
    it('is most of the area', () => {
        expect(zoneHeight(1000)).toBe(600);
        expect(zoneHeight(780)).toBe(468);
    });

    it('is never smaller than the least', () => {
        expect(zoneHeight(100)).toBe(240);
        expect(zoneHeight(0)).toBe(240);
    });
});

describe('endZoneProgress', () => {
    const zone = { top: 1000, bottom: 1400 };

    it('is 0 while the zone is below what shows, or only touches its bottom', () => {
        expect(endZoneProgress(zone, 800)).toBe(0);
        expect(endZoneProgress(zone, 1000)).toBe(0);
    });

    it('is the part of the zone that shows', () => {
        expect(endZoneProgress(zone, 1100)).toBe(0.25);
        expect(endZoneProgress(zone, 1200)).toBe(0.5);
    });

    it('is 1 when all of it shows, and stays there past it', () => {
        expect(endZoneProgress(zone, 1400)).toBe(1);
        expect(endZoneProgress(zone, 1500)).toBe(1);
    });

    it('is 0 for a zone with no height', () => {
        expect(endZoneProgress({ top: 5, bottom: 5 }, 100)).toBe(0);
        expect(endZoneProgress({ top: 9, bottom: 5 }, 100)).toBe(0);
    });
});

describe('startZoneProgress', () => {
    const zone = { top: 100, bottom: 500 };

    it('is 0 while the zone is above what shows, or only touches its top', () => {
        expect(startZoneProgress(zone, 800)).toBe(0);
        expect(startZoneProgress(zone, 500)).toBe(0);
    });

    it('is the part of the zone that shows', () => {
        expect(startZoneProgress(zone, 400)).toBe(0.25);
        expect(startZoneProgress(zone, 300)).toBe(0.5);
    });

    it('is 1 when all of it shows, and stays there past it', () => {
        expect(startZoneProgress(zone, 100)).toBe(1);
        expect(startZoneProgress(zone, 0)).toBe(1);
    });

    it('is 0 for a zone with no height', () => {
        expect(startZoneProgress({ top: 5, bottom: 5 }, 0)).toBe(0);
    });
});

describe('chapterStartScrollTop', () => {
    it('moves the scroll by what the first page is from where it should be', () => {
        expect(chapterStartScrollTop(0, 678, 210)).toBe(468);
        expect(chapterStartScrollTop(468, 210, 210)).toBe(468);
        expect(chapterStartScrollTop(300, 378, 210)).toBe(468);
    });

    it('rounds to whole pixels and never goes above the top', () => {
        expect(chapterStartScrollTop(0, 210.6, 210)).toBe(1);
        expect(chapterStartScrollTop(0, 100, 210)).toBe(0);
    });
});
