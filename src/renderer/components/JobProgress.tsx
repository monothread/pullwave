import type { Translator } from '@shared/i18n';
import type { DownloadJob } from '@shared/types';
import { formatBytes, formatDuration, formatPercent, processingTextKey, type LivePhase } from './jobStatus';
import { hasParts, PartBars } from './PartBars';

interface JobProgressProps {
    job: DownloadJob;
    phase: LivePhase | null;
    t: Translator;
}

// The bar of a card: sweeping while the downloaded file is processed, while a stopped recording is saved or its parts of a recording are joined, draining while a live stream's end is checked, sweeping while waiting for one to start,
// striped while recording it, one bar for each part when the video and the audio are downloaded apart, and a percentage otherwise.
export function JobProgress({ job, phase, t }: JobProgressProps) {
    if (phase === 'verifying' && job.endCheck !== null) {
        return (
            <div
                className="progress progress--verify"
                role="progressbar"
                aria-label={t('job.verifyingLabel')}
                aria-valuemin={0}
                aria-valuemax={job.endCheck.totalSeconds}
                aria-valuenow={job.endCheck.secondsLeft}
            >
                <div className="progress__bar" style={{ animationDuration: `${job.endCheck.totalSeconds}s` }} />
            </div>
        );
    }
    if (phase === 'processing') {
        return (
            <div className="progress progress--processing" role="progressbar" aria-label={t('job.processingLabel')}>
                <div className="progress__bar" />
            </div>
        );
    }
    if (phase === 'saving') {
        return (
            <div className="progress progress--saving" role="progressbar" aria-label={t('job.savingLabel')}>
                <div className="progress__bar" />
            </div>
        );
    }
    if (phase === 'merging') {
        return (
            <div className="progress progress--merging" role="progressbar" aria-label={t('job.mergingLabel')}>
                <div className="progress__bar" />
            </div>
        );
    }
    if (phase === 'waiting') {
        return (
            <div className="progress progress--waiting" role="progressbar" aria-label={t('job.waitingLabel')}>
                <div className="progress__bar" />
            </div>
        );
    }
    if (job.live && job.status === 'running') {
        return (
            <div className="progress progress--live" role="progressbar" aria-label={t('job.recordingLabel')}>
                <div className="progress__bar" />
            </div>
        );
    }
    if (hasParts(job.parts)) {
        return <PartBars parts={job.parts} t={t} />;
    }
    return (
        <div
            className="progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(job.percent)}
            aria-label={t('job.progressLabel')}
        >
            <div className="progress__bar" style={{ width: `${job.percent}%` }} />
        </div>
    );
}

export function JobMeta({ job, phase, t }: JobProgressProps) {
    return (
        <div className="job__meta">
            <JobMetaMain job={job} phase={phase} t={t} />
            {phase !== 'processing' && job.speed && <span>{job.speed}</span>}
            {phase !== 'processing' && job.eta && <span>{t('job.eta', { eta: job.eta })}</span>}
        </div>
    );
}

function JobMetaMain({ job, phase, t }: JobProgressProps) {
    if (phase === 'verifying' && job.endCheck !== null) {
        return <span className="job__verifying">{t('job.verifyingText', { seconds: job.endCheck.secondsLeft })}</span>;
    }
    if (phase === 'processing') {
        return <span className="job__processing">{t(processingTextKey(job.postProcess))}</span>;
    }
    if (phase === 'saving') {
        return <span className="job__saving">{t('job.savingText')}</span>;
    }
    if (phase === 'merging') {
        return <span className="job__merging">{t('job.mergingText')}</span>;
    }
    if (phase === 'waiting') {
        return <span className="job__waiting">{t('job.waitingText')}</span>;
    }
    if (job.live && job.status === 'running') {
        return (
            <>
                <span className="job__live">{t('job.live')}</span>
                <span>{formatDuration(job.elapsedSeconds)}</span>
                <span>{formatBytes(job.downloadedBytes)}</span>
            </>
        );
    }
    // Each part has its percentage beside its bar.
    if (hasParts(job.parts)) {
        return null;
    }
    return <span>{formatPercent(job.percent)}</span>;
}
