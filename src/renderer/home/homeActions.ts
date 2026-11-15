import { batchNavigation } from '../navigation/navigationBatch';
import { useAnimeStore, type AnimeBrowseView } from '../store/animeStore';
import { useAppStore } from '../store/appStore';
import { useMangaStore, type MangaBrowseView } from '../store/mangaStore';
import type { ActiveDownloadKind } from './homeData';

const FIRST_LINK_SELECTOR = '.link-row__input';

function showDownloader(view: 'queue' | 'cut'): void {
    batchNavigation(() => {
        const app = useAppStore.getState();
        app.setTab('downloads');
        app.setDownloadsView(view);
    });
}

export function showQueue(): void {
    showDownloader('queue');
}

export function showCut(): void {
    showDownloader('cut');
}

export function pasteLink(): void {
    showQueue();
    window.setTimeout(() => {
        document.querySelector<HTMLInputElement>(FIRST_LINK_SELECTOR)?.focus();
    }, 0);
}

export function openAnime(view: Extract<AnimeBrowseView, 'library' | 'updates' | 'search'>): void {
    batchNavigation(() => {
        useAppStore.getState().setTab('anime');
        useAnimeStore.getState().setView(view);
    });
}

export function openManga(view: Extract<MangaBrowseView, 'library' | 'updates' | 'extensions' | 'browse'>): void {
    batchNavigation(() => {
        useAppStore.getState().setTab('manga');
        useMangaStore.getState().setView(view);
    });
}

export function openSubtitleJobs(): void {
    batchNavigation(() => {
        useAppStore.getState().setTab('anime');
        useAnimeStore.getState().openSubtitleJobs();
    });
}

export function openActiveDownload(kind: ActiveDownloadKind): void {
    if (kind === 'video') {
        showQueue();
        return;
    }
    batchNavigation(() => {
        useAppStore.getState().setTab(kind);
        if (kind === 'anime') {
            useAnimeStore.getState().openDownloads();
        } else {
            useMangaStore.getState().openDownloads();
        }
    });
}
