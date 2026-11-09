import { useEffect, useState } from 'react';
import type { ArrivalOrigin, MangaCheckState, MangaUpdateEntry } from '@shared/manga';
import type { MessageKey, Translator } from '@shared/i18n';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { MangaCover } from './MangaCover';
import { LibraryCard } from '../library/LibraryCard';
import { MangaRemove } from './MangaRemove';
import { chapterLabel, chapterStatusKey, groupByDay } from './mangaText';
import { useShownUpdates } from '../hooks/useShownManga';

const ORIGIN_KEYS: Record<ArrivalOrigin, MessageKey> = {
    auto: 'manga.recent.origin.auto',
    manual: 'manga.recent.origin.manual',
    move: 'manga.recent.origin.move'
};

const DAY_MS = 24 * 60 * 60 * 1000;

// What the button says: what it does, or how far the check that is going on is (and that it is the hourly one, when it is).
function checkButtonLabel(asked: boolean, state: MangaCheckState, t: Translator): string {
    if (state.running && state.total > 0) {
        return t(state.origin === 'auto' ? 'manga.recent.checking.auto' : 'manga.recent.checking.progress', { done: state.done, total: state.total });
    }
    return asked || state.running ? t('manga.recent.checking') : t('manga.recent.check');
}

function startOfDay(time: number): number {
    const date = new Date(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// The chapters that arrived in the library after their manga was in it, newest first and split by day: what the check every hour found,
// and what the buttons that look for new chapters found. A click opens the manga in the library.
export function MangaUpdates() {
    const t = useTranslator();
    const updates = useShownUpdates();
    const checking = useMangaStore((state) => {
        return state.checkingNew;
    });
    const checkState = useMangaStore((state) => {
        return state.checkState;
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
                    disabled={checking !== null || checkState.running}
                    title={checkState.running && checkState.origin === 'auto' ? t('manga.recent.checking.autoHint') : undefined}
                    onClick={() => {
                        void checkNewChapters(null);
                    }}
                >
                    {checkButtonLabel(checking === 'all', checkState, t)}
                </button>
                {checkState.running && checkState.current !== null && (
                    <span className="check-current" role="status" title={checkState.current} data-testid="manga-check-current">
                        {t('manga.recent.current', { title: checkState.current })}
                    </span>
                )}
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
                        <ul className="cover-grid">
                            {group.entries.map((entry) => {
                                const label = chapterLabel(entry.chapterName, entry.chapterNumber);
                                return (
                                    <LibraryCard
                                        key={entry.id}
                                        testId="manga-update"
                                        cover={<MangaCover url={entry.thumbnailUrl} />}
                                        title={entry.mangaTitle}
                                        openLabel={`${t('manga.browse.open')}: ${entry.mangaTitle} ${label}`}
                                        onOpen={() => {
                                            void openFromUpdate(entry);
                                        }}
                                        meta={<span className="history__meta">{`${label} · ${t('manga.recent.found', { time: new Date(entry.foundAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}`}</span>}
                                        badges={
                                            <>
                                                <span className="badge">{t(ORIGIN_KEYS[entry.origin])}</span>
                                                <span className={`badge badge--${entry.status}`}>{t(chapterStatusKey(entry.status))}</span>
                                            </>
                                        }
                                    />
                                );
                            })}
                        </ul>
                    </section>
                );
            })}
        </section>
    );
}
