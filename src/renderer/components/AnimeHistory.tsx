import { useAppTimeZone } from '../hooks/useAppTimeZone';
import { useAppLanguage, useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import { LibraryCard } from '../library/LibraryCard';
import { AnimeCover } from './AnimeCover';
import { ConfirmButton } from './ConfirmButton';
import { formatDateTime } from './dateFormat';

export function AnimeHistory() {
    const t = useTranslator();
    const language = useAppLanguage();
    const timeZone = useAppTimeZone();
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
                <ConfirmButton
                    className="btn btn--small btn--ghost"
                    dialog={{ title: t('confirm.historyClear.title'), message: t('confirm.historyClear.message'), confirmLabel: t('anime.history.clear') }}
                    onConfirm={() => {
                        void clearHistory();
                    }}
                >
                    {t('anime.history.clear')}
                </ConfirmButton>
            </div>
            <ul className="cover-grid">
                {history.map((entry) => {
                    return (
                        <LibraryCard
                            key={entry.id}
                            cover={<AnimeCover title={entry.title} />}
                            title={entry.title}
                            openLabel={t('anime.history.openLabel', { title: entry.title })}
                            onOpen={() => {
                                void openAnime(entry);
                            }}
                            meta={
                                <span className="history__meta">
                                    {entry.episode !== null && `${t('anime.history.episode', { episode: entry.episode })} · `}
                                    {formatDateTime(entry.openedAt, language, timeZone)}
                                </span>
                            }
                            actions={
                                <ConfirmButton
                                    className="btn btn--small btn--ghost"
                                    ariaLabel={t('anime.history.removeLabel', { title: entry.title })}
                                    dialog={{ title: t('confirm.historyRemove.title', { name: entry.title }), message: t('confirm.historyRemove.message'), confirmLabel: t('anime.history.remove') }}
                                    onConfirm={() => {
                                        void removeEntry(entry.id);
                                    }}
                                >
                                    {t('anime.history.remove')}
                                </ConfirmButton>
                            }
                        />
                    );
                })}
            </ul>
        </section>
    );
}
