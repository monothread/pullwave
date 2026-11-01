import { sectionAfter } from '@renderer/navigation/sections';

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
