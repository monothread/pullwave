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
//  - the author or the artist: first the text filter of the source that is about authors (or artists), which is given the name;
//  - a genre or tag (and an author or artist the source lists by name, as some do): the check box or tri-state filter named like it (a
//    group of them is how most sources list genres), or the option of a list filter that is named like it (some sources list the genres
//    as the options of one list).
// Gives null when the source has no filter that stands for it: the term is then not something that can be searched with the filters.
export function activateFilter(filters: readonly MangaFilter[], term: string, kind: TermKind = 'tag'): MangaFilter[] | null {
    const wanted = fold(term);
    if (wanted.length === 0) {
        return null;
    }
    if (kind !== 'tag') {
        const written = activateText(filters, term, kind);
        if (written !== null) {
            return written;
        }
    }
    return activateNamed(filters, wanted) ?? activateOption(filters, wanted);
}

// The text filter that is about the author (or the artist), given the name.
function activateText(filters: readonly MangaFilter[], term: string, kind: 'author' | 'artist'): MangaFilter[] | null {
    let found = false;
    const walk = (list: readonly MangaFilter[]): MangaFilter[] => {
        return list.map((filter) => {
            if (found) {
                return filter;
            }
            if (filter.type === 'group') {
                return { ...filter, filters: walk(filter.filters) };
            }
            if (filter.type === 'text' && fold(filter.name).split(' ').includes(kind)) {
                found = true;
                return { ...filter, value: term.trim() };
            }
            return filter;
        });
    };
    const result = walk(filters);
    return found ? result : null;
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
