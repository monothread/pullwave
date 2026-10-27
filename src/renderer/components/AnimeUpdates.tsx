import { useEffect, useState } from 'react';
import type { AnimeArrivalOrigin, AnimeUpdateEntry } from '@shared/anime';
import type { MessageKey } from '@shared/i18n';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { animeStatusKey, groupByDay, startOfDay } from './animeText';
import { AnimeCover } from './AnimeCover';
import { ConfirmButton } from './ConfirmButton';
import { RowLink } from './RowLink';

const ORIGIN_KEYS: Record<AnimeArrivalOrigin, MessageKey> = {
    auto: 'anime.recent.origin.auto',
    manual: 'anime.recent.origin.manual'
};

const DAY_MS = 24 * 60 * 60 * 1000;

// The episodes that arrived in the library after their anime was in it, newest first and split by day: what the check every hour found,
// and what the buttons that look for new episodes found. A click opens the anime in the library.
export function AnimeUpdates() {
    const t = useTranslator();
    const updates = useAnimeStore((state) => {
        return state.updates;
    });
    const checking = useAnimeStore((state) => {
        return state.checkingNew;
    });
    const loadUpdates = useAnimeStore((state) => {
        return state.loadUpdates;
    });
    const checkNewEpisodes = useAnimeStore((state) => {
        return state.checkNewEpisodes;
    });
    const clearUpdates = useAnimeStore((state) => {
        return state.clearUpdates;
    });
    const openFromUpdate = useAnimeStore((state) => {
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
            return t('anime.recent.today');
        }
        return day === today - DAY_MS ? t('anime.recent.yesterday') : new Date(day).toLocaleDateString();
    };
    const days = groupByDay<AnimeUpdateEntry>(updates, (entry) => {
        return entry.foundAt;
    });

    return (
        <section className="anime__updates" aria-label={t('anime.nav.updates')}>
            <div className="queue__toolbar">
                <button
                    type="button"
                    className="btn btn--small btn--primary"
                    disabled={checking !== null}
                    onClick={() => {
                        void checkNewEpisodes(null);
                    }}
                >
                    {checking === 'all' ? t('anime.recent.checking') : t('anime.recent.check')}
                </button>
                {updates.length > 0 && (
                    <ConfirmButton
                        className="btn btn--small btn--ghost"
                        title={t('anime.recent.clear')}
                        dialog={{ title: t('anime.recent.clear.title'), message: t('anime.recent.clear.message'), confirmLabel: t('anime.recent.clear') }}
                        onConfirm={() => {
                            void clearUpdates();
                        }}
                    >
                        {t('anime.recent.clear')}
                    </ConfirmButton>
                )}
            </div>
            {updates.length === 0 && <p className="empty">{t('anime.recent.empty')}</p>}
            {days.map((group) => {
                return (
                    <section key={group.day} className="anime__updates-day" aria-label={dayName(group.day)} data-testid="anime-update-day">
                        <span className="section-label">{dayName(group.day)}</span>
                        <ul className="history__list">
                            {group.entries.map((entry) => {
                                const label = t('anime.episode', { number: entry.episodeNumber });
                                const time = new Date(entry.foundAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                return (
                                    <li key={entry.id} className="history__item row--link" data-testid="anime-update">
                                        <AnimeCover title={entry.animeTitle} />
                                        <div className="history__main">
                                            <span className="history__title">
                                                <RowLink
                                                    label={`${t('anime.library.show')}: ${entry.animeTitle} ${label}`}
                                                    title={entry.animeTitle}
                                                    onClick={() => {
                                                        openFromUpdate(entry);
                                                    }}
                                                >
                                                    {entry.animeTitle}
                                                </RowLink>
                                            </span>
                                            <span className="history__meta">{`${label} · ${t('anime.recent.found', { time })}`}</span>
                                        </div>
                                        <span className="badge">{t(ORIGIN_KEYS[entry.origin])}</span>
                                        <span className={`badge badge--${entry.status}`}>{t(animeStatusKey(entry.status))}</span>
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
