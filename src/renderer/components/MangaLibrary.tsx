import { useEffect, useState, type ReactNode } from 'react';
import type { LibraryManga } from '@shared/manga';
import { foldSeries } from '@shared/series';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { TextField } from './fields';
import { MangaCover } from './MangaCover';
import { MangaRemove } from './MangaRemove';
import { MangaDetail } from './MangaDetail';
import { MangaGroupsPanel } from './MangaGroupsPanel';
import { MangaSeriesView } from './MangaSeriesView';
import { RowLink } from './RowLink';
import { activeGroup, downloadedCount, downloadedTotals, groupLibrary, inGroup, matchesManga, newChapterCount, searchMatchesByTab, sourceIsMissing, sourceLabelsOf, type MangaLibraryGroup } from './mangaText';

interface MangaRowProps {
    manga: LibraryManga;
}

// The badge of the chapters that were put in the library today, when there are some.
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
    // How many seasons the card stands for, when it is a series (the badge of the seasons).
    seasons?: number;
    // The extension of the source of the manga (of one of the seasons, for a series) is not installed.
    sourceMissing: boolean;
    // The sources the manga comes from (name and language), once each; the ones that are not known are left out.
    sourceLabels: readonly string[];
    onOpen: () => void;
    // What goes at the bottom of the card, under the badges.
    actions?: ReactNode;
}

// The card of the library, like the one of the anime: the cover, the name (the way into the manga or the series), how much is downloaded and
// the badges at the bottom (the seasons of a series, the chapters that are new) with what can be done to it.
function MangaCard({ testId, title, openLabel, thumbnailUrl, done, total, newChapters, seasons, sourceMissing, sourceLabels, onOpen, actions }: MangaCardProps) {
    const t = useTranslator();
    return (
        <li className="job job--done series cover-card row--link manga__entry" data-testid={testId}>
            <MangaCover url={thumbnailUrl} />
            <div className="cover-card__body">
                <header className="job__head">
                    <h3 className="series__title">
                        <RowLink label={openLabel} title={title} onClick={onOpen}>
                            {title}
                        </RowLink>
                    </h3>
                    <span className="history__meta">{t('manga.library.progress', { done, total })}</span>
                </header>
                <div className="cover-card__footer">
                    {(seasons !== undefined || newChapters > 0 || sourceMissing || sourceLabels.length > 0) && (
                        <span className="job__badges">
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
                        </span>
                    )}
                    {actions !== undefined && <div className="job__actions library__footer">{actions}</div>}
                </div>
            </div>
        </li>
    );
}

// Whether the extension of the source of any of these mangas is not installed (not known while the list of the sources is not read).
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

// The name and the language of the sources of these mangas, once each (a source the list does not have is left out).
function useSourceLabels(mangas: readonly LibraryManga[]): string[] {
    const sources = useMangaStore((state) => {
        return state.browse.sources;
    });
    return sourceLabelsOf(sources, mangas);
}

function MangaRow({ manga }: MangaRowProps) {
    const t = useTranslator();
    const sourceMissing = useSourceMissing([manga]);
    const sourceLabels = useSourceLabels([manga]);
    const removeManga = useMangaStore((state) => {
        return state.removeManga;
    });
    const openManga = useMangaStore((state) => {
        return state.openManga;
    });

    return (
        <MangaCard
            testId="manga-entry"
            title={manga.title}
            openLabel={`${t('manga.browse.open')}: ${manga.title}`}
            thumbnailUrl={manga.thumbnailUrl}
            done={downloadedCount(manga)}
            total={manga.chapters.length}
            newChapters={newChapterCount([manga])}
            sourceMissing={sourceMissing}
            sourceLabels={sourceLabels}
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

// A series of the library: its name, how many seasons it has and how much is downloaded, and the way into its own screen.
function SeriesRow({ group, onOpen }: SeriesRowProps) {
    const t = useTranslator();
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
            newChapters={newChapterCount(group.entries)}
            seasons={group.entries.length}
            sourceMissing={sourceMissing}
            sourceLabels={sourceLabels}
            onOpen={onOpen}
        />
    );
}

// The mangas the user keeps, as cards (a series of several seasons is one card), with how many chapters of each are downloaded. They can be
// searched and limited to one of the groups the user made.
export function MangaLibrary() {
    const t = useTranslator();
    const library = useMangaStore((state) => {
        return state.library;
    });
    const groups = useMangaStore((state) => {
        return state.groups;
    });
    const hiddenGroupIds = useMangaStore((state) => {
        return state.hiddenGroupIds;
    });
    const libraryGroup = useMangaStore((state) => {
        return state.libraryGroup;
    });
    const setLibraryGroup = useMangaStore((state) => {
        return state.setLibraryGroup;
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
    const sourcesStatus = useMangaStore((state) => {
        return state.browse.sourcesStatus;
    });
    const loadSources = useMangaStore((state) => {
        return state.loadSources;
    });
    const [search, setSearch] = useState('');
    const [managing, setManaging] = useState(false);

    // The sources are read to tell which mangas have an extension that is not installed.
    useEffect(() => {
        if (sourcesStatus === 'idle') {
            void loadSources();
        }
    }, [sourcesStatus, loadSources]);

    // A manga opened from the library is shown as it is from the browse: its chapters, to read, download or remove.
    if (selection !== null && selectionFrom === 'library') {
        return <MangaDetail />;
    }
    if (library.length === 0) {
        return (
            <section className="manga__library" aria-label={t('manga.nav.library')}>
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
                    // The key of a series is made of its name, so the screen goes on with the series under its new one.
                    openSeries(`series-${foldSeries(renamed)}`);
                }}
            />
        );
    }
    // The tab of all holds the mangas that are in no group; it is not there when every manga is in a group.
    const hasAllTab = inGroup(library, null).length > 0;
    // A hidden group has no tab, and the mangas that are only in it are not shown.
    const visibleGroups = groups.filter((group) => {
        return !hiddenGroupIds.includes(group.id);
    });
    const hiddenCount = groups.length - visibleGroups.length;
    const currentGroup = activeGroup(library, visibleGroups, libraryGroup);
    const shown = inGroup(library, currentGroup).filter((manga) => {
        return matchesManga(manga, search);
    });
    // While searching, the tabs that hold a match say how many.
    const tabMatches = searchMatchesByTab(library, [...(hasAllTab ? [null] : []), ...visibleGroups.map((group) => { return group.id; })], search);
    const matchBadge = (groupId: number | null): ReactNode => {
        const count = tabMatches.get(groupId);
        return count === undefined ? null : (
            <span className="badge" aria-label={t('manga.library.tabMatches', { count })}>
                {count}
            </span>
        );
    };
    const cards = groupLibrary(shown);
    return (
        <section className="manga__library" aria-label={t('manga.nav.library')}>
            <div className="field-row">
                <TextField label={t('manga.library.search.label')} value={search} placeholder={t('manga.library.search.placeholder')} onChange={setSearch} />
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
            {visibleGroups.length > 0 && (
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
                    {visibleGroups.map((group) => {
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
            {hiddenCount > 0 && <p className="field__hint">{t('manga.library.hiddenGroups', { count: hiddenCount })}</p>}
            <span className="section-label">{t('manga.library.label', { count: cards.length })}</span>
            {shown.length === 0 && <p className="empty">{currentGroup !== null && search.trim().length === 0 ? t('manga.library.emptyGroup') : t('manga.library.search.none')}</p>}
            <ul className="cover-grid">
                {cards.map((card) => {
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
                })}
            </ul>
        </section>
    );
}
