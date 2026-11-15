import { WindowedList } from './WindowedList';
import { useEffect } from 'react';
import type { MangaListKind, MangaSummary } from '@shared/manga';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { TextField } from './fields';
import { MangaDetail } from './MangaDetail';
import { MangaFilters } from './MangaFilters';
import { MangaSources } from './MangaSources';
import { MangaSourceSettings } from './MangaSourceSettings';
import { isCloudflareError } from './mangaText';
import { MangaErrorNotice } from './MangaErrorNotice';
import { MangaResultCard } from './MangaResultCard';
import { SETTINGS_ICON } from './TabButton';
import { NotFound } from './NotFound';

const MODES: ReadonlyArray<{ id: MangaListKind; label: 'manga.browse.mode.popular' | 'manga.browse.mode.latest' | 'manga.browse.mode.search' }> = [
    { id: 'popular', label: 'manga.browse.mode.popular' },
    { id: 'latest', label: 'manga.browse.mode.latest' },
    { id: 'search', label: 'manga.browse.mode.search' }
];

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

    useEffect(() => {
        if (sourceId !== null && mode !== 'search' && status === 'idle' && !settingsOpen) {
            void runList();
        }
    }, [sourceId, mode, status, settingsOpen, runList]);

    useEffect(() => {
        if (sourceId !== null && mode === 'search' && !settingsOpen) {
            void loadFilters();
        }
    }, [sourceId, mode, settingsOpen, loadFilters]);

    const endOfList = useInfiniteScroll(
        () => {
            void loadMore();
        },
        sourceId !== null && hasNextPage && !loadingMore && status === 'done',
        items.length
    );

    const openFound = (found: MangaSummary): void => {
        void openManga(found);
    };

    if (selection !== null && selectionFrom === 'browse') {
        return <MangaDetail />;
    }
    const current = sources.find((source) => {
        return source.id === sourceId;
    });

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
                    <TextField search label={t('manga.browse.query')} value={query} placeholder={t('manga.browse.placeholder')} onChange={setQuery} />
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
            {status === 'done' && items.length === 0 && <NotFound text={t('manga.browse.none')} />}
            {items.length > 0 && (
                <>
                    <span className="section-label">{t('manga.browse.results', { count: items.length })}</span>
                    <WindowedList
                        as="ul"
                        className="cover-grid"
                        items={items}
                        listKey={`manga-browse:${String(sourceId)}:${mode}`}
                        renderItem={(item, back) => {
                            return <MangaResultCard key={item.remoteId} item={item} library={library} onOpen={openFound} back={back} />;
                        }}
                    />
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
