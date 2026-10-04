import type { AnimeScheduleEntry } from '@shared/anime';

// The text compared: without the case, the accents and the spaces around it, so "dan da dan" finds "Dan Da Dan" and "Burichi" finds "Burīchi".
export function normalizeSearch(text: string): string {
    return text
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim();
}

// Whether the name that was typed is in the title of the entry or in any other name it is known by. An empty search matches everything.
export function matchesSearch(entry: AnimeScheduleEntry, query: string): boolean {
    const wanted = normalizeSearch(query);
    if (wanted === '') {
        return true;
    }
    return [entry.title, ...entry.names].some((name) => {
        return normalizeSearch(name).includes(wanted);
    });
}
