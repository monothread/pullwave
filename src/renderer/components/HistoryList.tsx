import { useAppLanguage, useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { ConfirmButton } from './ConfirmButton';

export function HistoryList() {
    const t = useTranslator();
    const language = useAppLanguage();
    const history = useAppStore((state) => {
        return state.history;
    });
    const clearHistory = useAppStore((state) => {
        return state.clearHistory;
    });

    if (history.length === 0) {
        return <p className="empty">{t('history.empty')}</p>;
    }

    return (
        <section className="history" aria-label={t('history.aria')}>
            <div className="queue__toolbar">
                <span className="section-label">{t('history.label', { count: history.length })}</span>
                <ConfirmButton
                    className="btn btn--small btn--ghost"
                    dialog={{ title: t('confirm.historyClear.title'), message: t('confirm.historyClear.message'), confirmLabel: t('history.clear') }}
                    onConfirm={() => {
                        void clearHistory();
                    }}
                >
                    {t('history.clear')}
                </ConfirmButton>
            </div>
            <ul className="history__list">
                {history.map((entry) => {
                    return (
                        <li key={entry.id} className={`history__item history__item--${entry.status}`}>
                            <div className="history__main">
                                <span className="history__title" title={entry.url}>
                                    {entry.title}
                                </span>
                                <span className="history__meta">
                                    {entry.status === 'done' ? t('history.complete') : t('history.failed', { title: entry.errorTitle ?? t('history.unknownError') })} ·{' '}
                                    {new Date(entry.finishedAt).toLocaleString(language)}
                                </span>
                            </div>
                            {entry.filePath && (
                                <button
                                    type="button"
                                    className="btn btn--small"
                                    onClick={() => {
                                        void window.api.showItemInFolder(entry.filePath ?? '');
                                    }}
                                >
                                    {t('history.showFile')}
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
