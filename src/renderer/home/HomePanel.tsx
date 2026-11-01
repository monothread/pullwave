import { useEffect, useMemo, useState } from 'react';
import type { MessageKey } from '@shared/i18n';
import type { StartTab } from '@shared/types';
import { useTranslator } from '../i18n/useTranslator';
import { Spotlight } from '../spotlight/Spotlight';
import { animeSpotlight, mangaSpotlight, mixSpotlight } from '../spotlight/spotlightData';
import { useSpotlightSlides } from '../spotlight/useSpotlightSlides';
import { useAnimeStore } from '../store/animeStore';
import { useAppStore } from '../store/appStore';
import { useMangaStore } from '../store/mangaStore';
import { HomeWelcome } from './HomeWelcome';
import { SectionCards } from './SectionCards';

const SECTION_NAME: Readonly<Record<StartTab, MessageKey>> = {
    downloads: 'tab.downloads',
    anime: 'tab.anime',
    manga: 'tab.manga'
};

// The history of reading is only read by its own screen: the home screen asks for it once the manga server runs.
function useMangaHistory(mangaReady: boolean): void {
    const loadHistory = useMangaStore((state) => {
        return state.loadHistory;
    });
    useEffect(() => {
        if (mangaReady) {
            void loadHistory();
        }
    }, [mangaReady, loadHistory]);
}

// The highlights of both sections, the one of "Open on" first.
function useHomeSpotlight(startTab: StartTab) {
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
    const mangaLibrary = useMangaStore((state) => {
        return state.library;
    });
    const mangaHistory = useMangaStore((state) => {
        return state.history;
    });
    const items = useMemo(() => {
        const anime = animeSupported ? animeSpotlight(animeLibrary, animeHistory, openedAt) : [];
        const manga = mangaSupported ? mangaSpotlight(mangaLibrary, mangaHistory, openedAt) : [];
        return mixSpotlight(anime, manga, startTab);
    }, [animeSupported, animeLibrary, animeHistory, mangaSupported, mangaLibrary, mangaHistory, openedAt, startTab]);
    return useSpotlightSlides(items);
}

// The home screen: the highlights (or a welcome when there are none yet), then a big block for each section.
export function HomePanel() {
    const t = useTranslator();
    const startTab = useAppStore((state) => {
        return state.settings.startTab;
    });
    const mangaReady = useMangaStore((state) => {
        return state.status.supported && state.status.server === 'running';
    });
    useMangaHistory(mangaReady);
    const slides = useHomeSpotlight(startTab);

    return (
        <section className="home" aria-label={t('home.aria')}>
            {slides.length > 0 ? <Spotlight slides={slides} label={t('spotlight.home')} /> : <HomeWelcome sectionName={t(SECTION_NAME[startTab])} startTab={startTab} />}
            <SectionCards />
        </section>
    );
}
