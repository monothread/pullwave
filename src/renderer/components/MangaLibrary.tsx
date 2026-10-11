import { useState } from 'react';
import type { LibraryManga } from '@shared/manga';
import { foldSeries } from '@shared/series';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { TextField } from './fields';
import { MangaCover } from './MangaCover';
import { MangaDetail } from './MangaDetail';
import { MangaGroupsPanel } from './MangaGroupsPanel';
import { MangaSeriesView } from './MangaSeriesView';
import { RowLink } from './RowLink';
import { downloadedCount, downloadedTotals, groupLibrary, inGroup, matchesSearch, type MangaLibraryGroup } from './mangaText';

interface MangaRowProps {
    manga: LibraryManga;
}

function MangaRow({ manga }: MangaRowProps) {
    const t = useTranslator();
    const groups = useMangaStore((state) => {
        return state.groups;
    });
    const openFolder = useMangaStore((state) => {
        return state.openFolder;
    });
    const removeManga = useMangaStore((state) => {
        return state.removeManga;
    });
    const openManga = useMangaStore((state) => {
        return state.openManga;
    });
    const [confirming, setConfirming] = useState(false);
    const done = downloadedCount(manga);
    const inside = groups.filter((group) => {
        return manga.groupIds.includes(group.id);
    });

    return (
        <li className="manga__entry" data-testid="manga-entry">
            <div className="history__item row--link">
                <MangaCover url={manga.thumbnailUrl} />
                <div className="history__main">
                    <h3 className="history__title">
                        <RowLink
                            label={`${t('manga.browse.open')}: ${manga.title}`}
                            title={manga.title}
                            onClick={() => {
                                void openManga({ remoteId: manga.remoteId, sourceId: manga.sourceId, title: manga.title, thumbnailUrl: manga.thumbnailUrl });
                            }}
                        >
                            {manga.title}
                        </RowLink>
                    </h3>
                    <span className="history__meta">{t('manga.library.progress', { done, total: manga.chapters.length })}</span>
                    {inside.length > 0 && (
                        <span className="history__meta" data-testid="manga-entry-groups">
                            {inside
                                .map((group) => {
                                    return group.name;
                                })
                                .join(' · ')}
                        </span>
                    )}
                </div>
                <span className="anime__actions">
                    <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => {
                            void openFolder(manga.id);
                        }}
                    >
                        {t('manga.library.openFolder')}
                    </button>
                    {confirming ? (
                        <>
                            <button
                                type="button"
                                className="btn btn--small btn--hot"
                                onClick={() => {
                                    void removeManga(manga.id);
                                }}
                            >
                                {t('manga.library.confirmRemove')}
                            </button>
                            <button
                                type="button"
                                className="btn btn--small btn--ghost"
                                onClick={() => {
                                    setConfirming(false);
                                }}
                            >
                                {t('manga.library.cancelRemove')}
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            className="btn btn--small btn--hot"
                            onClick={() => {
                                setConfirming(true);
                            }}
                        >
                            {t('manga.library.remove')}
                        </button>
                    )}
                </span>
            </div>
        </li>
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
    return (
        <li className="manga__entry" data-testid="manga-series">
            <div className="history__item row--link">
                <MangaCover url={group.entries[0]?.thumbnailUrl ?? null} />
                <div className="history__main">
                    <h3 className="history__title">
                        <RowLink label={`${t('manga.series.open')}: ${group.series}`} title={group.series} onClick={onOpen}>
                            {group.series}
                        </RowLink>
                    </h3>
                    <span className="history__meta">{t('manga.library.progress', { done: totals.done, total: totals.total })}</span>
                </div>
                <span className="badge">{group.entries.length === 1 ? t('anime.series.seasonOne') : t('anime.series.seasons', { count: group.entries.length })}</span>
            </div>
        </li>
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
    const [search, setSearch] = useState('');
    const [managing, setManaging] = useState(false);

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
    const shown = inGroup(library, libraryGroup).filter((manga) => {
        return matchesSearch(manga.title, search) || (manga.series !== null && matchesSearch(manga.series, search));
    });
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
            {groups.length > 0 && (
                <nav className="tabs" aria-label={t('manga.library.groups')}>
                    <button
                        type="button"
                        className={`tab${libraryGroup === null ? ' tab--active' : ''}`}
                        aria-current={libraryGroup === null ? 'page' : undefined}
                        onClick={() => {
                            setLibraryGroup(null);
                        }}
                    >
                        {t('manga.library.allGroups')}
                    </button>
                    {groups.map((group) => {
                        return (
                            <button
                                key={group.id}
                                type="button"
                                className={`tab${libraryGroup === group.id ? ' tab--active' : ''}`}
                                aria-current={libraryGroup === group.id ? 'page' : undefined}
                                onClick={() => {
                                    setLibraryGroup(group.id);
                                }}
                            >
                                {group.name}
                            </button>
                        );
                    })}
                </nav>
            )}
            <span className="section-label">{t('manga.library.label', { count: cards.length })}</span>
            {shown.length === 0 && <p className="empty">{libraryGroup !== null && search.trim().length === 0 ? t('manga.library.emptyGroup') : t('manga.library.search.none')}</p>}
            <ul className="history__list">
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
