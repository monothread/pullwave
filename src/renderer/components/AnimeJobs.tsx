import type { AnimeJob } from '@shared/anime';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { ConfirmButton } from './ConfirmButton';
import { animeErrorKey, animeStatusKey } from './animeText';
import { formatPercent } from './jobStatus';

const ORDER: Record<AnimeJob['status'], number> = { running: 0, paused: 1, queued: 2, error: 3, cancelled: 4, done: 5 };

function isFinished(job: AnimeJob): boolean {
    return job.status === 'done' || job.status === 'error' || job.status === 'cancelled';
}

// The list on the downloads screen: the running ones first, then the waiting ones, then the ones that are over.
export function AnimeJobs() {
    const t = useTranslator();
    const jobs = useAnimeStore((state) => {
        return state.jobs;
    });
    const cancelJob = useAnimeStore((state) => {
        return state.cancelJob;
    });
    const retryJob = useAnimeStore((state) => {
        return state.retryJob;
    });
    const pauseJob = useAnimeStore((state) => {
        return state.pauseJob;
    });
    const resumeJob = useAnimeStore((state) => {
        return state.resumeJob;
    });
    const clearFinishedJobs = useAnimeStore((state) => {
        return state.clearFinishedJobs;
    });

    if (jobs.length === 0) {
        return <p className="empty">{t('anime.jobs.empty')}</p>;
    }
    const sorted = [...jobs].sort((first, second) => {
        return ORDER[first.status] - ORDER[second.status];
    });

    return (
        <section className="anime__jobs queue" aria-label={t('anime.jobs.label', { count: jobs.length })}>
            <div className="queue__toolbar">
                <span className="section-label">{t('anime.jobs.label', { count: jobs.length })}</span>
                {jobs.some(isFinished) && (
                    <ConfirmButton
                        className="btn btn--small btn--ghost"
                        dialog={{ title: t('confirm.queueClear.title'), message: t('confirm.queueClear.message'), confirmLabel: t('anime.jobs.clear') }}
                        onConfirm={() => {
                            void clearFinishedJobs();
                        }}
                    >
                        {t('anime.jobs.clear')}
                    </ConfirmButton>
                )}
            </div>
            {sorted.map((job) => {
                const title = t('anime.job.title', { title: job.animeTitle, episode: job.episode });
                return (
                    <article key={job.episodeId} className={`job job--${job.status}`} data-testid="anime-job">
                        <header className="job__head">
                            <h3 className="job__title" title={title}>
                                {title}
                            </h3>
                            <span className="job__badges">
                                <span className={`badge badge--${job.status}`}>{t(animeStatusKey(job.status))}</span>
                            </span>
                        </header>
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
                        <div className="job__meta">
                            <span>{formatPercent(job.percent)}</span>
                            {job.speed && <span>{job.speed}</span>}
                            {job.eta && <span>{t('job.eta', { eta: job.eta })}</span>}
                        </div>
                        {job.error && (
                            <p className="field__warning" role="alert" title={job.error.raw}>
                                {t(animeErrorKey(job.error.code))}
                            </p>
                        )}
                        <div className="job__actions">
                            {job.status === 'running' && (
                                <button
                                    type="button"
                                    className="btn btn--small"
                                    onClick={() => {
                                        void pauseJob(job.episodeId);
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
                                        void resumeJob(job.episodeId);
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
                                        void cancelJob(job.episodeId);
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
                                        void retryJob(job.episodeId);
                                    }}
                                >
                                    {t('anime.job.retry')}
                                </button>
                            )}
                        </div>
                    </article>
                );
            })}
        </section>
    );
}
