import { useEffect, useMemo, useRef } from 'react';
import type { ExplorerPreviewFailure } from '@shared/explorer';
import type { MessageKey } from '@shared/i18n';
import { useModalDialog } from '../hooks/useModalDialog';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { useConvertStore } from '../store/convertStore';
import { useCutStore } from '../store/cutStore';
import { useExplorerStore, type ExplorerPlayerState } from '../store/explorerStore';
import { useMergeStore } from '../store/mergeStore';
import { filterAndSortEntries, formatBytes } from './explorerHelpers';
import { LoadingMark } from './LoadingMark';
import { VideoControls } from './VideoControls';

const FAILURE_KEYS: Record<Exclude<ExplorerPreviewFailure, 'cancelled'>, MessageKey> = {
    'not-found': 'explorer.player.error.not-found',
    'no-ffmpeg': 'explorer.player.error.no-ffmpeg',
    failed: 'explorer.player.error.failed'
};

const NO_SUBTITLES: readonly never[] = [];

function ignoreSubtitle(): void {
    return undefined;
}

function PlayerStage({ playing }: { playing: ExplorerPlayerState }) {
    const t = useTranslator();
    const convertPlayback = useExplorerStore((state) => {
        return state.convertPlayback;
    });
    const video = useRef<HTMLVideoElement | null>(null);

    if (playing.status === 'failed') {
        const key = playing.error === null || playing.error === 'cancelled' ? 'explorer.player.error.failed' : FAILURE_KEYS[playing.error];
        return (
            <div className="explorer-player__wait explorer-player__error">
                <p className="field__warning" role="alert">
                    {t(key)}
                </p>
                <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => {
                        void window.api.explorer.openExternal(playing.entry.path);
                    }}
                >
                    {t('explorer.action.openExternal')}
                </button>
            </div>
        );
    }

    if (playing.status === 'converting' || playing.url === null) {
        return (
            <div className="explorer-player__wait">
                <LoadingMark label={t('explorer.player.converting')} />
            </div>
        );
    }

    const isAudio = playing.entry.kind === 'audio';
    return (
        <div className={`player__stage${isAudio ? ' explorer-player__stage--audio' : ''}`}>
            {isAudio && (
                <div className="explorer-player__audio-art" aria-hidden="true">
                    <span className="explorer-player__audio-icon">♫</span>
                    <span className="explorer-player__audio-name">{playing.entry.name}</span>
                    <span className="explorer-player__audio-meta">
                        {playing.entry.extension.slice(1).toUpperCase()} · {formatBytes(playing.entry.sizeBytes)}
                    </span>
                </div>
            )}
            <video
                ref={video}
                className={`player__video${isAudio ? ' explorer-player__audio-video' : ''}`}
                src={playing.url}
                poster={playing.entry.thumbnailUrl ?? undefined}
                autoPlay
                data-testid="explorer-player-video"
                onError={() => {
                    void convertPlayback();
                }}
            />
            <VideoControls video={video} subtitles={NO_SUBTITLES} selectedSubtitle={null} onSelectSubtitle={ignoreSubtitle} />
        </div>
    );
}

interface ExplorerPlayerDialogProps {
    playing: ExplorerPlayerState;
    onClose: () => void;
}

function ExplorerPlayerDialog({ playing, onClose }: ExplorerPlayerDialogProps) {
    const t = useTranslator();
    const { dialogRef, handleKeyDown } = useModalDialog(onClose, true);

    useEffect(() => {
        const onWindowKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', onWindowKeyDown);
        return () => {
            window.removeEventListener('keydown', onWindowKeyDown);
        };
    }, [onClose]);
    const entries = useExplorerStore((state) => {
        return state.entries;
    });
    const filter = useExplorerStore((state) => {
        return state.filter;
    });
    const query = useExplorerStore((state) => {
        return state.query;
    });
    const sortBy = useExplorerStore((state) => {
        return state.sortBy;
    });
    const sortDirection = useExplorerStore((state) => {
        return state.sortDirection;
    });
    const playStep = useExplorerStore((state) => {
        return state.playStep;
    });
    const openTools = useAppStore((state) => {
        return state.openTools;
    });

    const playable = useMemo(() => {
        return filterAndSortEntries(entries, filter, query, sortBy, sortDirection).filter((item) => {
            return item.kind !== 'directory' && item.mediaUrl !== null;
        });
    }, [entries, filter, query, sortBy, sortDirection]);

    const { entry } = playing;
    const index = playable.findIndex((item) => {
        return item.path === entry.path;
    });
    const hasPrevious = index > 0;
    const hasNext = index >= 0 && index < playable.length - 1;
    const stageKey = `${entry.path}|${playing.status}|${playing.url ?? ''}`;

    return (
        <div className="player explorer-player" ref={dialogRef} role="dialog" aria-modal="true" aria-label={entry.name} onKeyDown={handleKeyDown}>
            <div className="player__box">
                <header className="job__head">
                    <h2 className="player__title" title={entry.path}>
                        {entry.name}
                    </h2>
                    <span className="anime__actions">
                        <span className="badge badge--done">{entry.extension.slice(1).toUpperCase()}</span>
                        {playing.converted && <span className="badge badge--waiting">{t('explorer.player.convertedBadge')}</span>}
                        {index >= 0 && playable.length > 1 && (
                            <span className="history__meta">{t('explorer.player.position', { current: index + 1, total: playable.length })}</span>
                        )}
                        {playable.length > 1 && (
                            <>
                                <button
                                    type="button"
                                    className="btn btn--small"
                                    disabled={!hasPrevious}
                                    onClick={() => {
                                        playStep(-1);
                                    }}
                                >
                                    {t('explorer.player.previous')}
                                </button>
                                <button
                                    type="button"
                                    className="btn btn--small"
                                    disabled={!hasNext}
                                    onClick={() => {
                                        playStep(1);
                                    }}
                                >
                                    {t('explorer.player.next')}
                                </button>
                            </>
                        )}
                        {entry.kind === 'video' && (
                            <>
                                <button
                                    type="button"
                                    className="btn btn--small"
                                    onClick={() => {
                                        onClose();
                                        openTools('convert');
                                        void useConvertStore.getState().addPaths([entry.path]);
                                    }}
                                >
                                    {t('explorer.action.convert')}
                                </button>
                                <button
                                    type="button"
                                    className="btn btn--small"
                                    onClick={() => {
                                        onClose();
                                        openTools('merge');
                                        void useMergeStore.getState().addPaths([entry.path]);
                                    }}
                                >
                                    {t('explorer.action.merge')}
                                </button>
                            </>
                        )}
                        <button
                            type="button"
                            className="btn btn--small"
                            onClick={() => {
                                onClose();
                                openTools('cut');
                                void useCutStore.getState().openPath(entry.path);
                            }}
                        >
                            {t('explorer.action.cut')}
                        </button>
                        <button
                            type="button"
                            className="btn btn--small"
                            onClick={() => {
                                void window.api.explorer.openExternal(entry.path);
                            }}
                        >
                            {t('explorer.action.openExternal')}
                        </button>
                        <button
                            type="button"
                            className="btn btn--small"
                            onClick={() => {
                                void window.api.showItemInFolder(entry.path);
                            }}
                        >
                            {t('explorer.action.showInFolder')}
                        </button>
                        <button type="button" className="btn btn--small btn--hot" autoFocus onClick={onClose}>
                            {t('explorer.player.close')}
                        </button>
                    </span>
                </header>
                <PlayerStage key={stageKey} playing={playing} />
            </div>
        </div>
    );
}

export function ExplorerMediaPlayer() {
    const playing = useExplorerStore((state) => {
        return state.playing;
    });
    const closePlayer = useExplorerStore((state) => {
        return state.closePlayer;
    });

    if (playing === null) {
        return null;
    }

    return <ExplorerPlayerDialog playing={playing} onClose={closePlayer} />;
}
