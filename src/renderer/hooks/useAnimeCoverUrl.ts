import { coverKey, useAnimeStore } from '../store/animeStore';

// The address of the cover of an anime as the store knows it, or null while it is not found.
export function useAnimeCoverUrl(title: string): string | null {
    return useAnimeStore((state) => {
        const found = state.covers[coverKey(title)];
        return found?.status === 'found' ? found.url : null;
    });
}
