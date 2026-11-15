import type { AnimeScheduleEntry } from '@shared/anime';

export function normalizeSearch(text: string): string {
    return text
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim();
}

export function matchesSearch(entry: AnimeScheduleEntry, query: string): boolean {
    const wanted = normalizeSearch(query);
    if (wanted === '') {
        return true;
    }
    return [entry.title, ...entry.names].some((name) => {
        return normalizeSearch(name).includes(wanted);
    });
}
