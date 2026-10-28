import { useEffect, useState } from 'react';
import type { AnimeArrivalOrigin, AnimeCheckState, AnimeUpdateEntry } from '@shared/anime';
import type { MessageKey, Translator } from '@shared/i18n';
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

// What the button says: what it does, or how far the check that is going on is (and that it is the hourly one, when it is).
function checkButtonLabel(asked: boolean, state: AnimeCheckState, progress: { done: number; total: number }, t: Translator): string {
    if (state.running && state.total > 0) {
        return t(state.origin === 'auto' ? 'anime.recent.checking.auto' : 'anime.recent.checking.progress', progress);
    }
    return asked || state.running ? t('anime.recent.checking') : t('anime.recent.check');
}

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
    const checkState = useAnimeStore((state) => {
        return state.checkState;
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
    // One check at a time: the button is off while one is going on, whether the button started it or the hourly look did.
    const busy = checking !== null || checkState.running;
    const progress = { done: checkState.done, total: checkState.total };

    return (
        <section className="anime__updates" aria-label={t('anime.nav.updates')}>
            <div className="queue__toolbar">
                <button
                    type="button"
                    className="btn btn--small btn--primary"
                    disabled={busy}
                    title={checkState.running && checkState.origin === 'auto' ? t('anime.recent.checking.autoHint') : undefined}
                    onClick={() => {
                        void checkNewEpisodes(null);
                    }}
                >
                    {checkButtonLabel(checking === 'all', checkState, progress, t)}
                </button>
                {checkState.running && checkState.current !== null && (
                    <span className="check-current" role="status" title={checkState.current} data-testid="anime-check-current">
                        {t('anime.recent.current', { title: checkState.current })}
                    </span>
                )}
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
