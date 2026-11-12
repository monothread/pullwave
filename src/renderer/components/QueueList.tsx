import { IncrementalItems } from './IncrementalItems';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { ConfirmButton } from './ConfirmButton';
import { JobCard } from './JobCard';
import { sortForDisplay } from './jobStatus';
import { DownloadHero } from '../downloads/DownloadHero';
import { VideoThumbnail } from '../downloads/VideoThumbnail';

// The actions of the cards, the same for every card and every drawing (so a card whose download did not change is not drawn again). They
// ask the store as it is when they are used.
const JOB_ACTIONS = {
    onCancel: (id: string): void => {
        void useAppStore.getState().cancelJob(id);
    },
    onPause: (id: string): void => {
        void useAppStore.getState().pauseJob(id);
    },
    onResume: (id: string): void => {
        void useAppStore.getState().resumeJob(id);
    },
    onStop: (id: string): void => {
        void useAppStore.getState().stopJob(id);
    },
    onRetry: (id: string): void => {
        void useAppStore.getState().retryJob(id);
    },
    onRemove: (id: string): void => {
        void useAppStore.getState().removeJob(id);
    },
    onClearPartials: (id: string): void => {
        void useAppStore.getState().clearPartialFiles(id);
    },
    onShowFile: (path: string): void => {
        void window.api.showItemInFolder(path);
    }
};

export function QueueList() {
    const t = useTranslator();
    const jobs = useAppStore((state) => {
        return state.jobs;
    });
    const clearFinished = useAppStore((state) => {
        return state.clearFinished;
    });
    const hasFinished = jobs.some((job) => {
        return job.status === 'done' || job.status === 'error' || job.status === 'cancelled';
    });

    if (jobs.length === 0) {
        return <p className="empty">{t('queue.empty')}</p>;
    }

    const running = jobs.find((job) => {
        return job.status === 'running' && !job.live;
    });
    const waiting = jobs.filter((job) => {
        return job.status === 'queued';
    }).length;

    return (
        <section className="queue" aria-label={t('queue.aria')}>
            {running !== undefined && (
                <DownloadHero
                    id={running.id}
                    title={running.title ?? running.url}
                    detail={null}
                    percent={running.percent}
                    speed={running.speed}
                    eta={running.eta}
                    kind="downloads"
                    cover={running.thumbnail === null ? null : <VideoThumbnail key={running.thumbnail} src={running.thumbnail} />}
                    coverShape={running.thumbnail === null ? 'poster' : 'wide'}
                    waiting={waiting}
                />
            )}
            <div className="queue__toolbar">
                <span className="section-label">{t('queue.label', { count: jobs.length })}</span>
                {hasFinished && (
                    <ConfirmButton
                        className="btn btn--small btn--ghost"
                        dialog={{ title: t('confirm.queueClear.title'), message: t('confirm.queueClear.message'), confirmLabel: t('queue.clearFinished') }}
                        onConfirm={() => {
                            void clearFinished();
                        }}
                    >
                        {t('queue.clearFinished')}
                    </ConfirmButton>
                )}
            </div>
            <IncrementalItems items={sortForDisplay(jobs)} listKey="download-queue" end="div" renderItem={(job) => {
                return (
                    <JobCard key={job.id} job={job} {...JOB_ACTIONS} />
                );
            }} />
        </section>
    );
}
