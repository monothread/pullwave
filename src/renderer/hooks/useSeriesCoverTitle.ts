import { useState } from 'react';
import { coverKey, useAnimeStore, type AnimeCoverState } from '../store/animeStore';

// The title whose cover stands for a series: the first season that has one, looked for one after the other. A season whose cover is known
// not to exist (AniList and the others have none, it could not be asked for, or its picture does not load) is passed over; one that is
// still being looked for is waited for. When no season has a cover, `exhausted` says so and the title is the first one.
export function pickSeriesCoverTitle(titles: readonly string[], covers: Readonly<Record<string, AnimeCoverState>>, broken: ReadonlySet<string>): PickedSeriesCover {
    for (const title of titles) {
        const key = coverKey(title);
        const state = covers[key];
        if (!broken.has(key) && (state === undefined || state.status === 'found')) {
            return { title, exhausted: false };
        }
    }
    return { title: titles[0] ?? null, exhausted: titles.length > 0 };
}

export interface PickedSeriesCover {
    // The title to show the cover of; null when the series has no season.
    title: string | null;
    // Every season is known to have no cover.
    exhausted: boolean;
}

export interface SeriesCoverTitle extends PickedSeriesCover {
    // To tell that the picture of the cover of a title does not load, so the next season is tried.
    markBroken: (title: string) => void;
}

export function useSeriesCoverTitle(titles: readonly string[]): SeriesCoverTitle {
    const covers = useAnimeStore((state) => {
        return state.covers;
    });
    const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
    const markBroken = (title: string): void => {
        setBroken((current) => {
            return new Set(current).add(coverKey(title));
        });
    };
    return { ...pickSeriesCoverTitle(titles, covers, broken), markBroken };
}
