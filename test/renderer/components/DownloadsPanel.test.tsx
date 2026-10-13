// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { HistoryEntry } from '@shared/types';
import { DownloadsPanel } from '@renderer/components/DownloadsPanel';
import { SETTINGS_ICON } from '@renderer/components/TabButton';
import { useAppStore } from '@renderer/store/appStore';
import { useProgramsStore } from '@renderer/store/programsStore';
import { installMockApi, makeProgramInfo, makeProgramsStatus } from '../../helpers/mockApi';

const initial = useAppStore.getState();
const DONE: HistoryEntry = { id: 'h1', url: 'https://x.com/1', title: 'Done Video', filePath: '/d/Done Video.mp4', status: 'done', errorTitle: null, finishedAt: 1700000000000 };

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initial, tab: 'downloads', downloadsView: 'queue', jobs: [], history: [], settings: DEFAULT_SETTINGS });
    useProgramsStore.setState({ status: makeProgramsStatus(), updates: {}, versions: null, checking: false, working: {}, results: {} });
});

function subNav(): HTMLElement {
    return screen.getByRole('navigation', { name: 'Video downloader' });
}

describe('DownloadsPanel', () => {
    describe('programs', () => {
        function failProgram(id: 'ytdlp' | 'deno' | 'ffmpeg'): void {
            const base = makeProgramsStatus();
            useProgramsStore.setState({
                status: {
                    ...base,
                    programs: base.programs.map((program) => {
                        return program.id === id ? makeProgramInfo(id, { state: { ...program.state, status: 'error', percent: 0, version: null, error: { code: 'DOWNLOAD_FAILED', message: 'offline' } } }) : program;
                    })
                }
            });
        }

        it('shows the queue once yt-dlp, deno and ffmpeg are ready', () => {
            render(<DownloadsPanel />);
            expect(screen.queryByTestId('programs-setup-downloads')).not.toBeInTheDocument();
            expect(screen.getByLabelText('Link 1')).toBeInTheDocument();
        });

        it('shows how the programs are downloaded, and TRY AGAIN for the one that failed, in place of the queue', async () => {
            failProgram('ytdlp');
            const user = userEvent.setup();
            const mock = installMockApi();
            render(<DownloadsPanel />);
            expect(screen.getByTestId('programs-setup-downloads')).toHaveTextContent('PREPARING THE VIDEO DOWNLOADER');
            expect(screen.queryByLabelText('Link 1')).not.toBeInTheDocument();
            expect(within(screen.getByTestId('program-setup-ytdlp')).getByRole('alert')).toHaveTextContent('The download failed. Check your connection and try again.');
            await user.click(within(screen.getByTestId('program-setup-ytdlp')).getByRole('button', { name: 'TRY AGAIN' }));
            expect(mock.api.programs.install).toHaveBeenCalledWith('ytdlp');
        });

        it('does not hold the history or the settings back', async () => {
            failProgram('ffmpeg');
            const user = userEvent.setup();
            render(<DownloadsPanel />);
            await user.click(within(subNav()).getByRole('button', { name: 'HISTORY' }));
            expect(screen.queryByTestId('programs-setup-downloads')).not.toBeInTheDocument();
            await user.click(within(subNav()).getByRole('button', { name: 'SETTINGS' }));
            expect(screen.queryByTestId('programs-setup-downloads')).not.toBeInTheDocument();
            expect(screen.getByTestId('programs-block-downloads')).toBeInTheDocument();
        });
    });

    it('is a region of the video downloader with a QUEUE, a HISTORY and a SETTINGS screen', () => {
        render(<DownloadsPanel />);
        expect(screen.getByRole('region', { name: 'Video downloader' })).toBeInTheDocument();
        expect(
            within(subNav())
                .getAllByRole('button')
                .map((button) => {
                    return button.getAttribute('aria-label') ?? button.textContent;
                })
        ).toEqual(['QUEUE', 'HISTORY', 'SETTINGS']);
        // The settings are a gear at the right end of the bar, not a word.
        const settings = within(subNav()).getByRole('button', { name: 'SETTINGS' });
        expect(settings).toHaveClass('tab--icon');
        expect(settings).toHaveTextContent(SETTINGS_ICON);
        expect(settings).not.toHaveTextContent('SETTINGS');
        expect(settings).toHaveAttribute('title', 'SETTINGS');
    });

    it('opens on the queue, with the field for links, and marks it as the current screen', () => {
        render(<DownloadsPanel />);
        expect(within(subNav()).getByRole('button', { name: 'QUEUE' })).toHaveAttribute('aria-current', 'page');
        expect(within(subNav()).getByRole('button', { name: 'HISTORY' })).not.toHaveAttribute('aria-current');
        expect(screen.getByLabelText('Link 1')).toBeInTheDocument();
        expect(screen.queryByText('// HISTORY IS EMPTY.')).not.toBeInTheDocument();
    });

    it('shows the history in place of the queue and keeps the choice in the store', async () => {
        const user = userEvent.setup();
        useAppStore.setState({ history: [DONE] });
        render(<DownloadsPanel />);

        await user.click(within(subNav()).getByRole('button', { name: 'HISTORY' }));
        expect(useAppStore.getState().downloadsView).toBe('history');
        expect(within(subNav()).getByRole('button', { name: 'HISTORY' })).toHaveAttribute('aria-current', 'page');
        expect(within(subNav()).getByRole('button', { name: 'QUEUE' })).not.toHaveAttribute('aria-current');
        expect(screen.getByText('Done Video')).toBeInTheDocument();
        expect(screen.getByText('HISTORY [1]')).toBeInTheDocument();
        expect(screen.queryByLabelText('Link 1')).not.toBeInTheDocument();
    });

    it('goes back to the queue', async () => {
        const user = userEvent.setup();
        useAppStore.setState({ downloadsView: 'history' });
        render(<DownloadsPanel />);
        expect(screen.getByText('// HISTORY IS EMPTY.')).toBeInTheDocument();

        await user.click(within(subNav()).getByRole('button', { name: 'QUEUE' }));
        expect(useAppStore.getState().downloadsView).toBe('queue');
        expect(screen.getByLabelText('Link 1')).toBeInTheDocument();
        expect(screen.queryByText('// HISTORY IS EMPTY.')).not.toBeInTheDocument();
    });

    it('shows the settings of the video downloader, and only them', async () => {
        const user = userEvent.setup();
        render(<DownloadsPanel />);

        await user.click(within(subNav()).getByRole('button', { name: 'SETTINGS' }));
        expect(useAppStore.getState().downloadsView).toBe('settings');
        expect(within(subNav()).getByRole('button', { name: 'SETTINGS' })).toHaveAttribute('aria-current', 'page');
        expect(within(subNav()).getByRole('button', { name: 'QUEUE' })).not.toHaveAttribute('aria-current');
        expect(screen.getByRole('region', { name: 'Settings' })).toBeInTheDocument();
        ['OUTPUT', 'QUALITY & FORMAT', 'PLAYLISTS & SUBTITLES', 'LIVE STREAMS', 'BROWSER COOKIES', 'Status of the programs', 'ADVANCED'].forEach((legend) => {
            expect(screen.getByText(legend)).toBeInTheDocument();
        });
        expect(screen.queryByText('APPEARANCE & WINDOW')).not.toBeInTheDocument();
        expect(screen.queryByText('APP UPDATES')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Link 1')).not.toBeInTheDocument();
        expect(screen.queryByText('// HISTORY IS EMPTY.')).not.toBeInTheDocument();
    });

    it('goes from the settings back to the queue', async () => {
        const user = userEvent.setup();
        useAppStore.setState({ downloadsView: 'settings' });
        render(<DownloadsPanel />);
        await user.click(within(subNav()).getByRole('button', { name: 'QUEUE' }));
        expect(screen.getByLabelText('Link 1')).toBeInTheDocument();
        expect(screen.queryByText('OUTPUT')).not.toBeInTheDocument();
    });
});
