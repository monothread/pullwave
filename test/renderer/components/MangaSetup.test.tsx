// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ToolErrorCode } from '@shared/tools';
import { MangaSetup } from '@renderer/components/MangaSetup';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { DEFAULT_SETTINGS } from '@shared/constants';
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

function setTool(tool: ReturnType<typeof makeTool> | null): void {
    useMangaStore.setState({ status: makeMangaStatus({ tool }) });
}

describe('MangaSetup', () => {
    it('shows nothing once the program is there, or when there is nothing to download', () => {
        setTool(makeTool({ status: 'ready' }));
        const { container, rerender } = render(<MangaSetup />);
        expect(container).toBeEmptyDOMElement();
        setTool(null);
        rerender(<MangaSetup />);
        expect(container).toBeEmptyDOMElement();
    });

    it('explains what is being downloaded and why', () => {
        setTool(makeTool({ status: 'downloading', percent: 42.4 }));
        render(<MangaSetup />);
        expect(screen.getByText('PREPARING THE MANGA SERVER')).toBeInTheDocument();
        expect(screen.getByText('Pullwave downloads, once, the program that runs the extensions (about 330 MB). It stays on this computer.')).toBeInTheDocument();
    });

    it('shows the progress of the download', () => {
        setTool(makeTool({ status: 'downloading', percent: 42.4 }));
        render(<MangaSetup />);
        const bar = screen.getByRole('progressbar', { name: 'PREPARING THE MANGA SERVER' });
        expect(bar).toHaveAttribute('aria-valuenow', '42');
        expect(bar).toHaveAttribute('aria-valuemin', '0');
        expect(bar).toHaveAttribute('aria-valuemax', '100');
        expect(bar.firstElementChild).toHaveStyle({ width: '42.4%' });
        expect(screen.getByText('Downloading… 42%')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it.each([
        ['missing', 'Waiting to download…'],
        ['verifying', 'Checking the file…'],
        ['extracting', 'Unpacking…']
    ] as const)('says what it is doing while it is %s', (status, text) => {
        setTool(makeTool({ status, percent: 90 }));
        render(<MangaSetup />);
        expect(screen.getByText(text)).toBeInTheDocument();
    });

    it.each([
        ['UNSUPPORTED_PLATFORM', 'There is no manga server for this system.'],
        ['DOWNLOAD_FAILED', 'The download failed. Check your connection and try again.'],
        ['HASH_MISMATCH', 'The downloaded file is not the one the app expects, so it was discarded.'],
        ['EXTRACT_FAILED', 'The file could not be unpacked.'],
        ['INCOMPLETE', 'The file is missing parts the server needs.'],
        ['DISK', 'There is no room or permission to save the file.']
    ] as Array<[ToolErrorCode, string]>)('explains the failure %s and keeps the details a hover away', (code, text) => {
        setTool(makeTool({ status: 'error', error: { code, message: 'raw detail' } }));
        render(<MangaSetup />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(text);
        expect(alert).toHaveAttribute('title', 'raw detail');
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    it('tries the download again from the button', async () => {
        const user = userEvent.setup();
        setTool(makeTool({ status: 'error', error: { code: 'DOWNLOAD_FAILED', message: 'offline' } }));
        mock.api.manga.status.mockResolvedValue(makeMangaStatus({ tool: makeTool({ status: 'downloading', percent: 1 }) }));
        render(<MangaSetup />);
        await user.click(screen.getByRole('button', { name: 'TRY AGAIN' }));
        expect(mock.api.manga.install).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => {
            expect(useMangaStore.getState().status.tool?.status).toBe('downloading');
        });
    });
});
