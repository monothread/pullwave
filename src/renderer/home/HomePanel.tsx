import { useEffect, useMemo, useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { Spotlight } from '../spotlight/Spotlight';
import { animeSpotlight, mangaSpotlight, mixSpotlight } from '../spotlight/spotlightData';
import { useSpotlightSlides } from '../spotlight/useSpotlightSlides';
import { useAnimeStore } from '../store/animeStore';
import { useMangaStore } from '../store/mangaStore';
import { HomeWelcome } from './HomeWelcome';
import { SectionCards } from './SectionCards';
import { StatsCard } from './StatsCard';
import { useShownHistory, useShownLibrary } from '../hooks/useShownManga';

// The history of reading is read from the library of the app, which does not need the manga server: the home screen asks for it as soon as
// it opens, so the numbers of the week are right at once. The sources of the manga (which tell what to hide, and send the block of the manga
// to the browse once an extension gives one) need the server: they are asked for once it runs, and the screens of the section keep them up
// to date.
function useMangaHomeData(mangaSupported: boolean, mangaReady: boolean): void {
    const loadHistory = useMangaStore((state) => {
        return state.loadHistory;
    });
    const loadSources = useMangaStore((state) => {
        return state.loadSources;
    });
    useEffect(() => {
        if (mangaSupported) {
            void loadHistory();
        }
    }, [mangaSupported, loadHistory]);
    useEffect(() => {
        if (mangaReady && useMangaStore.getState().browse.sourcesStatus === 'idle') {
            void loadSources();
        }
    }, [mangaReady, loadSources]);
}

// The highlights of both sections, the anime first.
function useHomeSpotlight() {
    const [openedAt] = useState(() => {
        return Date.now();
    });
    const animeSupported = useAnimeStore((state) => {
        return state.status.supported;
    });
    const animeLibrary = useAnimeStore((state) => {
        return state.library;
    });
    const animeHistory = useAnimeStore((state) => {
        return state.history;
    });
    const mangaSupported = useMangaStore((state) => {
        return state.status.supported;
    });
    const mangaLibrary = useShownLibrary();
    const mangaHistory = useShownHistory();
    const mangaReadKeys = useMangaStore((state) => {
        return state.readKeys;
    });
    const items = useMemo(() => {
        const anime = animeSupported ? animeSpotlight(animeLibrary, animeHistory, openedAt) : [];
        const manga = mangaSupported ? mangaSpotlight(mangaLibrary, mangaHistory, mangaReadKeys, openedAt) : [];
        return mixSpotlight(anime, manga);
    }, [animeSupported, animeLibrary, animeHistory, mangaSupported, mangaLibrary, mangaHistory, mangaReadKeys, openedAt]);
    return useSpotlightSlides(items);
}

// The home screen: the highlights (or a welcome when there are none yet), then a big block for each section.
export function HomePanel() {
    const t = useTranslator();
    const mangaSupported = useMangaStore((state) => {
        return state.status.supported;
    });
    const mangaReady = useMangaStore((state) => {
        return state.status.supported && state.status.server === 'running';
    });
    useMangaHomeData(mangaSupported, mangaReady);
    const slides = useHomeSpotlight();

    return (
        <section className="home" aria-label={t('home.aria')}>
            {slides.length > 0 ? <Spotlight slides={slides} label={t('spotlight.home')} /> : <HomeWelcome />}
            <StatsCard />
            <SectionCards />
        </section>
    );
}
