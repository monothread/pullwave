import type { DownloadJob } from '@shared/types';
import { useTranslator } from '../i18n/useTranslator';
import { ConfirmButton } from './ConfirmButton';
import { ErrorBanner } from './ErrorBanner';
import { livePhase, statusLabel } from './jobStatus';
import { JobMeta, JobProgress } from './JobProgress';

interface JobCardProps {
    job: DownloadJob;
    onCancel: (id: string) => void;
    onPause: (id: string) => void;
    onResume: (id: string) => void;
    onStop: (id: string) => void;
    onRetry: (id: string) => void;
    onRemove: (id: string) => void;
    onClearPartials: (id: string) => void;
    onShowFile: (path: string) => void;
}

export function JobCard({ job, onCancel, onPause, onResume, onStop, onRetry, onRemove, onClearPartials, onShowFile }: JobCardProps) {
    const t = useTranslator();
    const isActive = job.status === 'queued' || job.status === 'running' || job.status === 'paused';
    const phase = livePhase(job);
    const isRecording = job.live && job.status === 'running' && phase === null;
    const canRetry = job.status === 'error' || job.status === 'cancelled';
    // A plain download that is running (not a live recording, nor one closing its file) can be paused.
    const canPause = job.status === 'running' && !job.live && phase === null;
    // A live recording left behind may still be playable, so its window warns about that.
    const livePartialKept = job.live && job.hasPartial;
    const partialMessage = livePartialKept ? t('job.confirmLivePartial') : undefined;
    return (
        <article className={`job job--${job.status}${phase === null ? '' : ` job--${phase}`}`} data-testid="job-card">
            <header className="job__head">
                <h3 className="job__title" title={job.title ?? job.url}>
                    {job.title ?? job.url}
                </h3>
                <span className="job__badges">
                    {job.customized && <span className="badge badge--custom" title={t('job.customizedHint')}>{t('job.customized')}</span>}
                    <span className={`badge badge--${phase ?? job.status}`}>{statusLabel(job.status, job.live, t, phase)}</span>
                </span>
            </header>
            <JobProgress job={job} phase={phase} t={t} />
            <JobMeta job={job} phase={phase} t={t} />
            {job.status === 'paused' && !job.hasPartial && <p className="field__hint">{t('job.pausedNoPartial')}</p>}
            {job.error && (
                <ErrorBanner
                    error={job.error}
                    onRetry={() => {
                        onRetry(job.id);
                    }}
                />
            )}
            <div className="job__actions">
                {isRecording && (
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        onClick={() => {
                            onStop(job.id);
                        }}
                    >
                        {t('job.stopSave')}
                    </button>
                )}
                {phase === 'verifying' && (
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        onClick={() => {
                            onStop(job.id);
                        }}
                    >
                        {t('job.finishNow')}
                    </button>
                )}
                {canPause && (
                    <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => {
                            onPause(job.id);
                        }}
                    >
                        {t('job.pause')}
                    </button>
                )}
                {job.status === 'paused' && (
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        onClick={() => {
                            onResume(job.id);
                        }}
                    >
                        {t('job.resume')}
                    </button>
                )}
                {isActive && phase !== 'verifying' && phase !== 'merging' && phase !== 'saving' && phase !== 'processing' && (
                    <ConfirmButton
                        className="btn btn--small btn--hot"
                        dialog={{ title: t('confirm.jobCancel.title'), message: t('confirm.jobCancel.message'), confirmLabel: t('job.cancel'), cancelLabel: t('confirm.back') }}
                        onConfirm={() => {
                            onCancel(job.id);
                        }}
                    >
                        {t('job.cancel')}
                    </ConfirmButton>
                )}
                {canRetry && !job.error && (
                    <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => {
                            onRetry(job.id);
                        }}
                    >
                        {t('job.retry')}
                    </button>
                )}
                {canRetry && job.hasPartial && (
                    <ConfirmButton
                        className="btn btn--small"
                        dialog={{ title: t('confirm.clearPartials.title'), message: partialMessage ?? t('confirm.clearPartials.message'), confirmLabel: t('job.clearPartial') }}
                        onConfirm={() => {
                            onClearPartials(job.id);
                        }}
                    >
                        {t('job.clearPartial')}
                    </ConfirmButton>
                )}
                {job.status === 'done' && job.filePath && (
                    <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => {
                            onShowFile(job.filePath ?? '');
                        }}
                    >
                        {t('job.showFile')}
                    </button>
                )}
                {!isActive && (
                    <ConfirmButton
                        className="btn btn--small btn--ghost"
                        dialog={{ title: t('confirm.jobRemove.title'), message: partialMessage ?? t('confirm.jobRemove.message'), confirmLabel: t('job.remove') }}
                        onConfirm={() => {
                            onRemove(job.id);
                        }}
                    >
                        {t('job.remove')}
                    </ConfirmButton>
                )}
            </div>
        </article>
    );
}
