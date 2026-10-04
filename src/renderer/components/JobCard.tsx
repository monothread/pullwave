import type { DownloadJob } from '@shared/types';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { ErrorBanner } from './ErrorBanner';
import { canFindStream, livePhase, statusLabel } from './jobStatus';
import { JobMeta, JobProgress } from './JobProgress';
import { StreamFinder } from './StreamFinder';

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
    // A live recording left behind may still be playable, so deleting it is confirmed first.
    const confirmDeletion = (): boolean => {
        return !(job.live && job.hasPartial) || window.confirm(t('job.confirmLivePartial'));
    };
    const searchOpen = useAppStore((state) => {
        return state.streamSearches[job.id] !== undefined;
    });
    const findStreams = useAppStore((state) => {
        return state.findStreams;
    });
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
                    onFindStream={
                        canFindStream(job.error, job.pageUrl) && !searchOpen
                            ? () => {
                                  void findStreams(job.id, false);
                              }
                            : undefined
                    }
                    findStreamLabel={job.pageUrl !== null ? t('job.findFresh') : t('errorBanner.findStream')}
                />
            )}
            <StreamFinder jobId={job.id} />
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
                    <button
                        type="button"
                        className="btn btn--small btn--hot"
                        onClick={() => {
                            onCancel(job.id);
                        }}
                    >
                        {t('job.cancel')}
                    </button>
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
                    <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => {
                            if (confirmDeletion()) {
                                onClearPartials(job.id);
                            }
                        }}
                    >
                        {t('job.clearPartial')}
                    </button>
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
                    <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        onClick={() => {
                            if (confirmDeletion()) {
                                onRemove(job.id);
                            }
                        }}
                    >
                        {t('job.remove')}
                    </button>
                )}
            </div>
        </article>
    );
}
