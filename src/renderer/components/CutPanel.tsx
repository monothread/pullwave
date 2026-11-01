import { useEffect, useState, type DragEvent } from 'react';
import type { MessageKey } from '@shared/i18n';
import type { CutRun, CutSegmentState, CutSegmentStatus } from '@shared/cut';
import { useSmoothPercent } from '../hooks/useSmoothPercent';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { useCutStore } from '../store/cutStore';
import { checkRow, formatClock, problemKey, segmentsToCut } from './cutText';
import { TextField, ToggleField } from './fields';
import { LoadingMark } from './LoadingMark';

const STATUS_KEYS: Record<CutSegmentStatus, MessageKey> = {
    waiting: 'cut.status.waiting',
    cutting: 'cut.status.cutting',
    done: 'cut.status.done',
    error: 'cut.status.error',
    cancelled: 'cut.status.cancelled'
};

const CHOOSE_ERROR_KEYS = {
    unreadable: 'cut.error.unreadable',
    'no-ffmpeg': 'cut.error.no-ffmpeg',
    dropped: 'cut.error.dropped'
} as const satisfies Record<string, MessageKey>;

const STATUS_BADGES: Record<CutSegmentStatus, string> = {
    waiting: 'badge--waiting',
    cutting: 'badge--running',
    done: 'badge--done',
    error: 'badge--error',
    cancelled: 'badge--cancelled'
};

interface PartBarProps {
    percent: number;
    label: string;
}

// The bar of the part being cut: it glides to each new value (ffmpeg reports a few times a second) with the neon of the app.
function PartBar({ percent, label }: PartBarProps) {
    const shown = useSmoothPercent(percent);
    return (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-label={label}>
            <div className="progress__bar progress__bar--smooth" style={{ width: `${shown}%` }} />
        </div>
    );
}

interface PartRowProps {
    state: CutSegmentState;
    number: number;
}

function PartRow({ state, number }: PartRowProps) {
    const t = useTranslator();
    const title = t('cut.part', { number, start: formatClock(state.segment.start), end: formatClock(state.segment.end) });
    return (
        <li className="cut__part" data-testid="cut-part">
            <div className="cut__part-head">
                <span className="cut__part-title">{title}</span>
                <span className={`badge ${STATUS_BADGES[state.status]}`}>{t(STATUS_KEYS[state.status])}</span>
            </div>
            {state.status === 'cutting' && <PartBar percent={state.percent} label={t('cut.progressLabel', { number })} />}
            {state.status === 'waiting' && (
                <div className="progress progress--waiting" role="progressbar" aria-label={t('cut.waitingLabel', { number })}>
                    <div className="progress__bar" />
                </div>
            )}
            {state.status === 'error' && state.error !== null && (
                <p className="field__warning" role="alert">
                    {state.error}
                </p>
            )}
        </li>
    );
}

function summary(run: CutRun, t: ReturnType<typeof useTranslator>): string {
    const done = run.segments.filter((part) => {
        return part.status === 'done';
    }).length;
    const failed = run.segments.filter((part) => {
        return part.status === 'error';
    }).length;
    if (run.status === 'running') {
        return t('cut.run.progress', { done, total: run.segments.length });
    }
    if (run.status === 'cancelled') {
        return t('cut.run.cancelled', { done, total: run.segments.length });
    }
    return failed > 0 ? t('cut.run.failed', { done, failed }) : t('cut.run.done', { count: done });
}

// Whether what is being dragged carries files (and not text or a link).
function carriesFiles(event: { dataTransfer: Pick<DataTransfer, 'types'> | null }): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

// Cuts a video or audio file into the parts the user marks: one file for each, in the format of the original (or only the audio of a video).
export function CutPanel() {
    const t = useTranslator();
    const downloadDir = useAppStore((state) => {
        return state.settings.downloadDir;
    });
    const audioFormat = useAppStore((state) => {
        return state.settings.audioFormat;
    });
    const { media, choosing, chooseError, rows, audioOnly, starting, startError, cancelling, run } = useCutStore();
    const init = useCutStore((state) => {
        return state.init;
    });
    const choose = useCutStore((state) => {
        return state.choose;
    });
    const addRow = useCutStore((state) => {
        return state.addRow;
    });
    const updateRow = useCutStore((state) => {
        return state.updateRow;
    });
    const removeRow = useCutStore((state) => {
        return state.removeRow;
    });
    const setAudioOnly = useCutStore((state) => {
        return state.setAudioOnly;
    });
    const start = useCutStore((state) => {
        return state.start;
    });
    const cancel = useCutStore((state) => {
        return state.cancel;
    });
    const openPath = useCutStore((state) => {
        return state.openPath;
    });
    const rejectDrop = useCutStore((state) => {
        return state.rejectDrop;
    });
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
        let unsubscribe: (() => void) | null = null;
        let stopped = false;
        void init().then((stop) => {
            if (stopped) {
                stop();
                return;
            }
            unsubscribe = stop;
        });
        return () => {
            stopped = true;
            unsubscribe?.();
        };
    }, [init]);

    const running = run?.status === 'running';
    const busy = choosing || starting || running;

    // A file dropped outside the panel would make the window open it (and leave the app): while the cutter is open, a drop goes nowhere.
    useEffect(() => {
        const keepAway = (event: globalThis.DragEvent): void => {
            if (carriesFiles(event)) {
                event.preventDefault();
            }
        };
        window.addEventListener('dragover', keepAway);
        window.addEventListener('drop', keepAway);
        return () => {
            window.removeEventListener('dragover', keepAway);
            window.removeEventListener('drop', keepAway);
        };
    }, []);

    function onDragEnter(event: DragEvent<HTMLElement>): void {
        if (carriesFiles(event)) {
            event.preventDefault();
            setDragging(true);
        }
    }

    function onDragOver(event: DragEvent<HTMLElement>): void {
        if (carriesFiles(event)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
        }
    }

    // The drag leaves each element it passes over: it has left the panel when the element it goes to (none, if it leaves the window or is
    // cancelled) is not inside the panel.
    function onDragLeave(event: DragEvent<HTMLElement>): void {
        if (carriesFiles(event) && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragging(false);
        }
    }

    function onDrop(event: DragEvent<HTMLElement>): void {
        if (!carriesFiles(event)) {
            return;
        }
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (busy || file === undefined) {
            return;
        }
        const path = window.api.cut.pathForFile(file);
        if (path === '') {
            rejectDrop();
            return;
        }
        void openPath(path);
    }
    const segments = media === null ? null : segmentsToCut(rows, media.durationSeconds);
    const firstFile = run?.segments.find((part) => {
        return part.outputPath !== null;
    })?.outputPath;

    return (
        <section
            className={`cut panel${dragging ? ' cut--dragging' : ''}`}
            aria-label={t('cut.aria')}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            {dragging && (
                <div className={`cut__drop${busy ? ' cut__drop--busy' : ''}`} data-testid="cut-drop" aria-hidden="true">
                    {t(busy ? 'cut.drop.busy' : 'cut.drop.overlay')}
                </div>
            )}
            <p className="section-label">{t('cut.title')}</p>
            <p className="field__hint">{t('cut.hint')}</p>
            <p className="field__hint">{t('cut.drop.hint')}</p>
            <div className="cut__file">
                <button type="button" className="btn btn--primary" disabled={busy} onClick={() => { void choose(); }}>
                    {media === null ? t('cut.choose') : t('cut.change')}
                </button>
                {choosing && <LoadingMark label={t('cut.reading')} />}
                {media !== null && !choosing && (
                    <>
                        <strong className="cut__name" title={media.path}>
                            {media.name + media.extension}
                        </strong>
                        <span className="badge badge--done">{t(media.kind === 'video' ? 'cut.kind.video' : 'cut.kind.audio')}</span>
                        <span className="history__meta">{t('cut.duration', { duration: formatClock(media.durationSeconds) })}</span>
                    </>
                )}
            </div>
            {chooseError !== null && !choosing && (
                <p className="field__warning" role="alert">
                    {t(CHOOSE_ERROR_KEYS[chooseError])}
                </p>
            )}
            {media !== null && (
                <>
                    <p className="section-label">{t('cut.segments')}</p>
                    <ul className="cut__segments">
                        {rows.map((row, index) => {
                            const checked = checkRow(row, media.durationSeconds);
                            const number = index + 1;
                            return (
                                <li key={row.id} className="cut__segment" data-testid="cut-segment">
                                    <TextField
                                        label={t('cut.segment.start', { number })}
                                        value={row.start}
                                        placeholder={t('cut.placeholder')}
                                        disabled={busy}
                                        onChange={(start) => {
                                            updateRow(row.id, { start });
                                        }}
                                    />
                                    <TextField
                                        label={t('cut.segment.end', { number })}
                                        value={row.end}
                                        placeholder={t('cut.placeholder')}
                                        disabled={busy}
                                        onChange={(end) => {
                                            updateRow(row.id, { end });
                                        }}
                                    />
                                    <span className="cut__length">{checked.segment === null ? '' : t('cut.segment.length', { length: formatClock(checked.segment.end - checked.segment.start) })}</span>
                                    <button
                                        type="button"
                                        className="btn btn--small"
                                        disabled={busy}
                                        aria-label={t('cut.segment.remove', { number })}
                                        onClick={() => {
                                            removeRow(row.id);
                                        }}
                                    >
                                        ✕
                                    </button>
                                    {checked.problem !== null && (
                                        <p className="field__warning cut__problem" role="alert">
                                            {t(problemKey(checked.problem), { duration: formatClock(media.durationSeconds) })}
                                        </p>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                    <div className="cut__actions">
                        <button type="button" className="btn btn--small" disabled={busy} onClick={addRow}>
                            {t('cut.segment.add')}
                        </button>
                    </div>
                    {media.kind === 'video' && (
                        <ToggleField label={t('cut.audioOnly')} checked={audioOnly} hint={t('cut.audioOnly.hint', { format: audioFormat })} onChange={setAudioOnly} />
                    )}
                    <p className="field__hint">{t('cut.output', { folder: `${downloadDir}/${media.name} - cuts` })}</p>
                    {startError !== null && (
                        <p className="field__warning" role="alert">
                            {t(`cut.start.error.${startError}`)}
                        </p>
                    )}
                    <div className="cut__actions">
                        <button type="button" className="btn btn--primary" disabled={busy || segments === null} onClick={() => { void start(); }}>
                            {t('cut.start')}
                        </button>
                        {starting && <LoadingMark label={t('cut.starting')} />}
                        {running && !cancelling && (
                            <button type="button" className="btn btn--hot" onClick={() => { void cancel(); }}>
                                {t('cut.cancel')}
                            </button>
                        )}
                        {running && cancelling && <LoadingMark label={t('cut.cancelling')} />}
                    </div>
                </>
            )}
            {run !== null && (
                <>
                    <p className="section-label" role="status">
                        {summary(run, t)}
                    </p>
                    <ul className="cut__parts">
                        {run.segments.map((state, index) => {
                            return <PartRow key={index} state={state} number={index + 1} />;
                        })}
                    </ul>
                    {run.status !== 'running' && firstFile != null && (
                        <div className="cut__actions">
                            <button
                                type="button"
                                className="btn btn--small"
                                onClick={() => {
                                    void window.api.showItemInFolder(firstFile);
                                }}
                            >
                                {t('cut.run.openFolder')}
                            </button>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
