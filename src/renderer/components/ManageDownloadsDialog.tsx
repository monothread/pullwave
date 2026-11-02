import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MessageKey } from '@shared/i18n';
import { useModalDialog } from '../hooks/useModalDialog';
import { useTranslator } from '../i18n/useTranslator';
import { ConfirmButton } from './ConfirmButton';

// What one manga or anime has going on: how many of its chapters or episodes are downloading, waiting and paused.
export interface DownloadGroup {
    id: number;
    title: string;
    running: number;
    queued: number;
    paused: number;
}

type ActiveStatus = 'running' | 'queued' | 'paused';

function isActiveStatus(status: string): status is ActiveStatus {
    return status === 'running' || status === 'queued' || status === 'paused';
}

// The mangas or anime with a download to manage (running, waiting or paused), in the order their first job appears in the list.
export function groupActiveDownloads<T extends { status: string }>(jobs: readonly T[], idOf: (job: T) => number, titleOf: (job: T) => string): DownloadGroup[] {
    const groups = new Map<number, DownloadGroup>();
    jobs.forEach((job) => {
        if (!isActiveStatus(job.status)) {
            return;
        }
        const id = idOf(job);
        const group = groups.get(id) ?? { id, title: titleOf(job), running: 0, queued: 0, paused: 0 };
        group[job.status] += 1;
        groups.set(id, group);
    });
    return [...groups.values()];
}

// The words of the window (it is the same for the manga and for the anime, with the words of each).
export interface ManageDownloadsLabels {
    title: MessageKey;
    hint: MessageKey;
    all: MessageKey;
    counts: MessageKey;
    pause: MessageKey;
    resume: MessageKey;
    cancel: MessageKey;
    close: MessageKey;
    empty: MessageKey;
    cancelTitle: MessageKey;
    cancelMessage: MessageKey;
}

interface ManageDownloadsDialogProps {
    groups: readonly DownloadGroup[];
    labels: ManageDownloadsLabels;
    onPause: (ids: number[]) => void;
    onResume: (ids: number[]) => void;
    onCancel: (ids: number[]) => void;
    onClose: () => void;
}

// A window to pick mangas or anime and pause, resume or cancel all their downloads at once (picking all of them is how everything is
// paused or cancelled). Pausing leaves the rest of the queue as it is.
export function ManageDownloadsDialog({ groups, labels, onPause, onResume, onCancel, onClose }: ManageDownloadsDialogProps) {
    const t = useTranslator();
    const titleId = useId();
    const { dialogRef, handleKeyDown } = useModalDialog(onClose, true);
    const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());

    // One whose downloads all ended while the window was open is no longer on the list, so it is no longer picked.
    const selected = groups.filter((group) => {
        return picked.has(group.id);
    });
    const selectedIds = selected.map((group) => {
        return group.id;
    });
    const allPicked = groups.length > 0 && selected.length === groups.length;
    const canPause = selected.some((group) => {
        return group.running + group.queued > 0;
    });
    const canResume = selected.some((group) => {
        return group.paused > 0;
    });

    function toggle(id: number, checked: boolean): void {
        setPicked((current) => {
            const next = new Set(current);
            if (checked) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });
    }

    function toggleAll(checked: boolean): void {
        setPicked(
            new Set(
                checked
                    ? groups.map((group) => {
                          return group.id;
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
                    {t(labels.title)}
                </h2>
                <p className="modal__hint">{t(labels.hint)}</p>
                {groups.length === 0 ? (
                    <p className="empty">{t(labels.empty)}</p>
                ) : (
                    <>
                        <label className="toggle">
                            <input
                                type="checkbox"
                                aria-label={t(labels.all)}
                                checked={allPicked}
                                onChange={(event) => {
                                    toggleAll(event.target.checked);
                                }}
                            />
                            <span>{t(labels.all)}</span>
                        </label>
                        <ul className="modal__list" aria-label={t(labels.title)}>
                            {groups.map((group) => {
                                return (
                                    <li key={group.id}>
                                        <label className="toggle">
                                            <input
                                                type="checkbox"
                                                aria-label={group.title}
                                                checked={picked.has(group.id)}
                                                onChange={(event) => {
                                                    toggle(group.id, event.target.checked);
                                                }}
                                            />
                                            <span>
                                                {group.title} · {t(labels.counts, { running: group.running, queued: group.queued, paused: group.paused })}
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
                        {t(labels.close)}
                    </button>
                    <button
                        type="button"
                        className="btn btn--small"
                        disabled={!canPause}
                        onClick={() => {
                            onPause(selectedIds);
                        }}
                    >
                        {t(labels.pause)}
                    </button>
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        disabled={!canResume}
                        onClick={() => {
                            onResume(selectedIds);
                        }}
                    >
                        {t(labels.resume)}
                    </button>
                    <ConfirmButton
                        className="btn btn--small btn--hot"
                        disabled={selected.length === 0}
                        dialog={{ title: t(labels.cancelTitle), message: t(labels.cancelMessage), confirmLabel: t(labels.cancel), cancelLabel: t('confirm.back') }}
                        onConfirm={() => {
                            onCancel(selectedIds);
                        }}
                    >
                        {t(labels.cancel)}
                    </ConfirmButton>
                </div>
            </div>
        </div>,
        document.body
    );
}
