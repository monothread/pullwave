import type { Translator } from '@shared/i18n';
import type { DownloadJob } from '@shared/types';
import { formatBytes, formatDuration, formatPercent, processingTextKey, type LivePhase } from './jobStatus';
import { usePerformanceMode } from '../hooks/usePerformanceMode';
import { useZipPhase } from '../hooks/useZipPhase';
import { hasParts } from './PartBars';
import { PartsZipper } from './PartsZipper';

interface JobProgressProps {
    job: DownloadJob;
    phase: LivePhase | null;
    t: Translator;
}

export function isJoined(job: Pick<DownloadJob, 'postProcess' | 'status'>): boolean {
    return job.postProcess !== null || job.status === 'done';
}

export function JobProgress({ job, phase, t }: JobProgressProps) {
    const performanceMode = usePerformanceMode();
    const zip = useZipPhase(isJoined(job));
    if (hasParts(job.parts) && zip !== 'joined' && (phase === null || phase === 'processing') && !(job.live && job.status === 'running')) {
        return <PartsZipper parts={job.parts} phase={zip} t={t} />;
    }
    if (phase === 'verifying' && job.endCheck !== null) {
        const remaining = job.endCheck.totalSeconds > 0 ? Math.min(100, Math.max(0, (job.endCheck.secondsLeft / job.endCheck.totalSeconds) * 100)) : 0;
        const barStyle = performanceMode ? { width: `${String(remaining)}%` } : { animationDuration: `${job.endCheck.totalSeconds}s` };
        return (
            <div
                className="progress progress--verify"
                role="progressbar"
                aria-label={t('job.verifyingLabel')}
                aria-valuemin={0}
                aria-valuemax={job.endCheck.totalSeconds}
                aria-valuenow={job.endCheck.secondsLeft}
            >
                <div className="progress__bar" style={barStyle} />
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
    if (hasParts(job.parts)) {
        return null;
    }
    return <span>{formatPercent(job.percent)}</span>;
}
