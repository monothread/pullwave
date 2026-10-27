import type { AnimeSearchResult } from '@shared/anime';
import { comparableTitle, resolveResult } from '@main/services/animeSourceMatch';

describe('comparableTitle', () => {
    it.each([
        ['Dandadan', 'dandadan'],
        ['  DANDADAN  ', 'dandadan'],
        ['Frieren: Beyond Journey\'s End', 'frierenbeyondjourneysend'],
        ['Dandadan (28 episodes)', 'dandadan'],
        ['One Piece (1180 episodes)', 'onepiece'],
        ['Name [Dub]', 'name'],
        ['Pokémon', 'pokemon'],
        ['Re:Zero − Starting Life', 'rezerostartinglife'],
        ['葬送のフリーレン', '葬送のフリーレン'],
        ['', '']
    ])('turns "%s" into "%s"', (title, expected) => {
        expect(comparableTitle(title)).toBe(expected);
    });

    it('gives the same text for a title whose number of episodes changed', () => {
        expect(comparableTitle('One Piece (1180 episodes)')).toBe(comparableTitle('One Piece (1181 episodes)'));
    });
});

describe('resolveResult', () => {
    const RESULTS: AnimeSearchResult[] = [
        { index: 1, title: 'One Piece (1180 episodes)' },
        { index: 2, title: 'One Piece Film: Red' },
        { index: 3, title: 'One Piece: Heroines' }
    ];

    it('keeps the place the anime had when its title is still there', () => {
        expect(resolveResult({ title: 'One Piece Film: Red', searchIndex: 2 }, RESULTS)).toBe(2);
    });

    it('keeps the place when only the number of episodes in the title changed', () => {
        expect(resolveResult({ title: 'One Piece (1179 episodes)', searchIndex: 1 }, RESULTS)).toBe(1);
    });

    it('finds the anime at its new place when a new anime was listed before it', () => {
        const results: AnimeSearchResult[] = [{ index: 1, title: 'One Piece Fan Letter' }, ...RESULTS.map((result) => {
            return { index: result.index + 1, title: result.title };
        })];

        expect(resolveResult({ title: 'One Piece Film: Red', searchIndex: 2 }, results)).toBe(3);
    });

    it('finds the anime by its title when its place is not known (0)', () => {
        expect(resolveResult({ title: 'One Piece: Heroines', searchIndex: 0 }, RESULTS)).toBe(3);
    });

    it('does not mind case, accents or punctuation in the title', () => {
        expect(resolveResult({ title: 'ONE PIECE — film red', searchIndex: 1 }, RESULTS)).toBe(2);
    });

    it('gives null when no result has the title', () => {
        expect(resolveResult({ title: 'Naruto', searchIndex: 2 }, RESULTS)).toBeNull();
    });

    it('gives null when there are no results', () => {
        expect(resolveResult({ title: 'Naruto', searchIndex: 1 }, [])).toBeNull();
    });

    it('gives null when the title has no letters or numbers to compare', () => {
        expect(resolveResult({ title: '(12 episodes)', searchIndex: 1 }, RESULTS)).toBeNull();
        expect(resolveResult({ title: '', searchIndex: 1 }, RESULTS)).toBeNull();
    });

    it('gives null when more than one result has the title and none of them is at the place the anime had', () => {
        const results: AnimeSearchResult[] = [
            { index: 1, title: 'Bleach (366 episodes)' },
            { index: 2, title: 'Bleach (13 episodes)' },
            { index: 3, title: 'Bleach: Thousand-Year Blood War' }
        ];

        expect(resolveResult({ title: 'Bleach', searchIndex: 3 }, results)).toBeNull();
    });

    it('keeps the place the anime had when more than one result has the title and one of them is there', () => {
        const results: AnimeSearchResult[] = [
            { index: 1, title: 'Bleach (366 episodes)' },
            { index: 2, title: 'Bleach (13 episodes)' }
        ];

        expect(resolveResult({ title: 'Bleach', searchIndex: 2 }, results)).toBe(2);
    });

    it('takes the only result as the anime, whatever it is called: ani-cli gives the search as its title', () => {
        expect(resolveResult({ title: 'Dandadan (28 episodes)', searchIndex: 4 }, [{ index: 1, title: 'Dandadan' }])).toBe(1);
        expect(resolveResult({ title: 'Dandadan (28 episodes)', searchIndex: 0 }, [{ index: 1, title: 'dandadan' }])).toBe(1);
    });
});
