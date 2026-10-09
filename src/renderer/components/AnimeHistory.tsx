import { useAppLanguage, useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { AnimeCover } from './AnimeCover';
import { RowLink } from './RowLink';

// The anime the viewer opened or watched, the most recent first. Opening one goes to its series in the library when it is there, and to its episodes in the search when it is not.
export function AnimeHistory() {
    const t = useTranslator();
    const language = useAppLanguage();
    const history = useAnimeStore((state) => {
        return state.history;
    });
    const openAnime = useAnimeStore((state) => {
        return state.openHistoryEntry;
    });
    const removeEntry = useAnimeStore((state) => {
        return state.removeHistoryEntry;
    });
    const clearHistory = useAnimeStore((state) => {
        return state.clearHistory;
    });

    if (history.length === 0) {
        return <p className="empty">{t('anime.history.empty')}</p>;
    }

    return (
        <section className="history" aria-label={t('anime.history.aria')}>
            <div className="queue__toolbar">
                <span className="section-label">{t('anime.history.label', { count: history.length })}</span>
                <button
                    type="button"
                    className="btn btn--small btn--ghost"
                    onClick={() => {
                        void clearHistory();
                    }}
                >
                    {t('anime.history.clear')}
                </button>
            </div>
            <ul className="cover-grid">
                {history.map((entry) => {
                    return (
                        <li key={entry.id} className="history__item cover-card row--link">
                            <AnimeCover title={entry.title} />
                            <div className="history__main">
                                <span className="history__title">
                                    <RowLink
                                        label={t('anime.history.openLabel', { title: entry.title })}
                                        title={entry.title}
                                        onClick={() => {
                                            void openAnime(entry);
                                        }}
                                    >
                                        {entry.title}
                                    </RowLink>
                                </span>
                                <div className="cover-card__footer">
                                    <span className="history__meta">
                                        {entry.audio.toUpperCase()}
                                        {entry.episode !== null && ` · ${t('anime.history.episode', { episode: entry.episode })}`} · {new Date(entry.openedAt).toLocaleString(language)}
                                    </span>
                                    <div className="anime__actions">
                                        <button
                                            type="button"
                                            className="btn btn--small btn--ghost"
                                            aria-label={t('anime.history.removeLabel', { title: entry.title })}
                                            onClick={() => {
                                                void removeEntry(entry.id);
                                            }}
                                        >
                                            {t('anime.history.remove')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
