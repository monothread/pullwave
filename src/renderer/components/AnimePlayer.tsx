import { useEffect, useRef, useState } from 'react';
import { animeMediaUrl, type AnimeEpisodeRecord, type AnimeSubtitleCheckResponse, type AnimeSubtitleTrack, type LibraryAnime } from '@shared/anime';
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
import { VideoControls } from './VideoControls';
import { animeErrorKey, isWatched, nextDownloadedEpisode, previousDownloadedEpisode, resumePosition } from './animeText';

// How often the position is saved while watching.
export const SAVE_INTERVAL_SECONDS = 5;

// What the app says about the check for new subtitles: good news (it goes away by itself), or what went wrong (it stays until it is
// dismissed), as the other notices of the app do.
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
}

// One episode being watched. It is created again for each episode (see `key` below), so nothing carries over.
function PlayerView({ anime, episode }: PlayerViewProps) {
    const t = useTranslator();
    const language = useAppLanguage();
    const play = useAnimeStore((state) => {
        return state.play;
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
    const lastSaved = useRef(0);
    const [failed, setFailed] = useState(false);
    // Until the list arrives only the subtitle ani-cli picked is known.
    const [tracks, setTracks] = useState<AnimeSubtitleTrack[]>([{ id: '', label: 'Subtitles', kind: 'default' }]);
    const [subtitle, setSubtitle] = useState<string | null>(DEFAULT_OPTION_ID);
    const [importFailure, setImportFailure] = useState<SubtitleImportFailure | null>(null);
    const [checking, setChecking] = useState(false);
    const [translating, setTranslating] = useState(false);
    const [generating, setGenerating] = useState(false);
    // Whether the list of the subtitles of the episode has arrived: until then it is not known whether it has any.
    const [tracksLoaded, setTracksLoaded] = useState(false);
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

    // Asks the source for the subtitles the episode does not have yet; the ones that come show up in the list of the player.
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
            // Once an episode counts as watched it stays so, however far into it the viewer goes when they watch it again.
            watched: episode.watched || isWatched(element.currentTime, element.duration)
        });
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

    const previous = previousDownloadedEpisode(anime, episode);
    const next = nextDownloadedEpisode(anime, episode);
    const title = t('anime.job.title', { title: anime.title, episode: episode.number });

    return (
        <div className="player" role="dialog" aria-modal="true" aria-label={title}>
            <div className="player__box">
                <header className="job__head">
                    <h2 className="player__title">{title}</h2>
                    <span className="anime__actions">
                        {previous && (
                            <button
                                type="button"
                                className="btn btn--small"
                                onClick={() => {
                                    save();
                                    play(anime.id, previous.id);
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
                                    save();
                                    play(anime.id, next.id);
                                }}
                            >
                                {t('anime.player.next')}
                            </button>
                        )}
                        <button
                            type="button"
                            className="btn btn--small"
                            onClick={() => {
                                void loadSubtitle();
                            }}
                        >
                            {t('anime.player.loadSubtitle')}
                        </button>
                        {tracksLoaded && (
                            <button
                                type="button"
                                className="btn btn--small"
                                onClick={() => {
                                    if (tracks.length > 0) {
                                        setTranslating(true);
                                    } else {
                                        setGenerating(true);
                                    }
                                }}
                            >
                                {tracks.length > 0 ? t('anime.player.translate') : t('anime.player.generate')}
                            </button>
                        )}
                        <button
                            type="button"
                            className="btn btn--small"
                            disabled={checking}
                            onClick={() => {
                                void checkSubtitles();
                            }}
                        >
                            {checking ? t('anime.player.checkingSubtitles') : t('anime.player.checkSubtitles')}
                        </button>
                        <button type="button" className="btn btn--small btn--hot" autoFocus onClick={close}>
                            {t('anime.player.close')}
                        </button>
                    </span>
                </header>
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
                {failed && (
                    <p className="field__warning" role="alert">
                        {t('anime.player.error')}
                    </p>
                )}
                {importFailure !== null && (
                    <p className="field__warning" role="alert">
                        {t(importFailureKey(importFailure))}
                    </p>
                )}
                <div className="player__stage">
                    <video
                        ref={video}
                        className="player__video"
                        src={animeMediaUrl('episode', episode.id)}
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
                        onEnded={save}
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
                    <VideoControls video={video} subtitles={optionsOf(tracks, language)} selectedSubtitle={subtitle} onSelectSubtitle={chooseSubtitle} />
                </div>
            </div>
        </div>
    );
}

export function AnimePlayer() {
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
    return <PlayerView key={episode.id} anime={anime} episode={episode} />;
}
