import { useEffect, useMemo, useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { useMangaStore } from '../store/mangaStore';
import { Spotlight } from '../spotlight/Spotlight';
import { animeSpotlight, mangaSpotlight } from '../spotlight/spotlightData';
import { useSpotlightSlides } from '../spotlight/useSpotlightSlides';
import { useShownHistory, useShownLibrary } from '../hooks/useShownManga';

// The time the screen opened: what is new is counted from it (a screen left open for days is read again when it is opened again).
function useOpenedAt(): number {
    const [openedAt] = useState(() => {
        return Date.now();
    });
    return openedAt;
}

// The highlights at the top of the anime library: the episodes to go on with, then the series with new episodes.
export function AnimeLibrarySpotlight() {
    const t = useTranslator();
    const now = useOpenedAt();
    const library = useAnimeStore((state) => {
        return state.library;
    });
    const history = useAnimeStore((state) => {
        return state.history;
    });
    const items = useMemo(() => {
        return animeSpotlight(library, history, now);
    }, [library, history, now]);
    const slides = useSpotlightSlides(items);
    if (slides.length === 0) {
        return null;
    }
    return <Spotlight slides={slides} label={t('spotlight.library')} />;
}

// The highlights at the top of the manga library: the mangas being read, then the ones with new chapters.
export function MangaLibrarySpotlight() {
    const t = useTranslator();
    const now = useOpenedAt();
    const library = useShownLibrary();
    const history = useShownHistory();
    const readKeys = useMangaStore((state) => {
        return state.readKeys;
    });
    const loadHistory = useMangaStore((state) => {
        return state.loadHistory;
    });
    // The history of reading is only read by its own screen: the highlights ask for it when it was not read yet.
    useEffect(() => {
        if (useMangaStore.getState().history.length === 0) {
            void loadHistory();
        }
    }, [loadHistory]);
    const items = useMemo(() => {
        return mangaSpotlight(library, history, readKeys, now);
    }, [library, history, readKeys, now]);
    const slides = useSpotlightSlides(items);
    if (slides.length === 0) {
        return null;
    }
    return <Spotlight slides={slides} label={t('spotlight.library')} />;
}
