import type { MangaToolUpdateResult } from '@shared/manga';
import type { MessageKey } from '@shared/i18n';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';

function resultKey(result: MangaToolUpdateResult): MessageKey {
    if (result.ok) {
        return 'manga.updates.done';
    }
    switch (result.reason) {
        case 'current':
            return 'manga.updates.current';
        case 'busy':
            return 'manga.updates.busy';
        case 'not-installed':
            return 'manga.updates.helperMissing';
        case 'unsupported':
            return 'manga.updates.unsupported';
        default:
            return 'manga.updates.failed';
    }
}

// The versions of the server and of the helper, and the buttons that move them to the latest release of their projects.
export function MangaToolsSettings() {
    const t = useTranslator();
    const versions = useMangaStore((state) => {
        return state.toolVersions;
    });
    const checking = useMangaStore((state) => {
        return state.toolsChecking;
    });
    const results = useMangaStore((state) => {
        return state.updateResults;
    });
    const updating = useMangaStore((state) => {
        return state.updating;
    });
    const download = useMangaStore((state) => {
        return state.serverUpdate;
    });
    const checkToolUpdates = useMangaStore((state) => {
        return state.checkToolUpdates;
    });
    const updateServer = useMangaStore((state) => {
        return state.updateServer;
    });
    const resetServerVersion = useMangaStore((state) => {
        return state.resetServerVersion;
    });
    const updateHelper = useMangaStore((state) => {
        return state.updateHelper;
    });
    const restartApp = useMangaStore((state) => {
        return state.restartApp;
    });
    const server = versions?.suwayomi ?? null;
    const helper = versions?.flaresolverr ?? null;
    const downloading = updating.server && download !== null && download.status !== 'ready' && download.status !== 'error';

    return (
        <fieldset className="panel" aria-label={t('manga.updates.title')}>
            <legend>{t('manga.updates.title')}</legend>
            <p className="field__hint">{t('manga.updates.hint')}</p>
            <ul className="history__list">
                <li className="history__item" data-testid="manga-update-server">
                    <div className="history__main">
                        <span className="history__title">Suwayomi-Server</span>
                        <span className="history__meta">
                            {server === null ? t('manga.updates.unknown') : t('manga.updates.inUse', { version: server.current || '—', origin: server.chosen ? t('manga.updates.updated') : t('manga.updates.shipped') })}
                        </span>
                        {server?.latest && <span className="history__meta">{t('manga.updates.latest', { version: server.latest })}</span>}
                        {server?.error && (
                            <span className="history__meta" role="alert">
                                {t('manga.updates.lookupFailed', { message: server.error })}
                            </span>
                        )}
                        {server?.restartNeeded && <span className="field__warning">{t('manga.updates.restartNeeded')}</span>}
                        {results.server && (
                            <span className={`history__meta${results.server.ok ? '' : ' field__warning'}`} role={results.server.ok ? undefined : 'alert'} title={results.server.ok ? undefined : (results.server.message ?? undefined)}>
                                {t(resultKey(results.server), { version: results.server.ok ? results.server.version : '' })}
                            </span>
                        )}
                        {downloading && (
                            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(download.percent)} aria-label={t('manga.updates.downloading')}>
                                <div className="progress__bar" style={{ width: `${String(download.percent)}%` }} />
                            </div>
                        )}
                    </div>
                    <span className="anime__actions">
                        {server?.updatable && (
                            <button
                                type="button"
                                className="btn btn--small btn--primary"
                                disabled={updating.server}
                                onClick={() => {
                                    void updateServer();
                                }}
                            >
                                {updating.server ? t('manga.updates.working') : t('manga.updates.update', { version: server.latest ?? '' })}
                            </button>
                        )}
                        {server?.restartNeeded && (
                            <button
                                type="button"
                                className="btn btn--small btn--hot"
                                onClick={() => {
                                    void restartApp();
                                }}
                            >
                                {t('manga.updates.restart')}
                            </button>
                        )}
                        {server?.chosen && (
                            <button
                                type="button"
                                className="btn btn--small"
                                title={t('manga.updates.resetHint', { version: server.bundled })}
                                onClick={() => {
                                    void resetServerVersion();
                                }}
                            >
                                {t('manga.updates.reset')}
                            </button>
                        )}
                    </span>
                </li>
                <li className="history__item" data-testid="manga-update-helper">
                    <div className="history__main">
                        <span className="history__title">FlareSolverr</span>
                        <span className="history__meta">
                            {versions === null ? t('manga.updates.unknown') : helper === null ? t('manga.updates.helperUnused') : t('manga.updates.helperInUse', { version: helper.current })}
                        </span>
                        {helper?.latest && <span className="history__meta">{t('manga.updates.latest', { version: helper.latest })}</span>}
                        {helper?.error && (
                            <span className="history__meta" role="alert">
                                {t('manga.updates.lookupFailed', { message: helper.error })}
                            </span>
                        )}
                        {results.helper && (
                            <span className={`history__meta${results.helper.ok ? '' : ' field__warning'}`} role={results.helper.ok ? undefined : 'alert'} title={results.helper.ok ? undefined : (results.helper.message ?? undefined)}>
                                {t(resultKey(results.helper), { version: results.helper.ok ? results.helper.version : '' })}
                            </span>
                        )}
                    </div>
                    <span className="anime__actions">
                        {helper?.updatable && (
                            <button
                                type="button"
                                className="btn btn--small btn--primary"
                                disabled={updating.helper}
                                onClick={() => {
                                    void updateHelper();
                                }}
                            >
                                {updating.helper ? t('manga.updates.working') : t('manga.updates.update', { version: helper.latest ?? '' })}
                            </button>
                        )}
                    </span>
                </li>
            </ul>
            <div className="job__actions">
                <button
                    type="button"
                    className="btn btn--small btn--primary"
                    disabled={checking}
                    onClick={() => {
                        void checkToolUpdates();
                    }}
                >
                    {checking ? t('manga.updates.checking') : t('manga.updates.check')}
                </button>
            </div>
        </fieldset>
    );
}
