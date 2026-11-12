import { IncrementalItems } from './IncrementalItems';
import { useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { sameSeries, suggestSeries } from '@shared/series';
import { animeErrorKey, seriesNames } from './animeText';
import { AddToLibraryDialog } from './AddToLibraryDialog';
import { AnimeCover } from './AnimeCover';
import { useAnimeCoverUrl } from '../hooks/useAnimeCoverUrl';
import { useDetailBackdrop } from '../hooks/useDetailBackdrop';
import { animeListKey, inListOrder, useListOrder } from '../store/sortPrefsStore';
import { ListOrderSelect } from './ListOrderSelect';

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
        return candidate.title === selection?.result.title;
    });
    const suggested = suggestSeries(selection?.result.title ?? '');
    const [adding, setAdding] = useState(false);
    // The order the grid shows the episodes of this anime in (the same one the library shows).
    const orderKey = selection === null ? null : animeListKey(selection.result.title);
    const [episodeOrder] = useListOrder('episodes', orderKey);

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

    useDetailBackdrop(useAnimeCoverUrl(selection?.result.title ?? ''));

    if (!selection) {
        return null;
    }

    return (
        <section className="anime__detail detail-screen" aria-label={selection.result.title}>
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
            <div className="series__cover">
                {entry === undefined && selection.result.unconfirmed === true ? <AnimeCover title={selection.result.title} url={null} /> : <AnimeCover title={entry?.title ?? selection.result.title} />}
            </div>
            {entry === undefined && selection.result.unconfirmed === true && (
                <p className="field__hint" data-testid="anime-result-unconfirmed">
                    {t('anime.result.unconfirmed')}
                </p>
            )}
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
                                return candidate.series !== null && sameSeries(candidate.series, name);
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
                        <ListOrderSelect kind="episodes" itemKey={animeListKey(selection.result.title)} />
                    </div>
                    <p className="field__hint">{t('anime.episodes.hint')}</p>
                    <div className="episode-grid" role="group" aria-label={t('anime.episodes.label', { count: selection.episodes.length })}>
                        <IncrementalItems items={inListOrder(selection.episodes, episodeOrder)} listKey={`anime-search-episodes:${selection.result.title}`} end="div" renderItem={(number) => {
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
                        }} />
                    </div>
                </>
            )}
        </section>
    );
}
