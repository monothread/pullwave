import { useEffect, useMemo, useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { useMangaStore } from '../store/mangaStore';
import { Spotlight } from '../spotlight/Spotlight';
import { animeSpotlight, mangaSpotlight } from '../spotlight/spotlightData';
import { useSpotlightSlides } from '../spotlight/useSpotlightSlides';
import { useShownHistory, useShownLibrary } from '../hooks/useShownManga';

function useOpenedAt(): number {
    const [openedAt] = useState(() => {
        return Date.now();
    });
    return openedAt;
}

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
