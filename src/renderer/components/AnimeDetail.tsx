import { useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { sameSeries, suggestSeries } from '@shared/series';
import { animeErrorKey, seriesNames } from './animeText';
import { AddToLibraryDialog } from './AddToLibraryDialog';

// The anime that was opened: its episodes (a click on one opens the player, without downloading it), and the way to put it in the library with
// all of them.
export function AnimeDetail() {
    const t = useTranslator();
    const selection = useAnimeStore((state) => {
        return state.selection;
    });
    const library = useAnimeStore((state) => {
        return state.library;
    });
    const closeResult = useAnimeStore((state) => {
        return state.closeResult;
    });
    const addToLibrary = useAnimeStore((state) => {
        return state.addToLibrary;
    });
    const watchEpisode = useAnimeStore((state) => {
        return state.watchEpisode;
    });
    const showInLibrary = useAnimeStore((state) => {
        return state.showInLibrary;
    });
    // The anime in the library, when it is there already. Its series cannot change from here: what it suggests (its title) is only for the
    // one that is not in the library yet, and is saved with it.
    const entry = library.find((candidate) => {
        return candidate.title === selection?.result.title && candidate.audio === selection.audio;
    });
    const suggested = suggestSeries(selection?.result.title ?? '');
    const [adding, setAdding] = useState(false);

    // The episodes the source has that the library does not know yet (an anime that is still airing gets new ones after it was added).
    const inLibrary = new Set(
        (entry?.episodes ?? []).map((episode) => {
            return episode.number;
        })
    );
    const missingCount =
        entry && selection?.status === 'ready'
            ? selection.episodes.filter((number) => {
                  return !inLibrary.has(number);
              }).length
            : 0;

    const downloaded = new Set(
        (entry?.episodes ?? [])
            .filter((episode) => {
                return episode.status === 'done';
            })
            .map((episode) => {
                return episode.number;
            })
    );

    if (!selection) {
        return null;
    }

    return (
        <section className="anime__detail" aria-label={selection.result.title}>
            <div className="queue__toolbar">
                <button type="button" className="btn btn--small btn--ghost" onClick={closeResult}>
                    {t('anime.back')}
                </button>
                <span className="section-label">{selection.result.title}</span>
                {entry ? (
                    <>
                        {missingCount > 0 && (
                            <button
                                type="button"
                                className="btn btn--small btn--primary"
                                onClick={() => {
                                    void addToLibrary(null);
                                }}
                            >
                                {t('anime.library.addNew', { count: missingCount })}
                            </button>
                        )}
                        <button
                            type="button"
                            className="btn btn--small btn--primary"
                            onClick={() => {
                                showInLibrary(entry.id);
                            }}
                        >
                            {t('anime.library.view')}
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        disabled={selection.status !== 'ready'}
                        onClick={() => {
                            setAdding(true);
                        }}
                    >
                        {t('anime.library.add')}
                    </button>
                )}
            </div>
            {entry !== undefined && entry.series !== null && entry.season !== null && (
                <p className="field__hint" data-testid="anime-series-info">
                    {t('anime.series.in', { series: entry.series, order: entry.season })}
                </p>
            )}
            {adding && !entry && (
                <AddToLibraryDialog
                    initial={{ series: suggested.series, season: suggested.season, seasonName: '' }}
                    suggestions={seriesNames(library)}
                    usedOrders={(name) => {
                        return library
                            .filter((candidate) => {
                                return candidate.audio === selection.audio && candidate.series !== null && sameSeries(candidate.series, name);
                            })
                            .flatMap((candidate) => {
                                return candidate.season === null ? [] : [candidate.season];
                            });
                    }}
                    onConfirm={addToLibrary}
                    onClose={() => {
                        setAdding(false);
                    }}
                />
            )}
            {selection.status === 'loading' && <p className="empty">{t('anime.episodes.loading')}</p>}
            {selection.status === 'error' && selection.error && (
                <p className="field__warning" role="alert" title={selection.error.raw}>
                    {t(animeErrorKey(selection.error.code))}
                </p>
            )}
            {selection.status === 'ready' && (
                <>
                    <div className="queue__toolbar">
                        <span className="section-label">{t('anime.episodes.label', { count: selection.episodes.length })}</span>
                    </div>
                    <p className="field__hint">{t('anime.episodes.hint')}</p>
                    <div className="episode-grid" role="group" aria-label={t('anime.episodes.label', { count: selection.episodes.length })}>
                        {selection.episodes.map((number) => {
                            const isDownloaded = downloaded.has(number);
                            return (
                                <button
                                    key={number}
                                    type="button"
                                    className={`episode-chip${isDownloaded ? ' episode-chip--done' : ''}`}
                                    title={isDownloaded ? t('anime.inLibrary') : undefined}
                                    onClick={() => {
                                        void watchEpisode(number);
                                    }}
                                >
                                    {t('anime.episode', { number })}
                                </button>
                            );
                        })}
                    </div>
                </>
            )}
        </section>
    );
}
