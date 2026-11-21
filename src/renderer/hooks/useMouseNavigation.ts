import { useEffect } from 'react';
import type { MangaListKind } from '@shared/manga';
import { useAnimeStore, type AnimeBrowseView, type AnimeSelection, type AnimeView } from '../store/animeStore';
import { useAppStore, type DownloadsView, type Tab, type ToolsMode } from '../store/appStore';
import { useMangaStore, type MangaBrowseView, type MangaSelection, type MangaView } from '../store/mangaStore';
import { useCutStore } from '../store/cutStore';
import { useExplorerStore } from '../store/explorerStore';
import { isBatchingNavigation, onNavigationBatchEnd } from '../navigation/navigationBatch';
import { MAX_NAVIGATION_ENTRIES, NavigationHistory } from './navigationHistory';
import { isScrollRestoring, restoreScroll } from './scrollRestoration';

export const MOUSE_BACK_BUTTON = 3;
export const MOUSE_FORWARD_BUTTON = 4;

export interface MangaPage {
    view: MangaView;
    previousView: MangaBrowseView;
    sourceId: string | null;
    mode: MangaListKind;
    settingsOpen: boolean;
    selection: MangaSelection | null;
    selectionFrom: 'browse' | 'search' | 'library';
    librarySeries: string | null;
    libraryGroup: number | null;
}

export interface NavigationSnapshot {
    tab: Tab;
    downloadsView: DownloadsView;
    toolsMode: ToolsMode;
    view: AnimeView;
    returnView: AnimeBrowseView;
    selection: AnimeSelection | null;
    libraryFocus: number | null;
    librarySeries: string | null;
    librarySeason: number | null;
    manga: MangaPage;
}

export function snapshotKey(snapshot: NavigationSnapshot): string {
    const selection = snapshot.selection === null ? '' : String(snapshot.selection.result.index);
    const { manga } = snapshot;
    const mangaKey = [manga.view, manga.previousView, manga.sourceId ?? '', manga.mode, manga.settingsOpen, manga.selection?.manga.remoteId ?? '', manga.selectionFrom, manga.librarySeries ?? '', manga.libraryGroup ?? ''].join(':');
    return [snapshot.tab, snapshot.downloadsView, snapshot.toolsMode, snapshot.view, snapshot.returnView, selection, snapshot.libraryFocus ?? '', snapshot.librarySeries ?? '', snapshot.librarySeason ?? '', mangaKey].join('|');
}

function readMangaPage(): MangaPage {
    const { view, previousView, browse, sourceSettings, selection, selectionFrom, librarySeries, libraryGroup } = useMangaStore.getState();
    return { view, previousView, sourceId: browse.sourceId, mode: browse.mode, settingsOpen: sourceSettings.open, selection, selectionFrom, librarySeries, libraryGroup };
}

function readSnapshot(): NavigationSnapshot {
    const { view, returnView, selection, libraryFocus, librarySeries, librarySeason } = useAnimeStore.getState();
    const { tab, downloadsView, toolsMode } = useAppStore.getState();
    return { tab, downloadsView, toolsMode, view, returnView, selection, libraryFocus, librarySeries, librarySeason, manga: readMangaPage() };
}

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
    if (page.view === 'library') {
        void manga.refreshLibrary();
    }
}

function showSnapshot(snapshot: NavigationSnapshot): void {
    useAppStore.getState().setTab(snapshot.tab);
    useAppStore.getState().setDownloadsView(snapshot.downloadsView);
    useAppStore.getState().setToolsMode(snapshot.toolsMode);
    useAnimeStore.setState({
        view: snapshot.view,
        returnView: snapshot.returnView,
        selection: snapshot.selection,
        libraryFocus: snapshot.libraryFocus,
        librarySeries: snapshot.librarySeries,
        librarySeason: snapshot.librarySeason
    });
    if (snapshot.view === 'library') {
        void useAnimeStore.getState().refreshLibrary();
    }
    showMangaPage(snapshot.manga);
}

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
    const { preview, closePreview } = useCutStore.getState();
    if (preview !== null) {
        closePreview();
        return true;
    }
    const { playing: explorerPlaying, closePlayer: closeExplorerPlayer } = useExplorerStore.getState();
    if (explorerPlaying !== null) {
        closeExplorerPlayer();
        return true;
    }
    return false;
}

function isPlayerOpen(): boolean {
    const { playing, streaming } = useAnimeStore.getState();
    return (
        playing !== null ||
        streaming !== null ||
        useMangaStore.getState().reader.status !== 'closed' ||
        useCutStore.getState().preview !== null ||
        useExplorerStore.getState().playing !== null
    );
}

function scrollArea(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.app__main');
}

export function useMouseNavigation(): void {
    useEffect(() => {
        const history = new NavigationHistory<NavigationSnapshot>(MAX_NAVIGATION_ENTRIES, snapshotKey);
        let showing = false;
        const rememberScroll = (area: HTMLElement | null): void => {
            if (area !== null && !isScrollRestoring()) {
                history.rememberScroll(area.scrollTop);
            }
        };
        let batched = false;
        const record = (): void => {
            if (showing) {
                return;
            }
            if (isBatchingNavigation()) {
                if (!batched) {
                    batched = true;
                    rememberScroll(scrollArea());
                }
                return;
            }
            rememberScroll(scrollArea());
            history.record(readSnapshot());
        };
        const recordBatch = (): void => {
            if (batched) {
                batched = false;
                history.record(readSnapshot());
            }
        };
        const go = (move: () => NavigationSnapshot | null): void => {
            const area = scrollArea();
            rememberScroll(area);
            const snapshot = move();
            if (snapshot === null) {
                return;
            }
            showing = true;
            try {
                showSnapshot(snapshot);
            } finally {
                showing = false;
            }
            if (area !== null) {
                restoreScroll(area, history.currentScroll());
            }
        };
        const onMouseUp = (event: MouseEvent): void => {
            if (event.button === MOUSE_BACK_BUTTON) {
                event.preventDefault();
                if (!closePlayers()) {
                    go(() => {
                        return history.back();
                    });
                }
            } else if (event.button === MOUSE_FORWARD_BUTTON) {
                event.preventDefault();
                if (!isPlayerOpen()) {
                    go(() => {
                        return history.forward();
                    });
                }
            }
        };
        record();
        const unsubscribeApp = useAppStore.subscribe(record);
        const unsubscribeAnime = useAnimeStore.subscribe(record);
        const unsubscribeManga = useMangaStore.subscribe(record);
        const unsubscribeBatch = onNavigationBatchEnd(recordBatch);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            unsubscribeBatch();
            unsubscribeApp();
            unsubscribeAnime();
            unsubscribeManga();
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, []);
}
