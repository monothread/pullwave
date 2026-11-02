import type { AnimeJob } from '@shared/anime';
import { useAnimeStore } from '../store/animeStore';
import { groupActiveDownloads, ManageDownloadsDialog, type DownloadGroup, type ManageDownloadsLabels } from './ManageDownloadsDialog';

const LABELS: ManageDownloadsLabels = {
    title: 'anime.manage.title',
    hint: 'anime.manage.hint',
    all: 'anime.manage.all',
    counts: 'anime.manage.counts',
    pause: 'anime.manage.pause',
    resume: 'anime.manage.resume',
    cancel: 'anime.manage.cancel',
    close: 'anime.manage.close',
    empty: 'anime.manage.empty',
    cancelTitle: 'confirm.animeManageCancel.title',
    cancelMessage: 'confirm.animeManageCancel.message'
};

// The anime with a download to manage (running, waiting or paused), in the order their first episode appears in the list.
export function groupActiveAnimeJobs(jobs: readonly AnimeJob[]): DownloadGroup[] {
    return groupActiveDownloads(
        jobs,
        (job) => {
            return job.animeId;
        },
        (job) => {
            return job.animeTitle;
        }
    );
}

interface AnimeManageDownloadsProps {
    onClose: () => void;
}

// The window to pause, resume and cancel the downloads of the anime picked.
export function AnimeManageDownloads({ onClose }: AnimeManageDownloadsProps) {
    const jobs = useAnimeStore((state) => {
        return state.jobs;
    });
    const pauseAnimeJobs = useAnimeStore((state) => {
        return state.pauseAnimeJobs;
    });
    const resumeAnimeJobs = useAnimeStore((state) => {
        return state.resumeAnimeJobs;
    });
    const cancelAnimeJobs = useAnimeStore((state) => {
        return state.cancelAnimeJobs;
    });
    return (
        <ManageDownloadsDialog
            groups={groupActiveAnimeJobs(jobs)}
            labels={LABELS}
            onPause={(ids) => {
                void pauseAnimeJobs(ids);
            }}
            onResume={(ids) => {
                void resumeAnimeJobs(ids);
            }}
            onCancel={(ids) => {
                void cancelAnimeJobs(ids);
            }}
            onClose={onClose}
        />
    );
}
