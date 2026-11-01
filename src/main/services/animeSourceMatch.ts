import type { AnimeSearchResult } from '@shared/anime';
import { foldSeries } from '@shared/series';

// The title the source lists an anime by is the only thing that tells it again when its place in the results changes: ani-cli selects
// an entry by its position (`-S <index>`), so a new anime listed before it moves it.

const BRACKETS = /\s*[([][^)\]]*[)\]]/g;
const NOT_A_LETTER_OR_NUMBER = /[^\p{L}\p{N}]/gu;

// A title as it is compared: without case, accents, what is between brackets (the source adds "(12 episodes)" and qualifiers, and the
// number changes as episodes come out) or anything that is not a letter or a number.
export function comparableTitle(title: string): string {
    return foldSeries(title).replace(BRACKETS, '').replace(NOT_A_LETTER_OR_NUMBER, '');
}

// The anime kept in the library as it is found again: its id when it is known, else its title and the place it had in the results of its search.
export interface StoredAnimeResult {
    title: string;
    searchIndex: number;
    // The id the source gave it, when it is known: it tells the anime from another with the same title, and finds it wherever it is listed.
    sourceId?: string | null;
}

// Where the anime is in the results of its search now, or null when that cannot be told: it is not listed, or more than one entry has its
// title and none of them is the place it had. A single result is the anime itself: ani-cli picks it without listing, so the title it
// gives back is only the search, not the title of the source.
export function resolveResult(stored: StoredAnimeResult, results: readonly AnimeSearchResult[]): number | null {
    if (results.length === 1) {
        return (results[0] as AnimeSearchResult).index;
    }
    if (stored.sourceId !== undefined && stored.sourceId !== null) {
        const byId = results.find((result) => {
            return result.sourceId === stored.sourceId;
        });
        if (byId !== undefined) {
            return byId.index;
        }
    }
    const wanted = comparableTitle(stored.title);
    if (wanted.length === 0) {
        return null;
    }
    const same = results.filter((result) => {
        return comparableTitle(result.title) === wanted;
    });
    const kept = same.find((result) => {
        return result.index === stored.searchIndex;
    });
    if (kept !== undefined) {
        return kept.index;
    }
    return same.length === 1 ? (same[0] as AnimeSearchResult).index : null;
}
