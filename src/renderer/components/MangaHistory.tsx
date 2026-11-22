import { useIncrementalList } from '../hooks/useIncrementalList';
import { useAppTimeZone } from '../hooks/useAppTimeZone';
import { ListMore } from './ListMore';
import { useEffect, useState } from 'react';
import { useAppLanguage, useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { MangaCover } from './MangaCover';
import { ConfirmButton } from './ConfirmButton';
import { createDayLabeler } from './dateFormat';
import { LibraryCard } from '../library/LibraryCard';
import { MangaRemove } from './MangaRemove';
import { chapterLabel, groupByDay } from './mangaText';
import type { ReadingEntry } from '@shared/manga';
import { useShownHistory } from '../hooks/useShownManga';

export function MangaHistory() {
    const t = useTranslator();
    const language = useAppLanguage();
    const timeZone = useAppTimeZone();
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

    const [openedAt] = useState(() => {
        return Date.now();
    });
    const dayName = createDayLabeler(openedAt, { today: t('manga.recent.today'), yesterday: t('manga.recent.yesterday') }, language, timeZone);
    const { shown: drawn, hasMore, endRef } = useIncrementalList(history, 'manga-history');
    const days = groupByDay<ReadingEntry>(
        drawn,
        (entry) => {
            return entry.readAt;
        },
        timeZone
    );

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
