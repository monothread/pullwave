import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MangaJob } from '@shared/manga';
import { useModalDialog } from '../hooks/useModalDialog';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { ConfirmButton } from './ConfirmButton';
import { useShownJobs } from '../hooks/useShownManga';

// What one manga has going on: how many of its chapters are downloading, waiting and paused.
export interface MangaDownloadGroup {
    mangaId: number;
    title: string;
    running: number;
    queued: number;
    paused: number;
}

// The mangas with a download to manage (running, waiting or paused), in the order their first chapter appears in the list.
export function groupActiveJobs(jobs: readonly MangaJob[]): MangaDownloadGroup[] {
    const groups = new Map<number, MangaDownloadGroup>();
    jobs.forEach((job) => {
        if (job.status !== 'running' && job.status !== 'queued' && job.status !== 'paused') {
            return;
        }
        const group = groups.get(job.mangaId) ?? { mangaId: job.mangaId, title: job.mangaTitle, running: 0, queued: 0, paused: 0 };
        group[job.status] += 1;
        groups.set(job.mangaId, group);
    });
    return [...groups.values()];
}

interface MangaManageDownloadsProps {
    onClose: () => void;
}

// A window to pick mangas and pause, resume or cancel all their downloads at once (picking all of them is how everything is paused or
// cancelled). Pausing leaves the rest of the queue as it is.
export function MangaManageDownloads({ onClose }: MangaManageDownloadsProps) {
    const t = useTranslator();
    const titleId = useId();
    const { dialogRef, handleKeyDown } = useModalDialog(onClose, true);
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
    const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());

    const groups = groupActiveJobs(jobs);
    // A manga whose downloads all ended while the window was open is no longer on the list, so it is no longer picked.
    const selected = groups.filter((group) => {
        return picked.has(group.mangaId);
    });
    const selectedIds = selected.map((group) => {
        return group.mangaId;
    });
    const allPicked = groups.length > 0 && selected.length === groups.length;
    const canPause = selected.some((group) => {
        return group.running + group.queued > 0;
    });
    const canResume = selected.some((group) => {
        return group.paused > 0;
    });

    function toggle(mangaId: number, checked: boolean): void {
        setPicked((current) => {
            const next = new Set(current);
            if (checked) {
                next.add(mangaId);
            } else {
                next.delete(mangaId);
            }
            return next;
        });
    }

    function toggleAll(checked: boolean): void {
        setPicked(
            new Set(
                checked
                    ? groups.map((group) => {
                          return group.mangaId;
                      })
                    : []
            )
        );
    }

    return createPortal(
        <div
            className="modal-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <div ref={dialogRef} className="modal modal--wide" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}>
                <h2 id={titleId} className="modal__title">
                    {t('manga.manage.title')}
                </h2>
                <p className="modal__hint">{t('manga.manage.hint')}</p>
                {groups.length === 0 ? (
                    <p className="empty">{t('manga.manage.empty')}</p>
                ) : (
                    <>
                        <label className="toggle">
                            <input
                                type="checkbox"
                                aria-label={t('manga.manage.all')}
                                checked={allPicked}
                                onChange={(event) => {
                                    toggleAll(event.target.checked);
                                }}
                            />
                            <span>{t('manga.manage.all')}</span>
                        </label>
                        <ul className="modal__list" aria-label={t('manga.manage.title')}>
                            {groups.map((group) => {
                                return (
                                    <li key={group.mangaId}>
                                        <label className="toggle">
                                            <input
                                                type="checkbox"
                                                aria-label={group.title}
                                                checked={picked.has(group.mangaId)}
                                                onChange={(event) => {
                                                    toggle(group.mangaId, event.target.checked);
                                                }}
                                            />
                                            <span>
                                                {group.title} · {t('manga.manage.counts', { running: group.running, queued: group.queued, paused: group.paused })}
                                            </span>
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    </>
                )}
                <div className="modal__actions">
                    <button type="button" className="btn btn--small btn--ghost" onClick={onClose}>
                        {t('manga.manage.close')}
                    </button>
                    <button
                        type="button"
                        className="btn btn--small"
                        disabled={!canPause}
                        onClick={() => {
                            void pauseMangaJobs(selectedIds);
                        }}
                    >
                        {t('manga.manage.pause')}
                    </button>
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        disabled={!canResume}
                        onClick={() => {
                            void resumeMangaJobs(selectedIds);
                        }}
                    >
                        {t('manga.manage.resume')}
                    </button>
                    <ConfirmButton
                        className="btn btn--small btn--hot"
                        disabled={selected.length === 0}
                        dialog={{ title: t('confirm.manageCancel.title'), message: t('confirm.manageCancel.message'), confirmLabel: t('manga.manage.cancel'), cancelLabel: t('confirm.back') }}
                        onConfirm={() => {
                            void cancelMangaJobs(selectedIds);
                        }}
                    >
                        {t('manga.manage.cancel')}
                    </ConfirmButton>
                </div>
            </div>
        </div>,
        document.body
    );
}
