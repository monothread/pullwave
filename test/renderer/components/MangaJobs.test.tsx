// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { MangaErrorCode } from '@shared/manga';
import { MangaJobs } from '@renderer/components/MangaJobs';
import { useAppStore } from '@renderer/store/appStore';
import { useMangaStore } from '@renderer/store/mangaStore';
import { makeMangaJob } from '../../helpers/mangaFixtures';
import { installMockApi, type MockApiHandle } from '../../helpers/mockApi';

let mock: MockApiHandle;
const initialApp = useAppStore.getState();
const initialManga = useMangaStore.getState();

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initialApp, settings: DEFAULT_SETTINGS });
    useMangaStore.setState({ ...initialManga, jobs: [] });
});

describe('MangaJobs', () => {
    it('says there are no downloads', () => {
        render(<MangaJobs />);
        expect(screen.getByText('No downloads going on.')).toBeInTheDocument();
        expect(screen.queryByTestId('manga-job')).not.toBeInTheDocument();
    });

    it('shows the title, the progress and the pages of a running download', () => {
        useMangaStore.setState({ jobs: [makeMangaJob({ percent: 42.5, pagesDone: 17, pageCount: 40 })] });
        render(<MangaJobs />);
        const job = screen.getByTestId('manga-job');
        expect(job).toHaveClass('job', 'job--running');
        expect(within(job).getByRole('heading', { name: 'One Piece · Romance Dawn' })).toBeInTheDocument();
        expect(within(job).getByText('Downloading')).toHaveClass('badge--running');
        const bar = within(job).getByRole('progressbar', { name: 'One Piece · Romance Dawn' });
        expect(bar).toHaveAttribute('aria-valuenow', '43');
        expect(bar.firstElementChild).toHaveStyle({ width: '42.5%' });
        expect(within(job).getByText('42.5%')).toBeInTheDocument();
        expect(within(job).getByText('17 of 40 pages')).toBeInTheDocument();
        expect(screen.getByText('DOWNLOADS (1)', { selector: '.section-label' })).toBeInTheDocument();
    });

    it('leaves the pages out until the number of pages is known', () => {
        useMangaStore.setState({ jobs: [makeMangaJob({ status: 'queued', percent: 0, pagesDone: 0, pageCount: 0 })] });
        render(<MangaJobs />);
        expect(screen.getByTestId('manga-job').querySelector('.job__meta')?.textContent).toBe('0.0%');
        expect(screen.getByText('Waiting')).toHaveClass('badge--queued');
    });

    it('orders the downloads: running, paused, waiting, failed, cancelled, done', () => {
        useMangaStore.setState({
            jobs: (['done', 'cancelled', 'error', 'queued', 'paused', 'running'] as const).map((status, index) => {
                return makeMangaJob({ chapterId: index + 1, chapterName: status, status });
            })
        });
        render(<MangaJobs />);
        expect(
            screen.getAllByTestId('manga-job').map((job) => {
                return within(job).getByRole('heading').textContent;
            })
        ).toEqual(['One Piece · running', 'One Piece · paused', 'One Piece · queued', 'One Piece · error', 'One Piece · cancelled', 'One Piece · done']);
    });

    it.each([
        ['REQUEST_FAILED', 'The request to the manga server failed.'],
        ['EMPTY_CHAPTER', 'The chapter has no pages.'],
        ['IMAGE', 'A page is not a valid image.'],
        ['DISK', 'The chapter could not be saved on the disk.']
    ] as Array<[MangaErrorCode, string]>)('explains a failure %s, with the details a hover away', (code, text) => {
        useMangaStore.setState({ jobs: [makeMangaJob({ status: 'error', error: { code, message: 'raw detail' } })] });
        render(<MangaJobs />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(text);
        expect(alert).toHaveAttribute('title', 'raw detail');
    });

    it('pauses and cancels a running download', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 5, status: 'running' })] });
        render(<MangaJobs />);
        expect(screen.queryByRole('button', { name: 'RESUME' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'RETRY' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'PAUSE' }));
        await user.click(screen.getByRole('button', { name: 'CANCEL' }));
        expect(mock.api.manga.pause).toHaveBeenCalledWith(5);
        expect(mock.api.manga.cancel).toHaveBeenCalledWith(5);
    });

    it('resumes and cancels a paused download', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 6, status: 'paused' })] });
        render(<MangaJobs />);
        expect(screen.queryByRole('button', { name: 'PAUSE' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'RESUME' }));
        await user.click(screen.getByRole('button', { name: 'CANCEL' }));
        expect(mock.api.manga.resume).toHaveBeenCalledWith(6);
        expect(mock.api.manga.cancel).toHaveBeenCalledWith(6);
    });

    it('can only cancel a download that waits', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 7, status: 'queued' })] });
        render(<MangaJobs />);
        expect(screen.queryByRole('button', { name: 'PAUSE' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'CANCEL' }));
        expect(mock.api.manga.cancel).toHaveBeenCalledWith(7);
    });

    it.each(['error', 'cancelled'] as const)('retries a download that is %s, and has nothing else to offer', async (status) => {
        const user = userEvent.setup();
        useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 8, status })] });
        render(<MangaJobs />);
        expect(screen.queryByRole('button', { name: 'CANCEL' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'RETRY' }));
        expect(mock.api.manga.retry).toHaveBeenCalledWith(8);
    });

    it('clears the downloads that are over only when there are some', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 1, status: 'running' })] });
        const { rerender } = render(<MangaJobs />);
        expect(screen.queryByRole('button', { name: 'CLEAR FINISHED' })).not.toBeInTheDocument();
        useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 1, status: 'running' }), makeMangaJob({ chapterId: 2, status: 'error' })] });
        rerender(<MangaJobs />);
        await user.click(screen.getByRole('button', { name: 'CLEAR FINISHED' }));
        expect(mock.api.manga.clearFinished).toHaveBeenCalledTimes(1);
        expect(useMangaStore.getState().jobs.map((job) => {
            return job.chapterId;
        })).toEqual([1]);
    });
});

describe('MangaJobs trying the failed ones again', () => {
    it('counts the downloads that failed or were cancelled on a button that tries them all again', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({
            jobs: [
                makeMangaJob({ chapterId: 1, status: 'error' }),
                makeMangaJob({ chapterId: 2, status: 'cancelled' }),
                makeMangaJob({ chapterId: 3, status: 'running' }),
                makeMangaJob({ chapterId: 4, status: 'queued' })
            ]
        });
        render(<MangaJobs />);
        await user.click(screen.getByRole('button', { name: 'RETRY FAILED (2)' }));
        expect(mock.api.manga.retry.mock.calls).toEqual([[1], [2]]);
    });

    it('has no such button when nothing failed', () => {
        useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 3, status: 'running' }), makeMangaJob({ chapterId: 4, status: 'paused' })] });
        render(<MangaJobs />);
        expect(screen.queryByRole('button', { name: /RETRY FAILED/ })).not.toBeInTheDocument();
    });
});
