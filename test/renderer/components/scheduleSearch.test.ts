import type { AnimeScheduleEntry } from '@shared/anime';
import { matchesSearch, normalizeSearch } from '@renderer/components/scheduleSearch';
import { makeScheduleEntry } from '../../helpers/animeFixtures';

const BLEACH: AnimeScheduleEntry = makeScheduleEntry({ title: 'Bleach: Thousand-Year Blood War', names: ['Bleach: Thousand-Year Blood War', 'Bleach: Sennen Kessen-hen', 'Burīchi'] });

describe('normalizeSearch', () => {
    it('lowers the case and trims the spaces around the text', () => {
        expect(normalizeSearch('  Dan Da DAN  ')).toBe('dan da dan');
    });

    it('takes the accents and the macrons away', () => {
        expect(normalizeSearch('Burīchi')).toBe('burichi');
        expect(normalizeSearch('Pokémon')).toBe('pokemon');
    });

    it('keeps the spaces between the words and gives an empty text for blanks', () => {
        expect(normalizeSearch('Blue   Lock')).toBe('blue   lock');
        expect(normalizeSearch('   ')).toBe('');
    });
});

describe('matchesSearch', () => {
    it('matches everything when nothing, or only spaces, was typed', () => {
        expect(matchesSearch(BLEACH, '')).toBe(true);
        expect(matchesSearch(BLEACH, '   ')).toBe(true);
    });

    it('matches a part of the title, whatever the case', () => {
        expect(matchesSearch(BLEACH, 'thousand')).toBe(true);
        expect(matchesSearch(BLEACH, 'BLOOD WAR')).toBe(true);
    });

    it('matches any of the other names the anime is known by', () => {
        expect(matchesSearch(BLEACH, 'sennen')).toBe(true);
        expect(matchesSearch(BLEACH, 'burichi')).toBe(true);
        expect(matchesSearch(BLEACH, 'Burīchi')).toBe(true);
    });

    it('matches the title even when the list of names does not have it', () => {
        expect(matchesSearch(makeScheduleEntry({ title: 'Dandadan', names: [] }), 'dandadan')).toBe(true);
    });

    it('does not match a name that is in none of them', () => {
        expect(matchesSearch(BLEACH, 'naruto')).toBe(false);
        expect(matchesSearch(makeScheduleEntry({ title: 'Dandadan', names: [] }), 'blue lock')).toBe(false);
    });
});
