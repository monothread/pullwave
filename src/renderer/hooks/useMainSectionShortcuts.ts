import { useEffect } from 'react';
import { SECTION_TABS } from '../components/SideNav';
import { isEditable, openModal, sectionStepOf } from '../navigation/searchShortcuts';
import { mainSectionAfter } from '../navigation/sections';
import { arrowsAreOwned } from '../navigation/spatialNavigation';
import { withViewTransition } from '../navigation/viewTransition';
import { useAnimeStore } from '../store/animeStore';
import { useAppStore, type Tab } from '../store/appStore';
import { useMangaStore } from '../store/mangaStore';

// The sections that Ctrl+Home and Ctrl+End walk through, in the order of the menu: the home screen and the three sections, leaving out the
// settings of the whole app and the sections that do not exist here.
export function walkableSections(): Tab[] {
    const animeSupported = useAnimeStore.getState().status.supported;
    const mangaSupported = useMangaStore.getState().status.supported;
    return SECTION_TABS.map((item) => {
        return item.id;
    }).filter((id) => {
        return id !== 'settings' && (id !== 'anime' || animeSupported) && (id !== 'manga' || mangaSupported);
    });
}

// Ctrl+End goes to the next section of the menu and Ctrl+Home to the one before, going round at the ends, with the same slide as a click on the
// menu. With the cursor in a field the keys keep moving it through the text; a window that is open, the player and the reader keep them too.
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
