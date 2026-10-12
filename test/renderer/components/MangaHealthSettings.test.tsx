// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MangaHealth, MangaToolUpdateResult, MangaToolVersions } from '@shared/manga';
import { MangaHealthSettings } from '@renderer/components/MangaHealthSettings';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeTool } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialManga = useMangaStore.getState();

function health(overrides: Partial<MangaHealth> = {}): MangaHealth {
    return {
        server: { state: 'healthy', version: 'v2.4.2366', message: null, external: false },
        helper: { state: 'healthy', version: '3.5.2', message: null, external: false },
        ...overrides
    };
}

function answerWith(value: MangaHealth): void {
    mock.api.manga.health.mockResolvedValue(value);
}

beforeEach(() => {
    mock = installMockApi();
    useMangaStore.setState({ ...initialManga });
});

describe('MangaHealthSettings', () => {
    it('looks when it opens, without starting anything that is stopped', async () => {
        answerWith(health());
        render(<MangaHealthSettings />);
        await vi.waitFor(() => {
            expect(mock.api.manga.health).toHaveBeenCalledTimes(1);
        });
        expect(mock.api.manga.health).toHaveBeenCalledWith(false);
        expect(screen.getByRole('group', { name: 'Status of the programs' })).toBeInTheDocument();
    });

    it('says it is looking until the answer comes', () => {
        mock.api.manga.health.mockReturnValue(new Promise(() => {
            return undefined;
        }));
        render(<MangaHealthSettings />);
        expect(within(screen.getByTestId('manga-health-server')).getByText('Looking…')).toBeInTheDocument();
        expect(within(screen.getByTestId('manga-health-helper')).getByText('Looking…')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'CHECKING…' })).toBeDisabled();
    });

    it('shows the server and the helper as healthy, with their versions', async () => {
        answerWith(health());
        render(<MangaHealthSettings />);
        const server = await screen.findByTestId('manga-health-server');
        await vi.waitFor(() => {
            expect(within(server).getByText('HEALTHY')).toBeInTheDocument();
        });
        expect(within(server).getByText('Suwayomi-Server')).toBeInTheDocument();
        expect(within(server).getByText('v2.4.2366')).toBeInTheDocument();
        expect(within(server).getByText('HEALTHY')).toHaveClass('badge--done');
        const helper = screen.getByTestId('manga-health-helper');
        expect(within(helper).getByText('FlareSolverr')).toBeInTheDocument();
        expect(within(helper).getByText('3.5.2')).toBeInTheDocument();
        expect(within(helper).getByText('HEALTHY')).toHaveClass('badge--done');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it.each([
        ['starting', 'STARTING', 'badge--waiting'],
        ['stopped', 'STOPPED', 'badge--cancelled'],
        ['unhealthy', 'NOT WORKING', 'badge--error'],
        ['not-installed', 'NOT INSTALLED', 'badge--cancelled']
    ] as const)('shows a server that is %s', async (state, label, badge) => {
        answerWith(health({ server: { state, version: null, message: null, external: false } }));
        render(<MangaHealthSettings />);
        const server = screen.getByTestId('manga-health-server');
        await vi.waitFor(() => {
            expect(within(server).getByText(label)).toHaveClass(badge);
        });
    });

    it('says why something is not working', async () => {
        answerWith(health({ server: { state: 'unhealthy', version: null, message: 'The server did not answer', external: false } }));
        render(<MangaHealthSettings />);
        expect(await screen.findByRole('alert')).toHaveTextContent('The server did not answer');
    });

    it('says the helper is the one the user runs', async () => {
        answerWith(health({ helper: { state: 'healthy', version: '3.9.9', message: null, external: true } }));
        render(<MangaHealthSettings />);
        expect(await within(screen.getByTestId('manga-health-helper')).findByText('3.9.9 · yours')).toBeInTheDocument();
    });

    it('says the helper is not in use when there is none', async () => {
        answerWith(health({ helper: null }));
        render(<MangaHealthSettings />);
        expect(await within(screen.getByTestId('manga-health-helper')).findByText('Not in use: it is not installed, or you run your own.')).toBeInTheDocument();
        expect(within(screen.getByTestId('manga-health-helper')).queryByText('HEALTHY')).not.toBeInTheDocument();
    });

    it('starts what is stopped and asks it when CHECK NOW is clicked, and disables the button meanwhile', async () => {
        const user = userEvent.setup();
        answerWith(health());
        render(<MangaHealthSettings />);
        await vi.waitFor(() => {
            expect(screen.getByRole('button', { name: 'CHECK NOW' })).toBeEnabled();
        });
        let answer: (value: MangaHealth) => void = () => {
            return undefined;
        };
        mock.api.manga.health.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        await user.click(screen.getByRole('button', { name: 'CHECK NOW' }));
        expect(mock.api.manga.health).toHaveBeenLastCalledWith(true);
        expect(screen.getByRole('button', { name: 'CHECKING…' })).toBeDisabled();
        answer(health({ server: { state: 'unhealthy', version: null, message: 'boom', external: false } }));
        expect(await screen.findByText('NOT WORKING')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'CHECK NOW' })).toBeEnabled();
    });

    it('has no section of its own for the updates, only the button that looks for them', () => {
        mock.api.manga.health.mockReturnValue(new Promise(() => {
            return undefined;
        }));
        render(<MangaHealthSettings />);
        expect(screen.queryByRole('group', { name: 'Updates of the programs' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'CHECK FOR UPDATES' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: /^UPDATE TO/ })).not.toBeInTheDocument();
    });

    it('explains when it looks and what CHECK NOW does', () => {
        mock.api.manga.health.mockReturnValue(new Promise(() => {
            return undefined;
        }));
        render(<MangaHealthSettings />);
        expect(screen.getByText(/The status is read when this screen opens\. CHECK NOW al/)).toBeInTheDocument();
    });
});

function versions(overrides: { suwayomi?: Partial<MangaToolVersions['suwayomi']>; flaresolverr?: MangaToolVersions['flaresolverr'] } = {}): MangaToolVersions {
    return {
        suwayomi: { current: 'v1.0.0', latest: 'v2.0.0', error: null, updatable: true, chosen: false, bundled: 'v1.0.0', restartNeeded: false, ...overrides.suwayomi },
        flaresolverr: overrides.flaresolverr === undefined ? { current: 'v3.5.2', latest: 'v3.6.0', error: null, updatable: true } : overrides.flaresolverr
    };
}

function show(toolVersions: MangaToolVersions | null, extra: Partial<typeof initialManga> = {}): void {
    useMangaStore.setState({ ...initialManga, toolVersions, ...extra });
}

const server = () => {
    return screen.getByTestId('manga-health-server');
};
const helper = () => {
    return screen.getByTestId('manga-health-helper');
};

describe('MangaHealthSettings updates of the programs', () => {
    it('looks for updates with the button', async () => {
        const user = userEvent.setup();
        show(null);
        render(<MangaHealthSettings />);
        await user.click(screen.getByRole('button', { name: 'CHECK FOR UPDATES' }));
        expect(mock.api.manga.checkToolUpdates).toHaveBeenCalledTimes(1);
    });

    it('disables the check while it is looking', () => {
        show(null, { toolsChecking: true });
        render(<MangaHealthSettings />);
        expect(screen.getByRole('button', { name: 'LOOKING…' })).toBeDisabled();
    });

    it('shows the latest version and offers to update both', () => {
        show(versions());
        render(<MangaHealthSettings />);
        expect(within(server()).getByText('Latest: v2.0.0')).toBeInTheDocument();
        expect(within(server()).getByRole('button', { name: 'UPDATE TO v2.0.0' })).toBeEnabled();
        expect(within(helper()).getByText('Latest: v3.6.0')).toBeInTheDocument();
        expect(within(helper()).getByRole('button', { name: 'UPDATE TO v3.6.0' })).toBeEnabled();
        expect(within(server()).queryByRole('button', { name: 'RESTART NOW' })).not.toBeInTheDocument();
        expect(within(server()).queryByRole('button', { name: 'USE THE ONE OF THE APP' })).not.toBeInTheDocument();
    });

    it('offers no update when the latest is the one in use', () => {
        show(versions({ suwayomi: { latest: 'v1.0.0', updatable: false }, flaresolverr: { current: 'v3.6.0', latest: 'v3.6.0', error: null, updatable: false } }));
        render(<MangaHealthSettings />);
        expect(screen.queryByRole('button', { name: /^UPDATE TO/ })).not.toBeInTheDocument();
    });

    it('updates the server and the helper with their buttons', async () => {
        const user = userEvent.setup();
        show(versions());
        render(<MangaHealthSettings />);
        await user.click(within(server()).getByRole('button', { name: 'UPDATE TO v2.0.0' }));
        expect(mock.api.manga.updateServer).toHaveBeenCalledTimes(1);
        await user.click(within(helper()).getByRole('button', { name: 'UPDATE TO v3.6.0' }));
        expect(mock.api.manga.updateHelper).toHaveBeenCalledTimes(1);
    });

    it('disables the button and shows the progress of the download while the server updates', () => {
        show(versions(), { updating: { server: true, helper: false }, serverUpdate: makeTool({ status: 'downloading', percent: 42 }) });
        render(<MangaHealthSettings />);
        expect(within(server()).getByRole('button', { name: 'UPDATING…' })).toBeDisabled();
        expect(within(server()).getByRole('progressbar', { name: 'Downloading the server' })).toHaveAttribute('aria-valuenow', '42');
        expect(within(helper()).getByRole('button', { name: 'UPDATE TO v3.6.0' })).toBeEnabled();
    });

    it('shows no progress when the download ended or the server is not updating', () => {
        show(versions(), { updating: { server: true, helper: false }, serverUpdate: makeTool({ status: 'ready', percent: 100 }) });
        const { unmount } = render(<MangaHealthSettings />);
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        unmount();
        show(versions(), { updating: { server: false, helper: false }, serverUpdate: makeTool({ status: 'downloading', percent: 10 }) });
        render(<MangaHealthSettings />);
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    it('disables the button of the helper while it updates', () => {
        show(versions(), { updating: { server: false, helper: true } });
        render(<MangaHealthSettings />);
        expect(within(helper()).getByRole('button', { name: 'UPDATING…' })).toBeDisabled();
        expect(within(server()).getByRole('button', { name: 'UPDATE TO v2.0.0' })).toBeEnabled();
    });

    it('tells to restart when a newer server was downloaded, and restarts the app on click', async () => {
        const user = userEvent.setup();
        show(versions({ suwayomi: { restartNeeded: true, updatable: false } }));
        render(<MangaHealthSettings />);
        expect(within(server()).getByText('Downloaded. Restart the app to use it.')).toBeInTheDocument();
        await user.click(within(server()).getByRole('button', { name: 'RESTART NOW' }));
        expect(mock.api.manga.restartApp).toHaveBeenCalledTimes(1);
    });

    it('offers to go back to the version of the app when the one in use was updated', async () => {
        const user = userEvent.setup();
        show(versions({ suwayomi: { current: 'v2.0.0', chosen: true, updatable: false } }));
        render(<MangaHealthSettings />);
        const reset = within(server()).getByRole('button', { name: 'USE THE ONE OF THE APP' });
        expect(reset).toHaveAttribute('title', 'Goes back to v1.0.0, the one the app ships with, from the next time it opens.');
        await user.click(reset);
        expect(mock.api.manga.resetServerVersion).toHaveBeenCalledTimes(1);
    });

    it('offers no update of the helper when the app runs none', () => {
        show(versions({ flaresolverr: null }));
        render(<MangaHealthSettings />);
        expect(within(helper()).queryByRole('button')).not.toBeInTheDocument();
        expect(within(helper()).queryByText(/^Latest:/)).not.toBeInTheDocument();
    });

    it('says why the latest version could not be found', () => {
        show(versions({ suwayomi: { latest: null, error: 'offline', updatable: false }, flaresolverr: { current: 'v3.5.2', latest: null, error: 'timeout', updatable: false } }));
        render(<MangaHealthSettings />);
        expect(within(server()).getByRole('alert')).toHaveTextContent('Could not look for the latest version: offline');
        expect(within(helper()).getByRole('alert')).toHaveTextContent('Could not look for the latest version: timeout');
        expect(screen.queryByText(/^Latest:/)).not.toBeInTheDocument();
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
        render(<MangaHealthSettings />);
        const line = within(server()).getByText(text);
        if (result.ok) {
            expect(line).not.toHaveAttribute('role');
            expect(line).not.toHaveAttribute('title');
        } else {
            expect(line).toHaveAttribute('role', 'alert');
            expect(line).toHaveClass('field__warning');
            if (result.message !== null) {
                expect(line).toHaveAttribute('title', result.message);
            }
        }
    });

    it('says how the update of the helper went, apart from the server', () => {
        show(versions(), { updateResults: { server: null, helper: { ok: false, reason: 'failed', message: 'manifest unknown' } } });
        render(<MangaHealthSettings />);
        const line = within(helper()).getByText('The update failed. Nothing changed.');
        expect(line).toHaveAttribute('role', 'alert');
        expect(line).toHaveAttribute('title', 'manifest unknown');
        expect(within(server()).queryByText('The update failed. Nothing changed.')).not.toBeInTheDocument();
    });
});
