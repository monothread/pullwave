import { WindowedList, windowBack } from './WindowedList';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { animeErrorReport, libraryEntry, seasonLabel } from './animeText';
import { AnimeCover } from './AnimeCover';
import { AnimeDetail } from './AnimeDetail';
import { TextField } from './fields';
import { RowLink } from './RowLink';
import { ErrorNotice } from './ErrorNotice';

export function AnimeSearch() {
    const t = useTranslator();
    const search = useAnimeStore((state) => {
        return state.search;
    });
    const selection = useAnimeStore((state) => {
        return state.selection;
    });
    const setQuery = useAnimeStore((state) => {
        return state.setQuery;
    });
    const runSearch = useAnimeStore((state) => {
        return state.runSearch;
    });
    const loadMoreSearch = useAnimeStore((state) => {
        return state.loadMoreSearch;
    });
    const openResult = useAnimeStore((state) => {
        return state.openResult;
    });
    const library = useAnimeStore((state) => {
        return state.library;
    });
    const showInLibrary = useAnimeStore((state) => {
        return state.showInLibrary;
    });
    // The next results come when the end of the list is reached.
    const endOfList = useInfiniteScroll(
        () => {
            void loadMoreSearch();
        },
        search.status === 'done' && search.hasNextPage && !search.loadingMore,
        search.results.length
    );

    if (selection) {
        return <AnimeDetail />;
    }
    const searching = search.status === 'searching';

    return (
        <section className="anime__search" aria-label={t('anime.search.aria')}>
            <form
                className="field-row"
                onSubmit={(event) => {
                    event.preventDefault();
                    void runSearch();
                }}
            >
                <TextField search label={t('anime.search.label')} value={search.query} placeholder={t('anime.search.placeholder')} onChange={setQuery} />
                <button type="submit" className="btn btn--primary" disabled={searching || search.query.trim().length === 0}>
                    {searching ? t('anime.search.searching') : t('anime.search.button')}
                </button>
            </form>
            {search.error !== null && (
                <p className="field__warning" role="alert">
                    <ErrorNotice report={animeErrorReport(t, search.error)} />
                </p>
            )}
            {search.status === 'done' && search.results.length === 0 && <p className="empty">{t('anime.results.none')}</p>}
            {search.status === 'done' && search.results.length > 0 && (
                <>
                    <span className="section-label">{t('anime.results.label', { count: search.results.length })}</span>
                    <WindowedList
                        as="ul"
                        className="cover-grid"
                        items={search.results}
                        listKey={`anime-search:${search.searchedQuery}`}
                        renderItem={(result, back) => {
                            // An anime is in the library from the moment it is added, whether or not an episode of it was downloaded.
                            const saved = libraryEntry(library, result.title);
                            const joined = saved;
                            const inSeries = joined?.series != null && joined.season !== null;
                            return (
                                <li key={result.index} className="history__item cover-card row--link" {...windowBack(back)}>
                                    {result.unconfirmed === true ? <AnimeCover title={result.title} url={null} /> : <AnimeCover title={result.title} />}
                                    <div className="history__main">
                                        <span className="history__title">
                                            <RowLink
                                                label={`${t('anime.open')}: ${result.title}`}
                                                title={result.title}
                                                onClick={() => {
                                                    void openResult(result);
                                                }}
                                            >
                                                {result.title}
                                            </RowLink>
                                        </span>
                                        {result.unconfirmed === true && (
                                            <span className="history__meta" data-testid="anime-result-unconfirmed">
                                                {t('anime.result.unconfirmed')}
                                            </span>
                                        )}
                                        {(saved || inSeries) && (
                                            <div className="cover-card__footer">
                                                {joined?.series != null && joined.season !== null && (
                                                    <span className="history__meta">{t('anime.series.tag', { series: joined.series, label: seasonLabel(joined, t) })}</span>
                                                )}
                                                {saved && (
                                                    <button
                                                        type="button"
                                                        className="btn btn--small btn--ghost cover-card__action"
                                                        aria-label={`${t('anime.library.view')}: ${result.title}`}
                                                        onClick={() => {
                                                            showInLibrary(saved.id);
                                                        }}
                                                    >
                                                        {t('anime.library.view')}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </li>
                            );
                        }}
                    />
                    {search.hasNextPage && (
                        <div ref={endOfList} className="manga__more" data-testid="anime-end-of-list">
                            {search.loadingMore && <p className="empty">{t('anime.results.loading')}</p>}
                        </div>
                    )}
                    {search.limited && (
                        <p className="empty" data-testid="anime-results-limit">
                            {t('anime.results.limit', { count: search.results.length })}
                        </p>
                    )}
                </>
            )}
        </section>
    );
}
