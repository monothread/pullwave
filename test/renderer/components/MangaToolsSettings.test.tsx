// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MangaToolUpdateResult, MangaToolVersions } from '@shared/manga';
import { MangaToolsSettings } from '@renderer/components/MangaToolsSettings';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeMangaStatus, makeTool } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialManga = useMangaStore.getState();

function versions(overrides: { suwayomi?: Partial<MangaToolVersions['suwayomi']>; flaresolverr?: MangaToolVersions['flaresolverr'] } = {}): MangaToolVersions {
    return {
        suwayomi: { current: 'v1.0.0', latest: 'v2.0.0', error: null, updatable: true, chosen: false, bundled: 'v1.0.0', restartNeeded: false, ...overrides.suwayomi },
        flaresolverr: overrides.flaresolverr === undefined ? { current: 'v3.5.2', latest: 'v3.6.0', error: null, updatable: true } : overrides.flaresolverr
    };
}

function show(toolVersions: MangaToolVersions | null, extra: Partial<typeof initialManga> = {}): void {
    useMangaStore.setState({ ...initialManga, status: makeMangaStatus(), toolVersions, ...extra });
}

const server = () => {
    return screen.getByTestId('manga-update-server');
};
const helper = () => {
    return screen.getByTestId('manga-update-helper');
};

beforeEach(() => {
    mock = installMockApi();
    useMangaStore.setState({ ...initialManga });
});

describe('MangaToolsSettings', () => {
    it('asks to check for updates to see the versions when none was looked for', () => {
        show(null);
        render(<MangaToolsSettings />);
        expect(screen.getByRole('group', { name: 'Updates of the programs' })).toBeInTheDocument();
        expect(within(server()).getByText('Check for updates to see the versions.')).toBeInTheDocument();
        expect(within(helper()).getByText('Check for updates to see the versions.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^UPDATE TO/ })).not.toBeInTheDocument();
    });

    it('looks for updates and says it is looking meanwhile', async () => {
        const user = userEvent.setup();
        show(null);
        render(<MangaToolsSettings />);
        await user.click(screen.getByRole('button', { name: 'CHECK FOR UPDATES' }));
        expect(mock.api.manga.checkToolUpdates).toHaveBeenCalledTimes(1);
    });

    it('disables the check while it is looking', () => {
        show(null, { toolsChecking: true });
        render(<MangaToolsSettings />);
        expect(screen.getByRole('button', { name: 'LOOKING…' })).toBeDisabled();
    });

    it('shows the version in use, where it came from and the latest one, and offers to update both', () => {
        show(versions());
        render(<MangaToolsSettings />);
        expect(within(server()).getByText('In use: v1.0.0 (the one of the app)')).toBeInTheDocument();
        expect(within(server()).getByText('Latest: v2.0.0')).toBeInTheDocument();
        expect(within(server()).getByRole('button', { name: 'UPDATE TO v2.0.0' })).toBeEnabled();
        expect(within(helper()).getByText('In use: v3.5.2')).toBeInTheDocument();
        expect(within(helper()).getByText('Latest: v3.6.0')).toBeInTheDocument();
        expect(within(helper()).getByRole('button', { name: 'UPDATE TO v3.6.0' })).toBeEnabled();
        expect(within(server()).queryByRole('button', { name: 'RESTART NOW' })).not.toBeInTheDocument();
        expect(within(server()).queryByRole('button', { name: 'USE THE ONE OF THE APP' })).not.toBeInTheDocument();
    });

    it('offers no update when the latest is the one in use', () => {
        show(versions({ suwayomi: { latest: 'v1.0.0', updatable: false }, flaresolverr: { current: 'v3.6.0', latest: 'v3.6.0', error: null, updatable: false } }));
        render(<MangaToolsSettings />);
        expect(screen.queryByRole('button', { name: /^UPDATE TO/ })).not.toBeInTheDocument();
    });

    it('updates the server and the helper with their buttons', async () => {
        const user = userEvent.setup();
        show(versions());
        render(<MangaToolsSettings />);
        await user.click(within(server()).getByRole('button', { name: 'UPDATE TO v2.0.0' }));
        expect(mock.api.manga.updateServer).toHaveBeenCalledTimes(1);
        await user.click(within(helper()).getByRole('button', { name: 'UPDATE TO v3.6.0' }));
        expect(mock.api.manga.updateHelper).toHaveBeenCalledTimes(1);
    });

    it('disables the button and shows the progress of the download while the server updates', () => {
        show(versions(), { updating: { server: true, helper: false }, serverUpdate: makeTool({ status: 'downloading', percent: 42 }) });
        render(<MangaToolsSettings />);
        expect(within(server()).getByRole('button', { name: 'UPDATING…' })).toBeDisabled();
        const progress = within(server()).getByRole('progressbar', { name: 'Downloading the server' });
        expect(progress).toHaveAttribute('aria-valuenow', '42');
        expect(within(helper()).getByRole('button', { name: 'UPDATE TO v3.6.0' })).toBeEnabled();
    });

    it('shows no progress when the download ended or the server is not updating', () => {
        show(versions(), { updating: { server: true, helper: false }, serverUpdate: makeTool({ status: 'ready', percent: 100 }) });
        const { unmount } = render(<MangaToolsSettings />);
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        unmount();
        show(versions(), { updating: { server: false, helper: false }, serverUpdate: makeTool({ status: 'downloading', percent: 10 }) });
        render(<MangaToolsSettings />);
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    it('disables the button of the helper while it updates', () => {
        show(versions(), { updating: { server: false, helper: true } });
        render(<MangaToolsSettings />);
        expect(within(helper()).getByRole('button', { name: 'UPDATING…' })).toBeDisabled();
        expect(within(server()).getByRole('button', { name: 'UPDATE TO v2.0.0' })).toBeEnabled();
    });

    it('tells to restart when a newer server was downloaded, and restarts the app on click', async () => {
        const user = userEvent.setup();
        show(versions({ suwayomi: { restartNeeded: true, updatable: false } }));
        render(<MangaToolsSettings />);
        expect(within(server()).getByText('Downloaded. Restart the app to use it.')).toBeInTheDocument();
        await user.click(within(server()).getByRole('button', { name: 'RESTART NOW' }));
        expect(mock.api.manga.restartApp).toHaveBeenCalledTimes(1);
    });

    it('says the version in use was updated, and offers to go back to the one of the app', async () => {
        const user = userEvent.setup();
        show(versions({ suwayomi: { current: 'v2.0.0', chosen: true, updatable: false } }));
        render(<MangaToolsSettings />);
        expect(within(server()).getByText('In use: v2.0.0 (updated)')).toBeInTheDocument();
        const reset = within(server()).getByRole('button', { name: 'USE THE ONE OF THE APP' });
        expect(reset).toHaveAttribute('title', 'Goes back to v1.0.0, the one the app ships with, from the next time it opens.');
        await user.click(reset);
        expect(mock.api.manga.resetServerVersion).toHaveBeenCalledTimes(1);
    });

    it('says the helper is not in use when the app runs none', () => {
        show(versions({ flaresolverr: null }));
        render(<MangaToolsSettings />);
        expect(within(helper()).getByText('Not in use: it is not installed, or you run your own.')).toBeInTheDocument();
        expect(within(helper()).queryByRole('button')).not.toBeInTheDocument();
    });

    it('says why the latest version could not be found', () => {
        show(versions({ suwayomi: { latest: null, error: 'offline', updatable: false }, flaresolverr: { current: 'v3.5.2', latest: null, error: 'timeout', updatable: false } }));
        render(<MangaToolsSettings />);
        expect(within(server()).getByRole('alert')).toHaveTextContent('Could not look for the latest version: offline');
        expect(within(helper()).getByRole('alert')).toHaveTextContent('Could not look for the latest version: timeout');
        expect(screen.queryByText(/^Latest:/)).not.toBeInTheDocument();
    });

    it('shows a dash when the version in use is not known', () => {
        show(versions({ suwayomi: { current: '' } }));
        render(<MangaToolsSettings />);
        expect(within(server()).getByText('In use: — (the one of the app)')).toBeInTheDocument();
    });

    it.each<[MangaToolUpdateResult, string]>([
        [{ ok: true, version: 'v2.0.0' }, 'Updated to v2.0.0.'],
        [{ ok: false, reason: 'current', message: null }, 'Already on the latest version.'],
        [{ ok: false, reason: 'busy', message: null }, 'Another update is going on.'],
        [{ ok: false, reason: 'not-installed', message: null }, 'FlareSolverr is not installed.'],
        [{ ok: false, reason: 'unsupported', message: null }, 'There is no program for this system in the latest release.'],
        [{ ok: false, reason: 'failed', message: 'hash' }, 'The update failed. Nothing changed.']
    ])('says how the update of the server went: %j', (result, text) => {
        show(versions(), { updateResults: { server: result, helper: null } });
        render(<MangaToolsSettings />);
        const line = within(server()).getByText(text);
        if (result.ok) {
            expect(line).not.toHaveAttribute('role');
            expect(line).not.toHaveAttribute('title');
        } else {
            expect(line).toHaveAttribute('role', 'alert');
            expect(line).toHaveClass('field__warning');
            expect(line).toHaveAttribute('title', result.message ?? undefined);
        }
    });

    it('says how the update of the helper went', () => {
        show(versions(), { updateResults: { server: null, helper: { ok: false, reason: 'failed', message: 'manifest unknown' } } });
        render(<MangaToolsSettings />);
        const line = within(helper()).getByText('The update failed. Nothing changed.');
        expect(line).toHaveAttribute('role', 'alert');
        expect(line).toHaveAttribute('title', 'manifest unknown');
        expect(within(server()).queryByText('The update failed. Nothing changed.')).not.toBeInTheDocument();
    });
});
