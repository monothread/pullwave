import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { animeMediaUrl, episodeVideoUrl, type AnimeEpisodeRecord, type AnimeSubtitleCheckResponse, type AnimeSubtitleTrack, type LibraryAnime } from '@shared/anime';
import type { Translator } from '@shared/i18n';
import { useAppLanguage, useTranslator } from '../i18n/useTranslator';
import type { LanguageCode } from '@shared/types';
import { useAnimeStore } from '../store/animeStore';
import { useAppStore, type Notice } from '../store/appStore';
import {
    DEFAULT_OPTION_ID,
    importFailureKey,
    initialSubtitle,
    optionIdOf,
    optionsOf,
    readSubtitleChoice,
    saveSubtitleChoice,
    type SubtitleImportFailure
} from './subtitleChoice';
import { subtitleDisplayNames } from './subtitleName';
import { SubtitleGenerateDialog } from './SubtitleGenerateDialog';
import { SubtitleTranslateDialog } from './SubtitleTranslateDialog';
import { formatClock, VideoControls } from './VideoControls';
import { AutoNextPanel } from './AutoNextPanel';
import { useUiPrefsStore } from '../store/uiPrefsStore';
import { animeErrorKey, isWatched, nextDownloadedEpisode, previousDownloadedEpisode, resumePosition, type PlayableEpisode } from './animeText';

export const SAVE_INTERVAL_SECONDS = 5;

function noticeOfCheck(response: AnimeSubtitleCheckResponse, t: Translator, language: LanguageCode): Notice {
    if (response.ok) {
        const message =
            response.added.length === 0
                ? t('anime.player.subtitlesNone')
                : t('anime.player.subtitlesAdded', { count: response.added.length, names: subtitleDisplayNames(response.added, language).join(', ') });
        return { kind: 'info', message };
    }
    if (response.reason === 'missing') {
        return { kind: 'error', message: t('anime.player.subtitlesMissing') };
    }
    return { kind: 'error', message: t('anime.player.subtitlesFailed', { reason: t(animeErrorKey(response.error.code)) }) };
}

interface PlayerViewProps {
    anime: LibraryAnime;
    episode: AnimeEpisodeRecord;
    title: string;
    headSlot: HTMLElement | null;
    stageSlot: HTMLElement | null;
}

function PlayerView({ anime, episode, title, headSlot, stageSlot }: PlayerViewProps) {
    const t = useTranslator();
    const language = useAppLanguage();
    const play = useAnimeStore((state) => {
        return state.play;
    });
    const library = useAnimeStore((state) => {
        return state.library;
    });
    const closePlayer = useAnimeStore((state) => {
        return state.closePlayer;
    });
    const saveProgress = useAnimeStore((state) => {
        return state.saveProgress;
    });
    const refreshLibrary = useAnimeStore((state) => {
        return state.refreshLibrary;
    });
    const video = useRef<HTMLVideoElement | null>(null);
    const [opening] = useState(() => {
        return Date.now();
    });
    const lastSaved = useRef(0);
    const [failed, setFailed] = useState(false);
    const [tracks, setTracks] = useState<AnimeSubtitleTrack[]>([{ id: '', label: 'Subtitles', kind: 'default' }]);
    const [subtitle, setSubtitle] = useState<string | null>(DEFAULT_OPTION_ID);
    const [importFailure, setImportFailure] = useState<SubtitleImportFailure | null>(null);
    const [checking, setChecking] = useState(false);
    const [translating, setTranslating] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [tracksLoaded, setTracksLoaded] = useState(false);
    const [upNext, setUpNext] = useState(false);
    const autoNext = useUiPrefsStore((state) => {
        return state.autoNext;
    });
    const toggleAutoNext = useUiPrefsStore((state) => {
        return state.toggleAutoNext;
    });
    const setNotice = useAppStore((state) => {
        return state.setNotice;
    });

    useEffect(() => {
        let current = true;
        void window.api.listAnimeSubtitles(episode.id).then((found) => {
            if (current) {
                setTracks(found);
                setTracksLoaded(true);
                setSubtitle(initialSubtitle(optionsOf(found), readSubtitleChoice(episode.id)));
            }
        });
        return () => {
            current = false;
        };
    }, [episode.id]);

    function chooseSubtitle(choice: string | null): void {
        setSubtitle(choice);
        saveSubtitleChoice(episode.id, choice);
    }

    async function loadSubtitle(): Promise<void> {
        const result = await window.api.importAnimeSubtitle(episode.id);
        if (result.ok) {
            setImportFailure(null);
            setTracks(result.tracks);
            chooseSubtitle(optionIdOf(result.imported));
        } else if (result.reason !== 'cancelled') {
            setImportFailure(result.reason);
        }
    }

    async function checkSubtitles(): Promise<void> {
        setChecking(true);
        try {
            const response = await window.api.checkAnimeSubtitles(episode.id);
            if (response.ok) {
                setTracks(response.tracks);
            }
            setNotice(noticeOfCheck(response, t, language));
        } finally {
            setChecking(false);
        }
    }

    async function deleteTranslatedSubtitle(trackId: string): Promise<void> {
        const result = await window.api.deleteAnimeSubtitle(episode.id, trackId);
        if (!result.ok) {
            setNotice({ kind: 'error', message: t('anime.player.deleteSubtitle.failed') });
            return;
        }
        setTracks(result.tracks);
        if (subtitle === trackId) {
            chooseSubtitle(initialSubtitle(optionsOf(result.tracks, language), undefined));
        }
        setNotice({ kind: 'info', message: t('anime.player.deleteSubtitle.done') });
    }

    function save(): void {
        const element = video.current;
        if (!element || !Number.isFinite(element.duration)) {
            return;
        }
        lastSaved.current = element.currentTime;
        void saveProgress({
            episodeId: episode.id,
            positionSeconds: element.currentTime,
            durationSeconds: element.duration,
            watched: episode.watched || isWatched(element.currentTime, element.duration)
        });
    }

    function goTo(target: PlayableEpisode): void {
        save();
        play(target.anime.id, target.episode.id);
    }

    function close(): void {
        save();
        closePlayer();
        void refreshLibrary();
    }

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                close();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
        };
    });

    const previous = previousDownloadedEpisode(library, anime, episode);
    const next = nextDownloadedEpisode(library, anime, episode);
    const resumedAt = resumePosition(episode);

    const head = (
        <>
            <header className="job__head">
                <h2 className="player__title">{title}</h2>
                <span className="anime__actions">
                    {previous && (
                        <button
                            type="button"
                            className="btn btn--small"
                            onClick={() => {
                                goTo(previous);
                            }}
                        >
                            {t('anime.player.previous')}
                        </button>
                    )}
                    {next && (
                        <button
                            type="button"
                            className="btn btn--small"
                            onClick={() => {
                                goTo(next);
                            }}
                        >
                            {t('anime.player.next')}
                        </button>
                    )}
                    <button type="button" className="btn btn--small btn--hot" autoFocus onClick={close}>
                        {t('anime.player.close')}
                    </button>
                </span>
            </header>
            {failed && (
                <p className="field__warning" role="alert">
                    {t('anime.player.error')}
                </p>
            )}
        </>
    );

    const videoUrl = episodeVideoUrl(episode.id, opening);
    const stage = (
        <>
            {resumedAt !== null && (
                <span className="player__resumed" data-testid="player-resumed">
                    {t('anime.player.resumedAt', { time: formatClock(resumedAt) })}
                </span>
            )}
            <video
                ref={video}
                className="player__video"
                src={videoUrl}
                crossOrigin="anonymous"
                autoPlay
                onLoadedMetadata={(event) => {
                    const position = resumePosition(episode);
                    if (position !== null) {
                        event.currentTarget.currentTime = position;
                    }
                }}
                onTimeUpdate={(event) => {
                    if (Math.abs(event.currentTarget.currentTime - lastSaved.current) >= SAVE_INTERVAL_SECONDS) {
                        save();
                    }
                }}
                onPause={save}
                onPlay={() => {
                    setUpNext(false);
                }}
                onEnded={() => {
                    save();
                    if (autoNext && next !== null) {
                        setUpNext(true);
                    }
                }}
                onError={() => {
                    setFailed(true);
                }}
            >
                {tracks.map((track) => {
                return (
                    <track
                        key={optionIdOf(track)}
                        id={optionIdOf(track)}
                        kind="subtitles"
                        src={animeMediaUrl('subtitle', episode.id, track.id)}
                        label={track.label}
                        default={optionIdOf(track) === subtitle}
                    />
                );
            })}
            </video>
            {upNext && next !== null && (
                <AutoNextPanel
                    title={t('anime.job.title', { title: next.anime.title, episode: next.episode.number })}
                    coverTitle={next.anime.title}
                    onGo={() => {
                        goTo(next);
                    }}
                    onCancel={() => {
                        setUpNext(false);
                    }}
                />
            )}
            <VideoControls
                video={video}
                subtitles={optionsOf(tracks, language)}
                selectedSubtitle={subtitle}
                onSelectSubtitle={chooseSubtitle}
                autoNext={{ enabled: autoNext, onToggle: toggleAutoNext }}
                preview={{ kind: 'file', url: videoUrl }}
                subtitleManager={{
                    loaded: tracksLoaded,
                    hasSubtitles: tracks.length > 0,
                    checking,
                    failure: importFailure === null ? null : t(importFailureKey(importFailure)),
                    translatedSubtitles: tracks
                        .filter((track) => {
                            return track.kind === 'translated';
                        })
                        .map((track) => {
                            return { id: track.id, label: track.label };
                        }),
                    onLoad: () => {
                        void loadSubtitle();
                    },
                    onCreate: () => {
                        if (tracks.length > 0) {
                            setTranslating(true);
                        } else {
                            setGenerating(true);
                        }
                    },
                    onCheck: () => {
                        void checkSubtitles();
                    },
                    onDeleteTranslated: (trackId) => {
                        void deleteTranslatedSubtitle(trackId);
                    }
                }}
            />
            {translating && (
                <SubtitleTranslateDialog
                    episodeId={episode.id}
                    tracks={tracks}
                    onTranslated={(updated, translated) => {
                        setTracks(updated);
                        chooseSubtitle(optionIdOf(translated));
                        setTranslating(false);
                        setNotice({ kind: 'info', message: t('anime.translate.done', { language: translated.label }) });
                    }}
                    onClose={() => {
                        setTranslating(false);
                    }}
                />
            )}
            {generating && (
                <SubtitleGenerateDialog
                    episodeId={episode.id}
                    onGenerated={(updated, generated) => {
                        setTracks(updated);
                        chooseSubtitle(optionIdOf(generated));
                        setGenerating(false);
                        setNotice({ kind: 'info', message: t('anime.generate.done', { language: generated.label }) });
                    }}
                    onClose={() => {
                        setGenerating(false);
                    }}
                />
            )}
        </>
    );

    return (
        <>
            {headSlot !== null && createPortal(head, headSlot)}
            {stageSlot !== null && createPortal(stage, stageSlot)}
        </>
    );
}

export function AnimePlayer() {
    const t = useTranslator();
    const [headSlot, setHeadSlot] = useState<HTMLElement | null>(null);
    const [stageSlot, setStageSlot] = useState<HTMLElement | null>(null);
    const playing = useAnimeStore((state) => {
        return state.playing;
    });
    const library = useAnimeStore((state) => {
        return state.library;
    });
    const anime = library.find((candidate) => {
        return candidate.id === playing?.animeId;
    });
    const episode = anime?.episodes.find((candidate) => {
        return candidate.id === playing?.episodeId;
    });
    if (!anime || !episode) {
        return null;
    }
    const title = t('anime.job.title', { title: anime.title, episode: episode.number });
    return (
        <div className="player" role="dialog" aria-modal="true" aria-label={title}>
            <div className="player__box">
                <div ref={setHeadSlot} className="player__slot" />
                <div ref={setStageSlot} className="player__stage" />
            </div>
            <PlayerView key={episode.id} anime={anime} episode={episode} title={title} headSlot={headSlot} stageSlot={stageSlot} />
        </div>
    );
}
