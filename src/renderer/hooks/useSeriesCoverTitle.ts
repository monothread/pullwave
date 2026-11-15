import { useState } from 'react';
import { coverKey, useAnimeStore, type AnimeCoverState } from '../store/animeStore';

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
    title: string | null;
    exhausted: boolean;
}

export interface SeriesCoverTitle extends PickedSeriesCover {
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
