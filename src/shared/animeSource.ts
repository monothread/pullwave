import type { AnimeSearchResult } from './anime';
import { foldSeries } from './series';

function titleKey(title: string): string {
    return foldSeries(title).replace(/[^\p{L}\p{N}]/gu, '');
}

function slugOfTitle(title: string): string {
    return foldSeries(title)
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '');
}

export function sourceIdNumber(sourceId: string): string {
    return /-(\d+)$/.exec(sourceId)?.[1] ?? sourceId;
}

export function sourceQualifier(title: string, sourceId: string): string | null {
    const words = sourceId.replace(/-\d+$/, '').replace(/^-+|-+$/g, '');
    const base = slugOfTitle(title);
    const rest = words === base || base === '' || !words.startsWith(`${base}-`) ? (words === base ? '' : words) : words.slice(base.length + 1);
    const spoken = rest.replace(/-+/g, ' ').trim();
    return spoken.length > 0 ? spoken : null;
}

export function tellResultsApart(results: readonly AnimeSearchResult[]): AnimeSearchResult[] {
    const groups = new Map<string, AnimeSearchResult[]>();
    results.forEach((result) => {
        if (result.sourceId !== undefined) {
            groups.set(titleKey(result.title), [...(groups.get(titleKey(result.title)) ?? []), result]);
        }
    });
    const named = new Map<AnimeSearchResult, string>();
    groups.forEach((group) => {
        if (group.length < 2) {
            return;
        }
        group.forEach((result) => {
            const qualifier = sourceQualifier(result.title, result.sourceId as string);
            named.set(result, qualifier === null ? result.title : `${result.title} (${qualifier})`);
        });
        const counts = new Map<string, number>();
        group.forEach((result) => {
            const name = named.get(result) as string;
            counts.set(name, (counts.get(name) ?? 0) + 1);
        });
        group.forEach((result) => {
            const name = named.get(result) as string;
            if ((counts.get(name) ?? 0) > 1) {
                named.set(result, `${name} (${sourceIdNumber(result.sourceId as string)})`);
            }
        });
    });
    return results.map((result) => {
        const title = named.get(result);
        return title === undefined ? result : { ...result, title };
    });
}
