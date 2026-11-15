import { lazy, Suspense } from 'react';
import { useAnimeStore } from '../store/animeStore';

const AnimeStreamPlayer = lazy(async () => {
    const module = await import('./AnimeStreamPlayer');
    return { default: module.AnimeStreamPlayer };
});

export function LazyAnimeStreamPlayer() {
    const open = useAnimeStore((state) => {
        return state.streaming !== null;
    });
    if (!open) {
        return null;
    }
    return (
        <Suspense fallback={null}>
            <AnimeStreamPlayer />
        </Suspense>
    );
}
