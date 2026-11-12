import { useIncrementalList } from '../hooks/useIncrementalList';
import { ListMore } from './ListMore';
import { useEffect, useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { MangaCover } from './MangaCover';
import { ConfirmButton } from './ConfirmButton';
import { LibraryCard } from '../library/LibraryCard';
import { MangaRemove } from './MangaRemove';
import { chapterLabel, groupByDay } from './mangaText';
import type { ReadingEntry } from '@shared/manga';
import { useShownHistory } from '../hooks/useShownManga';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(time: number): number {
    const date = new Date(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// The mangas that were read, the last one first and split by day, each with the chapter and the page it was left on. A manga that is in
// the library opens on its page there (which has the chapters that are downloaded); one that only was read opens on its source.
export function MangaHistory() {
    const t = useTranslator();
    const history = useShownHistory();
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
    // A long list is drawn a part at a time: the days are made of the entries drawn so far.
    const { shown: drawn, hasMore, endRef } = useIncrementalList(history, 'manga-history');
    const days = groupByDay<ReadingEntry>(drawn, (entry) => {
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
                        <ul className="cover-grid">
                            {group.entries.map((entry) => {
                                return (
                                    <LibraryCard
                                        key={entry.id}
                                        testId="manga-history-entry"
                                        cover={<MangaCover url={entry.thumbnailUrl} />}
                                        title={entry.title}
                                        openLabel={`${t('manga.browse.open')}: ${entry.title}`}
                                        onOpen={() => {
                                            void openFromHistory(entry);
                                        }}
                                        meta={
                                            <span className="history__meta">
                                                {t('manga.history.left', { chapter: chapterLabel(entry.chapterName, entry.chapterNumber), page: entry.page + 1, total: entry.pageCount })}
                                            </span>
                                        }
                                        badges={entry.libraryMangaId === null ? undefined : <span className="badge badge--done">{t('manga.history.inLibrary')}</span>}
                                        actions={
                                            <ConfirmButton
                                                className="btn btn--small btn--ghost"
                                                ariaLabel={`${t('manga.history.removeOne')}: ${entry.title}`}
                                                dialog={{ title: t('confirm.historyRemove.title', { name: entry.title }), message: t('confirm.historyRemove.message'), confirmLabel: t('manga.history.remove') }}
                                                onConfirm={() => {
                                                    void removeReading(entry.id);
                                                }}
                                            >
                                                {t('manga.history.remove')}
                                            </ConfirmButton>
                                        }
                                    />
                                );
                            })}
                        </ul>
                    </section>
                );
            })}
            <ListMore hasMore={hasMore} endRef={endRef} />
        </section>
    );
}
