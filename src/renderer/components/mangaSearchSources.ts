import type { MangaSource } from '@shared/manga';
import { ALL_LANGUAGES, listedSources } from './mangaText';

export const SEVERAL_LANGUAGES = 'all';

export function sourceLanguages(sources: readonly MangaSource[]): string[] {
    return [
        ...new Set(
            sources.map((source) => {
                return source.lang;
            })
        )
    ].sort((first, second) => {
        return Number(first === SEVERAL_LANGUAGES) - Number(second === SEVERAL_LANGUAGES) || first.localeCompare(second);
    });
}

export const RESULTS_PER_SOURCE = 12;
export const SEARCH_CONCURRENCY = 2;

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

export function migrationSources(sources: readonly MangaSource[], currentSourceId: string, language: string, showAdult: boolean): MangaSource[] {
    return listedSources(sources, showAdult)
        .filter((source) => {
            return source.id !== currentSourceId && (language === ALL_LANGUAGES || source.lang === language || source.lang === SEVERAL_LANGUAGES);
        })
        .sort((first, second) => {
            return first.name.localeCompare(second.name, undefined, { sensitivity: 'base' }) || first.lang.localeCompare(second.lang);
        });
}

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
