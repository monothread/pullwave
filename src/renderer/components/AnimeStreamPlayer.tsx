import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AnimeStream } from '@shared/anime';
import { useAppLanguage, useTranslator } from '../i18n/useTranslator';
import { useAnimeStore, type StreamingEpisode } from '../store/animeStore';
import { animeErrorReport } from './animeText';
import { streamOptionsOf, streamTracks } from './subtitleChoice';
import { bestLevelIndex } from './streamLevel';
import { VideoControls } from './VideoControls';
import { ErrorNotice } from './ErrorNotice';
import { AutoNextPanel } from './AutoNextPanel';
import { useUiPrefsStore } from '../store/uiPrefsStore';

export const STREAM_BUFFER_SECONDS = 60;

interface StreamVideoProps {
    stream: AnimeStream;
    stageSlot: HTMLElement;
    next: { title: string; episode: string } | null;
    onNext: () => void;
}

function StreamVideo({ stream, stageSlot, next, onNext }: StreamVideoProps) {
    const t = useTranslator();
    const video = useRef<HTMLVideoElement | null>(null);
    const [failed, setFailed] = useState(false);
    const supported = Hls.isSupported();
    const language = useAppLanguage();
    const tracks = streamTracks(stream);
    const [subtitle, setSubtitle] = useState<string | null>(tracks[0]?.id ?? null);
    const [upNext, setUpNext] = useState(false);
    const autoNext = useUiPrefsStore((state) => {
        return state.autoNext;
    });
    const toggleAutoNext = useUiPrefsStore((state) => {
        return state.toggleAutoNext;
    });

    useEffect(() => {
        const element = video.current;
        if (!element || !supported) {
            return undefined;
        }
        const hls = new Hls({ enableWorker: false, maxBufferLength: STREAM_BUFFER_SECONDS });
        hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
                setFailed(true);
            }
        });
        hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
            const best = bestLevelIndex(data.levels);
            if (best !== null) {
                hls.currentLevel = best;
            }
        });
        hls.loadSource(stream.url);
        hls.attachMedia(element);
        return () => {
            hls.destroy();
        };
    }, [stream.url, supported]);

    return createPortal(
        <>
            {(failed || !supported) && (
                <p className="field__warning" role="alert">
                    {t('anime.player.error')}
                </p>
            )}
            <video
                ref={video}
                className="player__video"
                crossOrigin="anonymous"
                autoPlay
                onPlay={() => {
                    setUpNext(false);
                }}
                onEnded={() => {
                    if (autoNext && next !== null) {
                        setUpNext(true);
                    }
                }}
            >
                {tracks.map((track) => {
                    return <track key={track.id} id={track.id} kind="subtitles" src={track.url} label={track.label} default={track.id === subtitle} />;
                })}
            </video>
            {upNext && next !== null && (
                <AutoNextPanel
                    title={t('anime.job.title', { title: next.title, episode: next.episode })}
                    coverTitle={next.title}
                    onGo={onNext}
                    onCancel={() => {
                        setUpNext(false);
                    }}
                />
            )}
            <VideoControls
                video={video}
                subtitles={streamOptionsOf(tracks, language)}
                selectedSubtitle={subtitle}
                onSelectSubtitle={setSubtitle}
                autoNext={{ enabled: autoNext, onToggle: toggleAutoNext }}
                preview={{ kind: 'hls', url: stream.url }}
            />
        </>,
        stageSlot
    );
}

function StreamView({ streaming }: { streaming: StreamingEpisode }) {
    const t = useTranslator();
    const closeStream = useAnimeStore((state) => {
        return state.closeStream;
    });
    const watchEpisode = useAnimeStore((state) => {
        return state.watchEpisode;
    });
    const [stageSlot, setStageSlot] = useState<HTMLElement | null>(null);
    const [hadVideo, setHadVideo] = useState(false);
    if (streaming.status === 'ready' && !hadVideo) {
        setHadVideo(true);
    } else if (streaming.status === 'error' && hadVideo) {
        setHadVideo(false);
    }
    const showStage = streaming.status === 'ready' || (streaming.status === 'loading' && hadVideo);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                closeStream();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [closeStream]);

    const title = t('anime.job.title', { title: streaming.title, episode: streaming.episode });
    return (
        <div className="player" role="dialog" aria-modal="true" aria-label={title}>
            <div className="player__box">
                <header className="job__head">
                    <h2 className="player__title">{title}</h2>
                    <button type="button" className="btn btn--small btn--hot" autoFocus onClick={closeStream}>
                        {t('anime.player.close')}
                    </button>
                </header>
                {streaming.status === 'loading' && !showStage && <p className="empty">{t('anime.stream.loading')}</p>}
                {streaming.status === 'error' && streaming.error && (
                    <p className="field__warning" role="alert">
                        <ErrorNotice report={animeErrorReport(t, streaming.error)} />
                    </p>
                )}
                {showStage && (
                    <div ref={setStageSlot} className="player__stage">
                        {streaming.status === 'loading' && <p className="empty">{t('anime.stream.loading')}</p>}
                    </div>
                )}
            </div>
            {streaming.status === 'ready' && streaming.stream && stageSlot !== null && (
                <StreamVideo
                    key={streaming.stream.sessionId}
                    stream={streaming.stream}
                    stageSlot={stageSlot}
                    next={streaming.nextEpisode === null ? null : { title: streaming.title, episode: streaming.nextEpisode }}
                    onNext={() => {
                        if (streaming.nextEpisode !== null) {
                            void watchEpisode(streaming.nextEpisode);
                        }
                    }}
                />
            )}
        </div>
    );
}

export function AnimeStreamPlayer() {
    const streaming = useAnimeStore((state) => {
        return state.streaming;
    });
    return streaming ? <StreamView streaming={streaming} /> : null;
}
