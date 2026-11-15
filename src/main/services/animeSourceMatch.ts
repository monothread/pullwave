import type { AnimeSearchResult } from '@shared/anime';
import { foldSeries } from '@shared/series';

const BRACKETS = /\s*[([][^)\]]*[)\]]/g;
const NOT_A_LETTER_OR_NUMBER = /[^\p{L}\p{N}]/gu;

export function comparableTitle(title: string): string {
    return foldSeries(title).replace(BRACKETS, '').replace(NOT_A_LETTER_OR_NUMBER, '');
}

export interface StoredAnimeResult {
    title: string;
    searchIndex: number;
    sourceId?: string | null;
}

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
