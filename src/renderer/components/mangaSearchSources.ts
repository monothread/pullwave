import type { MangaSource } from '@shared/manga';
import { ALL_LANGUAGES, listedSources } from './mangaText';

// How many results of each source are shown.
export const RESULTS_PER_SOURCE = 12;
// How many sources are asked at the same time.
export const SEARCH_CONCURRENCY = 2;

// The sources a search goes through: the ones that are listed (the ones for adults only when the user asked for them) and are in the
// language, by name. A language that no listed source has (a remembered one whose sources are gone) stands for all of them.
export function searchableSources(sources: readonly MangaSource[], language: string, showAdult: boolean): MangaSource[] {
    const listed = listedSources(sources, showAdult);
    const known = listed.some((source) => {
        return source.lang === language;
    });
    return listed
        .filter((source) => {
            return language === ALL_LANGUAGES || !known || source.lang === language;
        })
        .sort((first, second) => {
            return first.name.localeCompare(second.name, undefined, { sensitivity: 'base' }) || first.lang.localeCompare(second.lang);
        });
}

// Runs the task for each item, `limit` of them at a time, each one starting as soon as one of the others is over (in the order of the items).
export async function runLimited<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < items.length) {
            const item = items[next]!;
            next += 1;
            await task(item);
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, () => {
            return worker();
        })
    );
}
