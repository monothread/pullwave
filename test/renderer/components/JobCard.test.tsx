// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DownloadError, DownloadJob } from '@shared/types';
import { JobCard } from '@renderer/components/JobCard';
import { useAppStore } from '@renderer/store/appStore';
import { answerDialog, confirmDialog } from '../../helpers/confirmDialog';
import { installMockApi, makeJob } from '../../helpers/mockApi';

const ERROR: DownloadError = { code: 'UNAVAILABLE', title: 'Video unavailable', hint: 'Maybe private.', raw: 'ERROR: gone' };
const FORBIDDEN: DownloadError = { code: 'FORBIDDEN', title: 'Access refused by the server', hint: 'Expired?', raw: 'HTTP Error 403: Forbidden' };
const UNSUPPORTED: DownloadError = { code: 'OUTDATED', title: 'yt-dlp may be outdated', hint: 'Update.', raw: 'ERROR: Unsupported URL' };

const CANCEL_TITLE = 'Cancel this download?';
const REMOVE_TITLE = 'Remove this download from the list?';
const PARTIALS_TITLE = 'Delete the partial files?';

const initial = useAppStore.getState();

beforeEach(() => {
    installMockApi();
    useAppStore.setState({ ...initial });
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
        expect(handlers.onCancel).not.toHaveBeenCalled();
        await answerDialog(user, CANCEL_TITLE, 'CANCEL');
        expect(handlers.onCancel).toHaveBeenCalledWith('job-1');
        expect(screen.queryByRole('button', { name: 'REMOVE' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'RETRY' })).not.toBeInTheDocument();
    });

    it('keeps the download going when the user goes back, presses Esc or clicks outside the window', async () => {
        const user = userEvent.setup();
        const handlers = renderCard(makeJob({ status: 'running' }));
        await user.click(screen.getByRole('button', { name: 'CANCEL' }));
        expect(within(confirmDialog(CANCEL_TITLE)).getByText('The download stops. You can start it again later.')).toBeInTheDocument();
        await answerDialog(user, CANCEL_TITLE, 'BACK');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'CANCEL' }));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'CANCEL' }));
        fireEvent.mouseDown(document.querySelector('.modal-backdrop') as HTMLElement);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(handlers.onCancel).not.toHaveBeenCalled();
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
        expect(handlers.onRemove).not.toHaveBeenCalled();
        await answerDialog(user, REMOVE_TITLE, 'REMOVE');
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
        await answerDialog(user, REMOVE_TITLE, 'REMOVE');
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

        it('offers to clear them on a failed or cancelled download that left some, after confirming', async () => {
            const user = userEvent.setup();
            const handlers = renderCard(makeJob({ status: 'error', error: ERROR, hasPartial: true }));
            await user.click(screen.getByRole('button', { name: 'CLEAR PARTIAL FILES' }));
            expect(handlers.onClearPartials).not.toHaveBeenCalled();
            expect(within(confirmDialog(PARTIALS_TITLE)).getByText('The partial files of this download are deleted from the disk.')).toBeInTheDocument();
            await answerDialog(user, PARTIALS_TITLE, 'CLEAR PARTIAL FILES');
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

        it('asks before clearing or removing an ordinary download, with the ordinary message, and does nothing until it is confirmed', async () => {
            const user = userEvent.setup();
            const handlers = renderCard(makeJob({ status: 'error', error: ERROR, hasPartial: true }));
            await user.click(screen.getByRole('button', { name: 'CLEAR PARTIAL FILES' }));
            await answerDialog(user, PARTIALS_TITLE, 'CLEAR PARTIAL FILES');
            await user.click(screen.getByRole('button', { name: 'REMOVE' }));
            expect(within(confirmDialog(REMOVE_TITLE)).getByText('Only the entry leaves the list. Files already saved stay on the disk.')).toBeInTheDocument();
            await answerDialog(user, REMOVE_TITLE, 'REMOVE');
            expect(handlers.onClearPartials).toHaveBeenCalledTimes(1);
            expect(handlers.onRemove).toHaveBeenCalledTimes(1);
        });

        it('warns that a live recording was not saved in the window, and deletes it only when confirmed', async () => {
            const user = userEvent.setup();
            const handlers = renderCard(makeJob({ status: 'error', error: ERROR, live: true, hasPartial: true }));
            await user.click(screen.getByRole('button', { name: 'CLEAR PARTIAL FILES' }));
            expect(within(confirmDialog(PARTIALS_TITLE)).getByText('This live recording was not saved. Deleting it cannot be undone. Delete it?')).toBeInTheDocument();
            expect(handlers.onClearPartials).not.toHaveBeenCalled();
            await answerDialog(user, PARTIALS_TITLE, 'CLEAR PARTIAL FILES');
            expect(handlers.onClearPartials).toHaveBeenCalledWith('job-1');
            await user.click(screen.getByRole('button', { name: 'REMOVE' }));
            expect(within(confirmDialog(REMOVE_TITLE)).getByText('This live recording was not saved. Deleting it cannot be undone. Delete it?')).toBeInTheDocument();
            await answerDialog(user, REMOVE_TITLE, 'REMOVE');
            expect(handlers.onRemove).toHaveBeenCalledWith('job-1');
        });

        it('keeps a live recording when the user keeps it, presses Esc or goes back', async () => {
            const user = userEvent.setup();
            const handlers = renderCard(makeJob({ status: 'error', error: ERROR, live: true, hasPartial: true }));
            await user.click(screen.getByRole('button', { name: 'CLEAR PARTIAL FILES' }));
            await answerDialog(user, PARTIALS_TITLE, 'KEEP');
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            await user.click(screen.getByRole('button', { name: 'REMOVE' }));
            await user.keyboard('{Escape}');
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(handlers.onClearPartials).not.toHaveBeenCalled();
            expect(handlers.onRemove).not.toHaveBeenCalled();
        });

        it('asks the ordinary question for a live card that has no partial files', async () => {
            const user = userEvent.setup();
            const handlers = renderCard(makeJob({ status: 'done', live: true, hasPartial: false, filePath: '/d/live.mp4' }));
            await user.click(screen.getByRole('button', { name: 'REMOVE' }));
            expect(within(confirmDialog(REMOVE_TITLE)).getByText('Only the entry leaves the list. Files already saved stay on the disk.')).toBeInTheDocument();
            await answerDialog(user, REMOVE_TITLE, 'REMOVE');
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
            expect(handlers.onCancel).not.toHaveBeenCalled();
            await answerDialog(user, CANCEL_TITLE, 'CANCEL');
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

    describe('failed downloads', () => {
        it.each([
            ['an unsupported page', UNSUPPORTED, null],
            ['an unavailable video', ERROR, null],
            ['a refused link from a page', FORBIDDEN, 'https://site.test/ep-1'],
            ['a refused link the user pasted', FORBIDDEN, null]
        ])('offers no stream search for %s', (_label, error, pageUrl) => {
            renderCard(makeJob({ status: 'error', error, pageUrl }));
            expect(screen.getByRole('button', { name: 'RETRY' })).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /FIND/ })).not.toBeInTheDocument();
            expect(screen.queryByRole('region', { name: 'Stream finder' })).not.toBeInTheDocument();
        });
    });
});
