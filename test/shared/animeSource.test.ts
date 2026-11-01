import type { AnimeSearchResult } from '@shared/anime';
import { sourceIdNumber, sourceQualifier, tellResultsApart } from '@shared/animeSource';

function result(index: number, title: string, sourceId?: string): AnimeSearchResult {
    return sourceId === undefined ? { index, title } : { index, title, sourceId };
}

describe('sourceIdNumber', () => {
    it('gives the number the id ends with', () => {
        expect(sourceIdNumber('nisekoi-false-love-603')).toBe('603');
        expect(sourceIdNumber('nisekoi-false-love-season-2-605')).toBe('605');
    });

    it('gives the whole id when it has no number at its end', () => {
        expect(sourceIdNumber('nisekoi')).toBe('nisekoi');
    });
});

describe('sourceQualifier', () => {
    it('is what the id says after the title: the second season', () => {
        expect(sourceQualifier('Nisekoi: False Love', 'nisekoi-false-love-season-2-605')).toBe('season 2');
    });

    it('is nothing when the id is only the title and a number', () => {
        expect(sourceQualifier('Nisekoi: False Love', 'nisekoi-false-love-603')).toBeNull();
    });

    it('compares the title without case, accents or punctuation', () => {
        expect(sourceQualifier('Atelier Ryza: Ever Darkness', 'atelier-ryza-ever-darkness-ova-77')).toBe('ova');
        expect(sourceQualifier('Pokémon: Black & White', 'pokemon-black-white-2nd-season-12')).toBe('2nd season');
    });

    it('is all the words of the id when the id does not begin with the title', () => {
        expect(sourceQualifier('Another Name', 'black-clover-season-2-1-10492')).toBe('black clover season 2 1');
    });

    it('is all the words of the id for an empty title', () => {
        expect(sourceQualifier('', '603')).toBe('603');
        expect(sourceQualifier('', 'one-piece-12')).toBe('one piece');
    });
});

describe('tellResultsApart', () => {
    it('gives each result that shares a title what its id says, and leaves the one that says nothing more as it is', () => {
        const results = [result(1, 'Nisekoi: False Love', 'nisekoi-false-love-603'), result(2, 'Nisekoi: False Love', 'nisekoi-false-love-season-2-605'), result(3, 'Nisekoi OVA', 'nisekoi-ova-604')];
        expect(tellResultsApart(results)).toEqual([
            { index: 1, title: 'Nisekoi: False Love', sourceId: 'nisekoi-false-love-603' },
            { index: 2, title: 'Nisekoi: False Love (season 2)', sourceId: 'nisekoi-false-love-season-2-605' },
            { index: 3, title: 'Nisekoi OVA', sourceId: 'nisekoi-ova-604' }
        ]);
    });

    it('does not change a list that has no title twice', () => {
        const results = [result(1, 'Naruto', 'naruto-1'), result(2, 'Bleach', 'bleach-2')];
        expect(tellResultsApart(results)).toEqual(results);
    });

    it('does not change the list it was given', () => {
        const results = [result(1, 'A', 'a-1'), result(2, 'A', 'a-season-2-2')];
        const copy = JSON.parse(JSON.stringify(results)) as AnimeSearchResult[];
        tellResultsApart(results);
        expect(results).toEqual(copy);
    });

    it('tells apart titles that are the same but for case and punctuation', () => {
        const results = [result(1, 'Re:Zero', 're-zero-10'), result(2, 're zero', 're-zero-season-2-11')];
        expect(tellResultsApart(results).map((entry) => { return entry.title; })).toEqual(['Re:Zero', 're zero (season 2)']);
    });

    it('adds the number of the id to the results that would still be called the same', () => {
        const results = [result(1, 'Same', 'same-ova-10'), result(2, 'Same', 'same-ova-11'), result(3, 'Same', 'same-12')];
        expect(tellResultsApart(results).map((entry) => { return entry.title; })).toEqual(['Same (ova) (10)', 'Same (ova) (11)', 'Same']);
    });

    it('leaves alone the results without an id, even with a title that repeats', () => {
        const results = [result(1, 'Naruto'), result(2, 'Naruto')];
        expect(tellResultsApart(results)).toEqual(results);
    });

    it('tells apart only the results that have an id when some have none', () => {
        const results = [result(1, 'A', 'a-1'), result(2, 'A'), result(3, 'A', 'a-season-2-3')];
        expect(tellResultsApart(results)).toEqual([
            { index: 1, title: 'A', sourceId: 'a-1' },
            { index: 2, title: 'A' },
            { index: 3, title: 'A (season 2)', sourceId: 'a-season-2-3' }
        ]);
    });

    it('keeps the order and the positions', () => {
        const results = [result(5, 'A', 'a-season-3-9'), result(7, 'A', 'a-1')];
        expect(tellResultsApart(results).map((entry) => { return [entry.index, entry.title]; })).toEqual([[5, 'A (season 3)'], [7, 'A']]);
    });

    it('is empty for an empty list', () => {
        expect(tellResultsApart([])).toEqual([]);
    });
});
