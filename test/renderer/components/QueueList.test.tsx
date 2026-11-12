// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { QueueList } from '@renderer/components/QueueList';
import { useAppStore } from '@renderer/store/appStore';
import { answerDialog, confirmDialog } from '../../helpers/confirmDialog';
import { installMockApi, makeJob, type MockApiHandle } from '../../helpers/mockApi';
import { seeEnd, stubIntersectionObserver, type ObservedEnd } from '../../helpers/intersectionObserver';

let mock: MockApiHandle;
const initial = useAppStore.getState();

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initial, jobs: [], settings: DEFAULT_SETTINGS });
});

describe('QueueList', () => {
    it('shows an empty state without jobs', () => {
        render(<QueueList />);
        expect(screen.getByText('// NO ACTIVE DOWNLOADS. JACK IN A URL ABOVE.')).toBeInTheDocument();
    });

    it('renders a card per job and the count', () => {
        useAppStore.setState({ jobs: [makeJob({ id: 'a', title: 'First' }), makeJob({ id: 'b', title: 'Second' })] });
        render(<QueueList />);
        expect(screen.getByText('QUEUE [2]')).toBeInTheDocument();
        expect(screen.getAllByTestId('job-card')).toHaveLength(2);
        expect(screen.getByRole('heading', { name: 'First' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Second' })).toBeInTheDocument();
    });

    const titlesOnScreen = (): Array<string | null> => {
        return screen.getAllByRole('heading', { level: 3 }).map((heading) => {
            return heading.textContent;
        });
    };

    it('shows the newest download on top and the oldest at the bottom among downloads in the same state', () => {
        useAppStore.setState({
            jobs: [makeJob({ id: 'a', title: 'Oldest', status: 'done' }), makeJob({ id: 'b', title: 'Middle', status: 'done' }), makeJob({ id: 'c', title: 'Newest', status: 'done' })]
        });
        render(<QueueList />);
        expect(titlesOnScreen()).toEqual(['Newest', 'Middle', 'Oldest']);
    });

    it('puts what is running above what waits and what is over, whatever the order they were added in', () => {
        useAppStore.setState({
            jobs: [
                makeJob({ id: 'a', title: 'Finished early', status: 'done' }),
                makeJob({ id: 'b', title: 'Running early', status: 'running' }),
                makeJob({ id: 'c', title: 'Waiting', status: 'queued' }),
                makeJob({ id: 'd', title: 'Failed', status: 'error' }),
                makeJob({ id: 'e', title: 'Running late', status: 'running', percent: 100, postProcess: 'ExtractAudio' }),
                makeJob({ id: 'f', title: 'Cancelled', status: 'cancelled' })
            ]
        });
        render(<QueueList />);
        expect(titlesOnScreen()).toEqual(['Running late', 'Running early', 'Waiting', 'Cancelled', 'Failed', 'Finished early']);
    });

    it('moves a download below the active ones when it completes', () => {
        useAppStore.setState({ jobs: [makeJob({ id: 'a', title: 'First', status: 'running' }), makeJob({ id: 'b', title: 'Second', status: 'running' })] });
        render(<QueueList />);
        expect(titlesOnScreen()).toEqual(['Second', 'First']);
        act(() => {
            useAppStore.setState({ jobs: [makeJob({ id: 'a', title: 'First', status: 'running' }), makeJob({ id: 'b', title: 'Second', status: 'done' })] });
        });
        expect(titlesOnScreen()).toEqual(['First', 'Second']);
    });

    it('puts a download that was just added above the ones already listed in the same state', () => {
        useAppStore.setState({ jobs: [makeJob({ id: 'a', title: 'Old', status: 'queued' })] });
        render(<QueueList />);
        act(() => {
            useAppStore.setState({ jobs: [makeJob({ id: 'a', title: 'Old', status: 'queued' }), makeJob({ id: 'b', title: 'Fresh', status: 'queued' })] });
        });
        expect(titlesOnScreen()).toEqual(['Fresh', 'Old']);
    });

    it('does not change the order of the jobs in the store', () => {
        const jobs = [makeJob({ id: 'a', title: 'First', status: 'done' }), makeJob({ id: 'b', title: 'Second', status: 'running' })];
        useAppStore.setState({ jobs });
        render(<QueueList />);
        expect(
            useAppStore.getState().jobs.map((job) => {
                return job.id;
            })
        ).toEqual(['a', 'b']);
    });

    it('hides clear finished while every job is active', () => {
        useAppStore.setState({ jobs: [makeJob({ status: 'running' }), makeJob({ id: 'q', status: 'queued' })] });
        render(<QueueList />);
        expect(screen.queryByRole('button', { name: 'CLEAR FINISHED' })).not.toBeInTheDocument();
    });

    it.each(['done', 'error', 'cancelled'] as const)('shows clear finished when a job is %s', async (status) => {
        useAppStore.setState({ jobs: [makeJob({ status })] });
        render(<QueueList />);
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'CLEAR FINISHED' }));
        expect(mock.api.clearFinished).not.toHaveBeenCalled();
        expect(within(confirmDialog('Clear the finished ones?')).getByText('Only the list goes. Files already saved stay on the disk.')).toBeInTheDocument();
        await answerDialog(user, 'Clear the finished ones?', 'CLEAR FINISHED');
        expect(mock.api.clearFinished).toHaveBeenCalledTimes(1);
    });

    it('keeps the finished jobs when the user keeps them or presses Esc', async () => {
        const user = userEvent.setup();
        useAppStore.setState({ jobs: [makeJob({ status: 'done' })] });
        render(<QueueList />);
        await user.click(screen.getByRole('button', { name: 'CLEAR FINISHED' }));
        await answerDialog(user, 'Clear the finished ones?', 'KEEP');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'CLEAR FINISHED' }));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(mock.api.clearFinished).not.toHaveBeenCalled();
    });

    it('wires card actions to the API', async () => {
        const user = userEvent.setup();
        useAppStore.setState({
            // Shown running first, then the finished ones newest first: `cards` is run, done, cancelled.
            jobs: [
                makeJob({ id: 'cancelled', status: 'cancelled' }),
                makeJob({ id: 'done', status: 'done', filePath: '/d/x.mp4' }),
                makeJob({ id: 'run', status: 'running' })
            ]
        });
        render(<QueueList />);
        const cards = screen.getAllByTestId('job-card');
        await user.click(within(cards[0] as HTMLElement).getByRole('button', { name: 'CANCEL' }));
        expect(mock.api.cancelJob).not.toHaveBeenCalled();
        await answerDialog(user, 'Cancel this download?', 'CANCEL');
        expect(mock.api.cancelJob).toHaveBeenCalledWith('run');
        await user.click(within(cards[1] as HTMLElement).getByRole('button', { name: 'SHOW FILE' }));
        expect(mock.api.showItemInFolder).toHaveBeenCalledWith('/d/x.mp4');
        await user.click(within(cards[1] as HTMLElement).getByRole('button', { name: 'REMOVE' }));
        expect(mock.api.removeJob).not.toHaveBeenCalled();
        await answerDialog(user, 'Remove this download from the list?', 'REMOVE');
        expect(mock.api.removeJob).toHaveBeenCalledWith('done');
        await user.click(within(cards[2] as HTMLElement).getByRole('button', { name: 'RETRY' }));
        expect(mock.api.retryJob).toHaveBeenCalledWith('cancelled');
    });

    it('wires CLEAR PARTIAL FILES to the API', async () => {
        useAppStore.setState({ jobs: [makeJob({ id: 'failed', status: 'cancelled', hasPartial: true })] });
        render(<QueueList />);
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'CLEAR PARTIAL FILES' }));
        expect(mock.api.clearPartialFiles).not.toHaveBeenCalled();
        await answerDialog(user, 'Delete the partial files?', 'CLEAR PARTIAL FILES');
        expect(mock.api.clearPartialFiles).toHaveBeenCalledTimes(1);
        expect(mock.api.clearPartialFiles).toHaveBeenCalledWith('failed');
    });

    it('wires STOP & SAVE of a live recording to the API', async () => {
        useAppStore.setState({ jobs: [makeJob({ id: 'live-1', status: 'running', live: true, elapsedSeconds: 5, downloadedBytes: 1024 })] });
        render(<QueueList />);
        await userEvent.setup().click(screen.getByRole('button', { name: 'STOP & SAVE' }));
        expect(mock.api.stopJob).toHaveBeenCalledWith('live-1');
        expect(mock.api.cancelJob).not.toHaveBeenCalled();
    });
});

describe('QueueList pause and resume', () => {
    it('pauses a download through the store when its PAUSE is pressed', async () => {
        const user = userEvent.setup();
        useAppStore.setState({ jobs: [makeJob({ id: 'a', status: 'running' })] });
        render(<QueueList />);

        await user.click(screen.getByRole('button', { name: 'PAUSE' }));

        expect(mock.api.pauseJob).toHaveBeenCalledTimes(1);
        expect(mock.api.pauseJob).toHaveBeenCalledWith('a');
        expect(mock.api.resumeJob).not.toHaveBeenCalled();
    });

    it('resumes a download through the store when its RESUME is pressed', async () => {
        const user = userEvent.setup();
        useAppStore.setState({ jobs: [makeJob({ id: 'a', status: 'paused' })] });
        render(<QueueList />);

        await user.click(screen.getByRole('button', { name: 'RESUME' }));

        expect(mock.api.resumeJob).toHaveBeenCalledTimes(1);
        expect(mock.api.resumeJob).toHaveBeenCalledWith('a');
        expect(mock.api.pauseJob).not.toHaveBeenCalled();
    });

    it('shows what is paused after what is running and before what waits', () => {
        useAppStore.setState({
            jobs: [
                makeJob({ id: 'a', title: 'Waiting', status: 'queued' }),
                makeJob({ id: 'b', title: 'Paused', status: 'paused' }),
                makeJob({ id: 'c', title: 'Running', status: 'running' }),
                makeJob({ id: 'd', title: 'Done', status: 'done' })
            ]
        });
        render(<QueueList />);

        expect(
            screen.getAllByRole('heading', { level: 3 }).map((heading) => {
                return heading.textContent;
            })
        ).toEqual(['Running', 'Paused', 'Waiting', 'Done']);
    });

    it('does not offer to clear the finished ones because of a paused download', () => {
        useAppStore.setState({ jobs: [makeJob({ id: 'a', status: 'paused' })] });
        render(<QueueList />);

        expect(screen.queryByRole('button', { name: 'CLEAR FINISHED' })).not.toBeInTheDocument();
    });
});

describe('QueueList: the download going on', () => {
    it('shows the first running download big at the top, with how many wait after it', () => {
        useAppStore.setState({
            jobs: [
                makeJob({ id: 'r', status: 'running', title: 'Running video', percent: 40, speed: '1.00MiB/s', eta: '00:20' }),
                makeJob({ id: 'q1', status: 'queued', title: 'Waiting one' }),
                makeJob({ id: 'q2', status: 'queued', title: 'Waiting two' })
            ]
        });
        render(<QueueList />);
        const hero = screen.getByTestId('download-hero');
        expect(hero.querySelector('.download-hero__title')).toHaveAttribute('data-text', 'Running video');
        expect(hero.querySelector('.download-hero__next')).toHaveTextContent('UP NEXT: 2');
        expect(hero.querySelector('.download-hero__percent')).toHaveAttribute('data-text', '40%');
        // The card of the download is still there, with its title in words.
        expect(screen.getByRole('heading', { name: 'Running video' })).toBeInTheDocument();
    });

    it('shows the picture of the video in a wide box once the app has it, and the picture of the section until then', () => {
        useAppStore.setState({ jobs: [makeJob({ id: 'r', status: 'running', title: 'Running video' })] });
        const { rerender } = render(<QueueList />);
        let hero = screen.getByTestId('download-hero');
        expect(hero).toHaveAttribute('class', 'download-hero');
        expect(hero.querySelector('.download-hero__art img')).toBeNull();
        expect(hero.querySelector('.download-hero__art .tile__generated svg')).toHaveClass('section-icon--downloads');
        act(() => {
            useAppStore.setState({ jobs: [makeJob({ id: 'r', status: 'running', title: 'Running video', thumbnail: 'pullwave-thumb://job/r?v=1' })] });
        });
        rerender(<QueueList />);
        hero = screen.getByTestId('download-hero');
        expect(hero).toHaveAttribute('class', 'download-hero download-hero--wide');
        const picture = hero.querySelector('.download-hero__art img');
        expect(picture).toHaveAttribute('src', 'pullwave-thumb://job/r?v=1');
        expect(picture).toHaveAttribute('class', 'cover download-hero__thumbnail');
        expect(picture).toHaveAttribute('alt', '');
    });

    it('names a download with no title by its link', () => {
        useAppStore.setState({ jobs: [makeJob({ id: 'r', status: 'running', title: null, url: 'https://example.com/v' })] });
        render(<QueueList />);
        expect(screen.getByTestId('download-hero').querySelector('.download-hero__title')).toHaveAttribute('data-text', 'https://example.com/v');
    });

    it.each([
        ['nothing runs', [makeJob({ id: 'q', status: 'queued' }), makeJob({ id: 'd', status: 'done' })]],
        ['the one running is a live recording', [makeJob({ id: 'l', status: 'running', live: true })]]
    ])('has no banner when %s', (_case, jobs) => {
        useAppStore.setState({ jobs });
        render(<QueueList />);
        expect(screen.queryByTestId('download-hero')).not.toBeInTheDocument();
    });
});

describe('QueueList with a long queue', () => {
    let observers: ObservedEnd[] = [];

    beforeEach(() => {
        observers = stubIntersectionObserver();
        useAppStore.setState({
            jobs: Array.from({ length: 70 }, (_unused, index) => {
                return makeJob({ id: `job-${String(index + 1)}`, title: `Video ${String(index + 1)}`, status: 'queued' });
            })
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function titles(): Array<string | null> {
        return screen.getAllByTestId('job-card').map((card) => {
            return within(card).getByRole('heading', { level: 3 }).textContent;
        });
    }

    it('draws the first 60 downloads in the order of the queue, counts all of them, and draws the others when the end comes into view', () => {
        render(<QueueList />);
        const first = titles();
        expect(first).toHaveLength(60);
        expect(screen.getByText('QUEUE [70]')).toBeInTheDocument();
        expect(screen.getByTestId('list-more')).toBeInTheDocument();
        seeEnd(observers);
        const all = titles();
        expect(all).toHaveLength(70);
        expect(all.slice(0, 60)).toEqual(first);
        expect([...all].sort()).toEqual(
            Array.from({ length: 70 }, (_unused, index) => {
                return `Video ${String(index + 1)}`;
            }).sort()
        );
        expect(screen.queryByTestId('list-more')).not.toBeInTheDocument();
    });
});
