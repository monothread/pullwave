// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { MangaHelperSettings } from '@renderer/components/MangaHelperSettings';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeMangaStatus, makeTool } from '../../helpers/mangaFixtures';
import { answerDialog, confirmDialog } from '../../helpers/confirmDialog';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

function helper(overrides: Parameters<typeof makeTool>[0] = {}) {
    return makeTool({ id: 'flaresolverr', version: 'v3.5.2', ...overrides });
}

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
    useMangaStore.setState({ ...initialManga, status: makeMangaStatus() });
    mock.api.manga.status.mockResolvedValue(makeMangaStatus());
});

describe('MangaHelperSettings', () => {
    it('warns that Docker is needed, always', () => {
        render(<MangaHelperSettings enabled={false} external={false} onEnabledChange={vi.fn()} />);
        expect(screen.getByTestId('manga-helper-docker')).toHaveTextContent('Docker must be installed and running.');
    });

    it('offers to install when it is not installed, and says only the sites behind Cloudflare need it', () => {
        render(<MangaHelperSettings enabled={false} external={false} onEnabledChange={vi.fn()} />);
        expect(screen.getByText('Not installed. Only the sites protected by Cloudflare need it.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'INSTALL' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'REMOVE' })).not.toBeInTheDocument();
    });

    it('turns the setting on and installs, and refreshes the status', async () => {
        const user = userEvent.setup();
        const onEnabledChange = vi.fn();
        render(<MangaHelperSettings enabled={false} external={false} onEnabledChange={onEnabledChange} />);
        await user.click(screen.getByRole('button', { name: 'INSTALL' }));
        expect(onEnabledChange).toHaveBeenCalledTimes(1);
        expect(onEnabledChange).toHaveBeenCalledWith(true);
        expect(mock.api.manga.installHelper).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => {
            expect(mock.api.manga.status).toHaveBeenCalledTimes(1);
        });
    });

    it('says it is installed and ready, and offers to remove it', () => {
        useMangaStore.setState({ status: makeMangaStatus({ helper: helper() }) });
        render(<MangaHelperSettings enabled external={false} onEnabledChange={vi.fn()} />);
        expect(screen.getByText('Installed and ready.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'REMOVE' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'INSTALL' })).not.toBeInTheDocument();
    });

    it('turns the setting off and removes it', async () => {
        const user = userEvent.setup();
        const onEnabledChange = vi.fn();
        useMangaStore.setState({ status: makeMangaStatus({ helper: helper() }) });
        render(<MangaHelperSettings enabled external={false} onEnabledChange={onEnabledChange} />);
        await user.click(screen.getByRole('button', { name: 'REMOVE' }));
        expect(onEnabledChange).not.toHaveBeenCalled();
        expect(mock.api.manga.removeHelper).not.toHaveBeenCalled();
        expect(within(confirmDialog('Remove the helper for Cloudflare?')).getByText('The sites that Cloudflare protects will not work until it is installed again.')).toBeInTheDocument();
        await answerDialog(user, 'Remove the helper for Cloudflare?', 'REMOVE');
        expect(onEnabledChange).toHaveBeenCalledWith(false);
        expect(mock.api.manga.removeHelper).toHaveBeenCalledTimes(1);
    });

    it('keeps the helper when the user keeps it or presses Esc', async () => {
        const user = userEvent.setup();
        const onEnabledChange = vi.fn();
        useMangaStore.setState({ status: makeMangaStatus({ helper: helper() }) });
        render(<MangaHelperSettings enabled external={false} onEnabledChange={onEnabledChange} />);
        await user.click(screen.getByRole('button', { name: 'REMOVE' }));
        await answerDialog(user, 'Remove the helper for Cloudflare?', 'KEEP');
        await user.click(screen.getByRole('button', { name: 'REMOVE' }));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(onEnabledChange).not.toHaveBeenCalled();
        expect(mock.api.manga.removeHelper).not.toHaveBeenCalled();
    });

    it('shows the progress of the download and disables the buttons while it goes on', () => {
        useMangaStore.setState({ status: makeMangaStatus({ helper: helper({ status: 'downloading', percent: 40 }) }) });
        render(<MangaHelperSettings enabled external={false} onEnabledChange={vi.fn()} />);
        expect(screen.getByRole('progressbar', { name: 'FlareSolverr (sites protected by Cloudflare)' })).toHaveAttribute('aria-valuenow', '40');
        expect(screen.getByRole('button', { name: 'REMOVE' })).toBeDisabled();
    });

    it('shows why it could not be installed and lets the user try again', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ status: makeMangaStatus({ helper: helper({ status: 'error', error: { code: 'DOCKER_MISSING', message: 'no docker' } }) }) });
        render(<MangaHelperSettings enabled external={false} onEnabledChange={vi.fn()} />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveAttribute('title', 'no docker');
        expect(alert).toHaveTextContent('Docker is not installed or is not running.');
        await user.click(screen.getByRole('button', { name: 'INSTALL' }));
        expect(mock.api.manga.installHelper).toHaveBeenCalledTimes(1);
    });

    it('does not show an old error while the helper is not installed', () => {
        useMangaStore.setState({ status: makeMangaStatus({ helper: helper({ status: 'error', error: { code: 'DOCKER_MISSING', message: 'no docker' } }) }) });
        render(<MangaHelperSettings enabled={false} external={false} onEnabledChange={vi.fn()} />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('says the app installs and runs none when the user gave the address of their own', () => {
        render(<MangaHelperSettings enabled={false} external onEnabledChange={vi.fn()} />);
        expect(screen.getByText('You gave the address of your own FlareSolverr, so the app installs and runs none.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'INSTALL' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'REMOVE' })).not.toBeInTheDocument();
    });
});
