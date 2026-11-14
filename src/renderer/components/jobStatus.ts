import type { MessageKey, Translator } from '@shared/i18n';
import type { DownloadJob, JobStatus } from '@shared/types';

export type LivePhase = 'verifying' | 'waiting' | 'merging' | 'saving' | 'processing';

// A running job is either processing the downloaded file (conversion, merge, tags), closing a recording that was told to stop, joining the parts of a live recording, checking whether a live stream really ended or waiting
// for a scheduled one to start.
export function livePhase(job: Pick<DownloadJob, 'status' | 'endCheck' | 'waitingForLive' | 'merging' | 'saving' | 'postProcess'>): LivePhase | null {
    if (job.status !== 'running') {
        return null;
    }
    if (job.merging) {
        return 'merging';
    }
    if (job.saving) {
        return 'saving';
    }
    if (job.postProcess !== null) {
        return 'processing';
    }
    if (job.endCheck !== null) {
        return 'verifying';
    }
    return job.waitingForLive ? 'waiting' : null;
}

// What each yt-dlp post-processor does, by the start of its name (Fixup* are several: FixupM3u8, FixupM4a...). The same word names the text
// of the step going on (job.processing.*) and its short name in the trail of steps (job.step.*).
type ProcessingKind = 'audio' | 'merge' | 'video' | 'fixup' | 'metadata' | 'thumbnail' | 'subtitle' | 'chapters' | 'move' | 'default';

const PROCESSING_KINDS: ReadonlyArray<readonly [string, ProcessingKind]> = [
    ['ExtractAudio', 'audio'],
    ['Merger', 'merge'],
    ['VideoConvertor', 'video'],
    ['VideoRemuxer', 'video'],
    ['Fixup', 'fixup'],
    ['Metadata', 'metadata'],
    ['EmbedThumbnail', 'thumbnail'],
    ['ThumbnailsConvertor', 'thumbnail'],
    ['EmbedSubtitle', 'subtitle'],
    ['SubtitlesConvertor', 'subtitle'],
    ['SponsorBlock', 'chapters'],
    ['ModifyChapters', 'chapters'],
    ['SplitChapters', 'chapters'],
    ['MoveFiles', 'move']
];

function processingKind(processor: string | null): ProcessingKind {
    const match = PROCESSING_KINDS.find(([prefix]) => {
        return processor?.startsWith(prefix) === true;
    });
    return match ? match[1] : 'default';
}

export function processingTextKey(processor: string | null): MessageKey {
    return `job.processing.${processingKind(processor)}`;
}

// One step of the trail: its short name and whether it is done or going on.
export interface StepItem {
    key: MessageKey;
    state: 'done' | 'now';
}

// The steps after the download as the trail shows them: the ones that started, in their order, two that follow each other and do the same
// counted once (yt-dlp has several Fixup steps); the last one is going on while the job runs, and every one is done once it ended.
export function stepItems(steps: readonly string[], running: boolean): StepItem[] {
    const kinds = steps.map(processingKind).filter((kind, index, all) => {
        return index === 0 || all[index - 1] !== kind;
    });
    return kinds.map((kind, index): StepItem => {
        return { key: `job.step.${kind}`, state: running && index === kinds.length - 1 ? 'now' : 'done' };
    });
}

export function statusLabel(status: JobStatus, live: boolean, t: Translator, phase: LivePhase | null = null): string {
    if (phase !== null) {
        return t(`job.status.${phase}`);
    }
    return live && status === 'running' ? t('job.status.recording') : t(`job.status.${status}`);
}

// The list shows what is happening first (running, and a download that just finished, which stays a few seconds in its place, green), then
// what waits (queued), then what is over; inside each group the newest is on top. The queue itself keeps the order the downloads were added, which is the order they start in.
const DISPLAY_RANK: Record<JobStatus, number> = { running: 0, done: 0, paused: 1, queued: 2, error: 3, cancelled: 3 };

export function sortForDisplay(jobs: DownloadJob[]): DownloadJob[] {
    return jobs
        .map((job, index) => {
            return { job, index };
        })
        .sort((first, second) => {
            return DISPLAY_RANK[first.job.status] - DISPLAY_RANK[second.job.status] || second.index - first.index;
        })
        .map(({ job }) => {
            return job;
        });
}

export function formatPercent(percent: number): string {
    return `${percent.toFixed(1)}%`;
}

export function formatDuration(totalSeconds: number): string {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = String(seconds % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${String(minutes).padStart(2, '0')}:${rest}`;
}

const SIZE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

export function formatBytes(bytes: number): string {
    let value = Math.max(0, bytes);
    let unit = 0;
    while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${SIZE_UNITS[unit]}`;
}
