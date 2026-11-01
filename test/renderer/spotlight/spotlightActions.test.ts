import { runPrimary, showAnimeDetails } from '@renderer/spotlight/spotlightActions';
import { onNavigationBatchEnd } from '@renderer/navigation/navigationBatch';
import type { SpotlightItem } from '@renderer/spotlight/spotlightData';
import { groupLibrary } from '@renderer/components/mangaText';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeReading } from '../../helpers/homeFixtures';
import { makeLibraryManga } from '../../helpers/mangaFixtures';

const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();
const initialManga = useMangaStore.getState();
const app = { setTab: vi.fn() };
const anime = { play: vi.fn(), setView: vi.fn(), openSeries: vi.fn(), showInLibrary: vi.fn() };
const manga = { openFromHistory: vi.fn(async () => {}), setView: vi.fn(), openManga: vi.fn(async () => {}), openSeries: vi.fn() };

beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState(app);
    useAnimeStore.setState(anime);
    useMangaStore.setState(manga);
});

afterEach(() => {
    useAppStore.setState(initialApp, true);
    useAnimeStore.setState(initialAnime, true);
    useMangaStore.setState(initialManga, true);
});

describe('runPrimary', () => {
    it('plays the episode to go on with', () => {
        runPrimary({ key: 'k', kind: 'anime', reason: 'continue', title: 'T', coverTitle: 'T', animeId: 3, episodeId: 30, episode: '2', progress: 0.5 });
        expect(app.setTab.mock.calls).toEqual([['anime']]);
        expect(anime.play.mock.calls).toEqual([[3, 30]]);
        expect(anime.openSeries).not.toHaveBeenCalled();
    });

    it('opens the series of an anime with news in the library', () => {
        runPrimary({ key: 'k', kind: 'anime', reason: 'news', title: 'Saga', coverTitle: 'Saga', groupKey: 'series-saga', count: 2 });
        expect(app.setTab.mock.calls).toEqual([['anime']]);
        expect(anime.setView.mock.calls).toEqual([['library']]);
        expect(anime.openSeries.mock.calls).toEqual([['series-saga']]);
        expect(anime.play).not.toHaveBeenCalled();
    });

    it('opens the manga being read', () => {
        const entry = makeReading();
        runPrimary({ key: 'k', kind: 'manga', reason: 'continue', title: 'One Piece', coverUrl: null, entry, progress: 0.2 });
        expect(app.setTab.mock.calls).toEqual([['manga']]);
        expect(manga.openFromHistory.mock.calls).toEqual([[entry]]);
    });

    it('opens the page of a manga on its own with news', () => {
        const single = makeLibraryManga([], { id: 4, remoteId: 40, sourceId: '9', title: 'Solo', thumbnailUrl: 'https://img/s.jpg' });
        const [group] = groupLibrary([single]);
        runPrimary({ key: 'k', kind: 'manga', reason: 'news', title: 'Solo', coverUrl: null, group: group!, count: 1 });
        expect(app.setTab.mock.calls).toEqual([['manga']]);
        expect(manga.setView.mock.calls).toEqual([['library']]);
        expect(manga.openManga.mock.calls).toEqual([[{ remoteId: 40, sourceId: '9', title: 'Solo', thumbnailUrl: 'https://img/s.jpg' }]]);
        expect(manga.openSeries).not.toHaveBeenCalled();
    });

    it('opens the screen of a series of mangas with news', () => {
        const [group] = groupLibrary([makeLibraryManga([], { id: 5, title: 'Epic', series: 'Epic', season: 1 }), makeLibraryManga([], { id: 6, title: 'Epic 2', series: 'Epic', season: 2 })]);
        const item: SpotlightItem = { key: 'k', kind: 'manga', reason: 'news', title: 'Epic', coverUrl: null, group: group!, count: 3 };
        runPrimary(item);
        expect(manga.openSeries.mock.calls).toEqual([['series-epic']]);
        expect(manga.openManga).not.toHaveBeenCalled();
    });
});

describe('showAnimeDetails', () => {
    it('opens the series of the anime in the library', () => {
        showAnimeDetails(7);
        expect(app.setTab.mock.calls).toEqual([['anime']]);
        expect(anime.showInLibrary.mock.calls).toEqual([[7]]);
    });
});

describe('the changes of page of the highlights', () => {
    it('are one page each for the buttons of the mouse: their steps end in one batch', () => {
        const ended = vi.fn();
        const stop = onNavigationBatchEnd(ended);
        runPrimary({ key: 'k', kind: 'anime', reason: 'news', title: 'Saga', coverTitle: 'Saga', groupKey: 'series-saga', count: 2 });
        expect(ended).toHaveBeenCalledTimes(1);
        showAnimeDetails(7);
        expect(ended).toHaveBeenCalledTimes(2);
        stop();
    });
});
