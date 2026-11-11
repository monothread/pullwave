import { useEffect, useMemo, useState } from 'react';
import type { LibraryAnime, SubtitleTranslationJob } from '@shared/anime';
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

// Translates the subtitles of the downloaded episodes of a season that do not have the subtitle in the language of the settings yet, one after
// the other. It asks first, because every episode is a request that costs the user's token, and then follows how many are done, with a button to
// the screen of the subtitles being translated. What it follows is kept in the store, so it is the same when the screen is left and opened again.
// When no episode needs the translation there is no button to ask for it.
export function SeasonTranslation({ anime }: SeasonTranslationProps) {
    const t = useTranslator();
    const language = useAppStore((state) => {
        return state.settings.translateLanguage;
    });
    const updates = useAnimeStore((state) => {
        return state.translationUpdates;
    });
    const forgetTranslationUpdates = useAnimeStore((state) => {
        return state.forgetTranslationUpdates;
    });
    const openSubtitleJobs = useAnimeStore((state) => {
        return state.openSubtitleJobs;
    });
    const [confirming, setConfirming] = useState(false);
    // The episodes that can be translated, as the main process says; null while it is asked.
    const [translatable, setTranslatable] = useState<number[] | null>(null);
    const episodeKey = downloadedIdsOf(anime).join(',');
    const episodeIds = useMemo(() => {
        return episodeKey.length === 0 ? [] : episodeKey.split(',').map(Number);
    }, [episodeKey]);

    // The updates of every episode are kept; the ones of this season are the ones that count.
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
    // The episodes that had the subtitle in the language already are left as they were (nothing was asked of the provider for them).
    const skipped = finished.filter((job) => {
        return job.status === 'skipped';
    });
    const skippedLanguage = skipped[0]?.language ?? language;

    // Asked again when the episodes or the language change and each time a translation of the season ends (it may have added the subtitle).
    useEffect(() => {
        let current = true;
        if (episodeIds.length === 0) {
            return undefined;
        }
        void window.api.listTranslatableEpisodes({ episodeIds, language }).then((found) => {
            if (current) {
                setTranslatable(found);
            }
        });
        return () => {
            current = false;
        };
    }, [episodeIds, language, finished.length]);

    async function start(ids: number[]): Promise<void> {
        setConfirming(false);
        forgetTranslationUpdates(episodeIds);
        await window.api.translateAnimeSubtitles({ episodeIds: ids, language });
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
                <button type="button" className="btn btn--small btn--primary" onClick={openSubtitleJobs}>
                    {t('anime.translateSeason.seeProgress')}
                </button>
                <ConfirmButton
                    className="btn btn--small"
                    dialog={{ title: t('confirm.translateCancel.title'), message: t('confirm.translateCancel.message'), confirmLabel: t('anime.translateSeason.stop'), cancelLabel: t('confirm.back') }}
                    onConfirm={() => {
                        void window.api.cancelAnimeSubtitleTranslation(null);
                    }}
                >
                    {t('anime.translateSeason.stop')}
                </ConfirmButton>
            </span>
        );
    }
    if (translatable === null) {
        return null;
    }
    if (confirming && translatable.length > 0) {
        return (
            <span className="field-row">
                <span className="field__hint">{t('anime.translateSeason.confirm', { count: translatable.length, language })}</span>
                <button
                    type="button"
                    className="btn btn--small btn--primary"
                    onClick={() => {
                        void start(translatable);
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
            {translatable.length > 0 ? (
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
            ) : (
                <span className="field__hint" data-testid="season-translation-done">
                    {t('anime.translateSeason.allHave', { language })}
                </span>
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
