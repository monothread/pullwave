import { useEffect, useMemo, useState } from 'react';
import type { LibraryAnime, SubtitleTranslatableResponse, SubtitleTranslationJob } from '@shared/anime';
import { useTranslationTarget } from '../hooks/useTranslationTarget';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { useAppStore } from '../store/appStore';
import { ConfirmButton } from './ConfirmButton';

interface SeasonTranslationProps {
    anime: LibraryAnime;
}

const ACTIVE = new Set<SubtitleTranslationJob['status']>(['queued', 'running']);

function downloadedIdsOf(anime: LibraryAnime): number[] {
    return anime.episodes
        .filter((episode) => {
            return episode.status === 'done';
        })
        .map((episode) => {
            return episode.id;
        });
}

export function SeasonTranslation({ anime }: SeasonTranslationProps) {
    const t = useTranslator();
    const animeSubtitles = useAppStore((state) => {
        return state.settings.animeSubtitles;
    });
    const appLanguage = useAppStore((state) => {
        return state.settings.language;
    });
    const translationTarget = useTranslationTarget();
    const updates = useAnimeStore((state) => {
        return state.translationUpdates;
    });
    const forgetTranslationUpdates = useAnimeStore((state) => {
        return state.forgetTranslationUpdates;
    });
    const openSubtitleJobs = useAnimeStore((state) => {
        return state.openSubtitleJobs;
    });
    const [translatable, setTranslatable] = useState<SubtitleTranslatableResponse | null>(null);
    const episodeKey = downloadedIdsOf(anime).join(',');
    const episodeIds = useMemo(() => {
        return episodeKey.length === 0 ? [] : episodeKey.split(',').map(Number);
    }, [episodeKey]);

    const all = episodeIds.flatMap((episodeId) => {
        const update = updates[episodeId];
        return update === undefined ? [] : [update];
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
    const skipped = finished.filter((job) => {
        return job.status === 'skipped';
    });
    const skippedLanguage = skipped[0]?.language ?? translatable?.language ?? translationTarget;

    useEffect(() => {
        let current = true;
        if (episodeIds.length === 0) {
            return undefined;
        }
        void window.api.listTranslatableEpisodes(episodeIds).then((found) => {
            if (current) {
                setTranslatable(found);
            }
        });
        return () => {
            current = false;
        };
    }, [episodeIds, animeSubtitles, appLanguage, finished.length]);

    async function start(found: SubtitleTranslatableResponse): Promise<void> {
        forgetTranslationUpdates(episodeIds);
        await window.api.translateAnimeSubtitles({ episodeIds: found.episodeIds, language: found.language });
    }

    if (episodeIds.length === 0) {
        return <p className="field__hint">{t('anime.translateSeason.none')}</p>;
    }
    if (active) {
        return (
            <button type="button" className="btn btn--small btn--primary" data-testid="season-translation-progress" onClick={openSubtitleJobs}>
                {t('anime.translateSeason.seeProgress')}
            </button>
        );
    }
    if (translatable === null) {
        return null;
    }
    return (
        <>
            {translatable.episodeIds.length > 0 && (
                <ConfirmButton
                    className="btn btn--small"
                    ariaLabel={`${t('anime.translateSeason')}: ${anime.title}`}
                    dialog={{
                        title: t('confirm.translateSeason.title'),
                        message: t('anime.translateSeason.confirm', { count: translatable.episodeIds.length, language: translatable.language }),
                        confirmLabel: t('anime.translateSeason.start'),
                        cancelLabel: t('anime.translateSeason.cancel')
                    }}
                    onConfirm={() => {
                        void start(translatable);
                    }}
                >
                    {t('anime.translateSeason')}
                </ConfirmButton>
            )}
            {failedCount > 0 && (
                <span className="field__warning" role="alert">
                    {t('anime.translateSeason.failed', { count: failedCount })}
                </span>
            )}
            {skipped.length > 0 && (
                <span className="field__hint" role="status" data-testid="season-translation-skipped">
                    {t('anime.translateSeason.skipped', { count: skipped.length, language: skippedLanguage })}
                </span>
            )}
        </>
    );
}
