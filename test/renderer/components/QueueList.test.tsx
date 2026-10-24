// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { QueueList } from '@renderer/components/QueueList';
import { useAppStore } from '@renderer/store/appStore';
import { answerDialog, confirmDialog } from '../../helpers/confirmDialog';
import { installMockApi, makeJob, type MockApiHandle } from '../../helpers/mockApi';

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
