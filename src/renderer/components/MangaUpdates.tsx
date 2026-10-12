import { useEffect, useState } from 'react';
import type { ArrivalOrigin, MangaUpdateEntry } from '@shared/manga';
import type { MessageKey } from '@shared/i18n';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { MangaCover } from './MangaCover';
import { MangaRemove } from './MangaRemove';
import { RowLink } from './RowLink';
import { chapterLabel, chapterStatusKey, groupByDay } from './mangaText';

const ORIGIN_KEYS: Record<ArrivalOrigin, MessageKey> = {
    auto: 'manga.recent.origin.auto',
    manual: 'manga.recent.origin.manual',
    move: 'manga.recent.origin.move'
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(time: number): number {
    const date = new Date(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// The chapters that arrived in the library after their manga was in it, newest first and split by day: what the check every hour found,
// and what the buttons that look for new chapters found. A click opens the manga in the library.
export function MangaUpdates() {
    const t = useTranslator();
    const updates = useMangaStore((state) => {
        return state.updates;
    });
    const checking = useMangaStore((state) => {
        return state.checkingNew;
    });
    const loadUpdates = useMangaStore((state) => {
        return state.loadUpdates;
    });
    const checkNewChapters = useMangaStore((state) => {
        return state.checkNewChapters;
    });
    const clearUpdates = useMangaStore((state) => {
        return state.clearUpdates;
    });
    const openFromUpdate = useMangaStore((state) => {
        return state.openFromUpdate;
    });

    useEffect(() => {
        void loadUpdates();
    }, [loadUpdates]);

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
    const days = groupByDay<MangaUpdateEntry>(updates, (entry) => {
        return entry.foundAt;
    });

    return (
        <section className="manga__updates" aria-label={t('manga.nav.updates')}>
            <div className="queue__toolbar">
                <button
                    type="button"
                    className="btn btn--small btn--primary"
                    disabled={checking !== null}
                    onClick={() => {
                        void checkNewChapters(null);
                    }}
                >
                    {checking === 'all' ? t('manga.recent.checking') : t('manga.recent.check')}
                </button>
                {updates.length > 0 && (
                    <MangaRemove
                        label={t('manga.recent.clear')}
                        ariaLabel={t('manga.recent.clear')}
                        title={t('manga.recent.clear.title')}
                        message={t('manga.recent.clear.message')}
                        quiet
                        onRemove={() => {
                            void clearUpdates();
                        }}
                    />
                )}
            </div>
            {updates.length === 0 && <p className="empty">{t('manga.recent.empty')}</p>}
            {days.map((group) => {
                return (
                    <section key={group.day} className="manga__updates-day" aria-label={dayName(group.day)} data-testid="manga-update-day">
                        <span className="section-label">{dayName(group.day)}</span>
                        <ul className="history__list">
                            {group.entries.map((entry) => {
                                const label = chapterLabel(entry.chapterName, entry.chapterNumber);
                                return (
                                    <li key={entry.id} className="history__item row--link" data-testid="manga-update">
                                        <MangaCover url={entry.thumbnailUrl} />
                                        <div className="history__main">
                                            <span className="history__title">
                                                <RowLink
                                                    label={`${t('manga.browse.open')}: ${entry.mangaTitle} ${label}`}
                                                    title={entry.mangaTitle}
                                                    onClick={() => {
                                                        void openFromUpdate(entry);
                                                    }}
                                                >
                                                    {entry.mangaTitle}
                                                </RowLink>
                                            </span>
                                            <span className="history__meta">{`${label} · ${t('manga.recent.found', { time: new Date(entry.foundAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}`}</span>
                                        </div>
                                        <span className="badge">{t(ORIGIN_KEYS[entry.origin])}</span>
                                        <span className={`badge badge--${entry.status}`}>{t(chapterStatusKey(entry.status))}</span>
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
