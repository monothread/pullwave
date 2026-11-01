import { runSuggestion } from '@renderer/home/searchActions';
import { onNavigationBatchEnd } from '@renderer/navigation/navigationBatch';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeLibraryManga } from '../../helpers/mangaFixtures';

const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();
const initialManga = useMangaStore.getState();

const setTab = vi.fn();
const anime = { showInLibrary: vi.fn(), setView: vi.fn(), setQuery: vi.fn(), runSearch: vi.fn(async () => {}) };
const manga = { setView: vi.fn(), openManga: vi.fn(async () => {}), setSearchQuery: vi.fn(), runSearch: vi.fn(async () => {}) };

beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ setTab });
    useAnimeStore.setState(anime);
    useMangaStore.setState(manga);
});

afterEach(() => {
    useAppStore.setState(initialApp, true);
    useAnimeStore.setState(initialAnime, true);
    useMangaStore.setState(initialManga, true);
});

describe('runSuggestion', () => {
    it('opens an anime of the library on its series', () => {
        runSuggestion({ kind: 'anime', key: 'anime-anime-4', title: 'Naruto', animeId: 4 });
        expect(setTab.mock.calls).toEqual([['anime']]);
        expect(anime.showInLibrary.mock.calls).toEqual([[4]]);
    });

    it('opens a manga of the library on its page', () => {
        const entry = makeLibraryManga([], { id: 9, remoteId: 70, sourceId: '55', title: 'Berserk', thumbnailUrl: 'https://img/b.jpg' });
        runSuggestion({ kind: 'manga', key: 'manga-9', title: 'Berserk', manga: entry });
        expect(setTab.mock.calls).toEqual([['manga']]);
        expect(manga.setView.mock.calls).toEqual([['library']]);
        expect(manga.openManga.mock.calls).toEqual([[{ remoteId: 70, sourceId: '55', title: 'Berserk', thumbnailUrl: 'https://img/b.jpg' }]]);
    });

    it('searches the text in the anime section', () => {
        runSuggestion({ kind: 'search-anime', key: 'search-anime', query: 'frieren' });
        expect(setTab.mock.calls).toEqual([['anime']]);
        expect(anime.setView.mock.calls).toEqual([['search']]);
        expect(anime.setQuery.mock.calls).toEqual([['frieren']]);
        expect(anime.runSearch).toHaveBeenCalledTimes(1);
    });

    it('searches the text in the manga section', () => {
        runSuggestion({ kind: 'search-manga', key: 'search-manga', query: 'berserk' });
        expect(setTab.mock.calls).toEqual([['manga']]);
        expect(manga.setView.mock.calls).toEqual([['search']]);
        expect(manga.setSearchQuery.mock.calls).toEqual([['berserk']]);
        expect(manga.runSearch).toHaveBeenCalledTimes(1);
    });
});

describe('the changes of page of the search', () => {
    it('are one page each for the buttons of the mouse: their steps end in one batch', () => {
        const ended = vi.fn();
        const stop = onNavigationBatchEnd(ended);
        runSuggestion({ kind: 'search-anime', key: 'search-anime', query: 'frieren' });
        expect(ended).toHaveBeenCalledTimes(1);
        stop();
    });
});
