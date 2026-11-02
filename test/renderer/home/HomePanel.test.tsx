// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { HomePanel } from '@renderer/home/HomePanel';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeAnime, makeEpisode, makeStatus } from '../../helpers/animeFixtures';
import { makeAnimeHistory, makeReading } from '../../helpers/homeFixtures';
import { makeChapterRecord, makeLibraryManga, makeMangaStatus, makeSource } from '../../helpers/mangaFixtures';
import { installMockApi } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();
const initialManga = useMangaStore.getState();
const loadHistory = vi.fn(async () => {});
// As the real one does, it marks the sources as asked for at once.
const loadSources = vi.fn(async () => {
    useMangaStore.setState({ browse: { ...useMangaStore.getState().browse, sourcesStatus: 'loading' } });
});

beforeEach(() => {
    vi.clearAllMocks();
    installMockApi();
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS }, jobs: [] });
    useAnimeStore.setState({ status: makeStatus(), library: [], history: [], jobs: [], covers: {}, loadCover: vi.fn(async () => {}) });
    useMangaStore.setState({ status: makeMangaStatus(), library: [], history: [], jobs: [], loadHistory, loadSources, browse: { ...initialManga.browse, sourcesStatus: 'idle' } });
});

afterEach(() => {
    useAppStore.setState(initialApp, true);
    useAnimeStore.setState(initialAnime, true);
    useMangaStore.setState(initialManga, true);
});

function fill(): void {
    useAnimeStore.setState({ library: [makeAnime([makeEpisode({ id: 1, animeId: 1, number: '1' })], { id: 1, title: 'Watching' })], history: [makeAnimeHistory({ title: 'Watching', episode: '1' })] });
    useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord({ id: 1 })], { id: 1, title: 'Reading' })], history: [makeReading({ id: 5, title: 'Reading', libraryMangaId: 1 })] });
}

describe('HomePanel', () => {
    it('is the home region: a welcome when there is nothing to highlight, then the blocks of the sections', () => {
        render(<HomePanel />);
        const home = screen.getByRole('region', { name: 'Home' });
        expect(home).toHaveClass('home');
        expect(within(home).getByRole('region', { name: 'WELCOME TO PULLWAVE' })).toBeInTheDocument();
        expect(within(within(home).getByRole('region', { name: 'WELCOME TO PULLWAVE' })).queryByRole('button')).not.toBeInTheDocument();
        expect(within(home).queryByRole('region', { name: 'Highlights' })).not.toBeInTheDocument();
        expect(within(home).getByRole('list', { name: 'Sections' })).toBeInTheDocument();
    });


    it('shows the highlights of both sections, the anime first, and no welcome', () => {
        fill();
        render(<HomePanel />);
        const highlights = screen.getByRole('region', { name: 'Highlights' });
        expect(highlights).toHaveAttribute('aria-roledescription', 'carousel');
        expect(within(highlights).getByRole('heading', { level: 2 })).toHaveTextContent('Watching');
        expect(within(highlights).getByRole('button', { name: 'Highlight 2 of 2' })).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'WELCOME TO PULLWAVE' })).not.toBeInTheDocument();
    });

    it('leaves the manga of the adult sources out of the highlights while they are not listed, and shows them when they are', () => {
        fill();
        useMangaStore.setState({
            library: [{ ...useMangaStore.getState().library[0]!, sourceId: 'adult' }],
            history: [{ ...useMangaStore.getState().history[0]!, sourceId: 'adult' }],
            browse: { ...initialManga.browse, sources: [makeSource({ id: 'safe', contentWarning: 'SAFE' }), makeSource({ id: 'adult', contentWarning: 'NSFW' })], sourcesStatus: 'ready' }
        });
        const { unmount } = render(<HomePanel />);
        const highlights = screen.getByRole('region', { name: 'Highlights' });
        expect(within(highlights).getByRole('heading', { level: 2 })).toHaveTextContent('Watching');
        expect(within(highlights).queryByRole('button', { name: 'Highlight 2 of 2' })).not.toBeInTheDocument();
        unmount();
        useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, mangaShowAdult: true } });
        render(<HomePanel />);
        expect(within(screen.getByRole('region', { name: 'Highlights' })).getByRole('button', { name: 'Highlight 2 of 2' })).toBeInTheDocument();
    });

    it('puts the manga after the anime in the highlights', () => {
        fill();
        render(<HomePanel />);
        const highlights = screen.getByRole('region', { name: 'Highlights' });
        fireEvent.click(within(highlights).getByRole('button', { name: 'Highlight 2 of 2' }));
        expect(within(highlights).getByRole('heading', { level: 2 })).toHaveTextContent('Reading');
    });

    it('leaves out of the highlights a manga whose last chapter read was read to the end, when it has no chapter after it', () => {
        fill();
        useMangaStore.setState({ history: [makeReading({ id: 5, title: 'Reading', libraryMangaId: 1, chapterRemoteId: makeChapterRecord({ id: 1 }).remoteId, page: 9, pageCount: 10 })] });
        render(<HomePanel />);
        const highlights = screen.getByRole('region', { name: 'Highlights' });
        expect(within(highlights).getByRole('heading', { level: 2 })).toHaveTextContent('Watching');
        expect(within(highlights).queryByRole('button', { name: /^Highlight/ })).not.toBeInTheDocument();
    });

    it('leaves out the highlights of a section that does not exist here', () => {
        fill();
        useAnimeStore.setState({ status: makeStatus({ supported: false }) });
        render(<HomePanel />);
        const highlights = screen.getByRole('region', { name: 'Highlights' });
        expect(within(highlights).getByRole('heading', { level: 2 })).toHaveTextContent('Reading');
        expect(within(highlights).queryByRole('button', { name: /^Highlight/ })).not.toBeInTheDocument();
    });

    it('leaves out the highlights of the manga when the section does not exist here', () => {
        fill();
        useMangaStore.setState({ status: makeMangaStatus({ supported: false }) });
        render(<HomePanel />);
        expect(within(screen.getByRole('region', { name: 'Highlights' })).getByRole('heading', { level: 2 })).toHaveTextContent('Watching');
    });

    it('reads the history of reading and the sources once the manga server runs, and not before', () => {
        useMangaStore.setState({ status: makeMangaStatus({ server: 'starting' }) });
        const { unmount } = render(<HomePanel />);
        expect(loadHistory).not.toHaveBeenCalled();
        expect(loadSources).not.toHaveBeenCalled();
        unmount();
        useMangaStore.setState({ status: makeMangaStatus() });
        render(<HomePanel />);
        expect(loadHistory).toHaveBeenCalledTimes(1);
        expect(loadSources).toHaveBeenCalledTimes(1);
    });

    it.each(['loading', 'ready', 'error'] as const)('does not read the sources again when they were asked for already (%s)', (sourcesStatus) => {
        useMangaStore.setState({ browse: { ...initialManga.browse, sourcesStatus } });
        render(<HomePanel />);
        expect(loadHistory).toHaveBeenCalledTimes(1);
        expect(loadSources).not.toHaveBeenCalled();
    });

    it('reads nothing of the manga where the section does not exist', () => {
        useMangaStore.setState({ status: makeMangaStatus({ supported: false }) });
        render(<HomePanel />);
        expect(loadHistory).not.toHaveBeenCalled();
        expect(loadSources).not.toHaveBeenCalled();
    });
});

