import { useEffect } from 'react';
import { ANIME_TAB_IDS } from '../components/AnimePanel';
import { DOWNLOADS_TAB_IDS } from '../components/DownloadsPanel';
import { MANGA_TAB_IDS } from '../components/MangaPanel';
import { openModal, tabStepOf } from '../navigation/searchShortcuts';
import { sectionAfter } from '../navigation/sections';
import { arrowsAreOwned } from '../navigation/spatialNavigation';
import { useAnimeStore, type AnimeBrowseView } from '../store/animeStore';
import { useAppStore, type DownloadsView } from '../store/appStore';
import { useMangaStore, type MangaBrowseView } from '../store/mangaStore';

// The tabs of the section that is open, which one is open, and how to open another.
export interface SectionTabs {
    ids: readonly string[];
    current: string;
    select: (id: string) => void;
}

function isTab(ids: readonly string[], id: string): boolean {
    return ids.includes(id);
}

// The tabs of the section the user is in, or null where there are none to move through: the home screen and the settings of the whole app have
// no tabs, a section that does not exist here has no screens, and the lists of downloads of the anime and the manga are not a tab.
export function currentSectionTabs(): SectionTabs | null {
    const { tab, downloadsView, setDownloadsView } = useAppStore.getState();
    if (tab === 'downloads') {
        return {
            ids: DOWNLOADS_TAB_IDS,
            current: downloadsView,
            select: (id) => {
                setDownloadsView(id as DownloadsView);
            }
        };
    }
    if (tab === 'anime') {
        const { status, view, setView } = useAnimeStore.getState();
        return status.supported && isTab(ANIME_TAB_IDS, view)
            ? {
                  ids: ANIME_TAB_IDS,
                  current: view,
                  select: (id) => {
                      setView(id as AnimeBrowseView);
                  }
              }
            : null;
    }
    if (tab === 'manga') {
        const { status, view, setView, reader } = useMangaStore.getState();
        return status.supported && reader.status === 'closed' && isTab(MANGA_TAB_IDS, view)
            ? {
                  ids: MANGA_TAB_IDS,
                  current: view,
                  select: (id) => {
                      setView(id as MangaBrowseView);
                  }
              }
            : null;
    }
    return null;
}

// Ctrl+Page Down goes to the next tab of the section and Ctrl+Page Up to the one before, going round at the ends. A window that is open, the
// player and the reader keep the keys.
export function useSectionTabShortcuts(): void {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
            const step = tabStepOf(event);
            if (step === null || openModal() !== null || arrowsAreOwned()) {
                return;
            }
            const tabs = currentSectionTabs();
            if (tabs === null) {
                return;
            }
            event.preventDefault();
            tabs.select(sectionAfter(tabs.ids, tabs.current, step));
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
        };
    }, []);
}
