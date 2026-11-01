import type { LibraryAnime } from '@shared/anime';
import type { LibraryManga } from '@shared/manga';
import { groupLibrary, matchesSearch } from '../components/animeText';

// How many titles of the library the search of the top bar suggests at most.
export const SEARCH_SUGGESTION_LIMIT = 6;

export type SearchSuggestion =
    | { kind: 'anime'; key: string; title: string; animeId: number }
    | { kind: 'manga'; key: string; title: string; manga: LibraryManga }
    | { kind: 'search-anime'; key: string; query: string }
    | { kind: 'search-manga'; key: string; query: string };

// What the search of the top bar offers for a text: the anime and the mangas of the library whose names have it, then a search of it in the
// sections that exist here. Nothing for an empty text.
export function searchSuggestions(query: string, anime: readonly LibraryAnime[], manga: readonly LibraryManga[], animeSupported: boolean, mangaSupported: boolean, limit: number = SEARCH_SUGGESTION_LIMIT): SearchSuggestion[] {
    const text = query.trim();
    if (text === '') {
        return [];
    }
    const found: SearchSuggestion[] = [];
    groupLibrary(anime).forEach((group) => {
        const first = group.entries[0];
        if (first !== undefined && matchesSearch(group.series, text)) {
            found.push({ kind: 'anime', key: `anime-${group.key}`, title: group.series, animeId: first.id });
        }
    });
    manga.forEach((entry) => {
        if (matchesSearch(entry.title, text)) {
            found.push({ kind: 'manga', key: `manga-${String(entry.id)}`, title: entry.title, manga: entry });
        }
    });
    const searches: SearchSuggestion[] = [];
    if (animeSupported) {
        searches.push({ kind: 'search-anime', key: 'search-anime', query: text });
    }
    if (mangaSupported) {
        searches.push({ kind: 'search-manga', key: 'search-manga', query: text });
    }
    return [...found.slice(0, limit), ...searches];
}
