import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useFullscreenIdle } from '../hooks/useFullscreenIdle';
import { useSubtitleStyle } from '../hooks/useSubtitleStyle';
import { useSeekPreview } from '../hooks/useSeekPreview';
import { useVideoBuffer } from '../hooks/useVideoBuffer';
import { useTranslator } from '../i18n/useTranslator';
import { seekHover, type SeekHover } from './seekHover';
import { hasPlayerSettings, PlayerSettings, type AutoNextSetting, type SubtitleManagerSetting, type SubtitleOption } from './PlayerSettings';
import { SubtitleManagerDialog } from './SubtitleManagerDialog';
import { clamp, SEEK_STEP_SECONDS, shortcutOf, skipFlashOf, VOLUME_STEP, type PlayerShortcut, type SkipFlashDirection } from './playerShortcuts';
import { atRangeEnd, mediaTimeOf, outsideRange, rangeLength, timeInRange, type PlaybackRange } from './playbackRange';
import { PlayerIcon } from './PlayerIcon';
import { previewSecondOf, type SeekPreviewSource } from './seekPreview';
import { SeekPreviewThumb } from './SeekPreviewThumb';

export type { SubtitleOption } from './PlayerSettings';

interface VideoControlsProps {
    video: RefObject<HTMLVideoElement | null>;
    subtitles: readonly SubtitleOption[];
    selectedSubtitle: string | null;
    onSelectSubtitle: (id: string | null) => void;
    range?: PlaybackRange;
    autoNext?: AutoNextSetting;
    subtitleManager?: SubtitleManagerSetting;
    preview?: SeekPreviewSource;
}

interface PlaybackState {
    paused: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    muted: boolean;
}

const INITIAL_STATE: PlaybackState = { paused: true, currentTime: 0, duration: 0, volume: 1, muted: false };
const DOUBLE_CLICK_WAIT_MS = 250;
const SYNC_EVENTS = ['play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata', 'volumechange', 'seeked', 'ended'];

export function formatClock(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '0:00';
    }
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = String(total % 60).padStart(2, '0');
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${rest}`;
    }
    return `${minutes}:${rest}`;
}

interface CenterFlash {
    kind: 'play' | 'pause';
    id: number;
}

interface VolumeBubble {
    percent: number;
    id: number;
}

interface SkipFlash extends SkipFlashDirection {
    id: number;
}

function readState(element: HTMLVideoElement): PlaybackState {
    return {
        paused: element.paused,
        currentTime: element.currentTime,
        duration: Number.isFinite(element.duration) ? element.duration : 0,
        volume: element.volume,
        muted: element.muted
    };
}

function useFrameClock(video: RefObject<HTMLVideoElement | null>, playing: boolean, onTime: (seconds: number) => void): void {
    useEffect(() => {
        const element = video.current;
        if (!element || !playing) {
            return undefined;
        }
        let frame = 0;
        const tick = (): void => {
            onTime(element.currentTime);
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(frame);
        };
    }, [video, playing, onTime]);
}

function setCurrentTime(element: HTMLVideoElement, seconds: number): void {
    element.currentTime = seconds;
}

function setVolume(element: HTMLVideoElement, value: number): void {
    element.volume = value;
    element.muted = value === 0;
}

function toggleMuted(element: HTMLVideoElement): void {
    element.muted = !element.muted;
}

function togglePlayback(element: HTMLVideoElement): void {
    if (element.paused) {
        void element.play().catch(() => {
            return undefined;
        });
    } else {
        element.pause();
    }
}

function steppedVolume(value: number): number {
    return Math.round(clamp(value, 0, 1) * 100) / 100;
}

function runShortcut(element: HTMLVideoElement, shortcut: PlayerShortcut, range: PlaybackRange | undefined): void {
    const duration = Number.isFinite(element.duration) ? element.duration : 0;
    const first = range?.start ?? 0;
    const last = range?.end ?? duration;
    const volume = element.muted ? 0 : element.volume;
    switch (shortcut) {
        case 'toggle-play':
            togglePlayback(element);
            return;
        case 'seek-forward':
            setCurrentTime(element, clamp(element.currentTime + SEEK_STEP_SECONDS, first, last));
            return;
        case 'seek-backward':
            setCurrentTime(element, clamp(element.currentTime - SEEK_STEP_SECONDS, first, last));
            return;
        case 'volume-up':
            setVolume(element, steppedVolume(volume + VOLUME_STEP));
            return;
        case 'volume-down':
            setVolume(element, steppedVolume(volume - VOLUME_STEP));
            return;
    }
}

function toggleStageFullscreen(element: HTMLVideoElement): void {
    const stage = element.parentElement;
    if (!stage) {
        return;
    }
    if (document.fullscreenElement) {
        void document.exitFullscreen();
    } else {
        void stage.requestFullscreen();
    }
}

function setTrackMode(track: TextTrack, mode: TextTrackMode): void {
    track.mode = mode;
}

function progressStyle(percent: number): CSSProperties {
    return { '--progress': `${percent}%` } as CSSProperties;
}

function useRangeLimits(video: RefObject<HTMLVideoElement | null>, range: PlaybackRange | undefined): void {
    const start = range?.start;
    const end = range?.end;
    useEffect(() => {
        const element = video.current;
        if (!element || start === undefined || end === undefined) {
            return undefined;
        }
        const part: PlaybackRange = { start, end };
        const toStart = (): void => {
            setCurrentTime(element, start);
        };
        const onTimeUpdate = (): void => {
            if (!element.paused && atRangeEnd(element.currentTime, part)) {
                element.pause();
                setCurrentTime(element, end);
            }
        };
        const onPlay = (): void => {
            if (outsideRange(element.currentTime, part)) {
                toStart();
            }
        };
        if (element.readyState >= 1) {
            toStart();
        }
        element.addEventListener('loadedmetadata', toStart);
        element.addEventListener('timeupdate', onTimeUpdate);
        element.addEventListener('play', onPlay);
        return () => {
            element.removeEventListener('loadedmetadata', toStart);
            element.removeEventListener('timeupdate', onTimeUpdate);
            element.removeEventListener('play', onPlay);
        };
    }, [video, start, end]);
}

export function VideoControls({ video, subtitles, selectedSubtitle, onSelectSubtitle, range, autoNext, subtitleManager, preview }: VideoControlsProps) {
    const t = useTranslator();
    const [state, setState] = useState<PlaybackState>(INITIAL_STATE);
    const subtitleStyle = useSubtitleStyle(video);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [managerOpen, setManagerOpen] = useState(false);
    const [hover, setHover] = useState<SeekHover | null>(null);
    const [skip, setSkip] = useState<SkipFlash | null>(null);
    const [centerFlash, setCenterFlash] = useState<CenterFlash | null>(null);
    const [volumeBubble, setVolumeBubble] = useState<VolumeBubble | null>(null);
    const bubbleCount = useRef(0);
    const { loading, bufferedPercent } = useVideoBuffer(video);
    const hidden = useFullscreenIdle(video) && !settingsOpen;
    useRangeLimits(video, range);
    const followTime = useCallback((seconds: number): void => {
        setState((previous) => {
            return previous.currentTime === seconds ? previous : { ...previous, currentTime: seconds };
        });
    }, []);
    useFrameClock(video, !state.paused, followTime);

    useEffect(() => {
        const element = video.current;
        if (!element) {
            return undefined;
        }
        const sync = (): void => {
            setState(readState(element));
        };
        SYNC_EVENTS.forEach((name) => {
            element.addEventListener(name, sync);
        });
        sync();
        return () => {
            SYNC_EVENTS.forEach((name) => {
                element.removeEventListener(name, sync);
            });
        };
    }, [video]);

    useEffect(() => {
        const element = video.current;
        if (!element) {
            return undefined;
        }
        let count = 0;
        const flash = (kind: CenterFlash['kind']) => {
            return (): void => {
                if (kind === 'pause' && element.ended) {
                    return;
                }
                count += 1;
                setCenterFlash({ kind, id: count });
            };
        };
        const onPlay = flash('play');
        const onPause = flash('pause');
        element.addEventListener('play', onPlay);
        element.addEventListener('pause', onPause);
        return () => {
            element.removeEventListener('play', onPlay);
            element.removeEventListener('pause', onPause);
        };
    }, [video]);

    useEffect(() => {
        const element = video.current;
        if (!element) {
            return undefined;
        }
        let pending: ReturnType<typeof setTimeout> | null = null;
        const cancelPending = (): void => {
            if (pending !== null) {
                clearTimeout(pending);
                pending = null;
            }
        };
        const onClick = (): void => {
            cancelPending();
            pending = setTimeout(() => {
                pending = null;
                togglePlayback(element);
            }, DOUBLE_CLICK_WAIT_MS);
        };
        const onDoubleClick = (): void => {
            cancelPending();
            toggleStageFullscreen(element);
        };
        element.addEventListener('click', onClick);
        element.addEventListener('dblclick', onDoubleClick);
        return () => {
            cancelPending();
            element.removeEventListener('click', onClick);
            element.removeEventListener('dblclick', onDoubleClick);
        };
    }, [video]);

    const rangeRef = useRef(range);
    useEffect(() => {
        rangeRef.current = range;
    }, [range]);

    useEffect(() => {
        const element = video.current;
        if (!element) {
            return undefined;
        }
        let skipCount = 0;
        const showVolume = (percent: number): void => {
            bubbleCount.current += 1;
            setVolumeBubble({ percent: Math.round(percent), id: bubbleCount.current });
        };
        const onKeyDown = (event: globalThis.KeyboardEvent): void => {
            const shortcut = shortcutOf(event);
            if (shortcut === null) {
                return;
            }
            event.preventDefault();
            runShortcut(element, shortcut, rangeRef.current);
            const flash = skipFlashOf(shortcut);
            if (flash !== null) {
                skipCount += 1;
                setSkip({ ...flash, id: skipCount });
            }
            if (shortcut === 'volume-up' || shortcut === 'volume-down') {
                showVolume((element.muted ? 0 : element.volume) * 100);
            }
        };
        const onKeyUp = (event: globalThis.KeyboardEvent): void => {
            if (event.key === ' ' && shortcutOf(event) !== null) {
                event.preventDefault();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, [video]);

    useEffect(() => {
        const element = video.current;
        if (!element) {
            return undefined;
        }
        const apply = (): void => {
            Array.from(element.textTracks).forEach((track) => {
                const wanted: TextTrackMode = track.id === selectedSubtitle ? 'showing' : 'disabled';
                if (track.mode !== wanted) {
                    setTrackMode(track, wanted);
                }
            });
        };
        apply();
        element.textTracks.addEventListener('change', apply);
        element.textTracks.addEventListener('addtrack', apply);
        return () => {
            element.textTracks.removeEventListener('change', apply);
            element.textTracks.removeEventListener('addtrack', apply);
        };
    }, [video, subtitles, selectedSubtitle]);

    function togglePlay(): void {
        if (video.current) {
            togglePlayback(video.current);
        }
    }

    function seekTo(seconds: number): void {
        const element = video.current;
        if (element) {
            setCurrentTime(element, range === undefined ? seconds : mediaTimeOf(seconds, range));
        }
    }

    function showVolume(percent: number): void {
        bubbleCount.current += 1;
        setVolumeBubble({ percent: Math.round(percent), id: bubbleCount.current });
    }

    function changeVolume(value: number): void {
        const element = video.current;
        if (element) {
            setVolume(element, value);
            showVolume(value * 100);
        }
    }

    function toggleMute(): void {
        const element = video.current;
        if (element) {
            toggleMuted(element);
        }
    }

    function toggleFullscreen(): void {
        if (video.current) {
            toggleStageFullscreen(video.current);
        }
    }

    function hoverTimeline(input: HTMLInputElement, clientX: number): void {
        setHover(seekHover(clientX, input.getBoundingClientRect(), duration));
    }

    const silent = state.muted || state.volume === 0;
    const duration = range === undefined ? state.duration : rangeLength(range);
    const currentTime = range === undefined ? state.currentTime : timeInRange(state.currentTime, range);
    const seekPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
    const volumePercent = silent ? 0 : state.volume * 100;
    const previewSecond = hover === null || preview === undefined ? null : previewSecondOf(range === undefined ? hover.time : mediaTimeOf(hover.time, range), state.duration);
    const previewFrame = useSeekPreview(preview, previewSecond);

    return (
        <>
            {loading && (
                <div className="player__loading" role="status" aria-label={t('anime.player.loading')}>
                    <span className="player__spinner" aria-hidden="true" />
                </div>
            )}
            {skip !== null && (
                <span
                    key={skip.id}
                    className={`player__skip player__skip--${skip.direction}`}
                    aria-hidden="true"
                    data-testid="player-skip"
                    onAnimationEnd={() => {
                        setSkip(null);
                    }}
                >
                    {skip.direction === 'forward' ? `${String(SEEK_STEP_SECONDS)}s ❯❯` : `❮❮ ${String(SEEK_STEP_SECONDS)}s`}
                </span>
            )}
            {centerFlash !== null && (
                <span
                    key={centerFlash.id}
                    className={`player__center player__center--${centerFlash.kind}`}
                    aria-hidden="true"
                    data-testid="player-center"
                    onAnimationEnd={() => {
                        setCenterFlash(null);
                    }}
                >
                    {centerFlash.kind === 'play' ? '▶' : '❚❚'}
                </span>
            )}
            <div className="player__controls" data-playing={!state.paused} data-hidden={hidden}>
                <button
                    type="button"
                    className="player__button"
                    aria-label={state.paused ? t('anime.player.play') : t('anime.player.pause')}
                    onClick={togglePlay}
                >
                    {state.paused ? <PlayerIcon key="play" name="play" /> : <PlayerIcon key="pause" name="pause" />}
                </button>
                <span className="player__time">{formatClock(currentTime)}</span>
                <div className="player__timeline">
                    <div className="progress" aria-hidden="true">
                        {range === undefined && <div className="player__buffered" style={{ width: `${String(bufferedPercent)}%` }} />}
                        <div className="progress__bar" style={{ width: `${seekPercent}%` }} />
                    </div>
                    <input
                        type="range"
                        className="player__range player__seek"
                        aria-label={t('anime.player.seek')}
                        min={0}
                        max={duration}
                        step="any"
                        value={Math.min(currentTime, duration)}
                        onMouseMove={(event) => {
                            hoverTimeline(event.currentTarget, event.clientX);
                        }}
                        onMouseLeave={() => {
                            setHover(null);
                        }}
                        onChange={(event) => {
                            seekTo(Number(event.target.value));
                        }}
                    />
                    {hover !== null && (
                        <span className="player__hover" role="tooltip" style={{ left: `${String(hover.fraction * 100)}%` }}>
                            {previewFrame !== null && <SeekPreviewThumb frame={previewFrame} />}
                            {formatClock(hover.time)}
                        </span>
                    )}
                </div>
                <span className="player__time">{formatClock(duration)}</span>
                <button
                    type="button"
                    className="player__button"
                    aria-label={silent ? t('anime.player.unmute') : t('anime.player.mute')}
                    onClick={toggleMute}
                >
                    {silent ? <PlayerIcon key="mute" name="mute" /> : <PlayerIcon key={state.volume < 0.5 ? 'volume-low' : 'volume'} name={state.volume < 0.5 ? 'volume-low' : 'volume'} />}
                </button>
                <span className="player__volume-wrap">
                {volumeBubble !== null && (
                    <span
                        key={volumeBubble.id}
                        className="player__volume-bubble"
                        aria-hidden="true"
                        data-testid="player-volume-bubble"
                        onAnimationEnd={() => {
                            setVolumeBubble(null);
                        }}
                    >
                        {`${String(volumeBubble.percent)}%`}
                    </span>
                )}
                <input
                    type="range"
                    className="player__range player__volume"
                    aria-label={t('anime.player.volume')}
                    min={0}
                    max={1}
                    step={0.05}
                    value={silent ? 0 : state.volume}
                    style={progressStyle(volumePercent)}
                    onChange={(event) => {
                        changeVolume(Number(event.target.value));
                    }}
                />
                </span>
                {hasPlayerSettings(subtitles, autoNext, subtitleManager) && (
                    <PlayerSettings
                        open={settingsOpen}
                        onOpenChange={setSettingsOpen}
                        subtitles={subtitles}
                        selectedSubtitle={selectedSubtitle}
                        onSelectSubtitle={onSelectSubtitle}
                        subtitleStyle={subtitleStyle}
                        autoNext={autoNext}
                        onManageSubtitles={
                            subtitleManager === undefined
                                ? undefined
                                : () => {
                                    setManagerOpen(true);
                                }
                        }
                    />
                )}
                <button type="button" className="player__button" aria-label={t('anime.player.fullscreen')} onClick={toggleFullscreen}>
                    <PlayerIcon name="fullscreen" />
                </button>
            </div>
            {managerOpen && subtitleManager !== undefined && (
                <SubtitleManagerDialog
                    manager={subtitleManager}
                    onClose={() => {
                        setManagerOpen(false);
                    }}
                />
            )}
        </>
    );
}
