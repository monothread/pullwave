import { isKonamiComplete, isLogoFlurry, KONAMI_SEQUENCE, LOGO_CLICK_WINDOW_MS, LOGO_CLICKS, nextKonamiPosition } from '@renderer/fx/konami';

describe('the Konami code', () => {
    it('is up, up, down, down, left, right, left, right, B, A', () => {
        expect(KONAMI_SEQUENCE).toEqual(['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']);
    });

    it('goes on with each right key and is complete after the last one (letters in either case)', () => {
        let position = 0;
        ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'B', 'A'].forEach((key, index) => {
            position = nextKonamiPosition(position, key);
            expect(position).toBe(index + 1);
        });
        expect(isKonamiComplete(position)).toBe(true);
    });

    it('is not complete before the end', () => {
        expect(isKonamiComplete(9)).toBe(false);
        expect(isKonamiComplete(0)).toBe(false);
    });

    it('starts again from zero on a wrong key', () => {
        expect(nextKonamiPosition(4, 'x')).toBe(0);
        expect(nextKonamiPosition(9, 'Enter')).toBe(0);
    });

    it('counts a first key pressed in the middle as the start of a new try', () => {
        expect(nextKonamiPosition(2, 'ArrowUp')).toBe(1);
    });
});

describe('the clicks on the name', () => {
    it('makes a flurry of five clicks close together', () => {
        expect(LOGO_CLICKS).toBe(5);
        const now = 10_000;
        const times = [now - 800, now - 600, now - 400, now - 200, now];
        expect(isLogoFlurry(times, now)).toBe(true);
    });

    it('is not a flurry with four clicks', () => {
        expect(isLogoFlurry([9_000, 9_200, 9_400, 10_000], 10_000)).toBe(false);
    });

    it('does not count the clicks that are too old', () => {
        const now = 20_000;
        const times = [now - LOGO_CLICK_WINDOW_MS - 1, now - 600, now - 400, now - 200, now];
        expect(isLogoFlurry(times, now)).toBe(false);
    });
});
