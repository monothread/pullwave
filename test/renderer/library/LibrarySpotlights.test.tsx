// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { AnimeLibrarySpotlight, MangaLibrarySpotlight } from '@renderer/library/LibrarySpotlights';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeAnime, makeEpisode } from '../../helpers/animeFixtures';
import { makeAnimeHistory, makeReading } from '../../helpers/homeFixtures';
import { makeChapterRecord, makeLibraryManga } from '../../helpers/mangaFixtures';
import { installMockApi } from '../../helpers/mockApi';

const initialAnime = useAnimeStore.getState();
const initialManga = useMangaStore.getState();
const loadHistory = vi.fn(async () => {});
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
    vi.clearAllMocks();
    installMockApi();
    useAnimeStore.setState({ library: [], history: [], covers: {}, loadCover: vi.fn(async () => {}) });
    useMangaStore.setState({ library: [], history: [], loadHistory });
});

afterEach(() => {
    useAnimeStore.setState(initialAnime, true);
    useMangaStore.setState(initialManga, true);
});

// The title of the highlight shown.
function titles(): Array<string | null> {
    return [screen.getByRole('heading', { level: 2 }).textContent];
}

describe('AnimeLibrarySpotlight', () => {
    it('draws nothing with nothing to go on with and nothing new', () => {
        useAnimeStore.setState({ library: [makeAnime([makeEpisode()], { title: 'Quiet' })] });
        const { container } = render(<AnimeLibrarySpotlight />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows the highlights of the library: what to go on with first, then the news', () => {
        useAnimeStore.setState({
            library: [makeAnime([makeEpisode({ id: 1, animeId: 1, number: '1' })], { id: 1, title: 'Watching' }), makeAnime([makeEpisode({ id: 2, animeId: 2, addedAt: Date.now() - DAY })], { id: 2, title: 'Fresh' })],
            history: [makeAnimeHistory({ title: 'Watching', episode: '1' })]
        });
        render(<AnimeLibrarySpotlight />);
        expect(screen.getByRole('region', { name: 'Highlights of the library' })).toHaveAttribute('aria-roledescription', 'carousel');
        expect(titles()).toEqual(['Watching']);
        expect(screen.getByRole('button', { name: 'Highlight 2 of 2' })).toBeInTheDocument();
    });
});

describe('MangaLibrarySpotlight', () => {
    it('reads the history of reading when it was not read yet', () => {
        render(<MangaLibrarySpotlight />);
        expect(loadHistory).toHaveBeenCalledTimes(1);
    });

    it('does not read it again when it was read', () => {
        useMangaStore.setState({ history: [makeReading({ libraryMangaId: null })] });
        render(<MangaLibrarySpotlight />);
        expect(loadHistory).not.toHaveBeenCalled();
    });

    it('shows the manga being read, then the ones with news', () => {
        useMangaStore.setState({
            library: [makeLibraryManga([makeChapterRecord({ id: 1 })], { id: 1, title: 'Reading' }), makeLibraryManga([makeChapterRecord({ id: 2, mangaId: 2, addedAt: Date.now() - DAY })], { id: 2, title: 'Fresh' })],
            history: [makeReading({ id: 5, title: 'Reading', libraryMangaId: 1 })]
        });
        render(<MangaLibrarySpotlight />);
        expect(screen.getByRole('region', { name: 'Highlights of the library' })).toBeInTheDocument();
        expect(titles()).toEqual(['Reading']);
        expect(screen.getByRole('button', { name: 'Highlight 2 of 2' })).toBeInTheDocument();
    });

    it('draws nothing for an empty library', () => {
        useMangaStore.setState({ history: [makeReading({ libraryMangaId: null })] });
        const { container } = render(<MangaLibrarySpotlight />);
        expect(container).toBeEmptyDOMElement();
    });
});
