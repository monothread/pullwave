import { useEffect, useState, type DragEvent } from 'react';
import { CONVERT_AUDIO_FORMATS, CONVERT_OUTPUT_MODES, type ConvertAudioFormat, type ConvertItemState, type ConvertItemStatus, type ConvertOutputMode, type ConvertRun } from '@shared/convert';
import type { MessageKey } from '@shared/i18n';
import { useSmoothPercent } from '../hooks/useSmoothPercent';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { useConvertStore, type ConvertUiError } from '../store/convertStore';
import { useExplorerStore } from '../store/explorerStore';
import { ConfirmButton } from './ConfirmButton';
import { formatClock } from './cutText';
import { SelectField } from './fields';
import { LoadingMark } from './LoadingMark';

const STATUS_KEYS: Record<ConvertItemStatus, MessageKey> = {
    waiting: 'convert.status.waiting',
    converting: 'convert.status.converting',
    done: 'convert.status.done',
    error: 'convert.status.error',
    cancelled: 'convert.status.cancelled'
};

const STATUS_BADGES: Record<ConvertItemStatus, string> = {
    waiting: 'badge--waiting',
    converting: 'badge--running',
    done: 'badge--done',
    error: 'badge--error',
    cancelled: 'badge--cancelled'
};

const ERROR_KEYS: Record<ConvertUiError, MessageKey> = {
    unreadable: 'convert.error.unreadable',
    'not-video': 'convert.error.not-video',
    'no-audio': 'convert.error.no-audio',
    'no-ffmpeg': 'convert.error.no-ffmpeg',
    dropped: 'convert.error.dropped'
};

const ITEM_ERROR_KEYS: Partial<Record<string, MessageKey>> = {
    unreadable: 'convert.error.unreadable',
    'not-video': 'convert.error.not-video',
    'no-audio': 'convert.error.no-audio',
    'no-ffmpeg': 'convert.error.no-ffmpeg',
    folder: 'convert.start.error.folder'
};

interface ConvertBarProps {
    percent: number;
    label: string;
}

function ConvertBar({ percent, label }: ConvertBarProps) {
    const shown = useSmoothPercent(percent);
    return (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-label={label}>
            <div className="progress__bar progress__bar--smooth" style={{ width: `${shown}%` }} />
        </div>
    );
}

function ConvertRunRow({ item }: { item: ConvertItemState }) {
    const t = useTranslator();
    const errorKey = item.error === null ? undefined : ITEM_ERROR_KEYS[item.error];
    const errorText = item.error === null ? null : errorKey !== undefined ? t(errorKey) : item.error;
    return (
        <li className="cut__part" data-testid="convert-run-item">
            <div className="cut__part-head">
                <span className="cut__part-title" title={item.path}>
                    {item.name}
                </span>
                <span className={`badge ${STATUS_BADGES[item.status]}`}>{t(STATUS_KEYS[item.status])}</span>
                {item.status === 'done' && item.outputPath !== null && (
                    <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => {
                            void useExplorerStore.getState().revealFile(item.outputPath ?? '');
                        }}
                    >
                        {t('convert.run.showFile')}
                    </button>
                )}
            </div>
            {item.status === 'converting' && <ConvertBar percent={item.percent} label={t('convert.progressLabel', { name: item.name })} />}
            {item.status === 'waiting' && (
                <div className="progress progress--waiting" role="progressbar" aria-label={t('convert.waitingLabel', { name: item.name })}>
                    <div className="progress__bar" />
                </div>
            )}
            {item.status === 'error' && errorText !== null && (
                <p className="field__warning" role="alert">
                    {errorText}
                </p>
            )}
        </li>
    );
}

function runSummary(run: ConvertRun, t: ReturnType<typeof useTranslator>): string {
    const done = run.items.filter((item) => {
        return item.status === 'done';
    }).length;
    const failed = run.items.filter((item) => {
        return item.status === 'error';
    }).length;
    if (run.status === 'running') {
        return t('convert.run.progress', { done, total: run.items.length });
    }
    if (run.status === 'cancelled') {
        return t('convert.run.cancelled', { done, total: run.items.length });
    }
    return failed > 0 ? t('convert.run.failed', { done, failed }) : t('convert.run.done', { count: done });
}

function carriesFiles(event: { dataTransfer: Pick<DataTransfer, 'types'> | null }): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function ConvertPanel() {
    const t = useTranslator();
    const downloadDir = useAppStore((state) => {
        return state.settings.downloadDir;
    });
    const settingsAudioFormat = useAppStore((state) => {
        return state.settings.audioFormat;
    });
    const {
        items,
        choosing,
        error,
        rejectedCount,
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
        setFormat,
        syncDefaultFormat,
        setOutputMode,
        chooseOutputDir,
        start,
        cancel,
        clear
    } = useConvertStore();
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
        syncDefaultFormat(settingsAudioFormat);
    }, [settingsAudioFormat, syncDefaultFormat]);

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
        if (busy) {
            return;
        }
        const files = Array.from(event.dataTransfer.files);
        if (files.length === 0) {
            return;
        }
        const paths = files
            .map((file) => {
                return window.api.convert.pathForFile(file);
            })
            .filter((path) => {
                return path.length > 0;
            });
        if (paths.length === 0) {
            rejectDrop();
            return;
        }
        void addPaths(paths);
    }

    const canStart = !busy && items.length > 0 && (outputMode !== 'custom' || customOutputDir.length > 0);
    const firstFile = run?.items.find((item) => {
        return item.outputPath !== null;
    })?.outputPath;

    const outputHint =
        outputMode === 'source'
            ? t('convert.outputDir.sourceHint')
            : outputMode === 'downloads'
              ? t('convert.outputDir.current', { folder: downloadDir || t('convert.outputMode.downloads') })
              : customOutputDir.length > 0
                ? t('convert.outputDir.current', { folder: customOutputDir })
                : t('convert.outputDir.none');

    return (
        <section
            className={`cut convert panel${dragging ? ' cut--dragging' : ''}`}
            aria-label={t('convert.aria')}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            {dragging && (
                <div className={`cut__drop${busy ? ' cut__drop--busy' : ''}`} data-testid="convert-drop" aria-hidden="true">
                    {t(busy ? 'convert.drop.busy' : 'convert.drop.overlay')}
                </div>
            )}
            <p className="section-label">{t('convert.title')}</p>
            <p className="field__hint">{t('convert.hint')}</p>
            <p className="field__hint">{t('convert.drop.hint')}</p>

            <div className="cut__file">
                <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy}
                    onClick={() => {
                        void choose();
                    }}
                >
                    {items.length === 0 ? t('convert.choose') : t('convert.add')}
                </button>
                {choosing && <LoadingMark label={t('convert.reading')} />}
                {(items.length > 0 || run !== null) && !choosing && (
                    <ConfirmButton
                        className="btn btn--small btn--hot cut__clear"
                        disabled={busy}
                        dialog={{ title: t('convert.clear.title'), message: t('convert.clear.message'), confirmLabel: t('convert.clear.confirm') }}
                        onConfirm={() => {
                            void clear();
                        }}
                    >
                        {t('convert.clear')}
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
                    {t('convert.error.rejectedSome', { count: rejectedCount })}
                </p>
            )}

            {items.length > 0 && (
                <>
                    <p className="section-label">{t('convert.list', { count: items.length })}</p>
                    <ul className="convert__items">
                        {items.map((item) => {
                            const fullName = item.name + item.extension;
                            return (
                                <li key={item.path} className="convert__item" data-testid="convert-item">
                                    <span className="convert__item-name" title={item.path}>
                                        {fullName}
                                    </span>
                                    {item.extension.length > 1 && <span className="badge badge--done">{item.extension.slice(1).toUpperCase()}</span>}
                                    <span className="history__meta">{t('convert.duration', { duration: formatClock(item.durationSeconds) })}</span>
                                    <button
                                        type="button"
                                        className="btn btn--small"
                                        disabled={busy}
                                        aria-label={t('convert.remove', { name: fullName })}
                                        onClick={() => {
                                            removeItem(item.path);
                                        }}
                                    >
                                        ✕
                                    </button>
                                </li>
                            );
                        })}
                    </ul>

                    <div className="convert__options">
                        <SelectField<ConvertAudioFormat>
                            label={t('convert.format')}
                            value={format}
                            options={CONVERT_AUDIO_FORMATS}
                            disabled={busy}
                            formatOption={(option) => {
                                return option.toUpperCase();
                            }}
                            onChange={setFormat}
                        />
                        <SelectField<ConvertOutputMode>
                            label={t('convert.outputMode')}
                            value={outputMode}
                            options={CONVERT_OUTPUT_MODES}
                            disabled={busy}
                            formatOption={(option) => {
                                return t(`convert.outputMode.${option}`);
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
                                {t('convert.outputDir.choose')}
                            </button>
                        )}
                    </div>

                    <p className="field__hint">{outputHint}</p>

                    {startError !== null && (
                        <p className="field__warning" role="alert">
                            {t(`convert.start.error.${startError}`)}
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
                            {t('convert.start', { count: items.length })}
                        </button>
                        {starting && <LoadingMark label={t('convert.starting')} />}
                    </div>
                </>
            )}

            {run !== null && (
                <>
                    <div className="cut__actions">
                        <p className="section-label" role="status">
                            {runSummary(run, t)}
                        </p>
                        {running && !cancelling && (
                            <button
                                type="button"
                                className="btn btn--small btn--hot"
                                onClick={() => {
                                    void cancel();
                                }}
                            >
                                {t('convert.cancel')}
                            </button>
                        )}
                        {running && cancelling && <LoadingMark label={t('convert.cancelling')} />}
                    </div>
                    <ul className="cut__parts">
                        {run.items.map((item) => {
                            return <ConvertRunRow key={item.path} item={item} />;
                        })}
                    </ul>
                    {run.status !== 'running' && firstFile !== undefined && firstFile !== null && (
                        <div className="cut__actions">
                            <button
                                type="button"
                                className="btn btn--small"
                                onClick={() => {
                                    void window.api.showItemInFolder(firstFile);
                                }}
                            >
                                {t('convert.run.openFolder')}
                            </button>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
