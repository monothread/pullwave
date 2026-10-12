import { useEffect } from 'react';
import type { MangaListKind } from '@shared/manga';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { TextField } from './fields';
import { MangaCover } from './MangaCover';
import { MangaDetail } from './MangaDetail';
import { MangaFilters } from './MangaFilters';
import { MangaSources } from './MangaSources';
import { MangaSourceSettings } from './MangaSourceSettings';
import { isCloudflareError, libraryEntry } from './mangaText';
import { MangaErrorNotice } from './MangaErrorNotice';
import { RowLink } from './RowLink';
import { SETTINGS_ICON } from './TabButton';

const MODES: ReadonlyArray<{ id: MangaListKind; label: 'manga.browse.mode.popular' | 'manga.browse.mode.latest' | 'manga.browse.mode.search' }> = [
    { id: 'popular', label: 'manga.browse.mode.popular' },
    { id: 'latest', label: 'manga.browse.mode.latest' },
    { id: 'search', label: 'manga.browse.mode.search' }
];

// Where a manga is looked for. First the sources (the sites the installed extensions read) are listed; a source opens on its own page,
// with its popular and latest mangas, a search and, when it has them, its settings.
export function MangaBrowse() {
    const t = useTranslator();
    const browse = useMangaStore((state) => {
        return state.browse;
    });
    const selection = useMangaStore((state) => {
        return state.selection;
    });
    const selectionFrom = useMangaStore((state) => {
        return state.selectionFrom;
    });
    const library = useMangaStore((state) => {
        return state.library;
    });
    const loadSources = useMangaStore((state) => {
        return state.loadSources;
    });
    const closeSource = useMangaStore((state) => {
        return state.closeSource;
    });
    const setMode = useMangaStore((state) => {
        return state.setMode;
    });
    const setQuery = useMangaStore((state) => {
        return state.setQuery;
    });
    const runList = useMangaStore((state) => {
        return state.runList;
    });
    const loadMore = useMangaStore((state) => {
        return state.loadMore;
    });
    const openManga = useMangaStore((state) => {
        return state.openManga;
    });
    const loadFilters = useMangaStore((state) => {
        return state.loadFilters;
    });
    const hasFilters = useMangaStore((state) => {
        return state.browse.filters.length > 0;
    });
    const settingsOpen = useMangaStore((state) => {
        return state.sourceSettings.open;
    });
    const openSourceSettings = useMangaStore((state) => {
        return state.openSourceSettings;
    });
    const { sources, sourcesStatus, sourceId, mode, query, status, items, hasNextPage, loadingMore, error } = browse;

    useEffect(() => {
        if (sourcesStatus === 'idle') {
            void loadSources();
        }
    }, [sourcesStatus, loadSources]);

    // The popular and the latest are listed as soon as the source is open; a search waits for its button.
    useEffect(() => {
        if (sourceId !== null && mode !== 'search' && status === 'idle' && !settingsOpen) {
            void runList();
        }
    }, [sourceId, mode, status, settingsOpen, runList]);

    // The filters belong to the search: they are asked of the source when its search is opened.
    useEffect(() => {
        if (sourceId !== null && mode === 'search' && !settingsOpen) {
            void loadFilters();
        }
    }, [sourceId, mode, settingsOpen, loadFilters]);

    // The next page comes when the end of the list is reached.
    const endOfList = useInfiniteScroll(
        () => {
            void loadMore();
        },
        sourceId !== null && hasNextPage && !loadingMore && status === 'done',
        items.length
    );

    if (selection !== null && selectionFrom === 'browse') {
        return <MangaDetail />;
    }
    const current = sources.find((source) => {
        return source.id === sourceId;
    });

    // No source is open: the list of the sources.
    if (sourceId === null || current === undefined) {
        return (
            <section className="manga__browse" aria-label={t('manga.nav.browse')}>
                {sourcesStatus === 'loading' && <p className="empty">{t('manga.browse.loading')}</p>}
                {sourcesStatus === 'error' && browse.sourcesError && (
                    <MangaErrorNotice error={browse.sourcesError} />
                )}
                {sourcesStatus === 'ready' && sources.length === 0 && <p className="empty">{t('manga.browse.noSources')}</p>}
                {sources.length > 0 && <MangaSources />}
            </section>
        );
    }

    // The settings of the source are a screen of their own.
    if (settingsOpen) {
        return (
            <section className="manga__browse" aria-label={current.name}>
                <MangaSourceSettings />
            </section>
        );
    }

    const modes = MODES.filter((item) => {
        return item.id !== 'latest' || current.supportsLatest;
    });
    const loading = status === 'loading';

    return (
        <section className="manga__browse" aria-label={current.name}>
            <div className="queue__toolbar">
                <button type="button" className="btn btn--small btn--ghost" onClick={closeSource}>
                    {t('manga.sources.back')}
                </button>
                <h2 className="history__title manga__source-name">{current.name}</h2>
                {current.isConfigurable ? (
                    <button
                        type="button"
                        className="btn btn--ghost manga__gear"
                        aria-label={t('manga.source.settings')}
                        title={t('manga.source.settings')}
                        onClick={() => {
                            void openSourceSettings();
                        }}
                    >
                        <span aria-hidden="true">{SETTINGS_ICON}</span>
                    </button>
                ) : (
                    <span />
                )}
            </div>
            <nav className="tabs" aria-label={t('manga.nav.browse')}>
                {modes.map((item) => {
                    return (
                        <button
                            key={item.id}
                            type="button"
                            className={`tab${mode === item.id ? ' tab--active' : ''}`}
                            aria-current={mode === item.id ? 'page' : undefined}
                            onClick={() => {
                                setMode(item.id);
                            }}
                        >
                            {t(item.label)}
                        </button>
                    );
                })}
            </nav>
            {mode === 'search' && (
                <form
                    className="field-row"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void runList();
                    }}
                >
                    <TextField label={t('manga.browse.query')} value={query} placeholder={t('manga.browse.placeholder')} onChange={setQuery} />
                    <button type="submit" className="btn btn--primary" disabled={loading || (query.trim().length === 0 && !hasFilters)}>
                        {t('manga.browse.search')}
                    </button>
                </form>
            )}
            {mode === 'search' && (
                <MangaFilters
                    onApply={() => {
                        void runList();
                    }}
                />
            )}
            {loading && <p className="empty">{t('manga.browse.loading')}</p>}
            {status === 'error' && error && (
                <MangaErrorNotice error={error} />
            )}
            {status === 'error' && error !== null && isCloudflareError(error) && <p className="field__hint">{t('manga.source.cloudflareHint')}</p>}
            {status === 'error' && error?.code === 'API_ERROR' && current.isConfigurable && !isCloudflareError(error) && <p className="field__hint">{t('manga.source.configureHint')}</p>}
            {status === 'done' && items.length === 0 && <p className="empty">{t('manga.browse.none')}</p>}
            {items.length > 0 && (
                <>
                    <span className="section-label">{t('manga.browse.results', { count: items.length })}</span>
                    <ul className="cover-grid">
                        {items.map((item) => {
                            const saved = libraryEntry(library, item.sourceId, item.remoteId);
                            return (
                                <li key={item.remoteId} className="history__item cover-card row--link">
                                    <MangaCover url={item.thumbnailUrl} />
                                    <div className="history__main">
                                        <span className="history__title">
                                            <RowLink
                                                label={`${t('manga.browse.open')}: ${item.title}`}
                                                title={item.title}
                                                onClick={() => {
                                                    void openManga(item);
                                                }}
                                            >
                                                {item.title}
                                            </RowLink>
                                        </span>
                                        {saved && (
                                            <div className="cover-card__footer">
                                                <span className="badge badge--done">{t('manga.browse.inLibrary')}</span>
                                            </div>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    {hasNextPage && (
                        <div ref={endOfList} className="manga__more" data-testid="manga-end-of-list">
                            {loadingMore && <p className="empty">{t('manga.browse.loading')}</p>}
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
