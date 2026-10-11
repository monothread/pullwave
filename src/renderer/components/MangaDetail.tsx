import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { MangaCover } from './MangaCover';
import { chapterState, chapterStatusKey, isCloudflareError, libraryEntry, mangaErrorKey, mangaStatusKey } from './mangaText';

function chapterLabel(name: string, number: number | null): string {
    if (name.length > 0) {
        return name;
    }
    return number === null ? '' : `#${number}`;
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

    if (selection === null) {
        return null;
    }
    const { manga, details, chapters, selected } = selection;
    const saved = libraryEntry(library, manga.sourceId, manga.remoteId);
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
                    {details?.author && <span className="history__meta">{`${t('manga.detail.author')}: ${details.author}`}</span>}
                    {details?.artist && <span className="history__meta">{`${t('manga.detail.artist')}: ${details.artist}`}</span>}
                    {details && <span className="history__meta">{t(mangaStatusKey(details.status))}</span>}
                    {details && details.genres.length > 0 && <span className="history__meta">{details.genres.join(' · ')}</span>}
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
                    </div>
                    <div className="job__actions">
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
                        <button
                            type="button"
                            className="btn"
                            onClick={() => {
                                void addToLibrary();
                            }}
                        >
                            {t('manga.detail.add')}
                        </button>
                    </div>
                    <ul className="history__list manga__chapters">
                        {chapters.map((chapter) => {
                            const state = chapterState(saved, chapter.remoteId);
                            const label = chapterLabel(chapter.name, chapter.number);
                            return (
                                <li key={chapter.remoteId} className="history__item">
                                    <label className="toggle">
                                        <input
                                            type="checkbox"
                                            aria-label={label}
                                            checked={selected.includes(chapter.remoteId)}
                                            onChange={() => {
                                                toggleChapter(chapter.remoteId);
                                            }}
                                        />
                                        <span>{label}</span>
                                    </label>
                                    <span className="history__meta">{[chapter.scanlator, formatDate(chapter.dateUploaded)].filter(Boolean).join(' · ')}</span>
                                    {state && <span className={`badge badge--${state.status}`}>{t(chapterStatusKey(state.status))}</span>}
                                    {state && state.status !== 'queued' && state.status !== 'downloading' && (
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
                                    <button
                                        type="button"
                                        className="btn btn--small btn--primary"
                                        aria-label={`${t('manga.reader.read')}: ${label}`}
                                        onClick={() => {
                                            void openReader(
                                                shown.title,
                                                readable,
                                                readable.findIndex((item) => {
                                                    return item.remoteId === chapter.remoteId;
                                                })
                                            );
                                        }}
                                    >
                                        {t('manga.reader.read')}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
        </section>
    );
}
