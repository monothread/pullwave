import type { MangaJob } from '@shared/manga';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { formatPercent } from './jobStatus';
import { jobStatusKey } from './mangaText';
import { useSmoothPercent } from '../hooks/useSmoothPercent';
import { MangaErrorNotice } from './MangaErrorNotice';

const ORDER: Record<MangaJob['status'], number> = { running: 0, paused: 1, queued: 2, error: 3, cancelled: 4, done: 5 };

function isFailed(job: MangaJob): boolean {
    return job.status === 'error' || job.status === 'cancelled';
}

function isFinished(job: MangaJob): boolean {
    return job.status === 'done' || job.status === 'error' || job.status === 'cancelled';
}

// The list on the downloads screen: the running ones first, then the waiting ones, then the ones that are over.
interface MangaJobBarProps {
    percent: number;
    title: string;
}

// The bar of a chapter being downloaded: it glides to each new value (the pages arrive one at a time) with the neon of the app.
function MangaJobBar({ percent, title }: MangaJobBarProps) {
    const shown = useSmoothPercent(percent);
    return (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-label={title}>
            <div className="progress__bar progress__bar--smooth" style={{ width: `${shown}%` }} />
        </div>
    );
}

export function MangaJobs() {
    const t = useTranslator();
    const jobs = useMangaStore((state) => {
        return state.jobs;
    });
    const cancelJob = useMangaStore((state) => {
        return state.cancelJob;
    });
    const retryJob = useMangaStore((state) => {
        return state.retryJob;
    });
    const pauseJob = useMangaStore((state) => {
        return state.pauseJob;
    });
    const resumeJob = useMangaStore((state) => {
        return state.resumeJob;
    });
    const clearFinishedJobs = useMangaStore((state) => {
        return state.clearFinishedJobs;
    });
    const retryFailedJobs = useMangaStore((state) => {
        return state.retryFailedJobs;
    });

    if (jobs.length === 0) {
        return <p className="empty">{t('manga.jobs.empty')}</p>;
    }
    const failed = jobs.filter(isFailed).length;
    const sorted = [...jobs].sort((first, second) => {
        return ORDER[first.status] - ORDER[second.status];
    });

    return (
        <section className="manga__jobs queue" aria-label={t('manga.jobs.label', { count: jobs.length })}>
            <div className="queue__toolbar">
                <span className="section-label">{t('manga.jobs.label', { count: jobs.length })}</span>
                {failed > 0 && (
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        onClick={() => {
                            void retryFailedJobs();
                        }}
                    >
                        {t('manga.jobs.retryAll', { count: failed })}
                    </button>
                )}
                {jobs.some(isFinished) && (
                    <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        onClick={() => {
                            void clearFinishedJobs();
                        }}
                    >
                        {t('manga.jobs.clear')}
                    </button>
                )}
            </div>
            {sorted.map((job) => {
                const title = `${job.mangaTitle} · ${job.chapterName}`;
                return (
                    <article key={job.chapterId} className={`job job--${job.status}`} data-testid="manga-job">
                        <header className="job__head">
                            <h3 className="job__title" title={title}>
                                {title}
                            </h3>
                            <span className="job__badges">
                                <span className={`badge badge--${job.status}`}>{t(jobStatusKey(job.status))}</span>
                            </span>
                        </header>
                        <MangaJobBar percent={job.percent} title={title} />
                        <div className="job__meta">
                            <span>{formatPercent(job.percent)}</span>
                            {job.pageCount > 0 && <span>{t('manga.jobs.pages', { done: job.pagesDone, total: job.pageCount })}</span>}
                        </div>
                        {job.error && (
                            <MangaErrorNotice error={job.error} />
                        )}
                        <div className="job__actions">
                            {job.status === 'running' && (
                                <button
                                    type="button"
                                    className="btn btn--small"
                                    onClick={() => {
                                        void pauseJob(job.chapterId);
                                    }}
                                >
                                    {t('manga.jobs.pause')}
                                </button>
                            )}
                            {job.status === 'paused' && (
                                <button
                                    type="button"
                                    className="btn btn--small btn--primary"
                                    onClick={() => {
                                        void resumeJob(job.chapterId);
                                    }}
                                >
                                    {t('manga.jobs.resume')}
                                </button>
                            )}
                            {(job.status === 'queued' || job.status === 'running' || job.status === 'paused') && (
                                <button
                                    type="button"
                                    className="btn btn--small btn--hot"
                                    onClick={() => {
                                        void cancelJob(job.chapterId);
                                    }}
                                >
                                    {t('manga.jobs.cancel')}
                                </button>
                            )}
                            {(job.status === 'error' || job.status === 'cancelled') && (
                                <button
                                    type="button"
                                    className="btn btn--small btn--primary"
                                    onClick={() => {
                                        void retryJob(job.chapterId);
                                    }}
                                >
                                    {t('manga.jobs.retry')}
                                </button>
                            )}
                        </div>
                    </article>
                );
            })}
        </section>
    );
}
