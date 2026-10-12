import type { MangaFilter } from '@shared/manga';
import { activateFilter } from '@renderer/components/mangaFilterSearch';

const FILTERS: MangaFilter[] = [
    { type: 'header', name: 'Genres' },
    { type: 'text', name: 'Title', value: '' },
    { type: 'checkbox', name: 'Completed', value: false },
    { type: 'select', name: 'Order', options: ['a'], value: 0 },
    { type: 'group', name: 'Genres', filters: [{ type: 'tristate', name: 'Action', value: 'exclude' }, { type: 'tristate', name: 'Big Ass', value: 'ignore' }] },
    { type: 'group', name: 'Tags', filters: [{ type: 'checkbox', name: 'Sole Female', value: false }, { type: 'tristate', name: 'Action', value: 'ignore' }] }
];

describe('activateFilter', () => {
    it('turns on a tri-state filter inside a group, leaving the others as they are', () => {
        const result = activateFilter(FILTERS, 'Big Ass');
        expect(result).toEqual([
            FILTERS[0],
            FILTERS[1],
            FILTERS[2],
            FILTERS[3],
            { type: 'group', name: 'Genres', filters: [{ type: 'tristate', name: 'Action', value: 'exclude' }, { type: 'tristate', name: 'Big Ass', value: 'include' }] },
            FILTERS[5]
        ]);
    });

    it('turns on a check box inside a group', () => {
        const result = activateFilter(FILTERS, 'Sole Female');
        expect(result?.[5]).toEqual({ type: 'group', name: 'Tags', filters: [{ type: 'checkbox', name: 'Sole Female', value: true }, { type: 'tristate', name: 'Action', value: 'ignore' }] });
    });

    it('turns on a check box that is not in a group', () => {
        expect(activateFilter(FILTERS, 'Completed')?.[2]).toEqual({ type: 'checkbox', name: 'Completed', value: true });
    });

    it('ignores case and the spaces around the name', () => {
        expect(activateFilter(FILTERS, '  big ass ')?.[4]).toMatchObject({ filters: [{ value: 'exclude' }, { name: 'Big Ass', value: 'include' }] });
    });

    it('turns on only the first filter with the name', () => {
        const result = activateFilter(FILTERS, 'action');
        expect(result?.[4]).toEqual({ type: 'group', name: 'Genres', filters: [{ type: 'tristate', name: 'Action', value: 'include' }, { type: 'tristate', name: 'Big Ass', value: 'ignore' }] });
        expect(result?.[5]).toEqual(FILTERS[5]);
    });

    it('does not turn on filters that are not boxes or lists, even with the name', () => {
        expect(activateFilter(FILTERS, 'Title')).toBeNull();
        expect(activateFilter(FILTERS, 'Order')).toBeNull();
        expect(activateFilter(FILTERS, 'Genres')).toBeNull();
    });

    it('ignores accents and punctuation: "Sci-Fi" is "sci fi", "Ação" is "acao"', () => {
        const filters: MangaFilter[] = [{ type: 'group', name: 'Genre', filters: [{ type: 'tristate', name: 'Sci Fi', value: 'ignore' }, { type: 'tristate', name: 'Ação', value: 'ignore' }] }];
        expect(activateFilter(filters, 'Sci-Fi')).toEqual([{ type: 'group', name: 'Genre', filters: [{ type: 'tristate', name: 'Sci Fi', value: 'include' }, filters[0] && (filters[0] as { filters: MangaFilter[] }).filters[1]] }]);
        expect(activateFilter(filters, 'acao')).toMatchObject([{ filters: [{ value: 'ignore' }, { name: 'Ação', value: 'include' }] }]);
    });

    it('does not take a term made only of punctuation for any filter', () => {
        expect(activateFilter(FILTERS, '---')).toBeNull();
    });

    it('gives null when no filter has the name, when the name is empty and when there are no filters', () => {
        expect(activateFilter(FILTERS, 'Romance')).toBeNull();
        expect(activateFilter(FILTERS, '   ')).toBeNull();
        expect(activateFilter([], 'Action')).toBeNull();
    });

    it('does not change the filters it is given', () => {
        const before = JSON.stringify(FILTERS);
        activateFilter(FILTERS, 'Big Ass');
        expect(JSON.stringify(FILTERS)).toBe(before);
    });
});

describe('activateFilter with a list of options', () => {
    const LISTS: MangaFilter[] = [
        { type: 'select', name: 'Status', options: ['ALL', 'Completed', 'Ongoing'], value: 0 },
        { type: 'select', name: 'Category', options: ['ALL', '4-Koma', 'Action', 'Adult'], value: 0 },
        { type: 'group', name: 'More', filters: [{ type: 'select', name: 'Type', options: ['Any', 'Manga', 'Manhwa'], value: 0 }] }
    ];

    it('chooses the option that is named like the term, in the list that has it', () => {
        expect(activateFilter(LISTS, 'Action')).toEqual([LISTS[0], { type: 'select', name: 'Category', options: ['ALL', '4-Koma', 'Action', 'Adult'], value: 2 }, LISTS[2]]);
        expect(activateFilter(LISTS, 'ongoing')?.[0]).toMatchObject({ name: 'Status', value: 2 });
    });

    it('chooses an option inside a group', () => {
        expect(activateFilter(LISTS, 'Manhwa')?.[2]).toEqual({ type: 'group', name: 'More', filters: [{ type: 'select', name: 'Type', options: ['Any', 'Manga', 'Manhwa'], value: 2 }] });
    });

    it('never chooses the option that stands for no choice', () => {
        expect(activateFilter(LISTS, 'ALL')).toBeNull();
        expect(activateFilter(LISTS, 'any')).toBeNull();
    });

    it('prefers a box named like the term to an option of a list', () => {
        const mixed: MangaFilter[] = [LISTS[1]!, { type: 'group', name: 'Genre', filters: [{ type: 'tristate', name: 'Action', value: 'ignore' }] }];
        expect(activateFilter(mixed, 'Action')).toEqual([LISTS[1], { type: 'group', name: 'Genre', filters: [{ type: 'tristate', name: 'Action', value: 'include' }] }]);
    });

    it('gives null when no option has the name', () => {
        expect(activateFilter(LISTS, 'Romance')).toBeNull();
    });
});

describe('activateFilter for the author and the artist', () => {
    const PEOPLE: MangaFilter[] = [
        { type: 'text', name: 'Title', value: '' },
        { type: 'text', name: 'Author (Case-sensitive)', value: '' },
        { type: 'text', name: 'Artist', value: '' },
        { type: 'group', name: 'Authors', filters: [{ type: 'checkbox', name: 'Oda', value: false }] }
    ];

    it('gives the name to the text filter that is about authors, or about artists', () => {
        expect(activateFilter(PEOPLE, 'ODA Eiichiro', 'author')?.[1]).toEqual({ type: 'text', name: 'Author (Case-sensitive)', value: 'ODA Eiichiro' });
        expect(activateFilter(PEOPLE, '  Someone  ', 'artist')?.[2]).toEqual({ type: 'text', name: 'Artist', value: 'Someone' });
        expect(activateFilter(PEOPLE, 'ODA Eiichiro', 'author')?.[0]).toEqual(PEOPLE[0]);
    });

    it('looks inside the groups for a text filter', () => {
        const nested: MangaFilter[] = [{ type: 'group', name: 'People', filters: [{ type: 'text', name: 'Author', value: '' }] }];
        expect(activateFilter(nested, 'Oda', 'author')).toEqual([{ type: 'group', name: 'People', filters: [{ type: 'text', name: 'Author', value: 'Oda' }] }]);
    });

    it('uses the filter about artists for an author when the source has none about authors, and the other way round, since there the author is the artist', () => {
        expect(activateFilter([{ type: 'text', name: 'Artists', value: '' }], 'Oltlo', 'author')).toEqual([{ type: 'text', name: 'Artists', value: 'Oltlo' }]);
        expect(activateFilter([{ type: 'text', name: 'Author(s)', value: '' }], 'Someone', 'artist')).toEqual([{ type: 'text', name: 'Author(s)', value: 'Someone' }]);
    });

    it('prefers the filter about what was asked to the one about the other', () => {
        const both: MangaFilter[] = [{ type: 'text', name: 'Artist', value: '' }, { type: 'text', name: 'Author', value: '' }];
        expect(activateFilter(both, 'A', 'author')).toEqual([both[0], { type: 'text', name: 'Author', value: 'A' }]);
        expect(activateFilter(both, 'B', 'artist')).toEqual([{ type: 'text', name: 'Artist', value: 'B' }, both[1]]);
    });

    it('does not take a text filter that is about something else, like the circles or the title, for a person', () => {
        expect(activateFilter([{ type: 'text', name: 'Circles', value: '' }, { type: 'text', name: 'Title', value: '' }], 'Oltlo', 'author')).toBeNull();
    });

    it('turns on the box named like the person when the source lists people that way', () => {
        expect(activateFilter(PEOPLE, 'Oda', 'artist')?.[3]).toEqual({ type: 'group', name: 'Authors', filters: [{ type: 'checkbox', name: 'Oda', value: true }] });
    });

    it('prefers the text filter to a box named like the person', () => {
        const result = activateFilter(PEOPLE, 'Oda', 'author');
        expect(result?.[1]).toMatchObject({ value: 'Oda' });
        expect(result?.[3]).toEqual(PEOPLE[3]);
    });

    it('gives null when the source has no way to search a person, and for an empty name', () => {
        expect(activateFilter([{ type: 'text', name: 'Title', value: '' }], 'Oda', 'author')).toBeNull();
        expect(activateFilter(PEOPLE, '   ', 'author')).toBeNull();
    });

    it('does not use a text filter for a tag', () => {
        expect(activateFilter([{ type: 'text', name: 'Author', value: '' }], 'Author', 'tag')).toBeNull();
    });
});

describe('activateFilter for the sources that take the tags as a text', () => {
    const TEXTS: MangaFilter[] = [
        { type: 'group', name: 'Types', filters: [{ type: 'checkbox', name: 'Manga', value: false }] },
        { type: 'header', name: 'Separate tags with commas (,)' },
        { type: 'text', name: 'Tags', value: '' },
        { type: 'text', name: 'Artists', value: '' }
    ];

    it('writes the tag in the text filter of the tags when no box or list has it', () => {
        expect(activateFilter(TEXTS, 'Big Breasts')?.[2]).toEqual({ type: 'text', name: 'Tags', value: 'Big Breasts' });
        expect(activateFilter(TEXTS, 'Big Breasts')?.[3]).toEqual(TEXTS[3]);
    });

    it('adds the tag to what the text already has, with a comma, and does not repeat it, whatever the case', () => {
        const withTags: MangaFilter[] = [{ type: 'text', name: 'Tags', value: 'Ahegao, -Anal' }];
        expect(activateFilter(withTags, 'Blowjob')).toEqual([{ type: 'text', name: 'Tags', value: 'Ahegao, -Anal, Blowjob' }]);
        expect(activateFilter(withTags, 'ahegao')).toEqual([{ type: 'text', name: 'Tags', value: 'Ahegao, -Anal' }]);
        expect(activateFilter(withTags, 'anal')).toEqual([{ type: 'text', name: 'Tags', value: 'Ahegao, -Anal' }]);
    });

    it('prefers a box or an option to the text of the tags', () => {
        expect(activateFilter(TEXTS, 'Manga')).toEqual([{ type: 'group', name: 'Types', filters: [{ type: 'checkbox', name: 'Manga', value: true }] }, TEXTS[1], TEXTS[2], TEXTS[3]]);
    });

    it('looks inside the groups for the text of the tags', () => {
        const nested: MangaFilter[] = [{ type: 'group', name: 'More', filters: [{ type: 'text', name: 'Tag', value: '' }] }];
        expect(activateFilter(nested, 'Ahegao')).toEqual([{ type: 'group', name: 'More', filters: [{ type: 'text', name: 'Tag', value: 'Ahegao' }] }]);
    });

    it('does not use the text of the tags for a person', () => {
        expect(activateFilter([{ type: 'text', name: 'Tags', value: '' }], 'Oltlo', 'author')).toBeNull();
    });

    it('does not use a text that is not about tags for a tag', () => {
        expect(activateFilter([{ type: 'text', name: 'Characters', value: '' }, { type: 'text', name: 'Title', value: '' }], 'Ahegao')).toBeNull();
    });
});
