import { IncrementalItems } from './IncrementalItems';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LibraryManga } from '@shared/manga';
import { foldSeries } from '@shared/series';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { TextField } from './fields';
import { MangaCover } from './MangaCover';
import { MangaCategoryFilterDialog } from './MangaCategoryFilterDialog';
import { MangaRemove } from './MangaRemove';
import { MangaDetail } from './MangaDetail';
import { MangaGroupsPanel } from './MangaGroupsPanel';
import { MangaSeriesView } from './MangaSeriesView';
import { LibraryCard } from '../library/LibraryCard';
import { LibraryControls } from '../library/LibraryControls';
import { MangaLibrarySpotlight } from '../library/LibrarySpotlights';
import { filterGroups, mangaLastArrival, mangaLastSeen, mangaNews, sortGroups, type LibraryFilter } from '../spotlight/spotlightData';
import { useMangaLibrarySort } from '../store/sortPrefsStore';
import { activeLibraryGenres, availableGenres, downloadedCount, downloadedTotals, filterGroupsByGenres, groupLibrary, inGroup, matchesManga, newChapterCount, searchMatchesByTab, sourceIsMissing, sourceLabelsOf, type MangaLibraryGroup } from './mangaText';
import { useAppTimeZone } from '../hooks/useAppTimeZone';
import { useShownHistory, useShownLibrary } from '../hooks/useShownManga';
import { NotFound } from './NotFound';

interface MangaRowProps {
    manga: LibraryManga;
}

export function NewChaptersBadge({ count }: { count: number }) {
    const t = useTranslator();
    if (count === 0) {
        return null;
    }
    return (
        <span className="badge badge--new" data-testid="manga-new-chapters">
            {count === 1 ? t('manga.library.newChapter') : t('manga.library.newChapters', { count })}
        </span>
    );
}

interface MangaCardProps {
    testId: 'manga-entry' | 'manga-series';
    title: string;
    openLabel: string;
    thumbnailUrl: string | null;
    done: number;
    total: number;
    newChapters: number;
    seasons?: number;
    sourceMissing: boolean;
    sourceLabels: readonly string[];
    onOpen: () => void;
    actions?: ReactNode;
}

function MangaCard({ testId, title, openLabel, thumbnailUrl, done, total, newChapters, seasons, sourceMissing, sourceLabels, onOpen, actions }: MangaCardProps) {
    const t = useTranslator();
    const hasBadges = seasons !== undefined || newChapters > 0 || sourceMissing || sourceLabels.length > 0;
    return (
        <LibraryCard
            className="manga__entry"
            testId={testId}
            cover={<MangaCover url={thumbnailUrl} />}
            title={title}
            openLabel={openLabel}
            onOpen={onOpen}
            meta={<span className="history__meta">{t('manga.library.progress', { done, total })}</span>}
            badges={
                hasBadges ? (
                    <>
                        {seasons !== undefined && <span className="badge">{seasons === 1 ? t('anime.series.seasonOne') : t('anime.series.seasons', { count: seasons })}</span>}
                        <NewChaptersBadge count={newChapters} />
                        {sourceLabels.map((label) => {
                            return (
                                <span key={label} className="badge badge--source" data-testid="manga-source-name" title={t('manga.library.source')}>
                                    {label}
                                </span>
                            );
                        })}
                        {sourceMissing && (
                            <span className="badge badge--error" data-testid="manga-source-missing" title={t('manga.detail.sourceMissing')}>
                                {t('manga.library.sourceMissing')}
                            </span>
                        )}
                    </>
                ) : undefined
            }
            actions={actions}
        />
    );
}

function useSourceMissing(mangas: readonly LibraryManga[]): boolean {
    const sources = useMangaStore((state) => {
        return state.browse.sources;
    });
    const sourcesStatus = useMangaStore((state) => {
        return state.browse.sourcesStatus;
    });
    return mangas.some((manga) => {
        return sourceIsMissing(sources, sourcesStatus, manga.sourceId);
    });
}

function useSourceLabels(mangas: readonly LibraryManga[]): string[] {
    const sources = useMangaStore((state) => {
        return state.browse.sources;
    });
    return sourceLabelsOf(sources, mangas);
}

interface MangaEntryCardProps {
    manga: LibraryManga;
    onOpen: () => void;
    actions?: ReactNode;
}

export function MangaEntryCard({ manga, onOpen, actions }: MangaEntryCardProps) {
    const t = useTranslator();
    const timeZone = useAppTimeZone();
    const sourceMissing = useSourceMissing([manga]);
    const sourceLabels = useSourceLabels([manga]);
    return (
        <MangaCard
            testId="manga-entry"
            title={manga.title}
            openLabel={`${t('manga.browse.open')}: ${manga.title}`}
            thumbnailUrl={manga.thumbnailUrl}
            done={downloadedCount(manga)}
            total={manga.chapters.length}
            newChapters={newChapterCount([manga], undefined, timeZone)}
            sourceMissing={sourceMissing}
            sourceLabels={sourceLabels}
            onOpen={onOpen}
            actions={actions}
        />
    );
}

function MangaRow({ manga }: MangaRowProps) {
    const t = useTranslator();
    const removeManga = useMangaStore((state) => {
        return state.removeManga;
    });
    const openManga = useMangaStore((state) => {
        return state.openManga;
    });

    return (
        <MangaEntryCard
            manga={manga}
            onOpen={() => {
                void openManga({ remoteId: manga.remoteId, sourceId: manga.sourceId, title: manga.title, thumbnailUrl: manga.thumbnailUrl });
            }}
            actions={
                <MangaRemove
                    label={t('manga.library.remove')}
                    ariaLabel={`${t('manga.library.remove')}: ${manga.title}`}
                    title={t('manga.remove.manga.title', { name: manga.title })}
                    message={t('manga.remove.manga.message')}
                    onRemove={() => {
                        void removeManga(manga.id);
                    }}
                />
            }
        />
    );
}

interface SeriesRowProps {
    group: MangaLibraryGroup;
    onOpen: () => void;
}

function SeriesRow({ group, onOpen }: SeriesRowProps) {
    const t = useTranslator();
    const timeZone = useAppTimeZone();
    const totals = downloadedTotals(group.entries);
    const sourceMissing = useSourceMissing(group.entries);
    const sourceLabels = useSourceLabels(group.entries);
    return (
        <MangaCard
            testId="manga-series"
            title={group.series}
            openLabel={`${t('manga.series.open')}: ${group.series}`}
            thumbnailUrl={group.entries[0]?.thumbnailUrl ?? null}
            done={totals.done}
            total={totals.total}
            newChapters={newChapterCount(group.entries, undefined, timeZone)}
            seasons={group.entries.length}
            sourceMissing={sourceMissing}
            sourceLabels={sourceLabels}
            onOpen={onOpen}
        />
    );
}

export function MangaLibrary() {
    const t = useTranslator();
    const library = useShownLibrary();
    const groups = useMangaStore((state) => {
        return state.groups;
    });
    const libraryGroup = useMangaStore((state) => {
        return state.libraryGroup;
    });
    const setLibraryGroup = useMangaStore((state) => {
        return state.setLibraryGroup;
    });
    const libraryGenres = useMangaStore((state) => {
        return state.libraryGenres;
    });
    const libraryGenreMode = useMangaStore((state) => {
        return state.libraryGenreMode;
    });
    const setLibraryGenres = useMangaStore((state) => {
        return state.setLibraryGenres;
    });
    const clearLibraryGenres = useMangaStore((state) => {
        return state.clearLibraryGenres;
    });
    const selection = useMangaStore((state) => {
        return state.selection;
    });
    const selectionFrom = useMangaStore((state) => {
        return state.selectionFrom;
    });
    const openKey = useMangaStore((state) => {
        return state.librarySeries;
    });
    const openSeries = useMangaStore((state) => {
        return state.openSeries;
    });
    const closeSeries = useMangaStore((state) => {
        return state.closeSeries;
    });
    const importLibrary = useMangaStore((state) => {
        return state.importLibrary;
    });
    const sourcesStatus = useMangaStore((state) => {
        return state.browse.sourcesStatus;
    });
    const loadSources = useMangaStore((state) => {
        return state.loadSources;
    });
    const history = useShownHistory();
    const [search, setSearch] = useState('');
    const [managing, setManaging] = useState(false);
    const [openedCategoriesScope, setOpenedCategoriesScope] = useState<string | null>(null);
    const [filter, setFilter] = useState<LibraryFilter>('all');
    const categoryButtonRef = useRef<HTMLButtonElement>(null);
    const hasAllTab = useMemo(() => {
        return library.some((manga) => {
            return manga.groupIds.length === 0;
        });
    }, [library]);
    const currentGroup = libraryGroup !== null || hasAllTab ? libraryGroup : (groups[0]?.id ?? null);
    const [sort, setSort] = useMangaLibrarySort(currentGroup, filter);
    const [openedAt] = useState(() => {
        return Date.now();
    });

    const detailOpen = selection !== null && selectionFrom === 'library';
    const modalScope = `${String(currentGroup ?? 'all')}|${String(detailOpen)}|${openKey ?? ''}`;
    const filteringCategories = openedCategoriesScope === modalScope;

    const groupMangas = useMemo(() => {
        return inGroup(library, currentGroup);
    }, [library, currentGroup]);
    const categories = useMemo(() => {
        return availableGenres(groupMangas);
    }, [groupMangas]);
    const activeGenres = useMemo(() => {
        return activeLibraryGenres(libraryGenres, categories);
    }, [libraryGenres, categories]);
    const hasCategoryFilter = activeGenres.length > 0;
    const shown = useMemo(() => {
        return groupMangas.filter((manga) => {
            return matchesManga(manga, search);
        });
    }, [groupMangas, search]);
    const grouped = useMemo(() => {
        return groupLibrary(shown);
    }, [shown]);
    const all = useMemo(() => {
        return filterGroupsByGenres(grouped, activeGenres, libraryGenreMode);
    }, [grouped, activeGenres, libraryGenreMode]);

    const previousGroupRef = useRef<number | null>(currentGroup);
    useEffect(() => {
        if (previousGroupRef.current !== currentGroup) {
            previousGroupRef.current = currentGroup;
            if (libraryGenres.length > 0 || libraryGenreMode !== 'or') {
                clearLibraryGenres();
            }
            return;
        }
        if (libraryGenres.length === 0) {
            return;
        }
        if (activeGenres.length === 0) {
            clearLibraryGenres();
            return;
        }
        const changed =
            activeGenres.length !== libraryGenres.length ||
            activeGenres.some((genre, index) => {
                return genre !== libraryGenres[index];
            });
        if (changed) {
            setLibraryGenres(activeGenres, libraryGenreMode);
        }
    }, [currentGroup, libraryGenres, libraryGenreMode, activeGenres, clearLibraryGenres, setLibraryGenres]);

    useEffect(() => {
        if (sourcesStatus === 'idle') {
            void loadSources();
        }
    }, [sourcesStatus, loadSources]);

    const importButton = (
        <button
            type="button"
            className="btn btn--small"
            title={t('manga.import.hint')}
            onClick={() => {
                void importLibrary();
            }}
        >
            {t('manga.import.button')}
        </button>
    );

    if (detailOpen) {
        return <MangaDetail />;
    }
    if (library.length === 0) {
        return (
            <section className="manga__library" aria-label={t('manga.nav.library')}>
                <div className="field-row">{importButton}</div>
                <p className="empty">{t('manga.library.empty')}</p>
            </section>
        );
    }
    const openGroup = openKey === null ? undefined : groupLibrary(library).find((group) => {
        return group.key === openKey;
    });
    if (openGroup) {
        return (
            <MangaSeriesView
                group={openGroup}
                onBack={closeSeries}
                onRenamed={(renamed) => {
                    openSeries(`series-${foldSeries(renamed)}`);
                }}
            />
        );
    }
    const tabMatches = searchMatchesByTab(library, [...(hasAllTab ? [null] : []), ...groups.map((group) => { return group.id; })], search);
    const matchBadge = (groupId: number | null): ReactNode => {
        const count = tabMatches.get(groupId);
        return count === undefined ? null : (
            <span className="badge" aria-label={t('manga.library.tabMatches', { count })}>
                {count}
            </span>
        );
    };
    const newsOf = (group: MangaLibraryGroup): number => {
        return mangaNews(group.entries, openedAt).count;
    };
    const lastSeenOf = (group: MangaLibraryGroup): number => {
        return mangaLastSeen(group.entries, history);
    };
    const lastArrivalOf = (group: MangaLibraryGroup): number => {
        return mangaLastArrival(group.entries);
    };
    const newsGroups = filterGroups(all, 'news', newsOf);
    const cards = sortGroups(filter === 'news' ? newsGroups : filterGroups(all, filter, newsOf), sort, lastSeenOf, lastArrivalOf);
    const searching = search.trim().length > 0;
    const emptyCategoriesMessage = t(groups.length === 0 ? 'manga.library.categories.emptyLibrary' : 'manga.library.categories.empty');
    const categoryButtonTitle =
        categories.length === 0
            ? emptyCategoriesMessage
            : hasCategoryFilter
              ? `${t(libraryGenreMode === 'and' ? 'manga.library.categories.and' : 'manga.library.categories.or')}: ${activeGenres.join(', ')}`
              : t('manga.library.categories.hint');
    return (
        <section className="manga__library" aria-label={t('manga.nav.library')}>
            {!searching && !hasCategoryFilter && <MangaLibrarySpotlight />}
            <div className="field-row">
                <TextField search label={t('manga.library.search.label')} value={search} placeholder={t('manga.library.search.placeholder')} onChange={setSearch} />
                {importButton}
                <button
                    type="button"
                    className="btn btn--small"
                    aria-expanded={managing}
                    onClick={() => {
                        setManaging(!managing);
                    }}
                >
                    {t('manga.library.manageGroups')}
                </button>
            </div>
            {managing && <MangaGroupsPanel />}
            {groups.length > 0 && (
                <nav className="tabs" aria-label={t('manga.library.groups')}>
                    {hasAllTab && (
                        <button
                            type="button"
                            className={`tab${currentGroup === null ? ' tab--active' : ''}`}
                            aria-current={currentGroup === null ? 'page' : undefined}
                            onClick={() => {
                                setLibraryGroup(null);
                            }}
                        >
                            {t('manga.library.allGroups')}
                            {matchBadge(null)}
                        </button>
                    )}
                    {groups.map((group) => {
                        return (
                            <button
                                key={group.id}
                                type="button"
                                className={`tab${currentGroup === group.id ? ' tab--active' : ''}`}
                                aria-current={currentGroup === group.id ? 'page' : undefined}
                                onClick={() => {
                                    setLibraryGroup(group.id);
                                }}
                            >
                                {group.name}
                                {matchBadge(group.id)}
                            </button>
                        );
                    })}
                </nav>
            )}
            <LibraryControls
                kind="manga"
                filter={filter}
                sort={sort}
                allCount={all.length}
                newsCount={newsGroups.length}
                beforeSort={
                    <>
                        {hasCategoryFilter && (
                            <button
                                type="button"
                                className="btn btn--small btn--ghost"
                                aria-label={t('manga.library.categories.resetAria')}
                                title={t('manga.library.categories.resetAria')}
                                onClick={() => {
                                    clearLibraryGenres();
                                    categoryButtonRef.current?.focus();
                                }}
                            >
                                {t('manga.library.categories.reset')}
                            </button>
                        )}
                        <button
                            ref={categoryButtonRef}
                            type="button"
                            className={`btn btn--small${hasCategoryFilter ? ' btn--primary' : ''}`}
                            aria-haspopup="dialog"
                            disabled={categories.length === 0}
                            title={categoryButtonTitle}
                            onClick={() => {
                                setOpenedCategoriesScope(modalScope);
                            }}
                        >
                            {hasCategoryFilter ? t('manga.library.categories.active', { count: activeGenres.length }) : t('manga.library.categories.button')}
                        </button>
                    </>
                }
                onFilter={setFilter}
                onSort={setSort}
            />
            {filteringCategories && (
                <MangaCategoryFilterDialog
                    key={modalScope}
                    categories={categories}
                    selected={activeGenres}
                    mode={libraryGenreMode}
                    emptyMessage={emptyCategoriesMessage}
                    onApply={(genres, mode) => {
                        setLibraryGenres(genres, mode);
                        setOpenedCategoriesScope(null);
                    }}
                    onClose={() => {
                        setOpenedCategoriesScope(null);
                    }}
                />
            )}
            <span className="section-label">{t('manga.library.label', { count: cards.length })}</span>
            {shown.length === 0 && currentGroup !== null && !searching && <p className="empty">{t('manga.library.emptyGroup')}</p>}
            {shown.length === 0 && (currentGroup === null || searching) && <NotFound text={t('manga.library.search.none')} />}
            {shown.length > 0 && all.length === 0 && <NotFound text={t('manga.library.categories.none')} />}
            {all.length > 0 && cards.length === 0 && <p className="empty">{t('library.filter.noNews')}</p>}
            <ul className="cover-grid">
                <IncrementalItems items={cards} listKey="manga-library" end="li" renderItem={(card) => {
                    const single = card.entries[0];
                    return card.key.startsWith('manga-') && single !== undefined ? (
                        <MangaRow key={card.key} manga={single} />
                    ) : (
                        <SeriesRow
                            key={card.key}
                            group={card}
                            onOpen={() => {
                                openSeries(card.key);
                            }}
                        />
                    );
                }} />
            </ul>
        </section>
    );
}
