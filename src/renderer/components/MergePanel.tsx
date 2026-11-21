import { useEffect } from 'react';
import {
    MERGE_OUTPUT_MODES,
    MERGE_VIDEO_FORMATS,
    MIN_MERGE_ITEMS,
    type MergeMethod,
    type MergeOutputMode,
    type MergeRun,
    type MergeRunStatus,
    type MergeVideoFormat
} from '@shared/merge';
import type { MessageKey } from '@shared/i18n';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { useExplorerStore } from '../store/explorerStore';
import { useMergeStore, type MergeUiError } from '../store/mergeStore';
import { ConfirmButton } from './ConfirmButton';
import { formatClock } from './cutText';
import { SelectField, TextField } from './fields';
import { LoadingMark } from './LoadingMark';
import { SmoothProgressBar, useFileDrop } from './mediaToolHelpers';

const STATUS_KEYS: Record<MergeRunStatus, MessageKey> = {
    running: 'merge.status.running',
    done: 'merge.status.done',
    error: 'merge.status.error',
    cancelled: 'merge.status.cancelled'
};

const STATUS_BADGES: Record<MergeRunStatus, string> = {
    running: 'badge--running',
    done: 'badge--done',
    error: 'badge--error',
    cancelled: 'badge--cancelled'
};

const METHOD_KEYS: Record<MergeMethod, MessageKey> = {
    copy: 'merge.method.copy',
    reencode: 'merge.method.reencode'
};

const ERROR_KEYS: Record<MergeUiError, MessageKey> = {
    unreadable: 'merge.error.unreadable',
    'not-video': 'merge.error.not-video',
    'no-ffmpeg': 'merge.error.no-ffmpeg',
    dropped: 'merge.error.dropped'
};

function runSummary(run: MergeRun, t: ReturnType<typeof useTranslator>): string {
    if (run.status === 'running') {
        return t('merge.run.progress', { count: run.inputCount, name: run.outputName });
    }
    if (run.status === 'cancelled') {
        return t('merge.run.cancelled');
    }
    if (run.status === 'error') {
        return t('merge.run.failed');
    }
    return t('merge.run.done', { name: run.outputName });
}

export interface MergePanelProps {
    skipInit?: boolean;
}

export function MergePanel({ skipInit = false }: MergePanelProps) {
    const t = useTranslator();
    const downloadDir = useAppStore((state) => {
        return state.settings.downloadDir;
    });
    const settingsVideoContainer = useAppStore((state) => {
        return state.settings.videoContainer;
    });
    const {
        items,
        choosing,
        error,
        rejectedCount,
        outputName,
        format,
        outputMode,
        customOutputDir,
        starting,
        startError,
        cancelling,
        run,
        init,
        choose,
        addPaths,
        rejectDrop,
        removeItem,
        moveItem,
        setOutputName,
        setFormat,
        syncDefaultFormat,
        setOutputMode,
        chooseOutputDir,
        start,
        cancel,
        clear
    } = useMergeStore();

    useEffect(() => {
        syncDefaultFormat(settingsVideoContainer);
    }, [settingsVideoContainer, syncDefaultFormat]);

    useEffect(() => {
        if (skipInit) {
            return;
        }
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
    }, [init, skipInit]);

    const running = run?.status === 'running';
    const busy = choosing || starting || running;

    const { dragging, onDragEnter, onDragOver, onDragLeave, onDrop } = useFileDrop(busy, (files) => {
        const paths = files
            .map((file) => {
                return window.api.merge.pathForFile(file);
            })
            .filter((path) => {
                return path.length > 0;
            });
        if (paths.length === 0) {
            rejectDrop();
            return;
        }
        void addPaths(paths);
    });

    const totalDuration = items.reduce((sum, item) => {
        return sum + item.media.durationSeconds;
    }, 0);
    const defaultOutputName = items[0] !== undefined ? `${items[0].media.name} - merged` : '';
    const canStart = !busy && items.length >= MIN_MERGE_ITEMS && (outputMode !== 'custom' || customOutputDir.length > 0);

    const outputHint =
        outputMode === 'source'
            ? t('merge.outputDir.sourceHint')
            : outputMode === 'downloads'
              ? t('merge.outputDir.current', { folder: downloadDir || t('merge.outputMode.downloads') })
              : customOutputDir.length > 0
                ? t('merge.outputDir.current', { folder: customOutputDir })
                : t('merge.outputDir.none');

    return (
        <section
            className={`cut convert merge panel${dragging ? ' cut--dragging' : ''}`}
            aria-label={t('merge.aria')}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            {dragging && (
                <div className={`cut__drop${busy ? ' cut__drop--busy' : ''}`} data-testid="merge-drop" aria-hidden="true">
                    {t(busy ? 'merge.drop.busy' : 'merge.drop.overlay')}
                </div>
            )}
            <p className="section-label">{t('merge.title')}</p>
            <p className="field__hint">{t('merge.hint')}</p>
            <p className="field__hint">{t('merge.drop.hint')}</p>

            <div className="cut__file">
                <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy}
                    onClick={() => {
                        void choose();
                    }}
                >
                    {items.length === 0 ? t('merge.choose') : t('merge.add')}
                </button>
                {choosing && <LoadingMark label={t('merge.reading')} />}
                {(items.length > 0 || run !== null) && !choosing && (
                    <ConfirmButton
                        className="btn btn--small btn--hot cut__clear"
                        disabled={busy}
                        dialog={{ title: t('merge.clear.title'), message: t('merge.clear.message'), confirmLabel: t('merge.clear.confirm') }}
                        onConfirm={() => {
                            void clear();
                        }}
                    >
                        {t('merge.clear')}
                    </ConfirmButton>
                )}
            </div>

            {error !== null && !choosing && (
                <p className="field__warning" role="alert">
                    {t(ERROR_KEYS[error])}
                </p>
            )}
            {rejectedCount > 0 && !choosing && (
                <p className="field__warning" role="status">
                    {t('merge.error.rejectedSome', { count: rejectedCount })}
                </p>
            )}

            {items.length > 0 && (
                <>
                    <p className="section-label">{t('merge.list', { count: items.length, duration: formatClock(totalDuration) })}</p>
                    <ul className="convert__items">
                        {items.map((item, index) => {
                            const fullName = item.media.name + item.media.extension;
                            return (
                                <li key={item.id} className="convert__item merge__item" data-testid="merge-item">
                                    <span className="merge__order" aria-hidden="true">
                                        #{index + 1}
                                    </span>
                                    <span className="convert__item-name" title={item.media.path}>
                                        {fullName}
                                    </span>
                                    {item.media.extension.length > 1 && <span className="badge badge--done">{item.media.extension.slice(1).toUpperCase()}</span>}
                                    <span className="history__meta">{t('merge.duration', { duration: formatClock(item.media.durationSeconds) })}</span>
                                    <span className="merge__controls">
                                        <button
                                            type="button"
                                            className="btn btn--small"
                                            disabled={busy || index === 0}
                                            aria-label={`${t('merge.moveUp')}: ${fullName}`}
                                            title={t('merge.moveUp')}
                                            onClick={() => {
                                                moveItem(item.id, 'up');
                                            }}
                                        >
                                            ↑
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn--small"
                                            disabled={busy || index === items.length - 1}
                                            aria-label={`${t('merge.moveDown')}: ${fullName}`}
                                            title={t('merge.moveDown')}
                                            onClick={() => {
                                                moveItem(item.id, 'down');
                                            }}
                                        >
                                            ↓
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn--small"
                                            disabled={busy}
                                            aria-label={t('merge.remove', { name: fullName })}
                                            onClick={() => {
                                                removeItem(item.id);
                                            }}
                                        >
                                            ✕
                                        </button>
                                    </span>
                                </li>
                            );
                        })}
                    </ul>

                    {items.length < MIN_MERGE_ITEMS && <p className="field__hint">{t('merge.needMore')}</p>}

                    <div className="convert__options merge__options">
                        <TextField
                            label={t('merge.outputName')}
                            value={outputName}
                            placeholder={t('merge.outputName.placeholder', { name: defaultOutputName })}
                            disabled={busy}
                            onChange={setOutputName}
                        />
                        <SelectField<MergeVideoFormat>
                            label={t('merge.format')}
                            value={format}
                            options={MERGE_VIDEO_FORMATS}
                            disabled={busy}
                            formatOption={(option) => {
                                return option.toUpperCase();
                            }}
                            onChange={setFormat}
                        />
                        <SelectField<MergeOutputMode>
                            label={t('merge.outputMode')}
                            value={outputMode}
                            options={MERGE_OUTPUT_MODES}
                            disabled={busy}
                            formatOption={(option) => {
                                return t(`merge.outputMode.${option}`);
                            }}
                            onChange={setOutputMode}
                        />
                        {outputMode === 'custom' && (
                            <button
                                type="button"
                                className="btn btn--small convert__folder-btn"
                                disabled={busy}
                                onClick={() => {
                                    void chooseOutputDir();
                                }}
                            >
                                {t('merge.outputDir.choose')}
                            </button>
                        )}
                    </div>

                    <p className="field__hint">{outputHint}</p>

                    {startError !== null && (
                        <p className="field__warning" role="alert">
                            {t(`merge.start.error.${startError}`)}
                        </p>
                    )}

                    <div className="cut__actions">
                        <button
                            type="button"
                            className="btn btn--primary"
                            disabled={!canStart}
                            onClick={() => {
                                void start();
                            }}
                        >
                            {t('merge.start', { count: items.length })}
                        </button>
                        {starting && <LoadingMark label={t('merge.starting')} />}
                    </div>
                </>
            )}

            {run !== null && (
                <div className="cut__part" data-testid="merge-run">
                    <div className="cut__part-head">
                        <p className="section-label cut__part-title" role="status">
                            {runSummary(run, t)}
                        </p>
                        <span className="badge badge--waiting">{t(METHOD_KEYS[run.method])}</span>
                        <span className={`badge ${STATUS_BADGES[run.status]}`}>{t(STATUS_KEYS[run.status])}</span>
                        {running && !cancelling && (
                            <button
                                type="button"
                                className="btn btn--small btn--hot"
                                onClick={() => {
                                    void cancel();
                                }}
                            >
                                {t('merge.cancel')}
                            </button>
                        )}
                        {running && cancelling && <LoadingMark label={t('merge.cancelling')} />}
                    </div>
                    {run.status === 'running' && <SmoothProgressBar percent={run.percent} label={t('merge.progressLabel', { name: run.outputName })} />}
                    {run.status === 'error' && run.error !== null && (
                        <p className="field__warning" role="alert">
                            {run.error}
                        </p>
                    )}
                    {run.status === 'done' && run.outputPath !== null && (
                        <div className="cut__actions">
                            <button
                                type="button"
                                className="btn btn--small"
                                onClick={() => {
                                    void useExplorerStore.getState().revealFile(run.outputPath ?? '');
                                }}
                            >
                                {t('merge.run.showFile')}
                            </button>
                            <button
                                type="button"
                                className="btn btn--small"
                                onClick={() => {
                                    void window.api.showItemInFolder(run.outputPath ?? '');
                                }}
                            >
                                {t('merge.run.openFolder')}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
