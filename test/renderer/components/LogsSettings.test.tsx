// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { LOG_SOURCES_BY_SCOPE, LogsSettings } from '@renderer/components/LogsSettings';
import type { SettingsScope } from '@renderer/components/SettingsPanel';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

const initialApp = useAppStore.getState();
const HINT =
    'The recent output of the programs of this section, kept in memory only (up to 2,000 lines per program) and gone when the app closes. Passwords, cookies and tokens show as ***.';

let mock: MockApiHandle;

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS, toasts: [] });
});

describe('LOG_SOURCES_BY_SCOPE', () => {
    it('gives each place of the settings the programs of its section', () => {
        expect(LOG_SOURCES_BY_SCOPE).toEqual({ global: ['ffmpeg'], downloads: ['yt-dlp'], anime: ['ani-cli'], manga: ['suwayomi', 'flaresolverr'] });
    });
});

describe('LogsSettings', () => {
    it('is a block of the settings with a button and what the logs keep', () => {
        render(<LogsSettings scope="global" />);
        const legend = screen.getByText('DIAGNOSTICS');
        expect(legend.tagName).toBe('LEGEND');
        expect(legend.parentElement).toHaveClass('panel');
        expect(screen.getByRole('button', { name: 'VIEW LOGS' })).toHaveClass('btn', 'btn--small');
        expect(screen.getByText(HINT)).toHaveClass('field__hint');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(mock.api.logs.watch).not.toHaveBeenCalled();
    });

    it.each<[SettingsScope, string, string[]]>([
        ['global', 'LOGS — ffmpeg', ['ffmpeg']],
        ['downloads', 'LOGS — yt-dlp', ['yt-dlp']],
        ['anime', 'LOGS — ani-cli', ['ani-cli']],
        ['manga', 'LOGS — Suwayomi · FlareSolverr', ['suwayomi']]
    ])('opens the window of the logs of the %s settings', async (scope, heading, watched) => {
        const user = userEvent.setup();
        render(<LogsSettings scope={scope} />);
        await user.click(screen.getByRole('button', { name: 'VIEW LOGS' }));
        expect(screen.getByRole('dialog', { name: heading })).toBeInTheDocument();
        await screen.findByText('Nothing recorded yet. The lines show up here as soon as the program runs.');
        expect(
            mock.api.logs.watch.mock.calls.map((call) => {
                return call[0];
            })
        ).toEqual(watched);
    });

    it('closes the window', async () => {
        const user = userEvent.setup();
        render(<LogsSettings scope="downloads" />);
        await user.click(screen.getByRole('button', { name: 'VIEW LOGS' }));
        await screen.findByText('Nothing recorded yet. The lines show up here as soon as the program runs.');
        await user.click(screen.getByRole('button', { name: 'CLOSE' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
