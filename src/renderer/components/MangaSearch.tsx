import { useEffect } from 'react';
import type { MangaSummary } from '@shared/manga';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { useMangaStore, type MangaSearchSourceStatus } from '../store/mangaStore';
import { SelectField, TextField } from './fields';
import { MangaDetail } from './MangaDetail';
import { MangaErrorNotice } from './MangaErrorNotice';
import { MangaResultCard } from './MangaResultCard';
import { searchableSources } from './mangaSearchSources';
import { ALL_LANGUAGES, listedSources } from './mangaText';
import { sourceLanguageLabel, sourceLanguages } from './MangaSources';

const STATUS_KEYS: Record<MangaSearchSourceStatus, 'manga.search.status.waiting' | 'manga.search.status.searching' | 'manga.search.status.found' | 'manga.search.status.none' | 'manga.search.status.error'> = {
    waiting: 'manga.search.status.waiting',
    searching: 'manga.search.status.searching',
    found: 'manga.search.status.found',
    none: 'manga.search.status.none',
    error: 'manga.search.status.error'
};

const BADGE_CLASSES: Record<MangaSearchSourceStatus, string> = {
    waiting: 'badge--queued',
    searching: 'badge--queued',
    found: 'badge--done',
    none: 'badge--queued',
    error: 'badge--error'
};

// Looks for a manga by name in every source of a language and shows, source by source, whether it was found.
export function MangaSearch() {
    const t = useTranslator();
    const browse = useMangaStore((state) => {
        return state.browse;
    });
    const search = useMangaStore((state) => {
        return state.search;
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
    const setSourceLanguage = useMangaStore((state) => {
        return state.setSourceLanguage;
    });
    const setSearchQuery = useMangaStore((state) => {
        return state.setSearchQuery;
    });
    const runSearch = useMangaStore((state) => {
        return state.runSearch;
    });
    const openManga = useMangaStore((state) => {
        return state.openManga;
    });
    const showAdult = useAppStore((state) => {
        return state.settings.mangaShowAdult;
    });
    const { sources, sourcesStatus, sourcesError } = browse;

    useEffect(() => {
        if (sourcesStatus === 'idle') {
            void loadSources();
        }
    }, [sourcesStatus, loadSources]);

    if (selection !== null && selectionFrom === 'search') {
        return <MangaDetail />;
    }
    const languages = sourceLanguages(listedSources(sources, showAdult));
    // A language that was remembered but is not there any more (its sources are gone or hidden) searches everything.
    const language = languages.includes(browse.sourceLanguage) ? browse.sourceLanguage : ALL_LANGUAGES;
    const targets = searchableSources(sources, language, showAdult).length;
    const searching = search.status === 'searching';
    const finished = search.results.filter((result) => {
        return result.status !== 'waiting' && result.status !== 'searching';
    }).length;
    const foundIn = search.results.filter((result) => {
        return result.status === 'found';
    }).length;
    const openFound = (found: MangaSummary): void => {
        void openManga(found);
    };

    return (
        <section className="manga__search" aria-label={t('manga.nav.search')}>
            {sourcesStatus === 'loading' && <p className="empty">{t('manga.browse.loading')}</p>}
            {sourcesStatus === 'error' && sourcesError && <MangaErrorNotice error={sourcesError} />}
            {sourcesStatus === 'ready' && targets === 0 && <p className="empty">{t('manga.search.noSources')}</p>}
            {sources.length > 0 && (
                <form
                    className="field-row"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void runSearch();
                    }}
                >
                    <SelectField
                        label={t('manga.sources.language')}
                        value={language}
                        options={[ALL_LANGUAGES, ...languages]}
                        formatOption={(option) => {
                            return option === ALL_LANGUAGES ? t('manga.sources.allLanguages') : sourceLanguageLabel(option, t);
                        }}
                        onChange={setSourceLanguage}
                    />
                    <TextField label={t('manga.search.name')} value={search.query} placeholder={t('manga.search.namePlaceholder')} onChange={setSearchQuery} />
                    <button type="submit" className="btn btn--primary" disabled={search.query.trim().length === 0 || targets === 0 || searching}>
                        {t('manga.search.button')}
                    </button>
                </form>
            )}
            {search.status !== 'idle' && (
                <span className="section-label">{searching ? t('manga.search.progress', { done: finished, total: search.results.length }) : t('manga.search.summary', { name: search.searchedFor, found: foundIn, total: search.results.length })}</span>
            )}
            {search.results.map((result) => {
                return (
                    <div key={result.source.id} className="manga__source-group" data-testid="manga-search-source">
                        <h3 className="section-label">
                            {`${result.source.name} (${sourceLanguageLabel(result.source.lang, t)})`} <span className={`badge ${BADGE_CLASSES[result.status]}`}>{t(STATUS_KEYS[result.status], { count: result.items.length })}</span>
                        </h3>
                        {result.status === 'error' && result.error && <MangaErrorNotice error={result.error} />}
                        {result.items.length > 0 && (
                            <ul className="cover-grid">
                                {result.items.map((item) => {
                                    return <MangaResultCard key={item.remoteId} item={item} library={library} onOpen={openFound} />;
                                })}
                            </ul>
                        )}
                    </div>
                );
            })}
        </section>
    );
}
