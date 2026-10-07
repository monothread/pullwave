import { useEffect, useState } from 'react';
import type { LibraryAnime, SubtitleTranslationJob } from '@shared/anime';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';

interface SeasonTranslationProps {
    anime: LibraryAnime;
}

const ACTIVE = new Set<SubtitleTranslationJob['status']>(['queued', 'running']);

// Translates the subtitles of all the downloaded episodes of a season into the language of the settings, one after the other. It asks first,
// because every episode is a request that costs the user's token, and then follows how many are done.
export function SeasonTranslation({ anime }: SeasonTranslationProps) {
    const t = useTranslator();
    const language = useAppStore((state) => {
        return state.settings.translateLanguage;
    });
    const [confirming, setConfirming] = useState(false);
    const [jobs, setJobs] = useState<Map<number, SubtitleTranslationJob>>(new Map());
    const episodeIds = anime.episodes
        .filter((episode) => {
            return episode.status === 'done';
        })
        .map((episode) => {
            return episode.id;
        });

    useEffect(() => {
        return window.api.onSubtitleTranslationUpdate((job) => {
            setJobs((previous) => {
                return new Map(previous).set(job.episodeId, job);
            });
        });
    }, []);

    // The updates of every episode arrive here; the ones of this season are the ones that count.
    const all = [...jobs.values()].filter((job) => {
        return episodeIds.includes(job.episodeId);
    });
    const active = all.some((job) => {
        return ACTIVE.has(job.status);
    });
    const finished = all.filter((job) => {
        return !ACTIVE.has(job.status);
    });
    const failedCount = finished.filter((job) => {
        return job.status === 'error';
    }).length;

    async function start(): Promise<void> {
        setConfirming(false);
        setJobs(new Map());
        await window.api.translateAnimeSubtitles({ episodeIds, language });
    }

    if (episodeIds.length === 0) {
        return <p className="field__hint">{t('anime.translateSeason.none')}</p>;
    }
    if (active) {
        return (
            <span className="field-row" aria-live="polite">
                <span className="field__hint" data-testid="season-translation-progress">
                    {t('anime.translateSeason.progress', { done: finished.length, total: all.length })}
                </span>
                <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => {
                        void window.api.cancelAnimeSubtitleTranslation(null);
                    }}
                >
                    {t('anime.translateSeason.stop')}
                </button>
            </span>
        );
    }
    if (confirming) {
        return (
            <span className="field-row">
                <span className="field__hint">{t('anime.translateSeason.confirm', { count: episodeIds.length, language })}</span>
                <button
                    type="button"
                    className="btn btn--small btn--primary"
                    onClick={() => {
                        void start();
                    }}
                >
                    {t('anime.translateSeason.start')}
                </button>
                <button
                    type="button"
                    className="btn btn--small btn--ghost"
                    onClick={() => {
                        setConfirming(false);
                    }}
                >
                    {t('anime.translateSeason.cancel')}
                </button>
            </span>
        );
    }
    return (
        <>
            <button
                type="button"
                className="btn btn--small"
                aria-label={`${t('anime.translateSeason')}: ${anime.title}`}
                onClick={() => {
                    setConfirming(true);
                }}
            >
                {t('anime.translateSeason')}
            </button>
            {failedCount > 0 && (
                <span className="field__warning" role="alert">
                    {t('anime.translateSeason.failed', { count: failedCount })}
                </span>
            )}
        </>
    );
}
