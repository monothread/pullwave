import { useEffect, useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { MangaCover } from './MangaCover';
import { MangaRemove } from './MangaRemove';
import { RowLink } from './RowLink';
import { chapterLabel, groupByDay } from './mangaText';
import type { ReadingEntry } from '@shared/manga';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(time: number): number {
    const date = new Date(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// The mangas that were read, the last one first and split by day, each with the chapter and the page it was left on. A manga that is in
// the library opens on its page there (which has the chapters that are downloaded); one that only was read opens on its source.
export function MangaHistory() {
    const t = useTranslator();
    const history = useMangaStore((state) => {
        return state.history;
    });
    const loadHistory = useMangaStore((state) => {
        return state.loadHistory;
    });
    const removeReading = useMangaStore((state) => {
        return state.removeReading;
    });
    const clearReading = useMangaStore((state) => {
        return state.clearReading;
    });
    const openFromHistory = useMangaStore((state) => {
        return state.openFromHistory;
    });

    useEffect(() => {
        void loadHistory();
    }, [loadHistory]);

    // The day that is today when the screen opens (what is listed is told by day names from it).
    const [today] = useState(() => {
        return startOfDay(Date.now());
    });
    const dayName = (day: number): string => {
        if (day === today) {
            return t('manga.recent.today');
        }
        return day === today - DAY_MS ? t('manga.recent.yesterday') : new Date(day).toLocaleDateString();
    };
    const days = groupByDay<ReadingEntry>(history, (entry) => {
        return entry.readAt;
    });

    return (
        <section className="manga__history" aria-label={t('manga.nav.history')}>
            {history.length > 0 && (
                <div className="queue__toolbar">
                    <MangaRemove
                        label={t('manga.history.clear')}
                        ariaLabel={t('manga.history.clear')}
                        title={t('manga.history.clear.title')}
                        message={t('manga.history.clear.message')}
                        quiet
                        onRemove={() => {
                            void clearReading();
                        }}
                    />
                </div>
            )}
            {history.length === 0 && <p className="empty">{t('manga.history.empty')}</p>}
            {days.map((group) => {
                return (
                    <section key={group.day} className="manga__history-day" aria-label={dayName(group.day)} data-testid="manga-history-day">
                        <span className="section-label">{dayName(group.day)}</span>
                        <ul className="history__list">
                            {group.entries.map((entry) => {
                                return (
                                    <li key={entry.id} className="history__item row--link" data-testid="manga-history-entry">
                                        <MangaCover url={entry.thumbnailUrl} />
                                        <div className="history__main">
                                            <span className="history__title">
                                                <RowLink
                                                    label={`${t('manga.browse.open')}: ${entry.title}`}
                                                    title={entry.title}
                                                    onClick={() => {
                                                        void openFromHistory(entry);
                                                    }}
                                                >
                                                    {entry.title}
                                                </RowLink>
                                            </span>
                                            <span className="history__meta">
                                                {t('manga.history.left', { chapter: chapterLabel(entry.chapterName, entry.chapterNumber), page: entry.page + 1, total: entry.pageCount })}
                                            </span>
                                        </div>
                                        {entry.libraryMangaId !== null && <span className="badge badge--done">{t('manga.history.inLibrary')}</span>}
                                        <button
                                            type="button"
                                            className="btn btn--small btn--ghost"
                                            aria-label={`${t('manga.history.removeOne')}: ${entry.title}`}
                                            onClick={() => {
                                                void removeReading(entry.id);
                                            }}
                                        >
                                            {t('manga.history.remove')}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                );
            })}
        </section>
    );
}
