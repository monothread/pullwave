// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { DownloadsIndicator, countByKind } from '@renderer/components/DownloadsIndicator';
import { useAnimeStore } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeAnimeJob, makeStatus } from '../../helpers/animeFixtures';
import { makeMangaJob, makeMangaStatus, makeSource } from '../../helpers/mangaFixtures';
import { installMockApi, makeJob } from '../../helpers/mockApi';

const openActiveDownload = vi.fn();
vi.mock('@renderer/home/homeActions', () => {
    return {
        openActiveDownload: (kind: string) => {
            openActiveDownload(kind);
        }
    };
});

const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();
const initialManga = useMangaStore.getState();

beforeEach(() => {
    installMockApi();
    openActiveDownload.mockClear();
    useAppStore.setState({ jobs: [makeJob({ id: 'a', status: 'running' }), makeJob({ id: 'b', status: 'done' })] });
    useAnimeStore.setState({ jobs: [makeAnimeJob({ episodeId: 1, status: 'queued' }), makeAnimeJob({ episodeId: 2, status: 'paused' })], status: makeStatus() });
    useMangaStore.setState({ jobs: [makeMangaJob({ status: 'error' })], status: makeMangaStatus() });
});

afterEach(() => {
    useAppStore.setState(initialApp, true);
    useAnimeStore.setState(initialAnime, true);
    useMangaStore.setState(initialManga, true);
});

describe('countByKind', () => {
    it('counts the downloads of each section', () => {
        expect(countByKind(['video', 'anime', 'anime'])).toEqual({ video: 1, anime: 2, manga: 0 });
        expect(countByKind([])).toEqual({ video: 0, anime: 0, manga: 0 });
    });
});

describe('DownloadsIndicator', () => {
    it('does not count the downloads of the adult sources while they are not listed, and counts them when they are', () => {
        useMangaStore.setState({
            jobs: [makeMangaJob({ chapterId: 1, sourceId: 'safe', status: 'running' }), makeMangaJob({ chapterId: 2, sourceId: 'adult', status: 'running' })],
            browse: { ...initialManga.browse, sources: [makeSource({ id: 'safe', contentWarning: 'SAFE' }), makeSource({ id: 'adult', contentWarning: 'NSFW' })], sourcesStatus: 'ready' }
        });
        const { unmount } = render(<DownloadsIndicator />);
        expect(screen.getByRole('button', { name: 'Downloads going on: 4' })).toBeInTheDocument();
        unmount();
        useAppStore.setState({ settings: { ...useAppStore.getState().settings, mangaShowAdult: true } });
        render(<DownloadsIndicator />);
        expect(screen.getByRole('button', { name: 'Downloads going on: 5' })).toBeInTheDocument();
    });

    it('says how many downloads go on in the whole app and lights up', () => {
        render(<DownloadsIndicator />);
        const button = screen.getByRole('button', { name: 'Downloads going on: 3' });
        expect(button).toHaveClass('topbar__button', 'downloads-indicator__button', 'downloads-indicator__button--busy');
        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(button).toHaveAttribute('aria-haspopup', 'true');
        expect(button.querySelector('.downloads-indicator__count')).toHaveTextContent('3');
    });

    it('has no count and no light when nothing downloads, and says so when opened', () => {
        useAppStore.setState({ jobs: [] });
        useAnimeStore.setState({ jobs: [] });
        render(<DownloadsIndicator />);
        const button = screen.getByRole('button', { name: 'Downloads going on: 0' });
        expect(button).not.toHaveClass('downloads-indicator__button--busy');
        expect(button.querySelector('.downloads-indicator__count')).toBeNull();
        fireEvent.click(button);
        expect(screen.getByText('Nothing is downloading.')).toBeInTheDocument();
    });

    it('opens a line for each section, which leads to its downloads and closes the list', () => {
        render(<DownloadsIndicator />);
        fireEvent.click(screen.getByRole('button', { name: 'Downloads going on: 3' }));
        expect(screen.getByRole('button', { name: 'Downloads going on: 3' })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.queryByText('Nothing is downloading.')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'VIDEOS: 1 going on' })).toHaveTextContent('VIDEOS1');
        expect(screen.getByRole('button', { name: 'ANIME: 2 going on' })).toHaveTextContent('ANIME2');
        fireEvent.click(screen.getByRole('button', { name: 'MANGA: 0 going on' }));
        expect(openActiveDownload.mock.calls).toEqual([['manga']]);
        expect(screen.queryByRole('button', { name: 'VIDEOS: 1 going on' })).not.toBeInTheDocument();
    });

    it('leaves out the sections that do not exist here', () => {
        useAnimeStore.setState({ status: makeStatus({ supported: false }), jobs: [] });
        useMangaStore.setState({ status: makeMangaStatus({ supported: false }) });
        render(<DownloadsIndicator />);
        fireEvent.click(screen.getByRole('button', { name: 'Downloads going on: 1' }));
        expect(screen.getByRole('button', { name: 'VIDEOS: 1 going on' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^ANIME/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^MANGA/ })).not.toBeInTheDocument();
    });

    it('closes with Esc, with a press outside and with its own button', () => {
        render(
            <>
                <DownloadsIndicator />
                <p data-testid="outside">outside</p>
            </>
        );
        const button = screen.getByRole('button', { name: 'Downloads going on: 3' });
        fireEvent.click(button);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(button).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(button);
        fireEvent.pointerDown(screen.getByRole('button', { name: 'VIDEOS: 1 going on' }));
        expect(button).toHaveAttribute('aria-expanded', 'true');
        fireEvent.pointerDown(screen.getByTestId('outside'));
        expect(button).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(button);
        fireEvent.click(button);
        expect(button).toHaveAttribute('aria-expanded', 'false');
    });
});
