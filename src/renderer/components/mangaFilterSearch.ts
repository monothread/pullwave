import type { MangaFilter } from '@shared/manga';

// Turns on, in the filters of a source, the one named like the term (a genre, a tag, an author...), looking inside the groups too. The
// name is compared ignoring case and the spaces around. Gives null when the source has no such filter.
export function activateFilter(filters: readonly MangaFilter[], term: string): MangaFilter[] | null {
    const wanted = term.trim().toLowerCase();
    if (wanted.length === 0) {
        return null;
    }
    let found = false;
    const walk = (list: readonly MangaFilter[]): MangaFilter[] => {
        return list.map((filter) => {
            if (found) {
                return filter;
            }
            if (filter.type === 'group') {
                return { ...filter, filters: walk(filter.filters) };
            }
            if ((filter.type === 'tristate' || filter.type === 'checkbox') && filter.name.trim().toLowerCase() === wanted) {
                found = true;
                return filter.type === 'checkbox' ? { ...filter, value: true } : { ...filter, value: 'include' };
            }
            return filter;
        });
    };
    const result = walk(filters);
    return found ? result : null;
}
