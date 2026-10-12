import type { LibraryManga, MangaSummary } from '@shared/manga';
import { useTranslator } from '../i18n/useTranslator';
import { MangaCover } from './MangaCover';
import { libraryEntriesByTitle, libraryEntry } from './mangaText';
import { RowLink } from './RowLink';

interface MangaResultCardProps {
    item: MangaSummary;
    library: readonly LibraryManga[];
    onOpen: (item: MangaSummary) => void;
}

// A manga found in a source: its cover and title (a click opens it), and a mark when it is in the library, or when the same title is there
// from another source.
export function MangaResultCard({ item, library, onOpen }: MangaResultCardProps) {
    const t = useTranslator();
    const saved = libraryEntry(library, item.sourceId, item.remoteId);
    const inOtherSource = saved === null && libraryEntriesByTitle(library, item.title, item.sourceId).length > 0;
    return (
        <li className="history__item cover-card row--link">
            <MangaCover url={item.thumbnailUrl} />
            <div className="history__main">
                <span className="history__title">
                    <RowLink
                        label={`${t('manga.browse.open')}: ${item.title}`}
                        title={item.title}
                        onClick={() => {
                            onOpen(item);
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
                {inOtherSource && (
                    <div className="cover-card__footer">
                        <span className="badge badge--done">{t('manga.browse.inLibraryOther')}</span>
                    </div>
                )}
            </div>
        </li>
    );
}
