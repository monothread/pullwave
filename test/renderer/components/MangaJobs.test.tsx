// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
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
    useMangaStore.setState({ ...initialManga, jobs: [], queueHeld: false });
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

    describe('the bar of a download', () => {
        let frames: Array<(time: number) => void>;

        beforeEach(() => {
            frames = [];
            vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
                frames.push(callback);
                return frames.length;
            });
            vi.stubGlobal('cancelAnimationFrame', (id: number) => {
                frames[id - 1] = () => {
                    return undefined;
                };
            });
            vi.stubGlobal('matchMedia', () => {
                return { matches: false };
            });
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        function width(): number {
            const bar = screen.getByRole('progressbar').firstElementChild as HTMLElement;
            return parseFloat(bar.style.width);
        }

        function frame(time: number): void {
            const pending = frames.splice(0);
            act(() => {
                pending.forEach((callback) => {
                    callback(time);
                });
            });
        }

        it('has the neon bar, which the screen moves itself', () => {
            useMangaStore.setState({ jobs: [makeMangaJob({ percent: 10 })] });
            render(<MangaJobs />);
            const bar = screen.getByRole('progressbar');
            expect(bar).toHaveClass('progress');
            expect(bar.firstElementChild).toHaveClass('progress__bar', 'progress__bar--smooth');
        });

        it('glides to the next page instead of jumping to it, and says the real value to the screen readers', () => {
            useMangaStore.setState({ jobs: [makeMangaJob({ percent: 10, pagesDone: 4, pageCount: 40 })] });
            render(<MangaJobs />);
            expect(width()).toBe(10);
            act(() => {
                useMangaStore.setState({ jobs: [makeMangaJob({ percent: 60, pagesDone: 24, pageCount: 40 })] });
            });
            expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');
            expect(screen.getByText('60.0%')).toBeInTheDocument();
            expect(width()).toBe(10);
            frame(0);
            frame(100);
            const first = width();
            expect(first).toBeGreaterThan(10);
            expect(first).toBeLessThan(60);
            frame(200);
            expect(width()).toBeGreaterThan(first);
            expect(width()).toBeLessThan(60);
            frame(10_000);
            expect(width()).toBe(60);
        });
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
        expect(within(alert).getByRole('button')).toHaveAttribute('title', 'Click to copy the technical error');
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

    it.each(['running', 'queued'] as const)('offers PAUSE ALL when a download is %s, and not RESUME ALL', async (status) => {
        const user = userEvent.setup();
        useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 5, status })] });
        render(<MangaJobs />);
        expect(screen.queryByRole('button', { name: 'RESUME ALL' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'PAUSE ALL' }));
        expect(mock.api.manga.pauseAll).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.resumeAll).not.toHaveBeenCalled();
    });

    it('offers RESUME ALL when a download is paused, and not PAUSE ALL', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 6, status: 'paused' })] });
        render(<MangaJobs />);
        expect(screen.queryByRole('button', { name: 'PAUSE ALL' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'RESUME ALL' }));
        expect(mock.api.manga.resumeAll).toHaveBeenCalledTimes(1);
        expect(mock.api.manga.pauseAll).not.toHaveBeenCalled();
    });

    it('offers RESUME ALL and not PAUSE ALL in a held queue where the downloads wait, and says they start with it', async () => {
        const user = userEvent.setup();
        useMangaStore.setState({ queueHeld: true, jobs: [makeMangaJob({ chapterId: 5, status: 'queued' })] });
        render(<MangaJobs />);
        expect(screen.queryByRole('button', { name: 'PAUSE ALL' })).not.toBeInTheDocument();
        expect(screen.getByText('The downloads are paused: the chapters that wait start with RESUME ALL.')).toBeInTheDocument();
        expect(screen.getByText('Waiting')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'RESUME ALL' }));
        expect(mock.api.manga.resumeAll).toHaveBeenCalledTimes(1);
    });

    it('offers PAUSE ALL in a held queue for a download resumed by itself, and RESUME ALL too', () => {
        useMangaStore.setState({ queueHeld: true, jobs: [makeMangaJob({ chapterId: 1, status: 'running' }), makeMangaJob({ chapterId: 2, status: 'queued' })] });
        render(<MangaJobs />);
        expect(screen.getByRole('button', { name: 'PAUSE ALL' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'RESUME ALL' })).toBeEnabled();
    });

    it('offers RESUME ALL in a held queue without downloads that wait, and does not say anything about them', () => {
        useMangaStore.setState({ queueHeld: true, jobs: [makeMangaJob({ chapterId: 1, status: 'error' })] });
        render(<MangaJobs />);
        expect(screen.getByRole('button', { name: 'RESUME ALL' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'PAUSE ALL' })).not.toBeInTheDocument();
        expect(screen.queryByText(/The downloads are paused/)).not.toBeInTheDocument();
    });

    it('does not say the downloads are paused when the queue is not held', () => {
        useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 1, status: 'queued' })] });
        render(<MangaJobs />);
        expect(screen.queryByText(/The downloads are paused/)).not.toBeInTheDocument();
    });

    it('offers both when some are going on and some are paused', () => {
        useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 1, status: 'running' }), makeMangaJob({ chapterId: 2, status: 'paused' })] });
        render(<MangaJobs />);
        expect(screen.getByRole('button', { name: 'PAUSE ALL' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'RESUME ALL' })).toBeEnabled();
    });

    it.each(['done', 'error', 'cancelled'] as const)('offers neither when the only download is %s', (status) => {
        useMangaStore.setState({ jobs: [makeMangaJob({ chapterId: 1, status })] });
        render(<MangaJobs />);
        expect(screen.queryByRole('button', { name: 'PAUSE ALL' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'RESUME ALL' })).not.toBeInTheDocument();
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
