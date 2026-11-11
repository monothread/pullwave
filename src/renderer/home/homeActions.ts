import { batchNavigation } from '../navigation/navigationBatch';
import { useAnimeStore, type AnimeBrowseView } from '../store/animeStore';
import { useAppStore } from '../store/appStore';
import { useMangaStore, type MangaBrowseView } from '../store/mangaStore';
import type { ActiveDownloadKind } from './homeData';

// Where the buttons of the home screen and of the downloads of the top bar lead: the screens of the sections, through what their stores
// already do.

// The field of the first link of the video downloader, once its screen is drawn.
const FIRST_LINK_SELECTOR = '.link-row__input';

// A screen of the video downloader, as one page for the back and forward buttons of the mouse.
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

// The cutter of the video downloader.
export function showCut(): void {
    showDownloader('cut');
}

// The queue of the video downloader with the focus in the field of the first link, to paste one.
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

// The screen of the subtitles being translated or made, in the anime section.
export function openSubtitleJobs(): void {
    batchNavigation(() => {
        useAppStore.getState().setTab('anime');
        useAnimeStore.getState().openSubtitleJobs();
    });
}

// The downloads of a section.
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
