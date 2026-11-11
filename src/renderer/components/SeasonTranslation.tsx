import { useEffect, useMemo, useState } from 'react';
import type { LibraryAnime, SubtitleTranslatableResponse, SubtitleTranslationJob } from '@shared/anime';
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

// Translates the subtitles of the downloaded episodes of a season that do not have the subtitle in the language that is wanted yet (the one of
// the anime subtitles of the settings, as the main process says), one after the other. It asks first, in a window, because every episode is a
// request that costs the user's token; while they are translated it has only a button to the screen of the subtitles being translated. What it
// follows is kept in the store, so it is the same when the screen is left and opened again. When no episode needs the translation it shows
// nothing, and the button comes back when one does (another language chosen, a new episode).
export function SeasonTranslation({ anime }: SeasonTranslationProps) {
    const t = useTranslator();
    // What decides the language that is wanted: when one of them changes the main process is asked again.
    const animeSubtitles = useAppStore((state) => {
        return state.settings.animeSubtitles;
    });
    const appLanguage = useAppStore((state) => {
        return state.settings.language;
    });
    const translateLanguage = useAppStore((state) => {
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
    // The language that is wanted and the episodes that can be translated into it, as the main process says; null while it is asked.
    const [translatable, setTranslatable] = useState<SubtitleTranslatableResponse | null>(null);
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
    const skippedLanguage = skipped[0]?.language ?? translatable?.language ?? translateLanguage;

    // Asked again when the episodes or the settings that decide the language change, and each time a translation of the season ends (it may
    // have added the subtitle).
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
    }, [episodeIds, animeSubtitles, appLanguage, translateLanguage, finished.length]);

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
