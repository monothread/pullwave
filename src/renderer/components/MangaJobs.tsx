import { IncrementalItems } from './IncrementalItems';
import type { MangaJob } from '@shared/manga';
import { DownloadHero } from '../downloads/DownloadHero';
import { formatSpeed } from '../downloads/speed';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { memo, useState } from 'react';
import { ConfirmButton } from './ConfirmButton';
import { formatDuration, formatPercent } from './jobStatus';
import { jobStatusKey } from './mangaText';
import { useSmoothPercent } from '../hooks/useSmoothPercent';
import { MangaErrorNotice } from './MangaErrorNotice';
import { MangaCover } from './MangaCover';
import { MangaManageDownloads } from './MangaManageDownloads';
import { useShownJobs } from '../hooks/useShownManga';

const ORDER: Record<MangaJob['status'], number> = { running: 0, paused: 1, queued: 2, error: 3, cancelled: 4, done: 5 };

function isFailed(job: MangaJob): boolean {
    return job.status === 'error' || job.status === 'cancelled';
}

function isPausable(job: MangaJob): boolean {
    return job.status === 'running' || job.status === 'queued';
}

function isRunning(job: MangaJob): boolean {
    return job.status === 'running';
}

function isQueued(job: MangaJob): boolean {
    return job.status === 'queued';
}

function isPaused(job: MangaJob): boolean {
    return job.status === 'paused';
}

function isManageable(job: MangaJob): boolean {
    return job.status === 'running' || job.status === 'queued' || job.status === 'paused';
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

// The speed and the time left of the chapter being downloaded, as the big card shows them ("" while they are not known).
function speedText(job: MangaJob): string {
    return job.bytesPerSecond === null ? '' : formatSpeed(job.bytesPerSecond);
}

function etaText(job: MangaJob): string {
    return job.etaSeconds === null ? '' : formatDuration(job.etaSeconds);
}

// One chapter of the queue. It is drawn again only when its download changes: the progress of one chapter does not draw the others again.
// Its actions ask the store as it is when they are used.
const MangaJobRow = memo(function MangaJobRow({ job }: { job: MangaJob }) {
    const t = useTranslator();
    const title = `${job.mangaTitle} · ${job.chapterName}`;
    return (
        <article className={`job job--${job.status}`} data-testid="manga-job">
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
                            void useMangaStore.getState().pauseJob(job.chapterId);
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
                            void useMangaStore.getState().resumeJob(job.chapterId);
                        }}
                    >
                        {t('manga.jobs.resume')}
                    </button>
                )}
                {(job.status === 'queued' || job.status === 'running' || job.status === 'paused') && (
                    <ConfirmButton
                        className="btn btn--small btn--hot"
                        dialog={{ title: t('confirm.jobCancel.title'), message: t('confirm.jobCancel.message'), confirmLabel: t('manga.jobs.cancel'), cancelLabel: t('confirm.back') }}
                        onConfirm={() => {
                            void useMangaStore.getState().cancelJob(job.chapterId);
                        }}
                    >
                        {t('manga.jobs.cancel')}
                    </ConfirmButton>
                )}
                {(job.status === 'error' || job.status === 'cancelled') && (
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        onClick={() => {
                            void useMangaStore.getState().retryJob(job.chapterId);
                        }}
                    >
                        {t('manga.jobs.retry')}
                    </button>
                )}
            </div>
        </article>
    );
});

export function MangaJobs() {
    const t = useTranslator();
    const [managing, setManaging] = useState(false);
    const jobs = useShownJobs();
    const queueHeld = useMangaStore((state) => {
        return state.queueHeld;
    });
    const library = useMangaStore((state) => {
        return state.library;
    });
    const pauseAllJobs = useMangaStore((state) => {
        return state.pauseAllJobs;
    });
    const resumeAllJobs = useMangaStore((state) => {
        return state.resumeAllJobs;
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
    // A held queue has nothing more to pause than the chapters resumed one by one; what waits there goes on with RESUME ALL.
    const canPauseAll = queueHeld ? jobs.some(isRunning) : jobs.some(isPausable);
    const canResumeAll = queueHeld || jobs.some(isPaused);
    const sorted = [...jobs].sort((first, second) => {
        return ORDER[first.status] - ORDER[second.status];
    });

    const running = jobs.find(isRunning);
    const waiting = jobs.filter(isQueued).length;
    const runningCover =
        running === undefined
            ? null
            : (library.find((manga) => {
                  return manga.id === running.mangaId;
              })?.thumbnailUrl ?? null);

    return (
        <section className="manga__jobs queue" aria-label={t('manga.jobs.label', { count: jobs.length })}>
            {running !== undefined && (
                <DownloadHero
                    id={`manga-${String(running.chapterId)}`}
                    title={running.mangaTitle}
                    detail={running.pageCount > 0 ? `${running.chapterName} · ${t('downloads.hero.pages', { done: running.pagesDone, total: running.pageCount })}` : running.chapterName}
                    percent={running.percent}
                    speed={speedText(running)}
                    eta={etaText(running)}
                    kind="manga"
                    cover={<MangaCover url={runningCover} />}
                    waiting={waiting}
                />
            )}
            <div className="queue__toolbar">
                <span className="section-label">{t('manga.jobs.label', { count: jobs.length })}</span>
                {canPauseAll && (
                    <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => {
                            void pauseAllJobs();
                        }}
                    >
                        {t('manga.jobs.pauseAll')}
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
                        {t('manga.jobs.resumeAll')}
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
                        {t('manga.jobs.manage')}
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
                        {t('manga.jobs.retryAll', { count: failed })}
                    </button>
                )}
                {jobs.some(isFinished) && (
                    <ConfirmButton
                        className="btn btn--small btn--ghost"
                        dialog={{ title: t('confirm.failedClear.title'), message: t('confirm.queueClear.message'), confirmLabel: t('manga.jobs.clear') }}
                        onConfirm={() => {
                            void clearFinishedJobs();
                        }}
                    >
                        {t('manga.jobs.clear')}
                    </ConfirmButton>
                )}
            </div>
            {managing && (
                <MangaManageDownloads
                    onClose={() => {
                        setManaging(false);
                    }}
                />
            )}
            {queueHeld && jobs.some(isQueued) && <p className="field__hint">{t('manga.jobs.held')}</p>}
            <IncrementalItems items={sorted} listKey="manga-jobs" end="div" renderItem={(job) => {
                return <MangaJobRow key={job.chapterId} job={job} />;
            }} />
        </section>
    );
}
