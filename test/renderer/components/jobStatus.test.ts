import { createTranslator } from '@shared/i18n';
import type { DownloadJob } from '@shared/types';
import { formatBytes, formatDuration, formatPercent, livePhase, processingTextKey, sortForDisplay, statusLabel } from '@renderer/components/jobStatus';

import { makeJob } from '../../helpers/mockApi';

const t = createTranslator('en');

describe('statusLabel', () => {
    it('maps every status to its label', () => {
        expect(statusLabel('queued', false, t)).toBe('QUEUED');
        expect(statusLabel('running', false, t)).toBe('DOWNLOADING');
        expect(statusLabel('done', false, t)).toBe('COMPLETE');
        expect(statusLabel('error', false, t)).toBe('FAILED');
        expect(statusLabel('cancelled', false, t)).toBe('CANCELLED');
    });
});

describe('formatPercent', () => {
    it('formats with one decimal', () => {
        expect(formatPercent(0)).toBe('0.0%');
        expect(formatPercent(42.56)).toBe('42.6%');
        expect(formatPercent(100)).toBe('100.0%');
    });
});

describe('statusLabel for live recordings', () => {
    it('says RECORDING for a live job that is running', () => {
        expect(statusLabel('running', true, t)).toBe('RECORDING');
    });

    it('keeps the other statuses for live jobs', () => {
        expect(statusLabel('done', true, t)).toBe('COMPLETE');
        expect(statusLabel('error', true, t)).toBe('FAILED');
        expect(statusLabel('cancelled', true, t)).toBe('CANCELLED');
        expect(statusLabel('queued', true, t)).toBe('QUEUED');
    });

    it('says DOWNLOADING for a running job that is not live', () => {
        expect(statusLabel('running', false, t)).toBe('DOWNLOADING');
        expect(statusLabel('running', false, t)).toBe('DOWNLOADING');
    });
});

describe('formatDuration', () => {
    it.each([
        [0, '00:00'],
        [5, '00:05'],
        [59.9, '00:59'],
        [60, '01:00'],
        [754, '12:34'],
        [3599, '59:59'],
        [3600, '1:00:00'],
        [3700, '1:01:40'],
        [36000 + 61, '10:01:01'],
        [-5, '00:00']
    ])('formats %s seconds as %s', (seconds, expected) => {
        expect(formatDuration(seconds)).toBe(expected);
    });
});

describe('formatBytes', () => {
    it.each([
        [0, '0 B'],
        [512, '512 B'],
        [1023, '1023 B'],
        [1024, '1.0 KiB'],
        [1536, '1.5 KiB'],
        [1048576, '1.0 MiB'],
        [220200960, '210.0 MiB'],
        [1073741824, '1.0 GiB'],
        [5497558138880, '5.0 TiB'],
        [1125899906842624, '1024.0 TiB'],
        [-10, '0 B']
    ])('formats %s bytes as %s', (bytes, expected) => {
        expect(formatBytes(bytes)).toBe(expected);
    });
});


describe('livePhase', () => {
    const END_CHECK = { secondsLeft: 7, totalSeconds: 10 };

    it('is verifying while the end of a running job is checked', () => {
        expect(livePhase({ status: 'running', endCheck: END_CHECK, waitingForLive: false, merging: false, saving: false, postProcess: null })).toBe('verifying');
    });

    it('is waiting while a running job waits for a scheduled live stream', () => {
        expect(livePhase({ status: 'running', endCheck: null, waitingForLive: true, merging: false, saving: false, postProcess: null })).toBe('waiting');
    });

    it('prefers verifying when both are set', () => {
        expect(livePhase({ status: 'running', endCheck: END_CHECK, waitingForLive: true, merging: false, saving: false, postProcess: null })).toBe('verifying');
    });

    it('is null for a running job doing neither', () => {
        expect(livePhase({ status: 'running', endCheck: null, waitingForLive: false, merging: false, saving: false, postProcess: null })).toBeNull();
    });

    it('is merging while the parts of a running job are joined', () => {
        expect(livePhase({ status: 'running', endCheck: null, waitingForLive: false, merging: true, saving: false, postProcess: null })).toBe('merging');
    });

    it('is saving while a recording that was told to stop is closed', () => {
        expect(livePhase({ status: 'running', endCheck: null, waitingForLive: false, merging: false, saving: true, postProcess: null })).toBe('saving');
    });

    it('prefers saving over verifying and waiting', () => {
        expect(livePhase({ status: 'running', endCheck: END_CHECK, waitingForLive: true, merging: false, saving: true, postProcess: null })).toBe('saving');
    });

    it('is processing while yt-dlp converts, merges or tags the downloaded file', () => {
        expect(livePhase({ status: 'running', endCheck: null, waitingForLive: false, merging: false, saving: false, postProcess: 'ExtractAudio' })).toBe('processing');
    });

    it('prefers processing over verifying and waiting', () => {
        expect(livePhase({ status: 'running', endCheck: END_CHECK, waitingForLive: true, merging: false, saving: false, postProcess: 'Merger' })).toBe('processing');
    });

    it('prefers saving and merging over processing', () => {
        expect(livePhase({ status: 'running', endCheck: null, waitingForLive: false, merging: false, saving: true, postProcess: 'Merger' })).toBe('saving');
        expect(livePhase({ status: 'running', endCheck: null, waitingForLive: false, merging: true, saving: false, postProcess: 'Merger' })).toBe('merging');
    });

    it('prefers merging over saving', () => {
        expect(livePhase({ status: 'running', endCheck: null, waitingForLive: false, merging: true, saving: true, postProcess: null })).toBe('merging');
    });

    it('prefers merging over the other phases', () => {
        expect(livePhase({ status: 'running', endCheck: END_CHECK, waitingForLive: true, merging: true, saving: false, postProcess: null })).toBe('merging');
    });

    it.each(['queued', 'done', 'error', 'cancelled'] as const)('is null for a job that is %s', (status) => {
        expect(livePhase({ status, endCheck: END_CHECK, waitingForLive: true, merging: true, saving: true, postProcess: null })).toBeNull();
    });
});

describe('statusLabel for the live phases', () => {
    it('says VERIFYING END, WAITING FOR LIVE and JOINING PARTS', () => {
        expect(statusLabel('running', false, t, 'processing')).toBe('PROCESSING');
        expect(statusLabel('running', true, t, 'saving')).toBe('SAVING FILE');
        expect(statusLabel('running', true, t, 'merging')).toBe('JOINING PARTS');
        expect(statusLabel('running', true, t, 'verifying')).toBe('VERIFYING END');
        expect(statusLabel('running', false, t, 'waiting')).toBe('WAITING FOR LIVE');
    });

    it('keeps the usual labels without a phase', () => {
        expect(statusLabel('running', true, t, null)).toBe('RECORDING');
        expect(statusLabel('running', false, t, null)).toBe('DOWNLOADING');
    });
});

describe('processingTextKey', () => {
    it.each([
        ['ExtractAudio', 'job.processing.audio'],
        ['Merger', 'job.processing.merge'],
        ['VideoConvertor', 'job.processing.video'],
        ['VideoRemuxer', 'job.processing.video'],
        ['FixupM3u8', 'job.processing.fixup'],
        ['FixupM4a', 'job.processing.fixup'],
        ['FixupStretched', 'job.processing.fixup'],
        ['Metadata', 'job.processing.metadata'],
        ['EmbedThumbnail', 'job.processing.thumbnail'],
        ['ThumbnailsConvertor', 'job.processing.thumbnail'],
        ['EmbedSubtitle', 'job.processing.subtitle'],
        ['SubtitlesConvertor', 'job.processing.subtitle'],
        ['SponsorBlock', 'job.processing.chapters'],
        ['ModifyChapters', 'job.processing.chapters'],
        ['SplitChapters', 'job.processing.chapters'],
        ['MoveFiles', 'job.processing.move']
    ] as const)('maps the %s post-processor to %s', (processor, key) => {
        expect(processingTextKey(processor)).toBe(key);
    });

    it('falls back to the generic text for a post-processor it does not know', () => {
        expect(processingTextKey('SomethingNew')).toBe('job.processing.default');
        expect(processingTextKey('')).toBe('job.processing.default');
    });

    it('falls back to the generic text without a post-processor', () => {
        expect(processingTextKey(null)).toBe('job.processing.default');
    });

    it('has a text in English for every key it can return', () => {
        const processors = ['ExtractAudio', 'Merger', 'VideoConvertor', 'FixupM3u8', 'Metadata', 'EmbedThumbnail', 'EmbedSubtitle', 'SponsorBlock', 'MoveFiles', 'Other'];
        processors.forEach((processor) => {
            expect(t(processingTextKey(processor))).not.toBe(processingTextKey(processor));
        });
    });
});

describe('sortForDisplay', () => {
    const ids = (jobs: DownloadJob[]): string[] => {
        return jobs.map((job) => {
            return job.id;
        });
    };

    it('lists the last added job first when every job is in the same state', () => {
        const jobs = [makeJob({ id: 'a' }), makeJob({ id: 'b' }), makeJob({ id: 'c' })];
        expect(ids(sortForDisplay(jobs))).toEqual(['c', 'b', 'a']);
    });

    it('lists running jobs, then queued ones, then the finished ones', () => {
        const jobs = [
            makeJob({ id: 'done', status: 'done' }),
            makeJob({ id: 'queued', status: 'queued' }),
            makeJob({ id: 'running', status: 'running' }),
            makeJob({ id: 'error', status: 'error' }),
            makeJob({ id: 'cancelled', status: 'cancelled' })
        ];
        expect(ids(sortForDisplay(jobs))).toEqual(['running', 'queued', 'cancelled', 'error', 'done']);
    });

    it('keeps the newest first inside each group', () => {
        const jobs = [
            makeJob({ id: 'run-1', status: 'running' }),
            makeJob({ id: 'wait-1', status: 'queued' }),
            makeJob({ id: 'run-2', status: 'running' }),
            makeJob({ id: 'wait-2', status: 'queued' }),
            makeJob({ id: 'end-1', status: 'done' }),
            makeJob({ id: 'end-2', status: 'error' })
        ];
        expect(ids(sortForDisplay(jobs))).toEqual(['run-2', 'run-1', 'wait-2', 'wait-1', 'end-2', 'end-1']);
    });

    it('does not change the list it receives', () => {
        const jobs = [makeJob({ id: 'a', status: 'done' }), makeJob({ id: 'b', status: 'running' })];
        sortForDisplay(jobs);
        expect(ids(jobs)).toEqual(['a', 'b']);
    });

    it('returns an empty list for no jobs and the same job for one', () => {
        expect(sortForDisplay([])).toEqual([]);
        expect(ids(sortForDisplay([makeJob({ id: 'only' })]))).toEqual(['only']);
    });
});

describe('jobs that are paused', () => {
    it('says a paused download is paused', () => {
        expect(statusLabel('paused', false, t)).toBe('PAUSED');
    });

    it('sorts them after what is running and before what waits and what is over', () => {
        const job = (id: string, status: DownloadJob['status']): DownloadJob => {
            return makeJob({ id, status });
        };
        const sorted = sortForDisplay([job('done', 'done'), job('queued', 'queued'), job('paused', 'paused'), job('running', 'running'), job('error', 'error')]);

        expect(
            sorted.map((entry) => {
                return entry.id;
            })
        ).toEqual(['running', 'paused', 'queued', 'error', 'done']);
    });
});
