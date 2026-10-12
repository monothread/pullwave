import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { useEffect, useMemo, useState } from 'react';
import { MangaCover } from './MangaCover';
import { activateFilter, type TermKind } from './mangaFilterSearch';
import { MangaGroupChips } from './MangaGroupChips';
import { MangaMigrateSource } from './MangaMigrateSource';
import { MangaSeriesSettings } from './MangaSeriesSettings';
import { loadAllProgress, loadLastChapter, progressKey } from './readerPrefs';
import { RowLink } from './RowLink';
import { SETTINGS_ICON } from './TabButton';
import { chapterState, chapterStatusKey, continueIndex, downloadablePicks, isNewChapter, isCloudflareError, libraryEntry, mangaErrorKey, mangaStatusKey } from './mangaText';

function chapterLabel(name: string, number: number | null): string {
    if (name.length > 0) {
        return name;
    }
    return number === null ? '' : `#${number}`;
}

interface TermButtonProps {
    term: string;
    label: string;
    kind: TermKind;
    // Whether the source has a filter that stands for the term: only then does a click search it.
    searchable: boolean;
    onSearch: (term: string, kind: TermKind) => Promise<void>;
}

// A genre, an author or an artist: a click opens the search of the source with the filter that stands for it turned on. When the source
// has no such filter the term is only shown.
function TermButton({ term, label, kind, searchable, onSearch }: TermButtonProps) {
    if (!searchable) {
        return <span className="manga__tag manga__tag--plain">{term}</span>;
    }
    return (
        <button
            type="button"
            className="manga__tag"
            aria-label={label}
            title={label}
            onClick={() => {
                void onSearch(term, kind);
            }}
        >
            {term}
        </button>
    );
}

function formatDate(milliseconds: number | null): string {
    return milliseconds === null ? '' : new Date(milliseconds).toLocaleDateString();
}

// A manga opened from the browse: what the source says about it, its chapters to pick, and what to do with them.
export function MangaDetail() {
    const t = useTranslator();
    const selection = useMangaStore((state) => {
        return state.selection;
    });
    const library = useMangaStore((state) => {
        return state.library;
    });
    const closeManga = useMangaStore((state) => {
        return state.closeManga;
    });
    const toggleChapter = useMangaStore((state) => {
        return state.toggleChapter;
    });
    const selectChapters = useMangaStore((state) => {
        return state.selectChapters;
    });
    const downloadSelected = useMangaStore((state) => {
        return state.downloadSelected;
    });
    const addToLibrary = useMangaStore((state) => {
        return state.addToLibrary;
    });
    const openReader = useMangaStore((state) => {
        return state.openReader;
    });
    const removeDownload = useMangaStore((state) => {
        return state.removeDownload;
    });
    const selectionFrom = useMangaStore((state) => {
        return state.selectionFrom;
    });
    const showInLibrary = useMangaStore((state) => {
        return state.showInLibrary;
    });
    const showInSource = useMangaStore((state) => {
        return state.showInSource;
    });
    const searchByTerm = useMangaStore((state) => {
        return state.searchByTerm;
    });
    const openSite = useMangaStore((state) => {
        return state.openSite;
    });
    const retryJob = useMangaStore((state) => {
        return state.retryJob;
    });
    const refresh = useMangaStore((state) => {
        return state.selectionRefresh;
    });
    const checkNewChapters = useMangaStore((state) => {
        return state.checkNewChapters;
    });
    const checkingNew = useMangaStore((state) => {
        return state.checkingNew;
    });
    const termFilters = useMangaStore((state) => {
        return state.termFilters;
    });
    const loadTermFilters = useMangaStore((state) => {
        return state.loadTermFilters;
    });
    const sourceId = selection?.manga.sourceId ?? null;
    const hasDetails = selection?.details != null;
    useEffect(() => {
        if (sourceId !== null && hasDetails) {
            void loadTermFilters(sourceId);
        }
    }, [sourceId, hasDetails, loadTermFilters]);
    const sourceInstalled = useMangaStore((state) => {
        return state.browse.sources.some((source) => {
            return source.id === state.selection?.manga.sourceId;
        });
    });

    const readKeys = useMangaStore((state) => {
        return state.readKeys;
    });
    const markRead = useMangaStore((state) => {
        return state.markRead;
    });
    const readerOpen = useMangaStore((state) => {
        return state.reader.status !== 'closed';
    });

    const [migrating, setMigrating] = useState(false);
    const [organizing, setOrganizing] = useState(false);
    // The page each chapter was left on: read again when the reader closes (it is what the reader writes).
    const progress = useMemo(() => {
        return readerOpen ? {} : loadAllProgress();
    }, [readerOpen]);

    if (selection === null) {
        return null;
    }
    const { manga, details, chapters, selected } = selection;
    // Downloading and removing files are done from the library; the page of a manga opened in the browse only reads it and adds it.
    const inLibraryPage = selectionFrom === 'library';
    const saved = libraryEntry(library, manga.sourceId, manga.remoteId);
    const missingFromLibrary = chapters.filter((chapter) => {
        return chapterState(saved, chapter.remoteId) === null;
    }).length;
    // Of the chapters picked, only the ones that a download does something for are counted.
    const toDownload = downloadablePicks(saved, selected).length;
    const shown = details ?? manga;
    // The chapters in reading order (the list shows the newest first), each with its place in the library when it is there.
    const readable = [...chapters]
        .sort((first, second) => {
            return first.sourceOrder - second.sourceOrder;
        })
        .map((chapter) => {
            return { remoteId: chapter.remoteId, libraryChapterId: chapterState(saved, chapter.remoteId)?.id ?? null, name: chapter.name, number: chapter.number };
        });

    // Which of the genres, the author and the artist the source can search with its filters.
    const searchable = (term: string, kind: TermKind): boolean => {
        return termFilters.sourceId === manga.sourceId && termFilters.status === 'ready' && activateFilter(termFilters.filters, term, kind) !== null;
    };

    const readSet = new Set(readKeys);
    const isRead = (remoteId: number): boolean => {
        return readSet.has(progressKey(shown.title, remoteId));
    };
    const allRead = readable.length > 0 && readable.every((chapter) => {
        return isRead(chapter.remoteId);
    });
    const hasStarted = readable.some((chapter) => {
        return isRead(chapter.remoteId) || (progress[progressKey(shown.title, chapter.remoteId)] ?? 0) > 0;
    });
    const nextIndex = continueIndex(readable, isRead, loadLastChapter(shown.title));

    return (
        <section className="manga__detail" aria-label={shown.title}>
            <div className="queue__toolbar">
                <button type="button" className="btn btn--small btn--ghost" onClick={closeManga}>
                    {t('manga.back')}
                </button>
            </div>
            <header className="history__item manga__head">
                {inLibraryPage && saved && (
                    <button
                        type="button"
                        className="btn btn--ghost manga__gear manga__head-gear"
                        aria-label={t('manga.detail.organize')}
                        title={t('manga.detail.organize')}
                        aria-expanded={organizing}
                        onClick={() => {
                            setOrganizing(!organizing);
                        }}
                    >
                        <span aria-hidden="true">{SETTINGS_ICON}</span>
                    </button>
                )}
                <MangaCover url={saved?.thumbnailUrl ?? shown.thumbnailUrl} />
                <div className="history__main">
                    <h2 className="history__title">{shown.title}</h2>
                    {details?.author && (
                        <span className="history__meta">
                            {`${t('manga.detail.author')}: `}
                            <TermButton term={details.author} kind="author" searchable={searchable(details.author, 'author')} label={t('manga.detail.searchBy', { term: details.author })} onSearch={searchByTerm} />
                        </span>
                    )}
                    {details?.artist && (
                        <span className="history__meta">
                            {`${t('manga.detail.artist')}: `}
                            <TermButton term={details.artist} kind="artist" searchable={searchable(details.artist, 'artist')} label={t('manga.detail.searchBy', { term: details.artist })} onSearch={searchByTerm} />
                        </span>
                    )}
                    {details && <span className="history__meta">{t(mangaStatusKey(details.status))}</span>}
                    {details && details.genres.length > 0 && (
                        <ul className="manga__tags" aria-label={t('manga.detail.genres')}>
                            {details.genres.map((genre) => {
                                return (
                                    <li key={genre}>
                                        <TermButton term={genre} kind="tag" searchable={searchable(genre, 'tag')} label={t('manga.detail.searchBy', { term: genre })} onSearch={searchByTerm} />
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    {details?.description && <p className="field__hint manga__description">{details.description}</p>}
                    {details?.url && (
                        <div className="job__actions">
                            <button
                                type="button"
                                className="btn btn--small"
                                title={details.url}
                                onClick={() => {
                                    void openSite(details.url!);
                                }}
                            >
                                {t('manga.detail.openSite')}
                            </button>
                        </div>
                    )}
                </div>
            </header>
            {inLibraryPage && saved && organizing && (
                <div className="manga__organize">
                    <section className="panel" aria-label={t('manga.library.groups')}>
                        <span className="section-label">{t('manga.library.groups')}</span>
                        <MangaGroupChips mangaIds={[saved.id]} title={saved.title} />
                    </section>
                    <MangaSeriesSettings key={`${String(saved.id)}-${saved.series ?? ''}-${String(saved.season ?? '')}`} manga={saved} />
                    {migrating ? (
                        <MangaMigrateSource
                            manga={saved}
                            onClose={() => {
                                setMigrating(false);
                            }}
                        />
                    ) : (
                        <div className="job__actions">
                            <button
                                type="button"
                                className="btn btn--small"
                                onClick={() => {
                                    setMigrating(true);
                                }}
                            >
                                {t('manga.migrateSource.title')}
                            </button>
                        </div>
                    )}
                </div>
            )}
            {selection.status === 'loading' && <p className="empty">{t('manga.detail.loading')}</p>}
            {selection.status === 'error' && selection.error && (
                <p className="field__warning" role="alert" title={selection.error.message}>
                    {t(mangaErrorKey(selection.error.code))}
                </p>
            )}
            {selection.status === 'error' && selection.error && isCloudflareError(selection.error) && <p className="field__hint">{t('manga.source.cloudflareHint')}</p>}
            {selection.status === 'ready' && refresh.loading && <p className="field__hint">{t('manga.detail.refreshing')}</p>}
            {selection.status === 'ready' && refresh.error && (
                <p className="field__warning" role="alert" title={refresh.error.message}>
                    {t('manga.detail.refreshFailed')}
                </p>
            )}
            {selection.status === 'ready' && refresh.error && isCloudflareError(refresh.error) && <p className="field__hint">{t('manga.source.cloudflareHint')}</p>}
            {selection.status === 'ready' && chapters.length === 0 && <p className="empty">{t('manga.detail.noChapters')}</p>}
            {selection.status === 'ready' && chapters.length > 0 && (
                <>
                    {inLibraryPage && (
                    <div className="job__actions">
                        <button
                            type="button"
                            className="btn btn--primary"
                            onClick={() => {
                                void openReader(shown.title, readable, nextIndex);
                            }}
                        >
                            {hasStarted ? t('manga.detail.continue') : t('manga.detail.start')}
                        </button>
                        <button
                            type="button"
                            className="btn"
                            onClick={() => {
                                markRead(
                                    readable.map((chapter) => {
                                        return progressKey(shown.title, chapter.remoteId);
                                    }),
                                    !allRead
                                );
                            }}
                        >
                            {allRead ? t('manga.detail.markAllUnread') : t('manga.detail.markAllRead')}
                        </button>
                    </div>
                    )}
                    <div className="queue__toolbar">
                        <span className="section-label">{t('manga.detail.chapters', { count: chapters.length })}</span>
                        {inLibraryPage && (
                            <span className="job__actions">
                                <button
                                    type="button"
                                    className="btn btn--small btn--ghost"
                                    onClick={() => {
                                        selectChapters('all');
                                    }}
                                >
                                    {t('manga.detail.selectAll')}
                                </button>
                                <button
                                    type="button"
                                    className="btn btn--small btn--ghost"
                                    onClick={() => {
                                        selectChapters('none');
                                    }}
                                >
                                    {t('manga.detail.selectNone')}
                                </button>
                                <button
                                    type="button"
                                    className="btn btn--small btn--ghost"
                                    onClick={() => {
                                        selectChapters('missing');
                                    }}
                                >
                                    {t('manga.detail.selectMissing')}
                                </button>
                            </span>
                        )}
                    </div>
                    <div className="job__actions">
                        {inLibraryPage ? (
                            <>
                                <button
                                    type="button"
                                    className="btn btn--primary"
                                    disabled={toDownload === 0}
                                    onClick={() => {
                                        void downloadSelected();
                                    }}
                                >
                                    {t('manga.detail.download', { count: toDownload })}
                                </button>
                                <button type="button" className="btn" disabled={!sourceInstalled} title={sourceInstalled ? undefined : t('manga.detail.sourceMissing')} onClick={() => {
                                    void showInSource();
                                }}>
                                    {t('manga.detail.goToSource')}
                                </button>
                                {saved && (
                                    <button
                                        type="button"
                                        className="btn"
                                        disabled={checkingNew !== null}
                                        onClick={() => {
                                            void checkNewChapters(saved.id);
                                        }}
                                    >
                                        {checkingNew === saved.id ? t('manga.detail.refreshWorking') : t('manga.detail.refresh')}
                                    </button>
                                )}
                            </>
                        ) : (
                            <>
                                {saved ? (
                                    <button
                                        type="button"
                                        className="btn btn--primary"
                                        onClick={() => {
                                            void showInLibrary();
                                        }}
                                    >
                                        {t('manga.detail.goToLibrary')}
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        className="btn btn--primary"
                                        onClick={() => {
                                            void addToLibrary();
                                        }}
                                    >
                                        {t('manga.detail.add')}
                                    </button>
                                )}
                                {saved && (
                                    <button
                                        type="button"
                                        className="btn"
                                        disabled={missingFromLibrary === 0}
                                        onClick={() => {
                                            void addToLibrary();
                                        }}
                                    >
                                        {t('manga.detail.addMissing', { count: missingFromLibrary })}
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                    <ul className="history__list manga__chapters">
                        {chapters.map((chapter) => {
                            const state = chapterState(saved, chapter.remoteId);
                            const label = chapterLabel(chapter.name, chapter.number);
                            const read = isRead(chapter.remoteId);
                            const pageLeftOn = progress[progressKey(shown.title, chapter.remoteId)] ?? 0;
                            const open = (): void => {
                                void openReader(
                                    shown.title,
                                    readable,
                                    readable.findIndex((item) => {
                                        return item.remoteId === chapter.remoteId;
                                    })
                                );
                            };
                            return (
                                <li key={chapter.remoteId} className="history__item row--link" data-testid="manga-chapter">
                                    {inLibraryPage && (
                                        <label className="toggle">
                                            <input
                                                type="checkbox"
                                                aria-label={`${t('manga.detail.select')}: ${label}`}
                                                checked={selected.includes(chapter.remoteId)}
                                                onChange={() => {
                                                    toggleChapter(chapter.remoteId);
                                                }}
                                            />
                                        </label>
                                    )}
                                    <div className="history__main">
                                        <span className="history__title">
                                            <RowLink label={`${t('manga.reader.read')}: ${label}`} title={label} onClick={open}>
                                                {label}
                                            </RowLink>
                                        </span>
                                        <span className="history__meta">
                                            {[chapter.scanlator, formatDate(chapter.dateUploaded), pageLeftOn > 0 && !read ? t('manga.detail.leftOn', { page: pageLeftOn + 1 }) : null].filter(Boolean).join(' · ')}
                                        </span>
                                    </div>
                                    {state && isNewChapter(state) && <span className="badge badge--new">{t('manga.detail.new')}</span>}
                                    {read && <span className="badge badge--done">{t('manga.detail.read')}</span>}
                                    {state && <span className={`badge badge--${state.status}`}>{t(chapterStatusKey(state.status))}</span>}
                                    {inLibraryPage && (
                                        <button
                                            type="button"
                                            className="btn btn--small btn--ghost"
                                            aria-label={`${read ? t('manga.detail.markUnread') : t('manga.detail.markRead')}: ${label}`}
                                            onClick={() => {
                                                markRead([progressKey(shown.title, chapter.remoteId)], !read);
                                            }}
                                        >
                                            {read ? t('manga.detail.markUnread') : t('manga.detail.markRead')}
                                        </button>
                                    )}
                                    {inLibraryPage && state && (state.status === 'error' || state.status === 'cancelled') && (
                                        <button
                                            type="button"
                                            className="btn btn--small btn--primary"
                                            aria-label={`${t('manga.jobs.retry')}: ${label}`}
                                            onClick={() => {
                                                void retryJob(state.id);
                                            }}
                                        >
                                            {t('manga.jobs.retry')}
                                        </button>
                                    )}
                                    {inLibraryPage && state && state.status === 'done' && (
                                        <button
                                            type="button"
                                            className="btn btn--small btn--ghost"
                                            aria-label={`${t('manga.library.removeDownload')}: ${label}`}
                                            onClick={() => {
                                                void removeDownload(state.id);
                                            }}
                                        >
                                            {t('manga.library.removeDownload')}
                                        </button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
        </section>
    );
}
