// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { AnimeJobs } from '@renderer/components/AnimeJobs';
import { useAnimeStore, UNSUPPORTED_STATUS, INITIAL_SEARCH } from '@renderer/store/animeStore';
import { useAppStore } from '@renderer/store/appStore';
import { makeAnimeJob } from '../../helpers/animeFixtures';
import { answerDialog, confirmDialog } from '../../helpers/confirmDialog';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';
import { openErrorDialog } from '../../helpers/errorDialog';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialAnime = useAnimeStore.getState();

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useAnimeStore.setState({ ...initialAnime, status: UNSUPPORTED_STATUS, jobs: [], library: [], search: INITIAL_SEARCH, selection: null, playing: null });
});

describe('AnimeJobs', () => {
    it('says there are no downloads yet', () => {
        render(<AnimeJobs />);
        expect(screen.getByText('// NO DOWNLOADS YET.')).toBeInTheDocument();
        expect(screen.queryByTestId('anime-job')).not.toBeInTheDocument();
    });

    it('shows the title, the progress, the speed and the time left of a running download', () => {
        useAnimeStore.setState({ jobs: [makeAnimeJob({ animeTitle: 'Cyberpunk: Edgerunners', episode: '3', percent: 42.5, speed: '1.50MiB/s', eta: '00:10' })] });
        render(<AnimeJobs />);

        const job = screen.getByTestId('anime-job');
        expect(job).toHaveClass('job', 'job--running');
        expect(within(job).getByRole('heading', { name: 'Cyberpunk: Edgerunners · EP 3' })).toBeInTheDocument();
        expect(within(job).getByText('DOWNLOADING')).toHaveClass('badge--running');
        const bar = within(job).getByRole('progressbar', { name: 'Download progress of Cyberpunk: Edgerunners, episode 3' });
        expect(bar).toHaveAttribute('aria-valuenow', '43');
        expect(bar).toHaveAttribute('aria-valuemin', '0');
        expect(bar).toHaveAttribute('aria-valuemax', '100');
        expect(bar.firstElementChild).toHaveStyle({ width: '42.5%' });
        expect(within(job).getByText('42.5%')).toBeInTheDocument();
        expect(within(job).getByText('1.50MiB/s')).toBeInTheDocument();
        expect(within(job).getByText('ETA 00:10')).toBeInTheDocument();
        expect(screen.getByText('DOWNLOADS (1)', { selector: '.section-label' })).toBeInTheDocument();
    });

    it('leaves the speed and the time out when there are none', () => {
        useAnimeStore.setState({ jobs: [makeAnimeJob({ status: 'queued', percent: 0, speed: '', eta: '' })] });
        render(<AnimeJobs />);
        const meta = screen.getByTestId('anime-job').querySelector('.job__meta');
        expect(meta?.textContent).toBe('0.0%');
        expect(screen.getByText('QUEUED')).toHaveClass('badge--queued');
    });

    it('orders the jobs: running, queued, failed, cancelled, done', () => {
        useAnimeStore.setState({
            jobs: [
                makeAnimeJob({ episodeId: 1, episode: '1', status: 'done' }),
                makeAnimeJob({ episodeId: 2, episode: '2', status: 'cancelled' }),
                makeAnimeJob({ episodeId: 3, episode: '3', status: 'error' }),
                makeAnimeJob({ episodeId: 4, episode: '4', status: 'queued' }),
                makeAnimeJob({ episodeId: 5, episode: '5', status: 'running' })
            ]
        });
        render(<AnimeJobs />);
        expect(
            screen.getAllByTestId('anime-job').map((job) => {
                return within(job).getByRole('heading').textContent;
            })
        ).toEqual(['Naruto · EP 5', 'Naruto · EP 4', 'Naruto · EP 3', 'Naruto · EP 2', 'Naruto · EP 1']);
    });

    it('cancels a running or waiting download', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ jobs: [makeAnimeJob({ episodeId: 7, status: 'running' }), makeAnimeJob({ episodeId: 8, status: 'queued' })] });
        render(<AnimeJobs />);

        const buttons = screen.getAllByRole('button', { name: 'CANCEL' });
        expect(buttons).toHaveLength(2);
        await user.click(buttons[0] as HTMLElement);
        expect(mock.api.cancelAnimeJob).not.toHaveBeenCalled();
        expect(within(confirmDialog('Cancel this download?')).getByText('The download stops. You can start it again later.')).toBeInTheDocument();
        await answerDialog(user, 'Cancel this download?', 'CANCEL');
        await user.click(screen.getAllByRole('button', { name: 'CANCEL' })[1] as HTMLElement);
        await answerDialog(user, 'Cancel this download?', 'CANCEL');
        expect(mock.api.cancelAnimeJob.mock.calls).toEqual([[7], [8]]);
        expect(screen.queryByRole('button', { name: 'RETRY' })).not.toBeInTheDocument();
    });

    it.each(['error', 'cancelled'] as const)('offers to retry a %s download', async (status) => {
        const user = userEvent.setup();
        useAnimeStore.setState({ jobs: [makeAnimeJob({ episodeId: 9, status })] });
        render(<AnimeJobs />);

        await user.click(screen.getByRole('button', { name: 'RETRY' }));
        expect(mock.api.retryAnimeJob).toHaveBeenCalledWith(9);
        expect(screen.queryByRole('button', { name: 'CANCEL' })).not.toBeInTheDocument();
    });

    it('does not offer any action for a finished download', () => {
        useAnimeStore.setState({ jobs: [makeAnimeJob({ status: 'done', percent: 100 })] });
        render(<AnimeJobs />);
        expect(screen.queryByRole('button', { name: 'CANCEL' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'RETRY' })).not.toBeInTheDocument();
        expect(screen.getByText('DOWNLOADED')).toHaveClass('badge--done');
    });

    it('explains an error, and opens the window with the raw text when it is clicked', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ jobs: [makeAnimeJob({ status: 'error', error: { code: 'NO_SOURCES', raw: 'No sources found for sub!', details: { occurredAt: 1700000000000, exitCode: 1, operation: 'Downloading an episode with ani-cli' } } })] });
        render(<AnimeJobs />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('No video source was found for this episode.');
        expect(alert).not.toHaveAttribute('title');
        const dialog = await openErrorDialog(user, 'No video source was found for this episode.');
        expect(within(dialog).getByTestId('error-message')).toHaveTextContent('No sources found for sub!');
        expect(within(dialog).getByText('Downloading an episode with ani-cli')).toBeInTheDocument();
        expect(within(dialog).getByText('NO_SOURCES')).toBeInTheDocument();
        expect(within(dialog).getByText('1')).toBeInTheDocument();
    });

    it('clears the finished downloads only when there are some', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ jobs: [makeAnimeJob({ status: 'running' })] });
        const { rerender } = render(<AnimeJobs />);
        expect(screen.queryByRole('button', { name: 'CLEAR FAILED' })).not.toBeInTheDocument();

        useAnimeStore.setState({ jobs: [makeAnimeJob({ status: 'running' }), makeAnimeJob({ episodeId: 2, status: 'done' })] });
        rerender(<AnimeJobs />);
        await user.click(screen.getByRole('button', { name: 'CLEAR FAILED' }));
        expect(mock.api.clearFinishedAnimeJobs).not.toHaveBeenCalled();
        await answerDialog(user, 'Clear the failed ones?', 'CLEAR FAILED');
        expect(mock.api.clearFinishedAnimeJobs).toHaveBeenCalledTimes(1);
    });

    it('keeps the downloads going and the finished ones listed when the user goes back or keeps them', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ jobs: [makeAnimeJob({ episodeId: 7, status: 'running' }), makeAnimeJob({ episodeId: 2, status: 'done' })] });
        render(<AnimeJobs />);
        await user.click(screen.getByRole('button', { name: 'CANCEL' }));
        await answerDialog(user, 'Cancel this download?', 'BACK');
        await user.click(screen.getByRole('button', { name: 'CLEAR FAILED' }));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(mock.api.cancelAnimeJob).not.toHaveBeenCalled();
        expect(mock.api.clearFinishedAnimeJobs).not.toHaveBeenCalled();
    });

    it.each(['error', 'cancelled'] as const)('offers CLEAR FAILED for a download that is %s, and no button called CLEAR FINISHED', (status) => {
        useAnimeStore.setState({ jobs: [makeAnimeJob({ status })] });
        render(<AnimeJobs />);
        expect(screen.getByRole('button', { name: 'CLEAR FAILED' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'CLEAR FINISHED' })).not.toBeInTheDocument();
    });
});

describe('AnimeJobs pause and resume', () => {
    it('offers PAUSE for a download that is going on, and pauses it by the episode', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ jobs: [makeAnimeJob({ episodeId: 7, status: 'running' })] });
        render(<AnimeJobs />);

        await user.click(screen.getByRole('button', { name: 'PAUSE' }));

        expect(mock.api.pauseAnimeJob).toHaveBeenCalledTimes(1);
        expect(mock.api.pauseAnimeJob).toHaveBeenCalledWith(7);
        expect(screen.getByRole('button', { name: 'CANCEL' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'RESUME' })).not.toBeInTheDocument();
    });

    it.each(['queued', 'done', 'error', 'cancelled'] as const)('does not offer PAUSE for a download that is %s', (status) => {
        useAnimeStore.setState({ jobs: [makeAnimeJob({ status })] });
        render(<AnimeJobs />);

        expect(screen.queryByRole('button', { name: 'PAUSE' })).not.toBeInTheDocument();
    });

    it('shows a paused download as PAUSED, with its progress, and offers RESUME and CANCEL', async () => {
        const user = userEvent.setup();
        useAnimeStore.setState({ jobs: [makeAnimeJob({ episodeId: 9, status: 'paused', percent: 61.5, speed: '', eta: '' })] });
        render(<AnimeJobs />);

        const job = screen.getByTestId('anime-job');
        expect(job).toHaveClass('job', 'job--paused');
        expect(within(job).getByText('PAUSED')).toHaveClass('badge', 'badge--paused');
        expect(within(job).getByText('61.5%')).toBeInTheDocument();
        await user.click(within(job).getByRole('button', { name: 'RESUME' }));
        expect(mock.api.resumeAnimeJob).toHaveBeenCalledTimes(1);
        expect(mock.api.resumeAnimeJob).toHaveBeenCalledWith(9);
        await user.click(within(job).getByRole('button', { name: 'CANCEL' }));
        await answerDialog(user, 'Cancel this download?', 'CANCEL');
        expect(mock.api.cancelAnimeJob).toHaveBeenCalledWith(9);
        expect(within(job).queryByRole('button', { name: 'PAUSE' })).not.toBeInTheDocument();
        expect(within(job).queryByRole('button', { name: 'RETRY' })).not.toBeInTheDocument();
    });

    it('does not offer RESUME for a download that is not paused', () => {
        useAnimeStore.setState({ jobs: [makeAnimeJob({ status: 'running' })] });
        render(<AnimeJobs />);

        expect(screen.queryByRole('button', { name: 'RESUME' })).not.toBeInTheDocument();
    });

    it('orders the paused downloads after the running ones and before the waiting ones', () => {
        useAnimeStore.setState({
            jobs: [
                makeAnimeJob({ episodeId: 1, episode: '1', status: 'queued' }),
                makeAnimeJob({ episodeId: 2, episode: '2', status: 'paused' }),
                makeAnimeJob({ episodeId: 3, episode: '3', status: 'running' }),
                makeAnimeJob({ episodeId: 4, episode: '4', status: 'done' })
            ]
        });
        render(<AnimeJobs />);

        expect(
            screen.getAllByRole('heading', { level: 3 }).map((heading) => {
                return heading.textContent;
            })
        ).toEqual(['Naruto · EP 3', 'Naruto · EP 2', 'Naruto · EP 1', 'Naruto · EP 4']);
    });

    it('does not count a paused download as finished for the button that clears them', () => {
        useAnimeStore.setState({ jobs: [makeAnimeJob({ status: 'paused' })] });
        render(<AnimeJobs />);

        expect(screen.queryByRole('button', { name: 'CLEAR FAILED' })).not.toBeInTheDocument();
    });
});

describe('AnimeJobs: the episode downloading', () => {
    it('shows the running episode big at the top, with its anime, the episode and how many wait', () => {
        useAnimeStore.setState({ jobs: [makeAnimeJob({ episodeId: 1, status: 'running', animeTitle: 'Naruto', episode: '3', percent: 10, speed: '2.00MiB/s', eta: '01:00' }), makeAnimeJob({ episodeId: 2, status: 'queued' })] });
        render(<AnimeJobs />);
        const hero = screen.getByTestId('download-hero');
        expect(hero.querySelector('.download-hero__title')).toHaveAttribute('data-text', 'Naruto');
        expect(hero.querySelector('.download-hero__detail')).toHaveAttribute('data-text', 'EP 3');
        expect(Array.from(hero.querySelectorAll('.download-hero__value')).map((value) => {
            return value.getAttribute('data-text');
        })).toEqual(['2.00MiB/s', '01:00']);
        expect(hero.querySelector('.download-hero__next')).toHaveTextContent('UP NEXT: 1');
        expect(hero.querySelector('.download-hero__art .cover')).not.toBeNull();
    });

    it('has no banner while no episode downloads', () => {
        useAnimeStore.setState({ jobs: [makeAnimeJob({ status: 'paused' })] });
        render(<AnimeJobs />);
        expect(screen.queryByTestId('download-hero')).not.toBeInTheDocument();
    });
});
