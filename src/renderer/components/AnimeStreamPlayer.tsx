import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import type { AnimeStream } from '@shared/anime';
import { useAppLanguage, useTranslator } from '../i18n/useTranslator';
import { useAnimeStore, type StreamingEpisode } from '../store/animeStore';
import { animeErrorReport } from './animeText';
import { streamOptionsOf, streamTracks } from './subtitleChoice';
import { VideoControls } from './VideoControls';
import { ErrorNotice } from './ErrorNotice';

// How much of the episode hls.js loads ahead of what is playing (its default is 30 seconds), so a jump to somewhere near is answered
// from what is already loaded.
export const STREAM_BUFFER_SECONDS = 60;

interface StreamVideoProps {
    stream: AnimeStream;
}

// The video of an episode that is not downloaded. The stream is an HLS playlist, which the browser cannot play alone: hls.js
// reads it and feeds the video. Everything it asks for goes through the app (see streamProxy.ts).
function StreamVideo({ stream }: StreamVideoProps) {
    const t = useTranslator();
    const video = useRef<HTMLVideoElement | null>(null);
    const [failed, setFailed] = useState(false);
    const supported = Hls.isSupported();
    const language = useAppLanguage();
    // Every subtitle the source offers, the one ani-cli picked first and shown at first.
    const tracks = streamTracks(stream);
    const [subtitle, setSubtitle] = useState<string | null>(tracks[0]?.id ?? null);

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
        hls.loadSource(stream.url);
        hls.attachMedia(element);
        return () => {
            hls.destroy();
        };
    }, [stream.url, supported]);

    return (
        <>
            {(failed || !supported) && (
                <p className="field__warning" role="alert">
                    {t('anime.player.error')}
                </p>
            )}
            <div className="player__stage">
                <video ref={video} className="player__video" crossOrigin="anonymous" autoPlay>
                    {tracks.map((track) => {
                        return <track key={track.id} id={track.id} kind="subtitles" src={track.url} label={track.label} default={track.id === subtitle} />;
                    })}
                </video>
                <VideoControls video={video} subtitles={streamOptionsOf(tracks, language)} selectedSubtitle={subtitle} onSelectSubtitle={setSubtitle} />
            </div>
        </>
    );
}

function StreamView({ streaming }: { streaming: StreamingEpisode }) {
    const t = useTranslator();
    const closeStream = useAnimeStore((state) => {
        return state.closeStream;
    });

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
                {streaming.status === 'loading' && <p className="empty">{t('anime.stream.loading')}</p>}
                {streaming.status === 'error' && streaming.error && (
                    <p className="field__warning" role="alert">
                        <ErrorNotice report={animeErrorReport(t, streaming.error)} />
                    </p>
                )}
                {streaming.status === 'ready' && streaming.stream && <StreamVideo key={streaming.stream.sessionId} stream={streaming.stream} />}
            </div>
        </div>
    );
}

export function AnimeStreamPlayer() {
    const streaming = useAnimeStore((state) => {
        return state.streaming;
    });
    return streaming ? <StreamView streaming={streaming} /> : null;
}
