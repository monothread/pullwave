import type { MangaFilter } from '@shared/manga';

export type TermKind = 'tag' | 'author' | 'artist';

function fold(text: string): string {
    return text
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

const NO_CHOICE = new Set(['all', 'any', 'none']);

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
