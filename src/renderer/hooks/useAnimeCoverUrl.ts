import { coverKey, useAnimeStore } from '../store/animeStore';

export function useAnimeCoverUrl(title: string): string | null {
    return useAnimeStore((state) => {
        const found = state.covers[coverKey(title)];
        return found?.status === 'found' ? found.url : null;
    });
}
