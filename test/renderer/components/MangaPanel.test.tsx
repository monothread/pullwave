// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaPanel } from '@renderer/components/MangaPanel';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeChapterRecord, makeLibraryManga, makeMangaJob, makeMangaStatus, makeSource, makeTool } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
    useMangaStore.setState({ ...initialManga, status: makeMangaStatus(), view: 'browse', library: [], jobs: [] });
    mock.api.manga.sources.mockResolvedValue({ ok: true, value: [makeSource({ id: '5' })] });
    mock.api.manga.list.mockResolvedValue({ ok: true, value: { items: [], hasNextPage: false } });
});

describe('MangaPanel', () => {
    it('says the section does not exist on this system', () => {
        useMangaStore.setState({ status: makeMangaStatus({ supported: false, tool: null }) });
        render(<MangaPanel />);
        expect(screen.getByRole('alert')).toHaveTextContent('The manga section is only available on Linux and Windows (64 bits).');
        expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });

    it.each(['missing', 'downloading', 'verifying', 'extracting', 'error'] as const)('shows only the preparation while the program is %s', (status) => {
        useMangaStore.setState({ status: makeMangaStatus({ tool: makeTool({ status, error: status === 'error' ? { code: 'DOWNLOAD_FAILED', message: 'x' } : null }) }) });
        render(<MangaPanel />);
        expect(screen.getByText('PREPARING THE MANGA SERVER')).toBeInTheDocument();
        expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
        expect(mock.api.manga.sources).not.toHaveBeenCalled();
    });

    it('opens on the browse once the program is there', async () => {
        render(<MangaPanel />);
        const nav = screen.getByRole('navigation', { name: 'Manga' });
        expect(
            within(nav)
                .getAllByRole('button')
                .map((button) => {
                    return button.getAttribute('aria-label') ?? button.textContent;
                })
        ).toEqual(['BROWSE', 'LIBRARY', 'EXTENSIONS', 'SETTINGS']);
        expect(within(nav).getByRole('button', { name: 'BROWSE' })).toHaveAttribute('aria-current', 'page');
        expect(within(nav).getByRole('button', { name: 'SETTINGS' })).toHaveClass('tab--icon');
        expect(await screen.findByTestId('manga-source')).toBeInTheDocument();
    });

    it('works with a server that is given, which has nothing to download', async () => {
        useMangaStore.setState({ status: makeMangaStatus({ tool: null }) });
        render(<MangaPanel />);
        expect(await screen.findByTestId('manga-source')).toBeInTheDocument();
        expect(screen.queryByText('PREPARING THE MANGA SERVER')).not.toBeInTheDocument();
    });

    it('goes through the library, the extensions and the settings', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ library: [makeLibraryManga([makeChapterRecord()])] });
        render(<MangaPanel />);
        await user.click(screen.getByRole('button', { name: 'LIBRARY' }));
        expect(screen.getByTestId('manga-entry')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'EXTENSIONS' }));
        expect(await screen.findByText('WHAT ARE EXTENSIONS?')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'SETTINGS' }));
        expect(await screen.findByLabelText('Manga folder')).toBeInTheDocument();
        expect(screen.getByText('Extension stores')).toBeInTheDocument();
        expect(screen.getByText('FlareSolverr (sites protected by Cloudflare)')).toBeInTheDocument();
        expect(useMangaStore.getState().view).toBe('settings');
    });

    it('counts the downloads that are going on on its button', () => {
        useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 1, status: 'running' }), makeMangaJob({ chapterId: 2, status: 'queued' }), makeMangaJob({ chapterId: 3, status: 'paused' })] });
        render(<MangaPanel />);
        expect(screen.getByRole('button', { name: 'DOWNLOADS (2)' })).toHaveClass('btn--primary');
    });

    it('does not highlight the button of the downloads when nothing is going on', () => {
        render(<MangaPanel />);
        expect(screen.getByRole('button', { name: 'DOWNLOADS (0)' })).not.toHaveClass('btn--primary');
    });

    it('opens the downloads and goes back to where it was', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ view: 'library', jobs: [makeMangaJob()] });
        render(<MangaPanel />);
        await user.click(screen.getByRole('button', { name: 'DOWNLOADS (1)' }));
        expect(screen.getByTestId('manga-job')).toBeInTheDocument();
        expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: '← BACK' }));
        expect(useMangaStore.getState().view).toBe('library');
        expect(screen.getByRole('navigation', { name: 'Manga' })).toBeInTheDocument();
    });

    it('shows the reader instead of the section while a chapter is being read, and the section again when it is closed', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({
            reader: { status: 'ready', mangaTitle: 'One Piece', chapters: [{ remoteId: 1, libraryChapterId: null, name: 'Chapter 1', number: 1 }], index: 0, pages: ['http://127.0.0.1:4321/p/0'], local: false, error: null }
        });
        render(<MangaPanel />);
        expect(screen.getByRole('region', { name: 'Reader' })).toBeInTheDocument();
        expect(screen.queryByRole('navigation', { name: 'Manga' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: '← CLOSE' }));
        expect(screen.queryByRole('region', { name: 'Reader' })).not.toBeInTheDocument();
        expect(screen.getByRole('navigation', { name: 'Manga' })).toBeInTheDocument();
    });

    it('shows the note about the helper for Cloudflare while it is not ready, and the rest of the section works', async () => {
        useMangaStore.setState({ status: makeMangaStatus({ helper: makeTool({ id: 'flaresolverr', status: 'downloading', percent: 20 }) }) });
        render(<MangaPanel />);
        expect(screen.getByRole('region', { name: 'Helper for sites protected by Cloudflare' })).toBeInTheDocument();
        expect(screen.getByText('Pulling the FlareSolverr image with Docker… 20%')).toBeInTheDocument();
        expect(screen.getByRole('navigation', { name: 'Manga' })).toBeInTheDocument();
        expect(await screen.findByTestId('manga-source')).toBeInTheDocument();
    });

    it('does not show the note once the helper is ready, or where there is none', () => {
        useMangaStore.setState({ status: makeMangaStatus({ helper: makeTool({ id: 'flaresolverr', status: 'ready' }) }) });
        const { rerender } = render(<MangaPanel />);
        expect(screen.queryByRole('region', { name: 'Helper for sites protected by Cloudflare' })).not.toBeInTheDocument();
        useMangaStore.setState({ status: makeMangaStatus({ helper: null }) });
        rerender(<MangaPanel />);
        expect(screen.queryByRole('region', { name: 'Helper for sites protected by Cloudflare' })).not.toBeInTheDocument();
    });

    it('says a check of Cloudflare is going on, on the browse and on the downloads', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ cloudflare: [{ id: 1, host: 'manganato.com', startedAt: 1 }] });
        render(<MangaPanel />);
        expect(screen.getByTestId('manga-cloudflare')).toHaveTextContent('Passing the Cloudflare check of manganato.com');
        await user.click(screen.getByRole('button', { name: /^DOWNLOADS \(\d+\)$/ }));
        expect(screen.getByTestId('manga-cloudflare')).toBeInTheDocument();
    });

    it('does not say it when no check is going on', () => {
        render(<MangaPanel />);
        expect(screen.queryByTestId('manga-cloudflare')).not.toBeInTheDocument();
    });

    it('says the server is starting', () => {
        useMangaStore.setState({ status: makeMangaStatus({ server: 'starting' }) });
        render(<MangaPanel />);
        expect(screen.getByText('Starting the manga server…')).toBeInTheDocument();
    });

    it('says the server could not start, keeps the details a hover away and tries again from the button', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ status: makeMangaStatus({ server: 'error', serverError: 'port in use' }) });
        render(<MangaPanel />);
        const alert = await screen.findByText('The manga server could not start.');
        expect(alert).toHaveAttribute('title', 'port in use');
        mock.api.manga.status.mockClear();
        mock.api.manga.sources.mockClear();
        await user.click(screen.getByRole('button', { name: 'TRY AGAIN' }));
        expect(mock.api.manga.status).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.sources).toHaveBeenCalledTimes(1);
    });

    it('says nothing of the server while it is running or stopped', () => {
        const { rerender } = render(<MangaPanel />);
        expect(screen.queryByText('Starting the manga server…')).not.toBeInTheDocument();
        expect(screen.queryByText('The manga server could not start.')).not.toBeInTheDocument();
        useMangaStore.setState({ status: makeMangaStatus({ server: 'stopped' }) });
        rerender(<MangaPanel />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

describe('MangaPanel starting each page at the top', () => {
    let area: HTMLElement;

    beforeEach(() => {
        area = document.createElement('div');
        area.className = 'app__main';
        document.body.appendChild(area);
    });

    afterEach(() => {
        area.remove();
    });

    it('scrolls the page of the app to the top when the screen changes', async () => {
        const user = userEvent.setup();
        render(<MangaPanel />, { container: area.appendChild(document.createElement('div')) });
        area.scrollTop = 700;
        await user.click(screen.getByRole('button', { name: 'LIBRARY' }));
        expect(area.scrollTop).toBe(0);
        area.scrollTop = 700;
        await user.click(screen.getByRole('button', { name: 'EXTENSIONS' }));
        expect(area.scrollTop).toBe(0);
    });

    it('scrolls to the top when a manga is opened, when a series is opened and when the reader opens or closes', () => {
        render(<MangaPanel />, { container: area.appendChild(document.createElement('div')) });
        const changes: Array<() => void> = [
            () => {
                useMangaStore.setState({ selection: { manga: { remoteId: 7, sourceId: '5', title: 'One Piece', thumbnailUrl: null }, status: 'loading', details: null, chapters: [], selected: [], error: null } });
            },
            () => {
                useMangaStore.setState({ librarySeries: 'series-frieren' });
            },
            () => {
                useMangaStore.setState({ libraryGroup: 2 });
            },
            () => {
                useMangaStore.setState({ reader: { status: 'loading', mangaTitle: 'One Piece', chapters: [], index: 0, pages: [], local: false, error: null } });
            },
            () => {
                useMangaStore.setState({ reader: { status: 'closed', mangaTitle: '', chapters: [], index: 0, pages: [], local: false, error: null } });
            }
        ];
        changes.forEach((change) => {
            area.scrollTop = 700;
            act(() => {
                change();
            });
            expect(area.scrollTop).toBe(0);
        });
    });

    it('does not scroll the page when something else changes', () => {
        render(<MangaPanel />, { container: area.appendChild(document.createElement('div')) });
        area.scrollTop = 700;
        act(() => {
            useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 9, status: 'running' })] });
        });
        expect(area.scrollTop).toBe(700);
    });
});
