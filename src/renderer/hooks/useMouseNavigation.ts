import { useEffect } from 'react';
import { useAnimeStore, type AnimeBrowseView, type AnimeSelection, type AnimeView } from '../store/animeStore';
import { useAppStore, type DownloadsView, type Tab } from '../store/appStore';
import { MAX_NAVIGATION_ENTRIES, NavigationHistory } from './navigationHistory';

// The buttons on the side of the mouse that browsers use to go back and forward.
export const MOUSE_BACK_BUTTON = 3;
export const MOUSE_FORWARD_BUTTON = 4;

// Everything that makes a page of the app.
export interface NavigationSnapshot {
    tab: Tab;
    downloadsView: DownloadsView;
    view: AnimeView;
    returnView: AnimeBrowseView;
    selection: AnimeSelection | null;
    libraryFocus: number | null;
    librarySeries: string | null;
}

export function snapshotKey(snapshot: NavigationSnapshot): string {
    const selection = snapshot.selection === null ? '' : `${snapshot.selection.result.index}:${snapshot.selection.audio}`;
    return [snapshot.tab, snapshot.downloadsView, snapshot.view, snapshot.returnView, selection, snapshot.libraryFocus ?? '', snapshot.librarySeries ?? ''].join('|');
}

function readSnapshot(): NavigationSnapshot {
    const { view, returnView, selection, libraryFocus, librarySeries } = useAnimeStore.getState();
    const { tab, downloadsView } = useAppStore.getState();
    return { tab, downloadsView, view, returnView, selection, libraryFocus, librarySeries };
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
}

// A player is not a page: going back from it only closes it. Returns whether there was one to close.
function closePlayers(): boolean {
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
    return playing !== null || streaming !== null;
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
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            unsubscribeApp();
            unsubscribeAnime();
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, []);
}
