import { PageTransferRate, RATE_WINDOW_MS } from '@main/services/manga/mangaTransferRate';

describe('PageTransferRate', () => {
    it('keeps the pages of the last ten seconds', () => {
        expect(RATE_WINDOW_MS).toBe(10_000);
    });

    it('knows nothing before a page arrives', () => {
        const rate = new PageTransferRate(1000);
        expect(rate.measure(5000, 10)).toEqual({ bytesPerSecond: null, etaSeconds: null });
    });

    it('knows nothing at the very moment the run starts, even with a page', () => {
        const rate = new PageTransferRate(1000);
        rate.add(1000, 500);
        expect(rate.measure(1000, 10)).toEqual({ bytesPerSecond: null, etaSeconds: null });
    });

    it('measures from the start of the run while it is younger than the window', () => {
        const rate = new PageTransferRate(1000);
        rate.add(1500, 1000);
        rate.add(3000, 3000);
        // 4000 bytes in two seconds; a second for each of the two pages, five left.
        expect(rate.measure(3000, 5)).toEqual({ bytesPerSecond: 2000, etaSeconds: 5 });
    });

    it('measures only the last ten seconds once the run is older', () => {
        const rate = new PageTransferRate(0);
        rate.add(1000, 50_000);
        rate.add(10_000, 1000);
        rate.add(20_000, 2000);
        // The window goes from 10 s (left out) to 20 s: one page of 2000 bytes in ten seconds.
        expect(rate.measure(20_000, 3)).toEqual({ bytesPerSecond: 200, etaSeconds: 30 });
    });

    it('forgets for good the pages that left the window', () => {
        const rate = new PageTransferRate(0);
        rate.add(1000, 50_000);
        expect(rate.measure(20_000, 1)).toEqual({ bytesPerSecond: null, etaSeconds: null });
        // Measuring an earlier moment again does not bring back the page that was dropped.
        expect(rate.measure(5000, 1)).toEqual({ bytesPerSecond: null, etaSeconds: null });
    });

    it('counts the time of a page that failed but none of its bytes', () => {
        const rate = new PageTransferRate(0);
        rate.add(1000, 0);
        rate.add(2000, 4000);
        expect(rate.measure(2000, 4)).toEqual({ bytesPerSecond: 2000, etaSeconds: 4 });
    });

    it('needs no more time when no page is left', () => {
        const rate = new PageTransferRate(0);
        rate.add(1000, 1000);
        expect(rate.measure(1000, 0)).toEqual({ bytesPerSecond: 1000, etaSeconds: 0 });
    });

    it('never gives a time below zero when more pages are counted than the chapter has', () => {
        const rate = new PageTransferRate(0);
        rate.add(1000, 1000);
        expect(rate.measure(1000, -2)).toEqual({ bytesPerSecond: 1000, etaSeconds: 0 });
    });
});
