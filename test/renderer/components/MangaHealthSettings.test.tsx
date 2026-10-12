// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MangaHealth } from '@shared/manga';
import { MangaHealthSettings } from '@renderer/components/MangaHealthSettings';
import { useMangaStore } from '@renderer/store/mangaStore';
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

    it('explains when it looks and what CHECK NOW does', () => {
        mock.api.manga.health.mockReturnValue(new Promise(() => {
            return undefined;
        }));
        render(<MangaHealthSettings />);
        expect(screen.getByText(/The status is read when this screen opens\. CHECK NOW al/)).toBeInTheDocument();
    });
});
