// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { createTranslator } from '@shared/i18n';
import { isJoined, JobMeta, JobProgress } from '@renderer/components/JobProgress';
import { ZIP_CLOSE_MS, ZIP_SETTLE_MS, ZIP_SPLIT_MS } from '@renderer/hooks/useZipPhase';
import type { DownloadPart } from '@shared/types';
import { makeJob } from '../../helpers/mockApi';

const t = createTranslator('en');
const END_CHECK = { secondsLeft: 4, totalSeconds: 10 };
const PARTS: DownloadPart[] = [
    { kind: 'video', percent: 100 },
    { kind: 'audio', percent: 34.2 }
];

describe('JobProgress', () => {
    it('shows a percentage bar for an ordinary download', () => {
        render(<JobProgress job={makeJob({ percent: 42.5 })} phase={null} t={t} />);
        const bar = screen.getByRole('progressbar', { name: 'Download progress' });
        expect(bar).toHaveAttribute('aria-valuenow', '43');
        expect(bar).toHaveAttribute('aria-valuemin', '0');
        expect(bar).toHaveAttribute('aria-valuemax', '100');
        expect(bar.firstElementChild).toHaveStyle({ width: '42.5%' });
    });

    it('shows the striped bar while a live stream is recorded', () => {
        render(<JobProgress job={makeJob({ live: true })} phase={null} t={t} />);
        expect(screen.getByRole('progressbar', { name: 'Recording a live stream' })).toHaveClass('progress--live');
    });

    it('shows a bar that drains over the checking time while the end of a stream is checked', () => {
        render(<JobProgress job={makeJob({ live: true, endCheck: END_CHECK })} phase="verifying" t={t} />);
        const bar = screen.getByRole('progressbar', { name: 'Checking whether the live stream really ended' });
        expect(bar).toHaveClass('progress', 'progress--verify');
        expect(bar).toHaveAttribute('aria-valuenow', '4');
        expect(bar).toHaveAttribute('aria-valuemax', '10');
        expect(bar.firstElementChild).toHaveStyle({ animationDuration: '10s' });
    });

    it('falls back to the normal bar when it is verifying but there is no check data', () => {
        render(<JobProgress job={makeJob({ live: false, endCheck: null })} phase="verifying" t={t} />);
        expect(screen.getByRole('progressbar', { name: 'Download progress' })).toBeInTheDocument();
    });

    it('shows a sweeping bar while waiting for a scheduled live stream', () => {
        render(<JobProgress job={makeJob({ waitingForLive: true })} phase="waiting" t={t} />);
        const bar = screen.getByRole('progressbar', { name: 'Waiting for the live stream to start' });
        expect(bar).toHaveClass('progress', 'progress--waiting');
        expect(bar).not.toHaveAttribute('aria-valuenow');
    });

    it('shows a sweeping bar while the downloaded file is processed', () => {
        render(<JobProgress job={makeJob({ percent: 100, postProcess: 'ExtractAudio' })} phase="processing" t={t} />);
        const bar = screen.getByRole('progressbar', { name: 'Processing the downloaded file' });
        expect(bar).toHaveClass('progress', 'progress--processing');
        expect(bar).not.toHaveAttribute('aria-valuenow');
        expect(screen.queryByRole('progressbar', { name: 'Download progress' })).not.toBeInTheDocument();
    });

    it('shows a sweeping bar while a stopped recording is saved', () => {
        render(<JobProgress job={makeJob({ live: true, saving: true })} phase="saving" t={t} />);
        const bar = screen.getByRole('progressbar', { name: 'Closing the recording and saving the file' });
        expect(bar).toHaveClass('progress', 'progress--saving');
        expect(bar).not.toHaveAttribute('aria-valuenow');
        expect(screen.queryByRole('progressbar', { name: 'Recording a live stream' })).not.toBeInTheDocument();
    });

    it('shows a sweeping bar while the parts of a recording are joined', () => {
        render(<JobProgress job={makeJob({ live: true, merging: true })} phase="merging" t={t} />);
        const bar = screen.getByRole('progressbar', { name: 'Joining the parts of the recording into one file' });
        expect(bar).toHaveClass('progress', 'progress--merging');
        expect(bar).not.toHaveAttribute('aria-valuenow');
        expect(screen.queryByRole('progressbar', { name: 'Recording a live stream' })).not.toBeInTheDocument();
    });

    it('is not live once the job finished', () => {
        render(<JobProgress job={makeJob({ live: true, status: 'done', percent: 100 })} phase={null} t={t} />);
        expect(screen.getByRole('progressbar', { name: 'Download progress' })).toHaveAttribute('aria-valuenow', '100');
    });

    it('shows a bar for each part, one under the other, in place of the one bar, when the video and the audio come apart', () => {
        render(<JobProgress job={makeJob({ percent: 34.2, parts: PARTS })} phase={null} t={t} />);
        expect(screen.queryByRole('progressbar', { name: 'Download progress' })).not.toBeInTheDocument();
        const bars = screen.getAllByRole('progressbar');
        expect(
            bars.map((bar) => {
                return [bar.getAttribute('aria-label'), bar.getAttribute('aria-valuenow'), (bar.firstElementChild as HTMLElement).style.width];
            })
        ).toEqual([
            ['Download progress: VIDEO', '100', '100%'],
            ['Download progress: AUDIO', '34', '34.2%']
        ]);
        expect(screen.getAllByTestId('job-part').map((row) => {
            return row.textContent;
        })).toEqual(['VIDEO100.0%', 'AUDIO34.2%']);
    });

    it('shows the one bar of the download for a single part', () => {
        render(<JobProgress job={makeJob({ percent: 20, parts: [{ kind: 'video', percent: 20 }] })} phase={null} t={t} />);
        expect(screen.getByRole('progressbar', { name: 'Download progress' })).toHaveAttribute('aria-valuenow', '20');
        expect(screen.queryByTestId('job-parts')).not.toBeInTheDocument();
    });

    it.each([
        ['processing', makeJob({ parts: PARTS, postProcess: 'Merger' })],
        ['waiting', makeJob({ parts: PARTS, waitingForLive: true })]
    ] as const)('keeps the bar of the %s phase over the bars of the parts', (phase, job) => {
        render(<JobProgress job={job} phase={phase} t={t} />);
        expect(screen.getAllByRole('progressbar')).toHaveLength(1);
        expect(screen.queryByTestId('job-parts')).not.toBeInTheDocument();
    });

    it('shows the striped bar of a recording over the bars of the parts', () => {
        render(<JobProgress job={makeJob({ live: true, parts: PARTS })} phase={null} t={t} />);
        expect(screen.getByRole('progressbar', { name: 'Recording a live stream' })).toHaveClass('progress--live');
        expect(screen.queryByTestId('job-parts')).not.toBeInTheDocument();
    });
});

describe('JobProgress joining the bars of the parts (D-196)', () => {
    const DOWNLOADED: DownloadPart[] = [
        { kind: 'video', percent: 100 },
        { kind: 'audio', percent: 100 }
    ];

    function zipState(container: HTMLElement): string | null {
        return container.querySelector('.zipper')?.getAttribute('data-zip') ?? null;
    }

    function advance(ms: number): void {
        act(() => {
            vi.advanceTimersByTime(ms);
        });
    }

    function runJoining(): void {
        advance(ZIP_SPLIT_MS);
        advance(ZIP_CLOSE_MS);
        advance(ZIP_SETTLE_MS);
    }

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('takes a download as joined once a step after the download started or it is complete', () => {
        expect(isJoined({ postProcess: null, status: 'running' })).toBe(false);
        expect(isJoined({ postProcess: 'Merger', status: 'running' })).toBe(true);
        expect(isJoined({ postProcess: null, status: 'done' })).toBe(true);
        expect(isJoined({ postProcess: null, status: 'error' })).toBe(false);
    });

    it('keeps the bars of the parts apart, in the zipper, while they download', () => {
        const { container } = render(<JobProgress job={makeJob({ parts: PARTS })} phase={null} t={t} />);
        expect(zipState(container)).toBe('parts');
        expect(screen.getAllByTestId('job-part')).toHaveLength(2);
    });

    it('zips the bars into one as the first step after the download starts, and then shows the bar of the step going on', () => {
        const job = makeJob({ parts: DOWNLOADED, percent: 100 });
        const { container, rerender } = render(<JobProgress job={job} phase={null} t={t} />);
        const processing = { ...job, postProcess: 'Merger', postProcessSteps: ['Merger'], speed: '', eta: '' };
        rerender(<JobProgress job={processing} phase="processing" t={t} />);
        expect(zipState(container)).toBe('split');
        expect(screen.getAllByTestId('job-part')).toHaveLength(2);
        expect(screen.queryByRole('progressbar', { name: 'Processing the downloaded file' })).not.toBeInTheDocument();
        advance(ZIP_SPLIT_MS);
        expect(zipState(container)).toBe('zip');
        advance(ZIP_CLOSE_MS);
        expect(zipState(container)).toBe('settle');
        advance(ZIP_SETTLE_MS);
        expect(zipState(container)).toBeNull();
        expect(screen.queryByTestId('job-parts')).not.toBeInTheDocument();
        const bar = screen.getByRole('progressbar', { name: 'Processing the downloaded file' });
        expect(bar.className).toBe('progress progress--processing');
    });

    it('zips the bars into one when the download completes with no step after it, and leaves one full bar', () => {
        const job = makeJob({ parts: DOWNLOADED, percent: 100 });
        const { container, rerender } = render(<JobProgress job={job} phase={null} t={t} />);
        rerender(<JobProgress job={{ ...job, status: 'done' }} phase={null} t={t} />);
        expect(zipState(container)).toBe('split');
        runJoining();
        expect(zipState(container)).toBeNull();
        const bar = screen.getByRole('progressbar', { name: 'Download progress' });
        expect(bar.className).toBe('progress');
        expect(bar).toHaveAttribute('aria-valuenow', '100');
        expect(bar.firstElementChild).toHaveStyle({ width: '100%' });
    });

    it('shows one full bar at once for a download in parts that was already complete when it was shown', () => {
        const { container } = render(<JobProgress job={makeJob({ status: 'done', parts: DOWNLOADED, percent: 100 })} phase={null} t={t} />);
        expect(zipState(container)).toBeNull();
        expect(screen.getByRole('progressbar', { name: 'Download progress' })).toHaveAttribute('aria-valuenow', '100');
    });

    it('puts the bars apart again for a download tried again after it was joined', () => {
        const joined = makeJob({ status: 'done', parts: DOWNLOADED, percent: 100 });
        const { container, rerender } = render(<JobProgress job={joined} phase={null} t={t} />);
        rerender(<JobProgress job={{ ...joined, status: 'running', percent: 5, parts: [{ kind: 'video', percent: 5 }, { kind: 'audio', percent: 0 }] }} phase={null} t={t} />);
        expect(zipState(container)).toBe('parts');
        expect(screen.getAllByRole('progressbar').map((bar) => {
            return bar.getAttribute('aria-valuenow');
        })).toEqual(['5', '0']);
    });

    it('keeps the bars of a failed download apart, as they were when it stopped', () => {
        const { container } = render(<JobProgress job={makeJob({ status: 'error', parts: PARTS })} phase={null} t={t} />);
        expect(zipState(container)).toBe('parts');
        expect(screen.getAllByTestId('job-part')).toHaveLength(2);
    });

    it('never zips a download that comes in one piece: its bar goes on to the bar of the step going on', () => {
        const job = makeJob({ percent: 100 });
        const { container, rerender } = render(<JobProgress job={job} phase={null} t={t} />);
        rerender(<JobProgress job={{ ...job, postProcess: 'Metadata', postProcessSteps: ['Metadata'] }} phase="processing" t={t} />);
        expect(zipState(container)).toBeNull();
        expect(screen.getByRole('progressbar', { name: 'Processing the downloaded file' })).toHaveClass('progress--processing');
    });
});

describe('JobMeta', () => {
    it('shows the percentage, the speed and the ETA of an ordinary download', () => {
        render(<JobMeta job={makeJob({ percent: 10, speed: '2MiB/s', eta: '00:30' })} phase={null} t={t} />);
        expect(screen.getByText('10.0%')).toBeInTheDocument();
        expect(screen.getByText('2MiB/s')).toBeInTheDocument();
        expect(screen.getByText('ETA 00:30')).toBeInTheDocument();
    });

    it('leaves the percentage to the bars of the parts, and still shows the speed and the ETA of the part going on', () => {
        const { container } = render(<JobMeta job={makeJob({ percent: 34.2, speed: '2MiB/s', eta: '00:30', parts: PARTS })} phase={null} t={t} />);
        expect(screen.queryByText('34.2%')).not.toBeInTheDocument();
        expect(Array.from(container.querySelectorAll('.job__meta > span')).map((span) => {
            return span.textContent;
        })).toEqual(['2MiB/s', 'ETA 00:30']);
    });

    it('omits the speed and the ETA when they are empty', () => {
        render(<JobMeta job={makeJob({ speed: '', eta: '' })} phase={null} t={t} />);
        expect(screen.queryByText(/ETA/)).not.toBeInTheDocument();
        expect(screen.getByText('42.5%')).toBeInTheDocument();
    });

    it('shows the time and the size of a recording', () => {
        render(<JobMeta job={makeJob({ live: true, elapsedSeconds: 65, downloadedBytes: 2048 })} phase={null} t={t} />);
        expect(screen.getByText('● LIVE')).toBeInTheDocument();
        expect(screen.getByText('01:05')).toBeInTheDocument();
        expect(screen.getByText('2.0 KiB')).toBeInTheDocument();
    });

    it('counts the seconds that are left while the end of a stream is checked', () => {
        render(<JobMeta job={makeJob({ live: true, endCheck: END_CHECK })} phase="verifying" t={t} />);
        expect(screen.getByText('The stream stopped. Checking whether it really ended… 4s')).toHaveClass('job__verifying');
        expect(screen.queryByText('● LIVE')).not.toBeInTheDocument();
    });

    it.each([
        ['ExtractAudio', 'Converting the audio'],
        ['Merger', 'Joining video and audio'],
        ['VideoConvertor', 'Converting the video'],
        ['FixupM3u8', 'Fixing the file'],
        ['Metadata', 'Writing the metadata'],
        ['EmbedThumbnail', 'Embedding the thumbnail'],
        ['EmbedSubtitle', 'Embedding the subtitles'],
        ['SponsorBlock', 'Processing the chapters'],
        ['MoveFiles', 'Moving the file to the folder'],
        ['SomethingNew', 'Processing the file']
    ])('says what the %s step is doing, without the percentage, speed or eta', (processor, text) => {
        render(<JobMeta job={makeJob({ percent: 100, speed: '6.6MiB/s', eta: '00:01', postProcess: processor })} phase="processing" t={t} />);
        expect(screen.getByText(text)).toHaveClass('job__processing');
        expect(screen.queryByText('100.0%')).not.toBeInTheDocument();
        expect(screen.queryByText('6.6MiB/s')).not.toBeInTheDocument();
        expect(screen.queryByText('ETA 00:01')).not.toBeInTheDocument();
    });

    it('says that the file is being saved, without the recording details', () => {
        render(<JobMeta job={makeJob({ live: true, saving: true, elapsedSeconds: 754, downloadedBytes: 2048 })} phase="saving" t={t} />);
        expect(screen.getByText('Saving the recording. Do not close the app')).toHaveClass('job__saving');
        expect(screen.queryByText('● LIVE')).not.toBeInTheDocument();
        expect(screen.queryByText('12:34')).not.toBeInTheDocument();
        expect(screen.queryByText('2.0 KiB')).not.toBeInTheDocument();
    });

    it('says that the parts are being joined, without the recording details', () => {
        render(<JobMeta job={makeJob({ live: true, merging: true, elapsedSeconds: 754, downloadedBytes: 2048 })} phase="merging" t={t} />);
        expect(screen.getByText('Joining the parts of the recording into one file')).toHaveClass('job__merging');
        expect(screen.queryByText('● LIVE')).not.toBeInTheDocument();
        expect(screen.queryByText('12:34')).not.toBeInTheDocument();
        expect(screen.queryByText('2.0 KiB')).not.toBeInTheDocument();
    });

    it('says that it is waiting for the stream to start', () => {
        render(<JobMeta job={makeJob({ waitingForLive: true })} phase="waiting" t={t} />);
        expect(screen.getByText('Waiting for the live stream to start')).toHaveClass('job__waiting');
        expect(screen.queryByText('42.5%')).not.toBeInTheDocument();
    });
});
