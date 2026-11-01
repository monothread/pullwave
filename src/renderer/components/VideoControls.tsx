import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useFullscreenIdle } from '../hooks/useFullscreenIdle';
import { useSubtitleStyle } from '../hooks/useSubtitleStyle';
import { useVideoBuffer } from '../hooks/useVideoBuffer';
import { useTranslator } from '../i18n/useTranslator';
import { seekHover, type SeekHover } from './seekHover';
import { hasPlayerSettings, PlayerSettings, type SubtitleOption } from './PlayerSettings';
import { clamp, SEEK_STEP_SECONDS, shortcutOf, VOLUME_STEP, type PlayerShortcut } from './playerShortcuts';
import { atRangeEnd, mediaTimeOf, outsideRange, rangeLength, timeInRange, type PlaybackRange } from './playbackRange';

// Kept here, where the player's other files already import it from.
export type { SubtitleOption } from './PlayerSettings';

interface VideoControlsProps {
    video: RefObject<HTMLVideoElement | null>;
    subtitles: readonly SubtitleOption[];
    // The id of the subtitle being shown; null when they are off.
    selectedSubtitle: string | null;
    onSelectSubtitle: (id: string | null) => void;
    // Only this part of the media is played, as if it were the whole of it (the preview of a cut); left out, the whole media.
    range?: PlaybackRange;
}

interface PlaybackState {
    paused: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    muted: boolean;
}

const INITIAL_STATE: PlaybackState = { paused: true, currentTime: 0, duration: 0, volume: 1, muted: false };
// A single click waits this long for a second one, so a double click does not also pause the video.
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

function readState(element: HTMLVideoElement): PlaybackState {
    return {
        paused: element.paused,
        currentTime: element.currentTime,
        duration: Number.isFinite(element.duration) ? element.duration : 0,
        volume: element.volume,
        muted: element.muted
    };
}

// While the media plays, its time is read at every frame of the screen: the media only says where it is a few times a second, and the bar
// would grow in jumps (a part of a few seconds, in the preview of a cut, jumped by a tenth of its length at a time).
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

// Rounded to the hundredth, so repeated steps do not drift away from the slider's marks (or from zero, which is what mutes).
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

// Keeps the media inside the part: it starts at its start, stops at its end, and plays again from the start when it is played at the end.
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

// The control bar of the player. It drives the <video> through its own API, so it looks the same in every theme.
export function VideoControls({ video, subtitles, selectedSubtitle, onSelectSubtitle, range }: VideoControlsProps) {
    const t = useTranslator();
    const [state, setState] = useState<PlaybackState>(INITIAL_STATE);
    const subtitleStyle = useSubtitleStyle(video);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [hover, setHover] = useState<SeekHover | null>(null);
    const { loading } = useVideoBuffer(video);
    // The bar stays while the settings are open: they are part of it.
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

    // The part played, for the keys (read when a key is pressed, so the listener does not change with it).
    const rangeRef = useRef(range);
    useEffect(() => {
        rangeRef.current = range;
    }, [range]);

    // The keys work wherever the focus is on the page (the video is not a field, so a click on it leaves it nowhere in the bar).
    useEffect(() => {
        const element = video.current;
        if (!element) {
            return undefined;
        }
        const onKeyDown = (event: globalThis.KeyboardEvent): void => {
            const shortcut = shortcutOf(event);
            if (shortcut === null) {
                return;
            }
            event.preventDefault();
            runShortcut(element, shortcut, rangeRef.current);
        };
        // A button is pressed when the space is released, so that is held back too, or it would press the focused button after the pause.
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

    // Shows the chosen subtitle and hides the others. Run again when the list changes: the tracks are added with it. The browser picks
    // subtitles by itself too (by language, once the video's data is there), possibly after the choice was applied and not only the
    // one that was chosen, so whenever the tracks change the choice is put back.
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

    // A point of the timeline: of the part when there is one.
    function seekTo(seconds: number): void {
        const element = video.current;
        if (element) {
            setCurrentTime(element, range === undefined ? seconds : mediaTimeOf(seconds, range));
        }
    }

    function changeVolume(value: number): void {
        const element = video.current;
        if (element) {
            setVolume(element, value);
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

    // The tooltip sits in the bar, so its position is measured from the bar: the timeline's own offset plus the mouse on it.
    function hoverTimeline(input: HTMLInputElement, clientX: number): void {
        const found = seekHover(clientX, input.getBoundingClientRect(), duration);
        setHover(found === null ? null : { time: found.time, offset: (input.parentElement?.offsetLeft ?? input.offsetLeft) + found.offset });
    }

    const silent = state.muted || state.volume === 0;
    // What the timeline shows: the part, from 0 to its length, when there is one.
    const duration = range === undefined ? state.duration : rangeLength(range);
    const currentTime = range === undefined ? state.currentTime : timeInRange(state.currentTime, range);
    const seekPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
    const volumePercent = silent ? 0 : state.volume * 100;

    return (
        <>
            {loading && (
                <div className="player__loading" role="status" aria-label={t('anime.player.loading')}>
                    <span className="player__spinner" aria-hidden="true" />
                </div>
            )}
            <div className="player__controls" data-playing={!state.paused} data-hidden={hidden}>
                <button
                    type="button"
                    className="player__button"
                    aria-label={state.paused ? t('anime.player.play') : t('anime.player.pause')}
                    onClick={togglePlay}
                >
                    {state.paused ? '▶' : '❚❚'}
                </button>
                {hover !== null && (
                    <span className="player__hover" role="tooltip" style={{ left: hover.offset }}>
                        {formatClock(hover.time)}
                    </span>
                )}
                <span className="player__time">{formatClock(currentTime)}</span>
                <div className="player__timeline">
                    <div className="progress" aria-hidden="true">
                        <div className="progress__bar" style={{ width: `${seekPercent}%` }} />
                    </div>
                    {/* Any step: the thumb stands at the very time of the video, as the bar does; with a step it went in jumps (a tenth of a
                        second is a fiftieth of a part of five seconds). The arrows still move it by the steps of the shortcuts. */}
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
                </div>
                <span className="player__time">{formatClock(duration)}</span>
                <button
                    type="button"
                    className="player__button"
                    aria-label={silent ? t('anime.player.unmute') : t('anime.player.mute')}
                    onClick={toggleMute}
                >
                    {silent ? '🔇' : '🔊'}
                </button>
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
                {hasPlayerSettings(subtitles) && (
                    <PlayerSettings
                        open={settingsOpen}
                        onOpenChange={setSettingsOpen}
                        subtitles={subtitles}
                        selectedSubtitle={selectedSubtitle}
                        onSelectSubtitle={onSelectSubtitle}
                        subtitleStyle={subtitleStyle}
                    />
                )}
                <button type="button" className="player__button" aria-label={t('anime.player.fullscreen')} onClick={toggleFullscreen}>
                    ⛶
                </button>
            </div>
        </>
    );
}
