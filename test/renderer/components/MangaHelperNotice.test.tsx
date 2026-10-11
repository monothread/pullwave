// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { MangaStatusInfo } from '@shared/manga';
import type { ToolErrorCode } from '@shared/tools';
import { MangaHelperNotice } from '@renderer/components/MangaHelperNotice';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeMangaStatus, makeTool } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useMangaStore.setState({ ...initialManga });
});

function setHelper(helper: ReturnType<typeof makeTool> | null, extra: Partial<MangaStatusInfo> = {}): void {
    useMangaStore.setState({ status: makeMangaStatus({ helper, ...extra }) });
}

describe('MangaHelperNotice', () => {
    it('shows nothing where there is no helper, or once it is there', () => {
        setHelper(null);
        const { container, rerender } = render(<MangaHelperNotice />);
        expect(container).toBeEmptyDOMElement();
        setHelper(makeTool({ id: 'flaresolverr', status: 'ready' }));
        rerender(<MangaHelperNotice />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows the progress of the download of the helper', () => {
        setHelper(makeTool({ id: 'flaresolverr', status: 'downloading', percent: 42.4 }));
        render(<MangaHelperNotice />);
        expect(screen.getByText('Helper for sites protected by Cloudflare', { selector: '.section-label' })).toBeInTheDocument();
        const bar = screen.getByRole('progressbar', { name: 'Helper for sites protected by Cloudflare' });
        expect(bar).toHaveAttribute('aria-valuenow', '42');
        expect(bar.firstElementChild).toHaveStyle({ width: '42.4%' });
        expect(screen.getByText('Pulling the FlareSolverr image with Docker… 42%')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it.each([
        ['missing', 'Waiting to download…'],
        ['verifying', 'Checking the file…'],
        ['extracting', 'Unpacking…']
    ] as const)('says what it is doing while it is %s', (status, text) => {
        setHelper(makeTool({ id: 'flaresolverr', status, percent: 90 }));
        render(<MangaHelperNotice />);
        expect(screen.getByText(text)).toBeInTheDocument();
    });

    it.each([
        ['DOWNLOAD_FAILED', 'The download failed. Check your connection and try again.'],
        ['HASH_MISMATCH', 'The downloaded file is not the one the app expects, so it was discarded.'],
        ['DISK', 'There is no room or permission to save the file.'],
        ['DOCKER_MISSING', 'Docker is not installed or is not running. Install it (or start it) and try again.']
    ] as Array<[ToolErrorCode, string]>)('explains the failure %s, and says what it costs', (code, hint) => {
        setHelper(makeTool({ id: 'flaresolverr', status: 'error', error: { code, message: 'raw detail' } }));
        render(<MangaHelperNotice />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('It is not ready: the sites that Cloudflare protects will not work until it is.');
        expect(alert).toHaveAttribute('title', 'raw detail');
        expect(screen.getByText(hint)).toBeInTheDocument();
        expect(screen.getByText('Or give the address of a FlareSolverr you already run, in SETTINGS → MANGA.')).toBeInTheDocument();
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    it('shows nothing when the user gave the address of a FlareSolverr of their own', () => {
        setHelper(makeTool({ id: 'flaresolverr', status: 'error', error: { code: 'DOCKER_MISSING', message: 'no docker' } }), { helperExternal: true });
        const { container } = render(<MangaHelperNotice />);
        expect(container).toBeEmptyDOMElement();
    });

    it('says the container did not start, with the detail, when the image is there and it still failed', () => {
        setHelper(makeTool({ id: 'flaresolverr', status: 'ready' }), { helperProblem: { code: 'start-failed', message: 'port is already allocated' } });
        render(<MangaHelperNotice />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('FlareSolverr did not start in Docker, so the sites that Cloudflare protects will not work.');
        expect(alert).toHaveAttribute('title', 'port is already allocated');
        expect(screen.getByText('Or give the address of a FlareSolverr you already run, in SETTINGS → MANGA.')).toBeInTheDocument();
    });

    it('shows nothing when the image is there and no problem was found', () => {
        setHelper(makeTool({ id: 'flaresolverr', status: 'ready' }), { helperProblem: null });
        const { container } = render(<MangaHelperNotice />);
        expect(container).toBeEmptyDOMElement();
    });

    it('tries the download again from the button', async () => {
        const user = userEvent.setup();
        setHelper(makeTool({ id: 'flaresolverr', status: 'error', error: { code: 'DOWNLOAD_FAILED', message: 'offline' } }));
        mock.api.manga.status.mockResolvedValue(makeMangaStatus({ helper: makeTool({ id: 'flaresolverr', status: 'downloading', percent: 1 }) }));
        render(<MangaHelperNotice />);
        await user.click(screen.getByRole('button', { name: 'TRY AGAIN' }));
        expect(mock.api.manga.install).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => {
            expect(useMangaStore.getState().status.helper?.status).toBe('downloading');
        });
    });
});
