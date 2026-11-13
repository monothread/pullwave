import { IncrementalItems } from './IncrementalItems';
import { memo, useState } from 'react';
import type { AnimeJob } from '@shared/anime';
import { DownloadHero } from '../downloads/DownloadHero';
import { AnimeCover } from './AnimeCover';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { ConfirmButton } from './ConfirmButton';
import { animeErrorReport, animeStatusKey } from './animeText';
import { formatPercent } from './jobStatus';
import { hasParts, PartBars } from './PartBars';
import { ErrorNotice } from './ErrorNotice';
import { AnimeManageDownloads } from './AnimeManageDownloads';

const ORDER: Record<AnimeJob['status'], number> = { running: 0, paused: 1, queued: 2, error: 3, cancelled: 4, done: 5 };

function isFinished(job: AnimeJob): boolean {
    return job.status === 'done' || job.status === 'error' || job.status === 'cancelled';
}

function isFailed(job: AnimeJob): boolean {
    return job.status === 'error' || job.status === 'cancelled';
}

function isPausable(job: AnimeJob): boolean {
    return job.status === 'running' || job.status === 'queued';
}

function isRunning(job: AnimeJob): boolean {
    return job.status === 'running';
}

function isQueued(job: AnimeJob): boolean {
    return job.status === 'queued';
}

function isPaused(job: AnimeJob): boolean {
    return job.status === 'paused';
}

function isManageable(job: AnimeJob): boolean {
    return job.status === 'running' || job.status === 'queued' || job.status === 'paused';
}

// One episode of the queue. It is drawn again only when its download changes: the progress of one episode does not draw the others again.
// Its actions ask the store as it is when they are used.
const AnimeJobRow = memo(function AnimeJobRow({ job }: { job: AnimeJob }) {
    const t = useTranslator();
    const title = t('anime.job.title', { title: job.animeTitle, episode: job.episode });
    return (
        <article className={`job job--${job.status}`} data-testid="anime-job">
            <header className="job__head">
                <h3 className="job__title" title={title}>
                    {title}
                </h3>
                <span className="job__badges">
                    <span className={`badge badge--${job.status}`}>{t(animeStatusKey(job.status))}</span>
                </span>
            </header>
            {hasParts(job.parts) ? (
                <PartBars parts={job.parts} t={t} />
            ) : (
                <div
                    className="progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(job.percent)}
                    aria-label={t('anime.progress.aria', { title: job.animeTitle, episode: job.episode })}
                >
                    <div className="progress__bar" style={{ width: `${job.percent}%` }} />
                </div>
            )}
            <div className="job__meta">
                {!hasParts(job.parts) && <span>{formatPercent(job.percent)}</span>}
                {job.speed && <span>{job.speed}</span>}
                {job.eta && <span>{t('job.eta', { eta: job.eta })}</span>}
            </div>
            {job.error && (
                <p className="field__warning" role="alert">
                    <ErrorNotice report={animeErrorReport(t, job.error)} />
                </p>
            )}
            <div className="job__actions">
                {job.status === 'running' && (
                    <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => {
                            void useAnimeStore.getState().pauseJob(job.episodeId);
                        }}
                    >
                        {t('anime.job.pause')}
                    </button>
                )}
                {job.status === 'paused' && (
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        onClick={() => {
                            void useAnimeStore.getState().resumeJob(job.episodeId);
                        }}
                    >
                        {t('anime.job.resume')}
                    </button>
                )}
                {(job.status === 'queued' || job.status === 'running' || job.status === 'paused') && (
                    <ConfirmButton
                        className="btn btn--small btn--hot"
                        dialog={{ title: t('confirm.jobCancel.title'), message: t('confirm.jobCancel.message'), confirmLabel: t('anime.job.cancel'), cancelLabel: t('confirm.back') }}
                        onConfirm={() => {
                            void useAnimeStore.getState().cancelJob(job.episodeId);
                        }}
                    >
                        {t('anime.job.cancel')}
                    </ConfirmButton>
                )}
                {(job.status === 'error' || job.status === 'cancelled') && (
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        onClick={() => {
                            void useAnimeStore.getState().retryJob(job.episodeId);
                        }}
                    >
                        {t('anime.job.retry')}
                    </button>
                )}
            </div>
        </article>
    );
});

// The list on the downloads screen: the running ones first, then the waiting ones, then the ones that are over.
export function AnimeJobs() {
    const t = useTranslator();
    const [managing, setManaging] = useState(false);
    const jobs = useAnimeStore((state) => {
        return state.jobs;
    });
    const queueHeld = useAnimeStore((state) => {
        return state.queueHeld;
    });
    const clearFinishedJobs = useAnimeStore((state) => {
        return state.clearFinishedJobs;
    });
    const pauseAllJobs = useAnimeStore((state) => {
        return state.pauseAllJobs;
    });
    const resumeAllJobs = useAnimeStore((state) => {
        return state.resumeAllJobs;
    });
    const retryFailedJobs = useAnimeStore((state) => {
        return state.retryFailedJobs;
    });

    if (jobs.length === 0) {
        return <p className="empty">{t('anime.jobs.empty')}</p>;
    }
    const failed = jobs.filter(isFailed).length;
    // A held queue has nothing more to pause than the episodes resumed one by one; what waits there goes on with RESUME ALL.
    const canPauseAll = queueHeld ? jobs.some(isRunning) : jobs.some(isPausable);
    const canResumeAll = queueHeld || jobs.some(isPaused);
    const sorted = [...jobs].sort((first, second) => {
        return ORDER[first.status] - ORDER[second.status];
    });

    const running = jobs.find(isRunning);
    const waiting = jobs.filter(isQueued).length;

    return (
        <section className="anime__jobs queue" aria-label={t('anime.jobs.label', { count: jobs.length })}>
            {running !== undefined && (
                <DownloadHero
                    id={`anime-${String(running.episodeId)}`}
                    title={running.animeTitle}
                    detail={t('anime.episode', { number: running.episode })}
                    percent={running.percent}
                    parts={running.parts}
                    speed={running.speed}
                    eta={running.eta}
                    kind="anime"
                    cover={<AnimeCover title={running.animeTitle} />}
                    waiting={waiting}
                />
            )}
            <div className="queue__toolbar">
                <span className="section-label">{t('anime.jobs.label', { count: jobs.length })}</span>
                {canPauseAll && (
                    <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => {
                            void pauseAllJobs();
                        }}
                    >
                        {t('anime.jobs.pauseAll')}
                    </button>
                )}
                {canResumeAll && (
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        onClick={() => {
                            void resumeAllJobs();
                        }}
                    >
                        {t('anime.jobs.resumeAll')}
                    </button>
                )}
                {jobs.some(isManageable) && (
                    <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => {
                            setManaging(true);
                        }}
                    >
                        {t('anime.jobs.manage')}
                    </button>
                )}
                {failed > 0 && (
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        onClick={() => {
                            void retryFailedJobs();
                        }}
                    >
                        {t('anime.jobs.retryAll', { count: failed })}
                    </button>
                )}
                {jobs.some(isFinished) && (
                    <ConfirmButton
                        className="btn btn--small btn--ghost"
                        dialog={{ title: t('confirm.failedClear.title'), message: t('confirm.queueClear.message'), confirmLabel: t('anime.jobs.clear') }}
                        onConfirm={() => {
                            void clearFinishedJobs();
                        }}
                    >
                        {t('anime.jobs.clear')}
                    </ConfirmButton>
                )}
            </div>
            {managing && (
                <AnimeManageDownloads
                    onClose={() => {
                        setManaging(false);
                    }}
                />
            )}
            {queueHeld && jobs.some(isQueued) && <p className="field__hint">{t('anime.jobs.held')}</p>}
            <IncrementalItems items={sorted} listKey="anime-jobs" end="div" renderItem={(job) => {
                return <AnimeJobRow key={job.episodeId} job={job} />;
            }} />
        </section>
    );
}
