import type { LibraryManga } from '@shared/manga';
import { batchNavigation } from '../navigation/navigationBatch';
import { useAnimeStore } from '../store/animeStore';
import { useAppStore } from '../store/appStore';
import { useMangaStore } from '../store/mangaStore';
import type { SearchSuggestion } from './searchData';

function openLibraryManga(manga: LibraryManga): void {
    useAppStore.getState().setTab('manga');
    const store = useMangaStore.getState();
    store.setView('library');
    void store.openManga({ remoteId: manga.remoteId, sourceId: manga.sourceId, title: manga.title, thumbnailUrl: manga.thumbnailUrl });
}

function searchAnime(query: string): void {
    useAppStore.getState().setTab('anime');
    const store = useAnimeStore.getState();
    store.setView('search');
    store.setQuery(query);
    void store.runSearch();
}

function searchManga(query: string): void {
    useAppStore.getState().setTab('manga');
    const store = useMangaStore.getState();
    store.setView('search');
    store.setSearchQuery(query);
    void store.runSearch();
}

// Goes where a suggestion of the search of the top bar leads, as one page for the buttons of the mouse.
export function runSuggestion(suggestion: SearchSuggestion): void {
    batchNavigation(() => {
        goTo(suggestion);
    });
}

function goTo(suggestion: SearchSuggestion): void {
    switch (suggestion.kind) {
        case 'anime': {
            useAppStore.getState().setTab('anime');
            useAnimeStore.getState().showInLibrary(suggestion.animeId);
            return;
        }
        case 'manga': {
            openLibraryManga(suggestion.manga);
            return;
        }
        case 'search-anime': {
            searchAnime(suggestion.query);
            return;
        }
        case 'search-manga': {
            searchManga(suggestion.query);
            return;
        }
    }
}
