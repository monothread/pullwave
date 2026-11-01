import type { AnimeSearchResult } from './anime';
import { foldSeries } from './series';

// Two anime of the source can have the same title ("Nisekoi: False Love" and its second season) and only differ by the id the source gives
// each one ("nisekoi-false-love-603" and "nisekoi-false-love-season-2-605"): the words of the id, after the title, tell them apart.

// What a title is compared by: without case, accents, spaces or anything that is not a letter or a number.
function titleKey(title: string): string {
    return foldSeries(title).replace(/[^\p{L}\p{N}]/gu, '');
}

function slugOfTitle(title: string): string {
    return foldSeries(title)
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '');
}

// The number an id ends with ("603"), which is only known by the source.
export function sourceIdNumber(sourceId: string): string {
    return /-(\d+)$/.exec(sourceId)?.[1] ?? sourceId;
}

// What the id says about the anime beyond its title ("season 2"), or null when it says nothing more (the id is the title and a number).
export function sourceQualifier(title: string, sourceId: string): string | null {
    const words = sourceId.replace(/-\d+$/, '').replace(/^-+|-+$/g, '');
    const base = slugOfTitle(title);
    const rest = words === base || base === '' || !words.startsWith(`${base}-`) ? (words === base ? '' : words) : words.slice(base.length + 1);
    const spoken = rest.replace(/-+/g, ' ').trim();
    return spoken.length > 0 ? spoken : null;
}

// The results of a search with the ones that share a title told apart: each one that has something more in its id gets it after its title
// ("Nisekoi: False Love (season 2)"), and the one that has nothing more keeps the title as it is. Two that would still be called the same
// get the number of their ids. Results without an id (this copy of ani-cli does not give it) are left as they are.
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
