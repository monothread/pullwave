import type { MangaLibraryGroup } from '../components/mangaText';
import { batchNavigation } from '../navigation/navigationBatch';
import { useAnimeStore } from '../store/animeStore';
import { useAppStore } from '../store/appStore';
import { useMangaStore } from '../store/mangaStore';
import type { SpotlightItem } from './spotlightData';

function openMangaGroup(group: MangaLibraryGroup): void {
    const store = useMangaStore.getState();
    store.setView('library');
    const single = group.entries[0];
    if (group.key.startsWith('manga-') && single !== undefined) {
        void store.openManga({ remoteId: single.remoteId, sourceId: single.sourceId, title: single.title, thumbnailUrl: single.thumbnailUrl });
        return;
    }
    store.openSeries(group.key);
}

export function runPrimary(item: SpotlightItem): void {
    batchNavigation(() => {
        openItem(item);
    });
}

function openItem(item: SpotlightItem): void {
    useAppStore.getState().setTab(item.kind);
    if (item.kind === 'anime') {
        const store = useAnimeStore.getState();
        if (item.reason === 'continue') {
            store.play(item.animeId, item.episodeId);
            return;
        }
        store.setView('library');
        store.openSeries(item.groupKey);
        return;
    }
    if (item.reason === 'continue') {
        void useMangaStore.getState().openFromHistory(item.entry);
        return;
    }
    openMangaGroup(item.group);
}

export function showAnimeDetails(animeId: number): void {
    batchNavigation(() => {
        useAppStore.getState().setTab('anime');
        useAnimeStore.getState().showInLibrary(animeId);
    });
}
