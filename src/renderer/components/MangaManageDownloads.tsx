import type { MangaJob } from '@shared/manga';
import { useShownJobs } from '../hooks/useShownManga';
import { useMangaStore } from '../store/mangaStore';
import { groupActiveDownloads, ManageDownloadsDialog, type DownloadGroup, type ManageDownloadsLabels } from './ManageDownloadsDialog';

const LABELS: ManageDownloadsLabels = {
    title: 'manga.manage.title',
    hint: 'manga.manage.hint',
    all: 'manga.manage.all',
    counts: 'manga.manage.counts',
    pause: 'manga.manage.pause',
    resume: 'manga.manage.resume',
    cancel: 'manga.manage.cancel',
    close: 'manga.manage.close',
    empty: 'manga.manage.empty',
    cancelTitle: 'confirm.manageCancel.title',
    cancelMessage: 'confirm.manageCancel.message'
};

export function groupActiveJobs(jobs: readonly MangaJob[]): DownloadGroup[] {
    return groupActiveDownloads(
        jobs,
        (job) => {
            return job.mangaId;
        },
        (job) => {
            return job.mangaTitle;
        }
    );
}

interface MangaManageDownloadsProps {
    onClose: () => void;
}

export function MangaManageDownloads({ onClose }: MangaManageDownloadsProps) {
    const jobs = useShownJobs();
    const pauseMangaJobs = useMangaStore((state) => {
        return state.pauseMangaJobs;
    });
    const resumeMangaJobs = useMangaStore((state) => {
        return state.resumeMangaJobs;
    });
    const cancelMangaJobs = useMangaStore((state) => {
        return state.cancelMangaJobs;
    });
    return (
        <ManageDownloadsDialog
            groups={groupActiveJobs(jobs)}
            labels={LABELS}
            onPause={(ids) => {
                void pauseMangaJobs(ids);
            }}
            onResume={(ids) => {
                void resumeMangaJobs(ids);
            }}
            onCancel={(ids) => {
                void cancelMangaJobs(ids);
            }}
            onClose={onClose}
        />
    );
}
