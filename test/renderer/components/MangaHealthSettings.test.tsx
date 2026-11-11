// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MangaHealth, MangaToolUpdateResult, MangaToolVersions } from '@shared/manga';
import { MangaHealthSettings } from '@renderer/components/MangaHealthSettings';
import { useMangaStore } from '@renderer/store/mangaStore';
import { answerDialog, confirmDialog } from '../../helpers/confirmDialog';
import { openErrorDialog } from '../../helpers/errorDialog';
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

    it('restarts the server and the helper after asking, and shows how they are afterwards', async () => {
        const user = userEvent.setup();
        answerWith(health());
        render(<MangaHealthSettings />);
        await vi.waitFor(() => {
            expect(screen.getByRole('button', { name: 'CHECK NOW' })).toBeEnabled();
        });
        let finish: (value: MangaHealth) => void = () => {
            return undefined;
        };
        mock.api.manga.restartPrograms.mockReturnValue(
            new Promise((resolve) => {
                finish = resolve;
            })
        );

        await user.click(screen.getByRole('button', { name: 'RESTART PROGRAMS' }));
        const question = confirmDialog('Restart Suwayomi-Server and FlareSolverr?');
        expect(within(question).getByText('Both are stopped and started again. A chapter that is downloading fails and is tried again by itself (up to 3 times). Use it when the sources or the downloads hang.')).toBeInTheDocument();
        expect(mock.api.manga.restartPrograms).not.toHaveBeenCalled();
        await answerDialog(user, 'Restart Suwayomi-Server and FlareSolverr?', 'RESTART PROGRAMS');

        expect(mock.api.manga.restartPrograms).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'RESTARTING…' })).toBeDisabled();
        finish(health({ server: { state: 'healthy', version: 'v3.0.0', message: null, external: false } }));
        expect(await screen.findByText('v3.0.0')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'RESTART PROGRAMS' })).toBeEnabled();
    });

    it('restarts nothing when the answer is to go back', async () => {
        const user = userEvent.setup();
        answerWith(health());
        render(<MangaHealthSettings />);
        await vi.waitFor(() => {
            expect(screen.getByRole('button', { name: 'RESTART PROGRAMS' })).toBeEnabled();
        });
        await user.click(screen.getByRole('button', { name: 'RESTART PROGRAMS' }));
        await answerDialog(user, 'Restart Suwayomi-Server and FlareSolverr?', 'BACK');
        expect(mock.api.manga.restartPrograms).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('cannot restart the server when the program is not installed', async () => {
        answerWith(health({ server: { state: 'not-installed', version: null, message: null, external: false } }));
        render(<MangaHealthSettings />);
        expect(await screen.findByText('NOT INSTALLED')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'RESTART PROGRAMS' })).toBeDisabled();
    });

    it('has no section of its own for the updates, only the button that looks for them, when the app runs the helper', async () => {
        answerWith(health());
        render(<MangaHealthSettings />);
        expect(screen.queryByRole('group', { name: 'Updates of the programs' })).not.toBeInTheDocument();
        expect(await screen.findByRole('button', { name: 'CHECK FOR UPDATES' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: /^UPDATE TO/ })).not.toBeInTheDocument();
        expect(screen.getByText(/^Updating takes the latest release of FlareSolverr/)).toBeInTheDocument();
    });

    it.each([
        ['the helper is not in use', health({ helper: null })],
        ['the user runs a helper of their own', health({ helper: { state: 'healthy', version: '3.5.2', message: null, external: true } })]
    ])('offers no look for updates, nor says how they are made, when %s: there is nothing the app can update', async (_name, answer) => {
        answerWith(answer);
        render(<MangaHealthSettings />);
        expect(await screen.findByTestId('manga-health-helper')).toBeInTheDocument();
        await screen.findByRole('button', { name: 'CHECK NOW' });
        await vi.waitFor(() => {
            expect(mock.api.manga.health).toHaveBeenCalledTimes(1);
        });
        expect(screen.queryByRole('button', { name: 'CHECK FOR UPDATES' })).not.toBeInTheDocument();
        expect(screen.queryByText(/^Updating takes the latest release of FlareSolverr/)).not.toBeInTheDocument();
    });

    it('offers no look for updates while it does not know how the helper is', () => {
        mock.api.manga.health.mockReturnValue(new Promise(() => {
            return undefined;
        }));
        render(<MangaHealthSettings />);
        expect(screen.queryByRole('button', { name: 'CHECK FOR UPDATES' })).not.toBeInTheDocument();
    });

    it('explains when it looks and what CHECK NOW does', () => {
        mock.api.manga.health.mockReturnValue(new Promise(() => {
            return undefined;
        }));
        render(<MangaHealthSettings />);
        expect(screen.getByText(/The status is read when this screen opens\. CHECK NOW al/)).toBeInTheDocument();
    });
});

function versions(flaresolverr: MangaToolVersions['flaresolverr'] = { current: 'v3.5.2', latest: 'v3.6.0', error: null, updatable: true }): MangaToolVersions {
    return { flaresolverr };
}

// The helper is the one the app runs (the look for updates is offered), unless the test says otherwise.
function show(toolVersions: MangaToolVersions | null, extra: Partial<typeof initialManga> = {}): void {
    mock.api.manga.health.mockReturnValue(new Promise(() => {
        return undefined;
    }));
    useMangaStore.setState({ ...initialManga, toolVersions, health: health(), ...extra });
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
        expect(mock.api.manga.checkToolUpdates).toHaveBeenCalledWith();
    });

    it('disables the check while it is looking', () => {
        show(null, { toolsChecking: true });
        render(<MangaHealthSettings />);
        expect(screen.getByRole('button', { name: 'LOOKING…' })).toBeDisabled();
    });

    it('shows the latest version of the helper and offers to update it', () => {
        show(versions());
        render(<MangaHealthSettings />);
        expect(within(helper()).getByText('Latest: v3.6.0')).toBeInTheDocument();
        expect(within(helper()).getByRole('button', { name: 'UPDATE TO v3.6.0' })).toBeEnabled();
    });

    it('never offers to update the server, go back from an update of it, or restart the app for it', () => {
        show(versions());
        render(<MangaHealthSettings />);
        expect(within(server()).queryByRole('button')).not.toBeInTheDocument();
        expect(within(server()).queryByText(/^Latest:/)).not.toBeInTheDocument();
        expect(within(server()).queryByRole('progressbar')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'RESTART NOW' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'USE THE ONE OF THE APP' })).not.toBeInTheDocument();
    });

    it('says the server moves with the updates of the app', () => {
        show(null);
        render(<MangaHealthSettings />);
        expect(
            screen.getByText(
                'Updating takes the latest release of FlareSolverr (from GitHub) and switches to it at once. The manga server stays at the version the app ships with: it moves with the updates of the app.'
            )
        ).toBeInTheDocument();
    });

    it('offers no update when the latest is the one in use', () => {
        show(versions({ current: 'v3.6.0', latest: 'v3.6.0', error: null, updatable: false }));
        render(<MangaHealthSettings />);
        expect(screen.queryByRole('button', { name: /^UPDATE TO/ })).not.toBeInTheDocument();
        expect(within(helper()).getByText('Latest: v3.6.0')).toBeInTheDocument();
    });

    it('updates the helper with its button', async () => {
        const user = userEvent.setup();
        mock.api.manga.checkToolUpdates.mockResolvedValue(versions());
        show(versions());
        render(<MangaHealthSettings />);
        await user.click(within(helper()).getByRole('button', { name: 'UPDATE TO v3.6.0' }));
        expect(mock.api.manga.updateHelper).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.updateHelper).toHaveBeenCalledWith();
    });

    it('disables the button of the helper while it updates', () => {
        show(versions(), { updating: { helper: true } });
        render(<MangaHealthSettings />);
        expect(within(helper()).getByRole('button', { name: 'UPDATING…' })).toBeDisabled();
    });

    it('offers no update of the helper when the app runs none', () => {
        show(versions(null));
        render(<MangaHealthSettings />);
        expect(within(helper()).queryByRole('button')).not.toBeInTheDocument();
        expect(within(helper()).queryByText(/^Latest:/)).not.toBeInTheDocument();
    });

    it('says why the latest version could not be found', () => {
        show(versions({ current: 'v3.5.2', latest: null, error: 'timeout', updatable: false }));
        render(<MangaHealthSettings />);
        expect(within(helper()).getByRole('alert')).toHaveTextContent('Could not look for the latest version: timeout');
        expect(screen.queryByText(/^Latest:/)).not.toBeInTheDocument();
    });

    it.each<[MangaToolUpdateResult, string]>([
        [{ ok: true, version: 'v3.6.0' }, 'Updated to v3.6.0.'],
        [{ ok: false, reason: 'current', message: null }, 'Already on the latest version.'],
        [{ ok: false, reason: 'busy', message: null }, 'Another update is going on.'],
        [{ ok: false, reason: 'not-installed', message: null }, 'FlareSolverr is not installed.'],
        [{ ok: false, reason: 'unsupported', message: null }, 'There is no program for this system in the latest release.'],
        [{ ok: false, reason: 'failed', message: 'manifest unknown' }, 'The update failed. Nothing changed.']
    ])('says how the update of the helper went: %j', async (result, text) => {
        const user = userEvent.setup();
        show(versions(), { updateResults: { helper: result } });
        render(<MangaHealthSettings />);
        const line = within(helper()).getByText(text);
        expect(within(server()).queryByText(text)).not.toBeInTheDocument();
        if (result.ok) {
            expect(line).not.toHaveAttribute('role');
            expect(line).not.toHaveAttribute('title');
            return;
        }
        const alert = line.closest('[role="alert"]');
        expect(alert).toHaveClass('field__warning');
        expect(alert).not.toHaveAttribute('title');
        if (result.message === null) {
            expect(line).toBe(alert);
            expect(within(helper()).queryByRole('button', { name: text })).not.toBeInTheDocument();
            return;
        }
        expect(line).toHaveAttribute('title', 'Click to see the technical error');
        const dialog = await openErrorDialog(user, text);
        expect(within(dialog).getByTestId('error-message')).toHaveTextContent(result.message);
    });
});
