import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { MangaCover } from './MangaCover';
import { RowLink } from './RowLink';
import { chapterState, chapterStatusKey, downloadedCount, isCloudflareError, libraryEntry, mangaErrorKey, mangaStatusKey } from './mangaText';

function chapterLabel(name: string, number: number | null): string {
    if (name.length > 0) {
        return name;
    }
    return number === null ? '' : `#${number}`;
}

interface TermButtonProps {
    term: string;
    label: string;
    onSearch: (term: string) => Promise<void>;
}

// A genre, an author or an artist: a click opens the search of the source with it.
function TermButton({ term, label, onSearch }: TermButtonProps) {
    return (
        <button
            type="button"
            className="manga__tag"
            aria-label={label}
            title={label}
            onClick={() => {
                void onSearch(term);
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
    const removeChapter = useMangaStore((state) => {
        return state.removeChapter;
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
    const downloadMissing = useMangaStore((state) => {
        return state.downloadMissing;
    });
    const sourceInstalled = useMangaStore((state) => {
        return state.browse.sources.some((source) => {
            return source.id === state.selection?.manga.sourceId;
        });
    });

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
    const complete = saved !== null && saved.chapters.length > 0 && downloadedCount(saved) === saved.chapters.length;
    const shown = details ?? manga;
    // The chapters in reading order (the list shows the newest first), each with its place in the library when it is there.
    const readable = [...chapters]
        .sort((first, second) => {
            return first.sourceOrder - second.sourceOrder;
        })
        .map((chapter) => {
            return { remoteId: chapter.remoteId, libraryChapterId: chapterState(saved, chapter.remoteId)?.id ?? null, name: chapter.name, number: chapter.number };
        });

    return (
        <section className="manga__detail" aria-label={shown.title}>
            <div className="queue__toolbar">
                <button type="button" className="btn btn--small btn--ghost" onClick={closeManga}>
                    {t('manga.back')}
                </button>
            </div>
            <header className="history__item manga__head">
                <MangaCover url={shown.thumbnailUrl} />
                <div className="history__main">
                    <h2 className="history__title">{shown.title}</h2>
                    {details?.author && (
                        <span className="history__meta">
                            {`${t('manga.detail.author')}: `}
                            <TermButton term={details.author} label={t('manga.detail.searchBy', { term: details.author })} onSearch={searchByTerm} />
                        </span>
                    )}
                    {details?.artist && (
                        <span className="history__meta">
                            {`${t('manga.detail.artist')}: `}
                            <TermButton term={details.artist} label={t('manga.detail.searchBy', { term: details.artist })} onSearch={searchByTerm} />
                        </span>
                    )}
                    {details && <span className="history__meta">{t(mangaStatusKey(details.status))}</span>}
                    {details && details.genres.length > 0 && (
                        <ul className="manga__tags" aria-label={t('manga.detail.genres')}>
                            {details.genres.map((genre) => {
                                return (
                                    <li key={genre}>
                                        <TermButton term={genre} label={t('manga.detail.searchBy', { term: genre })} onSearch={searchByTerm} />
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    {details?.description && <p className="field__hint manga__description">{details.description}</p>}
                </div>
            </header>
            {selection.status === 'loading' && <p className="empty">{t('manga.detail.loading')}</p>}
            {selection.status === 'error' && selection.error && (
                <p className="field__warning" role="alert" title={selection.error.message}>
                    {t(mangaErrorKey(selection.error.code))}
                </p>
            )}
            {selection.status === 'error' && selection.error && isCloudflareError(selection.error) && <p className="field__hint">{t('manga.source.cloudflareHint')}</p>}
            {selection.status === 'ready' && chapters.length === 0 && <p className="empty">{t('manga.detail.noChapters')}</p>}
            {selection.status === 'ready' && chapters.length > 0 && (
                <>
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
                                    disabled={selected.length === 0}
                                    onClick={() => {
                                        void downloadSelected();
                                    }}
                                >
                                    {t('manga.detail.download', { count: selected.length })}
                                </button>
                                {saved && (
                                    <button
                                        type="button"
                                        className="btn"
                                        disabled={complete}
                                        onClick={() => {
                                            void downloadMissing(saved.id);
                                        }}
                                    >
                                        {t('manga.library.downloadMissing')}
                                    </button>
                                )}
                                <button type="button" className="btn" disabled={!sourceInstalled} title={sourceInstalled ? undefined : t('manga.detail.sourceMissing')} onClick={() => {
                                    void showInSource();
                                }}>
                                    {t('manga.detail.goToSource')}
                                </button>
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
                                        <span className="history__meta">{[chapter.scanlator, formatDate(chapter.dateUploaded)].filter(Boolean).join(' · ')}</span>
                                    </div>
                                    {state && <span className={`badge badge--${state.status}`}>{t(chapterStatusKey(state.status))}</span>}
                                    {inLibraryPage && state && state.status !== 'queued' && state.status !== 'downloading' && (
                                        <button
                                            type="button"
                                            className="btn btn--small btn--ghost"
                                            aria-label={`${t('manga.library.removeChapter')}: ${label}`}
                                            onClick={() => {
                                                void removeChapter(state.id);
                                            }}
                                        >
                                            {t('manga.library.removeChapter')}
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
