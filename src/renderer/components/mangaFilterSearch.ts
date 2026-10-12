import type { MangaFilter } from '@shared/manga';

// What a term (from the page of a manga) is: a genre or tag, the author or the artist.
export type TermKind = 'tag' | 'author' | 'artist';

// Names are compared ignoring case, accents and punctuation ("Sci-Fi" is "sci fi").
function fold(text: string): string {
    return text
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

// The options of a list that stand for "no choice".
const NO_CHOICE = new Set(['all', 'any', 'none']);

// Turns on, in the filters of a source, the one that stands for the term, looking inside the groups too:
//  - a genre or tag: the check box or tri-state filter named like it (a group of them is how most sources list genres), or the option of a
//    list filter named like it (some list the genres as the options of one list); and, in the sources that have none of those and take the
//    tags as a text ("Separate tags with commas", HentaiRead), the text filter of the tags, which gets the tag added to what it has;
//  - the author or the artist: the text filter of the source about authors (or artists) given the name, or, when the source lists people
//    that way, the check box or tri-state filter named like the person. A source that only has the one about artists is used for authors
//    too (and the other way round): in those sources the author is the artist.
// Gives null when the source has no filter that stands for it: the term is then not something that can be searched with the filters.
export function activateFilter(filters: readonly MangaFilter[], term: string, kind: TermKind = 'tag'): MangaFilter[] | null {
    const wanted = fold(term);
    if (wanted.length === 0) {
        return null;
    }
    if (kind === 'tag') {
        return activateNamed(filters, wanted) ?? activateOption(filters, wanted) ?? activateText(filters, TAGS, term.trim(), true);
    }
    const first = kind === 'author' ? AUTHORS : ARTISTS;
    const second = kind === 'author' ? ARTISTS : AUTHORS;
    return activateText(filters, first, term.trim(), false) ?? activateText(filters, second, term.trim(), false) ?? activateNamed(filters, wanted) ?? activateOption(filters, wanted);
}

const TAGS = /\btags?\b/;
const AUTHORS = /\bauthors?\b/;
const ARTISTS = /\bartists?\b/;

// The text filter whose name says what it is about, given the term: written as the value, or (a list separated by commas) added to it.
function activateText(filters: readonly MangaFilter[], about: RegExp, term: string, list: boolean): MangaFilter[] | null {
    let found = false;
    const walk = (items: readonly MangaFilter[]): MangaFilter[] => {
        return items.map((filter) => {
            if (found) {
                return filter;
            }
            if (filter.type === 'group') {
                return { ...filter, filters: walk(filter.filters) };
            }
            if (filter.type === 'text' && about.test(fold(filter.name))) {
                found = true;
                return { ...filter, value: list ? addToList(filter.value, term) : term };
            }
            return filter;
        });
    };
    const result = walk(filters);
    return found ? result : null;
}

// A list written as text with commas, with the term in it (once).
function addToList(value: string, term: string): string {
    const items = value
        .split(',')
        .map((item) => {
            return item.trim();
        })
        .filter((item) => {
            return item.length > 0;
        });
    const has = items.some((item) => {
        return fold(item.replace(/^-/, '')) === fold(term);
    });
    return (has ? items : [...items, term]).join(', ');
}

// The check box or tri-state filter named like the term (the first one).
function activateNamed(filters: readonly MangaFilter[], wanted: string): MangaFilter[] | null {
    let found = false;
    const walk = (list: readonly MangaFilter[]): MangaFilter[] => {
        return list.map((filter) => {
            if (found) {
                return filter;
            }
            if (filter.type === 'group') {
                return { ...filter, filters: walk(filter.filters) };
            }
            if ((filter.type === 'tristate' || filter.type === 'checkbox') && fold(filter.name) === wanted) {
                found = true;
                return filter.type === 'checkbox' ? { ...filter, value: true } : { ...filter, value: 'include' };
            }
            return filter;
        });
    };
    const result = walk(filters);
    return found ? result : null;
}

// The option of a list filter named like the term (the first list that has one).
function activateOption(filters: readonly MangaFilter[], wanted: string): MangaFilter[] | null {
    let found = false;
    const walk = (list: readonly MangaFilter[]): MangaFilter[] => {
        return list.map((filter) => {
            if (found) {
                return filter;
            }
            if (filter.type === 'group') {
                return { ...filter, filters: walk(filter.filters) };
            }
            if (filter.type === 'select') {
                const index = filter.options.findIndex((option) => {
                    return fold(option) === wanted && !NO_CHOICE.has(fold(option));
                });
                if (index >= 0) {
                    found = true;
                    return { ...filter, value: index };
                }
            }
            return filter;
        });
    };
    const result = walk(filters);
    return found ? result : null;
}
