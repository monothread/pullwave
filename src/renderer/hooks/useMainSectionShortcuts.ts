import { useEffect } from 'react';
import { SECTION_TABS } from '../components/SideNav';
import { isEditable, openModal, sectionStepOf } from '../navigation/searchShortcuts';
import { mainSectionAfter } from '../navigation/sections';
import { arrowsAreOwned } from '../navigation/spatialNavigation';
import { withViewTransition } from '../navigation/viewTransition';
import { useAnimeStore } from '../store/animeStore';
import { useAppStore, type Tab } from '../store/appStore';
import { useMangaStore } from '../store/mangaStore';

export function walkableSections(): Tab[] {
    const animeSupported = useAnimeStore.getState().status.supported;
    const mangaSupported = useMangaStore.getState().status.supported;
    return SECTION_TABS.map((item) => {
        return item.id;
    }).filter((id) => {
        return id !== 'settings' && (id !== 'anime' || animeSupported) && (id !== 'manga' || mangaSupported);
    });
}

export function useMainSectionShortcuts(): void {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
            const step = sectionStepOf(event);
            if (step === null || isEditable(event.target) || openModal() !== null || arrowsAreOwned()) {
                return;
            }
            const { tab, setTab } = useAppStore.getState();
            const next = mainSectionAfter(walkableSections(), tab, step);
            if (next === null) {
                return;
            }
            event.preventDefault();
            if (next !== tab) {
                withViewTransition(() => {
                    setTab(next);
                });
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
        };
    }, []);
}
