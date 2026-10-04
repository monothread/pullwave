// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DownloadError, DownloadJob } from '@shared/types';
import { JobCard } from '@renderer/components/JobCard';
import { useAppStore } from '@renderer/store/appStore';
import { installMockApi, makeJob, type MockApiHandle } from '../../helpers/mockApi';

const ERROR: DownloadError = { code: 'UNAVAILABLE', title: 'Video unavailable', hint: 'Maybe private.', raw: 'ERROR: gone' };
const FORBIDDEN: DownloadError = { code: 'FORBIDDEN', title: 'Access refused by the server', hint: 'Expired?', raw: 'HTTP Error 403: Forbidden' };
const UNSUPPORTED: DownloadError = { code: 'OUTDATED', title: 'yt-dlp may be outdated', hint: 'Update.', raw: 'ERROR: Unsupported URL' };

let mock: MockApiHandle;
const initial = useAppStore.getState();

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({ ...initial, streamSearches: {} });
});

function makeHandlers() {
    return { onCancel: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onRetry: vi.fn(), onRemove: vi.fn(), onClearPartials: vi.fn(), onShowFile: vi.fn() };
}

function renderCard(job: DownloadJob) {
    const handlers = makeHandlers();
    render(<JobCard job={job} {...handlers} />);
    return handlers;
}

describe('JobCard', () => {
    it('shows title, status, progress, speed and ETA for a running job', () => {
        renderCard(makeJob());
        expect(screen.getByRole('heading', { name: 'Some Video' })).toBeInTheDocument();
        expect(screen.getByText('DOWNLOADING')).toBeInTheDocument();
        expect(screen.getByText('42.5%')).toBeInTheDocument();
        expect(screen.getByText('1.5MiB/s')).toBeInTheDocument();
        expect(screen.getByText('ETA 00:10')).toBeInTheDocument();
        const bar = screen.getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuenow', '43');
        expect(bar.firstElementChild).toHaveStyle({ width: '42.5%' });
    });

    it('falls back to the URL when there is no title', () => {
        renderCard(makeJob({ title: null }));
        expect(screen.getByRole('heading', { name: 'https://example.com/v' })).toBeInTheDocument();
    });

    it('omits speed and ETA when empty', () => {
        renderCard(makeJob({ speed: '', eta: '' }));
        expect(screen.queryByText(/ETA/)).not.toBeInTheDocument();
        expect(screen.queryByText('1.5MiB/s')).not.toBeInTheDocument();
    });

    it('offers cancel (only) for running and queued jobs', async () => {
        const user = userEvent.setup();
        const handlers = renderCard(makeJob({ status: 'running' }));
        await user.click(screen.getByRole('button', { name: 'CANCEL' }));
        expect(handlers.onCancel).toHaveBeenCalledWith('job-1');
        expect(screen.queryByRole('button', { name: 'REMOVE' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'RETRY' })).not.toBeInTheDocument();
    });

    it('offers cancel for queued jobs', () => {
        renderCard(makeJob({ status: 'queued' }));
        expect(screen.getByText('QUEUED')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'CANCEL' })).toBeInTheDocument();
    });

    it('offers show file and remove for done jobs', async () => {
        const user = userEvent.setup();
        const handlers = renderCard(makeJob({ status: 'done', percent: 100, filePath: '/d/Some Video.mp4' }));
        expect(screen.getByText('COMPLETE')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'SHOW FILE' }));
        expect(handlers.onShowFile).toHaveBeenCalledWith('/d/Some Video.mp4');
        await user.click(screen.getByRole('button', { name: 'REMOVE' }));
        expect(handlers.onRemove).toHaveBeenCalledWith('job-1');
        expect(screen.queryByRole('button', { name: 'CANCEL' })).not.toBeInTheDocument();
    });

    it('does not offer show file for a done job without a path', () => {
        renderCard(makeJob({ status: 'done', filePath: null }));
        expect(screen.queryByRole('button', { name: 'SHOW FILE' })).not.toBeInTheDocument();
    });

    it('shows the error banner and retries through it for failed jobs', async () => {
        const user = userEvent.setup();
        const handlers = renderCard(makeJob({ status: 'error', error: ERROR }));
        expect(screen.getByText('FAILED')).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Video unavailable');
        expect(screen.getAllByRole('button', { name: 'RETRY' })).toHaveLength(1);
        await user.click(screen.getByRole('button', { name: 'RETRY' }));
        expect(handlers.onRetry).toHaveBeenCalledWith('job-1');
        await user.click(screen.getByRole('button', { name: 'REMOVE' }));
        expect(handlers.onRemove).toHaveBeenCalledWith('job-1');
    });

    describe('a paused download whose unfinished files are gone', () => {
        const NOTICE = 'The unfinished files were not found: RESUME starts this download over.';

        it('says that RESUME starts it over when no unfinished file was found', () => {
            renderCard(makeJob({ status: 'paused', hasPartial: false }));
            expect(screen.getByText(NOTICE)).toHaveClass('field__hint');
            expect(screen.getByRole('button', { name: 'RESUME' })).toBeInTheDocument();
        });

        it.each([
            ['a paused download with its unfinished files', { status: 'paused' as const, hasPartial: true }],
            ['a running download without files yet', { status: 'running' as const, hasPartial: false }],
            ['a cancelled download without files', { status: 'cancelled' as const, hasPartial: false }]
        ])('says nothing for %s', (_case, overrides) => {
            renderCard(makeJob(overrides));
            expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
        });
    });

    describe('partial files', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('offers to clear them on a failed or cancelled download that left some', async () => {
            const user = userEvent.setup();
            const handlers = renderCard(makeJob({ status: 'error', error: ERROR, hasPartial: true }));
            await user.click(screen.getByRole('button', { name: 'CLEAR PARTIAL FILES' }));
            expect(handlers.onClearPartials).toHaveBeenCalledTimes(1);
            expect(handlers.onClearPartials).toHaveBeenCalledWith('job-1');
        });

        it('offers it for a cancelled download too', () => {
            renderCard(makeJob({ status: 'cancelled', hasPartial: true }));
            expect(screen.getByRole('button', { name: 'CLEAR PARTIAL FILES' })).toBeInTheDocument();
        });

        it.each([
            ['a failed download without partial files', { status: 'error' as const, error: ERROR, hasPartial: false }],
            ['a running download', { status: 'running' as const, hasPartial: true }],
            ['a finished download', { status: 'done' as const, hasPartial: true, filePath: '/d/x.mp4' }]
        ])('does not offer it for %s', (_case, overrides) => {
            renderCard(makeJob(overrides));
            expect(screen.queryByRole('button', { name: 'CLEAR PARTIAL FILES' })).not.toBeInTheDocument();
        });

        it('does not ask anything before clearing or removing an ordinary download', async () => {
            const confirm = vi.spyOn(window, 'confirm');
            const user = userEvent.setup();
            const handlers = renderCard(makeJob({ status: 'error', error: ERROR, hasPartial: true }));
            await user.click(screen.getByRole('button', { name: 'CLEAR PARTIAL FILES' }));
            await user.click(screen.getByRole('button', { name: 'REMOVE' }));
            expect(confirm).not.toHaveBeenCalled();
            expect(handlers.onClearPartials).toHaveBeenCalledTimes(1);
            expect(handlers.onRemove).toHaveBeenCalledTimes(1);
        });

        it('asks first and deletes a live recording only when confirmed', async () => {
            const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
            const user = userEvent.setup();
            const handlers = renderCard(makeJob({ status: 'error', error: ERROR, live: true, hasPartial: true }));
            await user.click(screen.getByRole('button', { name: 'CLEAR PARTIAL FILES' }));
            expect(confirm).toHaveBeenCalledWith('This live recording was not saved. Deleting it cannot be undone. Delete it?');
            expect(handlers.onClearPartials).toHaveBeenCalledWith('job-1');
            await user.click(screen.getByRole('button', { name: 'REMOVE' }));
            expect(confirm).toHaveBeenCalledTimes(2);
            expect(handlers.onRemove).toHaveBeenCalledWith('job-1');
        });

        it('keeps a live recording when the user declines', async () => {
            const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
            const user = userEvent.setup();
            const handlers = renderCard(makeJob({ status: 'error', error: ERROR, live: true, hasPartial: true }));
            await user.click(screen.getByRole('button', { name: 'CLEAR PARTIAL FILES' }));
            await user.click(screen.getByRole('button', { name: 'REMOVE' }));
            expect(confirm).toHaveBeenCalledTimes(2);
            expect(handlers.onClearPartials).not.toHaveBeenCalled();
            expect(handlers.onRemove).not.toHaveBeenCalled();
        });

        it('removes a live card without partial files without asking', async () => {
            const confirm = vi.spyOn(window, 'confirm');
            const user = userEvent.setup();
            const handlers = renderCard(makeJob({ status: 'done', live: true, hasPartial: false, filePath: '/d/live.mp4' }));
            await user.click(screen.getByRole('button', { name: 'REMOVE' }));
            expect(confirm).not.toHaveBeenCalled();
            expect(handlers.onRemove).toHaveBeenCalledWith('job-1');
        });
    });

    it('offers a retry button for cancelled jobs without an error', async () => {
        const user = userEvent.setup();
        const handlers = renderCard(makeJob({ status: 'cancelled' }));
        expect(screen.getByText('CANCELLED')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'RETRY' }));
        expect(handlers.onRetry).toHaveBeenCalledWith('job-1');
    });

    describe('live recording', () => {
        const live = (overrides: Partial<DownloadJob> = {}) => {
            return makeJob({ status: 'running', live: true, percent: 0, title: 'Live Show', elapsedSeconds: 754, downloadedBytes: 220200960, speed: '1.2MiB/s', ...overrides });
        };

        it('shows that it is recording, for how long and how much was written, instead of a percentage', () => {
            renderCard(live());
            expect(screen.getByText('RECORDING')).toBeInTheDocument();
            expect(screen.getByText('● LIVE')).toBeInTheDocument();
            expect(screen.getByText('12:34')).toBeInTheDocument();
            expect(screen.getByText('210.0 MiB')).toBeInTheDocument();
            expect(screen.getByText('1.2MiB/s')).toBeInTheDocument();
            expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
            expect(screen.queryByText('DOWNLOADING')).not.toBeInTheDocument();
        });

        it('uses an indeterminate progress bar without a percentage value', () => {
            renderCard(live());
            const bar = screen.getByRole('progressbar', { name: 'Recording a live stream' });
            expect(bar).toHaveClass('progress--live');
            expect(bar).not.toHaveAttribute('aria-valuenow');
            expect(screen.queryByRole('progressbar', { name: 'Download progress' })).not.toBeInTheDocument();
        });

        it('offers STOP & SAVE, which finishes the recording, next to CANCEL', async () => {
            const user = userEvent.setup();
            const handlers = renderCard(live());
            await user.click(screen.getByRole('button', { name: 'STOP & SAVE' }));
            expect(handlers.onStop).toHaveBeenCalledWith('job-1');
            expect(handlers.onCancel).not.toHaveBeenCalled();
            await user.click(screen.getByRole('button', { name: 'CANCEL' }));
            expect(handlers.onCancel).toHaveBeenCalledWith('job-1');
        });

        it('does not offer STOP & SAVE for an ordinary running download', () => {
            renderCard(makeJob({ status: 'running', live: false }));
            expect(screen.queryByRole('button', { name: 'STOP & SAVE' })).not.toBeInTheDocument();
            expect(screen.getByText('DOWNLOADING')).toBeInTheDocument();
        });

        it('shows a finished recording like any completed download', () => {
            renderCard(live({ status: 'done', percent: 100, filePath: '/d/Live Show.mp4' }));
            expect(screen.getByText('COMPLETE')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'STOP & SAVE' })).not.toBeInTheDocument();
            expect(screen.getByText('100.0%')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'SHOW FILE' })).toBeInTheDocument();
        });

        it('does not offer STOP & SAVE while a live job is still queued', () => {
            renderCard(live({ status: 'queued' }));
            expect(screen.queryByRole('button', { name: 'STOP & SAVE' })).not.toBeInTheDocument();
        });
    });

    describe('stream finder', () => {
        it('offers FIND STREAM for a page yt-dlp did not understand and starts the search', async () => {
            renderCard(makeJob({ status: 'error', error: UNSUPPORTED }));
            await userEvent.setup().click(screen.getByRole('button', { name: 'FIND STREAM' }));
            expect(mock.api.findStreams).toHaveBeenCalledWith('job-1', false);
            expect(useAppStore.getState().streamSearches['job-1']?.status).toMatch(/searching|done/);
        });

        it('does not offer it for failures a page scan cannot fix', () => {
            renderCard(makeJob({ status: 'error', error: ERROR }));
            expect(screen.queryByRole('button', { name: 'FIND STREAM' })).not.toBeInTheDocument();
        });

        it('does not offer it again while a search panel is open, and shows the panel', () => {
            useAppStore.setState({
                streamSearches: { 'job-1': { status: 'searching', stage: 'scanning', candidates: [], message: null, usedBrowser: false } }
            });
            renderCard(makeJob({ status: 'error', error: UNSUPPORTED }));
            expect(screen.queryByRole('button', { name: 'FIND STREAM' })).not.toBeInTheDocument();
            expect(screen.getByRole('region', { name: 'Stream finder' })).toBeInTheDocument();
        });

        it('offers a fresh link for a refused stream and searches its page again', async () => {
            renderCard(makeJob({ id: 'stream-job', status: 'error', error: FORBIDDEN, pageUrl: 'https://site.test/ep-1' }));
            expect(screen.queryByRole('button', { name: 'FIND STREAM' })).not.toBeInTheDocument();
            await userEvent.setup().click(screen.getByRole('button', { name: 'FIND A FRESH LINK' }));
            expect(mock.api.findStreams).toHaveBeenCalledWith('stream-job', false);
        });

        it('does not offer a fresh link for a refused link the user pasted', () => {
            renderCard(makeJob({ status: 'error', error: FORBIDDEN, pageUrl: null }));
            expect(screen.queryByRole('button', { name: /FIND/ })).not.toBeInTheDocument();
        });

        it('shows no panel for jobs without a search', () => {
            renderCard(makeJob({ status: 'error', error: UNSUPPORTED }));
            expect(screen.queryByRole('region', { name: 'Stream finder' })).not.toBeInTheDocument();
        });
    });
});

describe('JobCard live phases', () => {
    const verifying = (overrides: Partial<DownloadJob> = {}) => {
        return makeJob({ status: 'running', live: true, percent: 0, title: 'Live Show', elapsedSeconds: 754, endCheck: { secondsLeft: 7, totalSeconds: 10 }, ...overrides });
    };
    const waiting = (overrides: Partial<DownloadJob> = {}) => {
        return makeJob({ status: 'running', live: false, percent: 0, title: 'Scheduled Show', speed: '', eta: '', waitingForLive: true, ...overrides });
    };

    describe('checking whether the stream really ended', () => {
        it('shows the VERIFYING END badge, a draining bar and the seconds that are left', () => {
            const { container } = render(<JobCard job={verifying()} {...makeHandlers()} />);
            expect(screen.getByText('VERIFYING END')).toHaveClass('badge', 'badge--verifying');
            expect(screen.getByText('The stream stopped. Checking whether it really ended… 7s')).toHaveClass('job__verifying');
            const bar = screen.getByRole('progressbar', { name: 'Checking whether the live stream really ended' });
            expect(bar).toHaveClass('progress--verify');
            expect(bar).toHaveAttribute('aria-valuemin', '0');
            expect(bar).toHaveAttribute('aria-valuemax', '10');
            expect(bar).toHaveAttribute('aria-valuenow', '7');
            expect(bar.firstElementChild).toHaveStyle({ animationDuration: '10s' });
            expect(screen.getByTestId('job-card')).toHaveClass('job', 'job--running', 'job--verifying');
            expect(container.querySelector('.job__live')).toBeNull();
        });

        it('replaces the recording details and the usual actions with FINISH NOW', async () => {
            const user = userEvent.setup();
            const handlers = makeHandlers();
            render(<JobCard job={verifying()} {...handlers} />);
            expect(screen.queryByText('RECORDING')).not.toBeInTheDocument();
            expect(screen.queryByText('● LIVE')).not.toBeInTheDocument();
            expect(screen.queryByText('12:34')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'STOP & SAVE' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'CANCEL' })).not.toBeInTheDocument();
            await user.click(screen.getByRole('button', { name: 'FINISH NOW' }));
            expect(handlers.onStop).toHaveBeenCalledWith('job-1');
            expect(handlers.onCancel).not.toHaveBeenCalled();
        });

        it('goes back to the recording view when the check closes', () => {
            const { rerender } = render(<JobCard job={verifying()} {...makeHandlers()} />);
            rerender(<JobCard job={verifying({ endCheck: null })} {...makeHandlers()} />);
            expect(screen.getByText('RECORDING')).toBeInTheDocument();
            expect(screen.getByText('● LIVE')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'FINISH NOW' })).not.toBeInTheDocument();
            expect(screen.getByTestId('job-card')).not.toHaveClass('job--verifying');
        });

        it('has no effect once the job is finished', () => {
            render(<JobCard job={verifying({ status: 'done' })} {...makeHandlers()} />);
            expect(screen.getByText('COMPLETE')).toBeInTheDocument();
            expect(screen.queryByText('VERIFYING END')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'FINISH NOW' })).not.toBeInTheDocument();
        });
    });

    describe('processing the downloaded file', () => {
        const processing = (overrides: Partial<DownloadJob> = {}) => {
            return makeJob({ status: 'running', live: false, percent: 100, title: 'Some Video', speed: '', eta: '', postProcess: 'ExtractAudio', ...overrides });
        };

        it('shows the PROCESSING badge, a sweeping bar and the step that is running', () => {
            render(<JobCard job={processing()} {...makeHandlers()} />);
            expect(screen.getByText('PROCESSING')).toHaveClass('badge', 'badge--processing');
            expect(screen.getByText('Converting the audio')).toHaveClass('job__processing');
            expect(screen.getByRole('progressbar', { name: 'Processing the downloaded file' })).toHaveClass('progress--processing');
            expect(screen.getByTestId('job-card')).toHaveClass('job', 'job--running', 'job--processing');
            expect(screen.queryByText('DOWNLOADING')).not.toBeInTheDocument();
            expect(screen.queryByText('100.0%')).not.toBeInTheDocument();
        });

        it('follows the step as it changes', () => {
            const { rerender } = render(<JobCard job={processing()} {...makeHandlers()} />);
            rerender(<JobCard job={processing({ postProcess: 'Metadata' })} {...makeHandlers()} />);
            expect(screen.getByText('Writing the metadata')).toBeInTheDocument();
            expect(screen.queryByText('Converting the audio')).not.toBeInTheDocument();
        });

        it('has no actions while the file is processed', () => {
            render(<JobCard job={processing()} {...makeHandlers()} />);
            expect(screen.queryByRole('button', { name: 'CANCEL' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'STOP & SAVE' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'FINISH NOW' })).not.toBeInTheDocument();
        });

        it('goes back to the usual view when the step is over', () => {
            const { rerender } = render(<JobCard job={processing()} {...makeHandlers()} />);
            rerender(<JobCard job={processing({ postProcess: null, status: 'done' })} {...makeHandlers()} />);
            expect(screen.getByText('COMPLETE')).toBeInTheDocument();
            expect(screen.queryByText('PROCESSING')).not.toBeInTheDocument();
            expect(screen.getByTestId('job-card')).not.toHaveClass('job--processing');
        });

        it('keeps CANCEL for a download that is not processing', () => {
            render(<JobCard job={processing({ postProcess: null, percent: 40, speed: '1MiB/s' })} {...makeHandlers()} />);
            expect(screen.getByRole('button', { name: 'CANCEL' })).toBeInTheDocument();
        });
    });

    describe('saving the file after STOP & SAVE', () => {
        const saving = (overrides: Partial<DownloadJob> = {}) => {
            return makeJob({ status: 'running', live: true, percent: 0, title: 'Live Show', elapsedSeconds: 754, saving: true, ...overrides });
        };

        it('shows the SAVING FILE badge, a sweeping bar and the explanation', () => {
            const { container } = render(<JobCard job={saving()} {...makeHandlers()} />);
            expect(screen.getByText('SAVING FILE')).toHaveClass('badge', 'badge--saving');
            expect(screen.getByText('Saving the recording. Do not close the app')).toHaveClass('job__saving');
            expect(screen.getByRole('progressbar', { name: 'Closing the recording and saving the file' })).toHaveClass('progress--saving');
            expect(screen.getByTestId('job-card')).toHaveClass('job', 'job--running', 'job--saving');
            expect(container.querySelector('.job__live')).toBeNull();
            expect(screen.queryByText('RECORDING')).not.toBeInTheDocument();
        });

        it('replaces every action, so STOP & SAVE cannot be clicked twice', () => {
            render(<JobCard job={saving()} {...makeHandlers()} />);
            expect(screen.queryByRole('button', { name: 'STOP & SAVE' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'FINISH NOW' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'CANCEL' })).not.toBeInTheDocument();
        });

        it('goes from the recording view to saving as soon as the flag is set', () => {
            const { rerender } = render(<JobCard job={saving({ saving: false })} {...makeHandlers()} />);
            expect(screen.getByRole('button', { name: 'STOP & SAVE' })).toBeInTheDocument();
            rerender(<JobCard job={saving()} {...makeHandlers()} />);
            expect(screen.getByText('SAVING FILE')).toBeInTheDocument();
        });

        it('has no effect once the job is finished', () => {
            render(<JobCard job={saving({ status: 'done' })} {...makeHandlers()} />);
            expect(screen.getByText('COMPLETE')).toBeInTheDocument();
            expect(screen.queryByText('SAVING FILE')).not.toBeInTheDocument();
            expect(screen.getByTestId('job-card')).not.toHaveClass('job--saving');
        });
    });

    describe('joining the parts of the recording', () => {
        const merging = (overrides: Partial<DownloadJob> = {}) => {
            return makeJob({ status: 'running', live: true, percent: 0, title: 'Live Show', elapsedSeconds: 754, merging: true, ...overrides });
        };

        it('shows the JOINING PARTS badge, a sweeping bar and the explanation', () => {
            const { container } = render(<JobCard job={merging()} {...makeHandlers()} />);
            expect(screen.getByText('JOINING PARTS')).toHaveClass('badge', 'badge--merging');
            expect(screen.getByText('Joining the parts of the recording into one file')).toHaveClass('job__merging');
            expect(screen.getByRole('progressbar', { name: 'Joining the parts of the recording into one file' })).toHaveClass('progress--merging');
            expect(screen.getByTestId('job-card')).toHaveClass('job', 'job--running', 'job--merging');
            expect(container.querySelector('.job__live')).toBeNull();
            expect(screen.queryByText('RECORDING')).not.toBeInTheDocument();
        });

        it('has no actions while the files are being joined', () => {
            render(<JobCard job={merging()} {...makeHandlers()} />);
            expect(screen.queryByRole('button', { name: 'STOP & SAVE' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'FINISH NOW' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'CANCEL' })).not.toBeInTheDocument();
        });

        it('has no effect once the job is finished', () => {
            render(<JobCard job={merging({ status: 'done' })} {...makeHandlers()} />);
            expect(screen.getByText('COMPLETE')).toBeInTheDocument();
            expect(screen.queryByText('JOINING PARTS')).not.toBeInTheDocument();
            expect(screen.getByTestId('job-card')).not.toHaveClass('job--merging');
        });
    });

    describe('waiting for a scheduled live stream', () => {
        it('shows the WAITING FOR LIVE badge and a sweeping bar', () => {
            render(<JobCard job={waiting()} {...makeHandlers()} />);
            expect(screen.getByText('WAITING FOR LIVE')).toHaveClass('badge', 'badge--waiting');
            expect(screen.getByText('Waiting for the live stream to start')).toHaveClass('job__waiting');
            expect(screen.getByRole('progressbar', { name: 'Waiting for the live stream to start' })).toHaveClass('progress--waiting');
            expect(screen.getByTestId('job-card')).toHaveClass('job', 'job--running', 'job--waiting');
            expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
        });

        it('can be cancelled', async () => {
            const user = userEvent.setup();
            const handlers = makeHandlers();
            render(<JobCard job={waiting()} {...handlers} />);
            await user.click(screen.getByRole('button', { name: 'CANCEL' }));
            expect(handlers.onCancel).toHaveBeenCalledWith('job-1');
            expect(screen.queryByRole('button', { name: 'FINISH NOW' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'STOP & SAVE' })).not.toBeInTheDocument();
        });

        it('goes back to the normal view when it is not waiting any more', () => {
            render(<JobCard job={waiting({ waitingForLive: false, percent: 42.5 })} {...makeHandlers()} />);
            expect(screen.getByText('DOWNLOADING')).toBeInTheDocument();
            expect(screen.getByText('42.5%')).toBeInTheDocument();
            expect(screen.getByTestId('job-card')).not.toHaveClass('job--waiting');
        });
    });
});

describe('JobCard custom options', () => {
    it('shows a badge when the download has options of its own', () => {
        render(<JobCard job={makeJob({ customized: true })} {...makeHandlers()} />);
        const badge = screen.getByText('CUSTOM');
        expect(badge).toHaveClass('badge', 'badge--custom');
        expect(badge).toHaveAttribute('title', 'This download has options of its own');
        expect(screen.getByText('DOWNLOADING')).toBeInTheDocument();
    });

    it('has no badge otherwise', () => {
        render(<JobCard job={makeJob({ customized: false })} {...makeHandlers()} />);
        expect(screen.queryByText('CUSTOM')).not.toBeInTheDocument();
    });

    it('keeps the badge when the download has finished or failed', () => {
        const { rerender } = render(<JobCard job={makeJob({ customized: true, status: 'done' })} {...makeHandlers()} />);
        expect(screen.getByText('CUSTOM')).toBeInTheDocument();
        rerender(<JobCard job={makeJob({ customized: true, status: 'error' })} {...makeHandlers()} />);
        expect(screen.getByText('CUSTOM')).toBeInTheDocument();
        expect(screen.getByText('FAILED')).toBeInTheDocument();
    });
});

describe('JobCard pause and resume', () => {
    it('offers PAUSE for a download that is going on, next to CANCEL, and asks to pause it by its id', async () => {
        const user = userEvent.setup();
        const handlers = renderCard(makeJob({ status: 'running' }));

        await user.click(screen.getByRole('button', { name: 'PAUSE' }));

        expect(handlers.onPause).toHaveBeenCalledTimes(1);
        expect(handlers.onPause).toHaveBeenCalledWith('job-1');
        expect(screen.getByRole('button', { name: 'CANCEL' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'RESUME' })).not.toBeInTheDocument();
        expect(handlers.onResume).not.toHaveBeenCalled();
    });

    it.each([
        ['a live recording', { live: true }],
        ['a download that waits for a live stream', { waitingForLive: true }],
        ['a download that is checking if a live stream ended', { endCheck: { secondsLeft: 5, totalSeconds: 10 } }],
        ['a recording that is being joined', { merging: true }],
        ['a recording that is being saved', { saving: true }],
        ['a download that is converting its file', { postProcess: 'Merger' }]
    ] as const)('does not offer PAUSE for %s', (_name, overrides) => {
        renderCard(makeJob({ status: 'running', ...overrides }));

        expect(screen.queryByRole('button', { name: 'PAUSE' })).not.toBeInTheDocument();
    });

    it.each(['queued', 'done', 'error', 'cancelled'] as const)('does not offer PAUSE for a download that is %s', (status) => {
        renderCard(makeJob({ status }));

        expect(screen.queryByRole('button', { name: 'PAUSE' })).not.toBeInTheDocument();
    });

    it('shows a paused download as PAUSED, with what it had downloaded, and offers RESUME and CANCEL', async () => {
        const user = userEvent.setup();
        const handlers = renderCard(makeJob({ status: 'paused', percent: 42.5, speed: '', eta: '' }));

        expect(screen.getByText('PAUSED')).toHaveClass('badge', 'badge--paused');
        expect(screen.getByText('42.5%')).toBeInTheDocument();
        expect(screen.getByTestId('job-card')).toHaveClass('job--paused');
        await user.click(screen.getByRole('button', { name: 'RESUME' }));
        expect(handlers.onResume).toHaveBeenCalledTimes(1);
        expect(handlers.onResume).toHaveBeenCalledWith('job-1');
        await user.click(screen.getByRole('button', { name: 'CANCEL' }));
        expect(handlers.onCancel).toHaveBeenCalledWith('job-1');
    });

    it('does not offer PAUSE, RETRY or REMOVE for a paused download: it is resumed or cancelled first', () => {
        renderCard(makeJob({ status: 'paused', hasPartial: true }));

        expect(screen.queryByRole('button', { name: 'PAUSE' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'RETRY' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'REMOVE' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'CLEAR PARTIAL FILES' })).not.toBeInTheDocument();
    });

    it('does not offer RESUME for a download that is not paused', () => {
        renderCard(makeJob({ status: 'queued' }));

        expect(screen.queryByRole('button', { name: 'RESUME' })).not.toBeInTheDocument();
    });
});
