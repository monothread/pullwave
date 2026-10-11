import { useState } from 'react';
import type { LibraryManga } from '@shared/manga';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { MangaCover } from './MangaCover';
import { MangaDetail } from './MangaDetail';
import { RowLink } from './RowLink';
import { downloadedCount } from './mangaText';

interface MangaRowProps {
    manga: LibraryManga;
}

function MangaRow({ manga }: MangaRowProps) {
    const t = useTranslator();
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

// The mangas the user keeps, with how many chapters of each are downloaded.
export function MangaLibrary() {
    const t = useTranslator();
    const library = useMangaStore((state) => {
        return state.library;
    });
    const selection = useMangaStore((state) => {
        return state.selection;
    });
    const selectionFrom = useMangaStore((state) => {
        return state.selectionFrom;
    });
    // A manga opened from the library is shown as it is from the browse: its chapters, to read, download or remove.
    if (selection !== null && selectionFrom === 'library') {
        return <MangaDetail />;
    }
    if (library.length === 0) {
        return <p className="empty">{t('manga.library.empty')}</p>;
    }
    return (
        <section className="manga__library" aria-label={t('manga.nav.library')}>
            <ul className="history__list">
                {library.map((manga) => {
                    return <MangaRow key={manga.id} manga={manga} />;
                })}
            </ul>
        </section>
    );
}
