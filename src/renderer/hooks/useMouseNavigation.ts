import { useEffect } from 'react';
import type { MangaListKind } from '@shared/manga';
import { useAnimeStore, type AnimeBrowseView, type AnimeSelection, type AnimeView } from '../store/animeStore';
import { useAppStore, type DownloadsView, type Tab } from '../store/appStore';
import { useMangaStore, type MangaBrowseView, type MangaSelection, type MangaView } from '../store/mangaStore';
import { MAX_NAVIGATION_ENTRIES, NavigationHistory } from './navigationHistory';

// The buttons on the side of the mouse that browsers use to go back and forward.
export const MOUSE_BACK_BUTTON = 3;
export const MOUSE_FORWARD_BUTTON = 4;

// What makes a page of the manga section: the screen, the source that is open (and whether its search or its settings are), and the
// manga that is open.
export interface MangaPage {
    view: MangaView;
    previousView: MangaBrowseView;
    sourceId: string | null;
    mode: MangaListKind;
    settingsOpen: boolean;
    selection: MangaSelection | null;
    selectionFrom: 'browse' | 'search' | 'library';
    // The series open in the library, and the group the library is limited to.
    librarySeries: string | null;
    libraryGroup: number | null;
}

// Everything that makes a page of the app.
export interface NavigationSnapshot {
    tab: Tab;
    downloadsView: DownloadsView;
    view: AnimeView;
    returnView: AnimeBrowseView;
    selection: AnimeSelection | null;
    libraryFocus: number | null;
    librarySeries: string | null;
    manga: MangaPage;
}

export function snapshotKey(snapshot: NavigationSnapshot): string {
    const selection = snapshot.selection === null ? '' : `${snapshot.selection.result.index}:${snapshot.selection.audio}`;
    const { manga } = snapshot;
    const mangaKey = [manga.view, manga.previousView, manga.sourceId ?? '', manga.mode, manga.settingsOpen, manga.selection?.manga.remoteId ?? '', manga.selectionFrom, manga.librarySeries ?? '', manga.libraryGroup ?? ''].join(':');
    return [snapshot.tab, snapshot.downloadsView, snapshot.view, snapshot.returnView, selection, snapshot.libraryFocus ?? '', snapshot.librarySeries ?? '', mangaKey].join('|');
}

function readMangaPage(): MangaPage {
    const { view, previousView, browse, sourceSettings, selection, selectionFrom, librarySeries, libraryGroup } = useMangaStore.getState();
    return { view, previousView, sourceId: browse.sourceId, mode: browse.mode, settingsOpen: sourceSettings.open, selection, selectionFrom, librarySeries, libraryGroup };
}

function readSnapshot(): NavigationSnapshot {
    const { view, returnView, selection, libraryFocus, librarySeries } = useAnimeStore.getState();
    const { tab, downloadsView } = useAppStore.getState();
    return { tab, downloadsView, view, returnView, selection, libraryFocus, librarySeries, manga: readMangaPage() };
}

// Shows a page of the manga section again: the source is opened again when it is another one, and its list is asked for by the section
// itself once it is on the screen.
function showMangaPage(page: MangaPage): void {
    const manga = useMangaStore.getState();
    if (manga.browse.sourceId !== page.sourceId) {
        if (page.sourceId === null) {
            manga.closeSource();
        } else {
            manga.openSource(page.sourceId, page.mode);
        }
    } else if (page.sourceId !== null && manga.browse.mode !== page.mode) {
        manga.setMode(page.mode);
    }
    useMangaStore.setState({ view: page.view, previousView: page.previousView, selection: page.selection, selectionFrom: page.selectionFrom, librarySeries: page.librarySeries, libraryGroup: page.libraryGroup });
    if (page.settingsOpen && !manga.sourceSettings.open) {
        void manga.openSourceSettings();
    } else if (!page.settingsOpen && manga.sourceSettings.open) {
        manga.closeSourceSettings();
    }
    // Files can be moved or deleted while the app is open: the library is read again when it is shown.
    if (page.view === 'library') {
        void manga.refreshLibrary();
    }
}

function showSnapshot(snapshot: NavigationSnapshot): void {
    useAppStore.getState().setTab(snapshot.tab);
    useAppStore.getState().setDownloadsView(snapshot.downloadsView);
    useAnimeStore.setState({
        view: snapshot.view,
        returnView: snapshot.returnView,
        selection: snapshot.selection,
        libraryFocus: snapshot.libraryFocus,
        librarySeries: snapshot.librarySeries
    });
    // Files can be moved or deleted while the app is open: the library says which ones are gone when it is shown.
    if (snapshot.view === 'library') {
        void useAnimeStore.getState().refreshLibrary();
    }
    showMangaPage(snapshot.manga);
}

// A player is not a page: going back from it only closes it. Returns whether there was one to close. The reader of the manga is one too.
function closePlayers(): boolean {
    const { reader, closeReader } = useMangaStore.getState();
    if (reader.status !== 'closed') {
        closeReader();
        return true;
    }
    const { playing, streaming, closePlayer, closeStream } = useAnimeStore.getState();
    if (playing !== null) {
        closePlayer();
        return true;
    }
    if (streaming !== null) {
        closeStream();
        return true;
    }
    return false;
}

function isPlayerOpen(): boolean {
    const { playing, streaming } = useAnimeStore.getState();
    return playing !== null || streaming !== null || useMangaStore.getState().reader.status !== 'closed';
}

// Makes the back and forward buttons of the mouse move through the pages the viewer has been to.
export function useMouseNavigation(): void {
    useEffect(() => {
        const history = new NavigationHistory<NavigationSnapshot>(MAX_NAVIGATION_ENTRIES, snapshotKey);
        let showing = false;
        const record = (): void => {
            if (!showing) {
                history.record(readSnapshot());
            }
        };
        const show = (snapshot: NavigationSnapshot | null): void => {
            if (snapshot === null) {
                return;
            }
            showing = true;
            try {
                showSnapshot(snapshot);
            } finally {
                showing = false;
            }
        };
        const onMouseUp = (event: MouseEvent): void => {
            if (event.button === MOUSE_BACK_BUTTON) {
                event.preventDefault();
                if (!closePlayers()) {
                    show(history.back());
                }
            } else if (event.button === MOUSE_FORWARD_BUTTON) {
                event.preventDefault();
                if (!isPlayerOpen()) {
                    show(history.forward());
                }
            }
        };
        record();
        const unsubscribeApp = useAppStore.subscribe(record);
        const unsubscribeAnime = useAnimeStore.subscribe(record);
        const unsubscribeManga = useMangaStore.subscribe(record);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            unsubscribeApp();
            unsubscribeAnime();
            unsubscribeManga();
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, []);
}
