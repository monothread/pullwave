import { sectionAfter, mainSectionAfter } from '@renderer/navigation/sections';

const SECTIONS = ['downloads', 'anime', 'manga', 'settings'] as const;
type Section = (typeof SECTIONS)[number];

describe('sectionAfter', () => {
    it.each([
        ['downloads', 1, 'anime'],
        ['anime', 1, 'manga'],
        ['manga', 1, 'settings'],
        ['settings', 1, 'downloads'],
        ['downloads', -1, 'settings'],
        ['anime', -1, 'downloads'],
        ['settings', -1, 'manga'],
        ['anime', 2, 'settings'],
        ['anime', 5, 'manga'],
        ['anime', -5, 'downloads'],
        ['manga', 0, 'manga']
    ] as Array<[Section, number, Section]>)('goes from %s by %i to %s', (current, step, expected) => {
        expect(sectionAfter<Section>(SECTIONS, current, step)).toBe(expected);
    });

    it('starts from the first section when the current one is not listed', () => {
        expect(sectionAfter<Section>(['downloads', 'settings'], 'anime', 1)).toBe('settings');
        expect(sectionAfter<Section>(['downloads', 'settings'], 'anime', -1)).toBe('settings');
        expect(sectionAfter<Section>(['downloads', 'settings'], 'anime', 0)).toBe('downloads');
    });

    it('stays when there is no section', () => {
        expect(sectionAfter<Section>([], 'manga', 1)).toBe('manga');
    });

    it('goes round a list of one section', () => {
        expect(sectionAfter<Section>(['downloads'], 'downloads', 1)).toBe('downloads');
        expect(sectionAfter<Section>(['downloads'], 'downloads', -1)).toBe('downloads');
    });
});

describe('mainSectionAfter', () => {
    const WALKED = ['home', 'downloads', 'anime', 'manga'] as const;

    it('goes to the next section and to the one before', () => {
        expect(mainSectionAfter(WALKED, 'home', 1)).toBe('downloads');
        expect(mainSectionAfter(WALKED, 'anime', 1)).toBe('manga');
        expect(mainSectionAfter(WALKED, 'anime', -1)).toBe('downloads');
        expect(mainSectionAfter(WALKED, 'downloads', -1)).toBe('home');
    });

    it('goes round at the ends', () => {
        expect(mainSectionAfter(WALKED, 'manga', 1)).toBe('home');
        expect(mainSectionAfter(WALKED, 'home', -1)).toBe('manga');
    });

    it('goes to the first one from a section that is not in the list, in either direction', () => {
        expect(mainSectionAfter(WALKED, 'settings', 1)).toBe('home');
        expect(mainSectionAfter(WALKED, 'settings', -1)).toBe('home');
    });

    it('stays on the only section there is, and gives none for an empty list', () => {
        expect(mainSectionAfter(['home'], 'home', 1)).toBe('home');
        expect(mainSectionAfter(['home'], 'home', -1)).toBe('home');
        expect(mainSectionAfter([], 'home', 1)).toBeNull();
    });
});
