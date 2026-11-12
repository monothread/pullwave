import { lazy, Suspense } from 'react';
import { useAnimeStore } from '../store/animeStore';

// The player of the streams brings hls.js, the biggest part of the code of the window: it is loaded the first time a stream is opened.
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
