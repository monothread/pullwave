import { useEffect } from 'react';
import type { MessageKey } from '@shared/i18n';
import type { ComponentHealth, HealthState, MangaToolUpdateResult, ToolVersionInfo } from '@shared/manga';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';

const BADGES: Record<HealthState, string> = {
    healthy: 'badge--done',
    starting: 'badge--waiting',
    stopped: 'badge--cancelled',
    unhealthy: 'badge--error',
    'not-installed': 'badge--cancelled'
};

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

interface HealthRowProps {
    name: string;
    health: ComponentHealth | null;
    // What is said when there is nothing to look at.
    unused: string;
    testId: string;
    // The latest version found for it, once the user looked for updates; the buttons that move it to that version go in the children.
    info: ToolVersionInfo | null;
    result: MangaToolUpdateResult | null;
    children?: React.ReactNode;
    extra?: React.ReactNode;
}

function HealthRow({ name, health, unused, testId, info, result, children, extra }: HealthRowProps) {
    const t = useTranslator();
    return (
        <li className="history__item" data-testid={testId}>
            <div className="history__main">
                <span className="history__title">{name}</span>
                {health === null ? (
                    <span className="history__meta">{unused}</span>
                ) : (
                    <>
                        <span className="history__meta">{[health.version, health.external ? t('manga.health.external') : null].filter(Boolean).join(' · ')}</span>
                        {health.message && (
                            <span className="history__meta" role="alert">
                                {health.message}
                            </span>
                        )}
                    </>
                )}
                {info?.latest && <span className="history__meta">{t('manga.updates.latest', { version: info.latest })}</span>}
                {info?.error && (
                    <span className="history__meta" role="alert">
                        {t('manga.updates.lookupFailed', { message: info.error })}
                    </span>
                )}
                {extra}
                {result && (
                    <span className={`history__meta${result.ok ? '' : ' field__warning'}`} role={result.ok ? undefined : 'alert'} title={result.ok ? undefined : (result.message ?? undefined)}>
                        {t(resultKey(result), { version: result.ok ? result.version : '' })}
                    </span>
                )}
            </div>
            <span className="anime__actions">
                {children}
                {health !== null && <span className={`badge ${BADGES[health.state]}`}>{t(`manga.health.${health.state}`)}</span>}
            </span>
        </li>
    );
}

// Whether the server and the helper for Cloudflare are up, and the buttons that move them to the latest release of their projects. It looks
// when the settings open (without starting anything that is stopped); CHECK NOW starts what is stopped and asks it, and CHECK FOR UPDATES
// looks for the latest versions, which is what makes the update buttons appear.
export function MangaHealthSettings() {
    const t = useTranslator();
    const health = useMangaStore((state) => {
        return state.health;
    });
    const checking = useMangaStore((state) => {
        return state.healthChecking;
    });
    const checkHealth = useMangaStore((state) => {
        return state.checkHealth;
    });
    const versions = useMangaStore((state) => {
        return state.toolVersions;
    });
    const toolsChecking = useMangaStore((state) => {
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

    useEffect(() => {
        void checkHealth(false);
    }, [checkHealth]);

    return (
        <fieldset className="panel" aria-label={t('manga.health.title')}>
            <legend>{t('manga.health.title')}</legend>
            <ul className="history__list">
                <HealthRow
                    name="Suwayomi-Server"
                    health={health?.server ?? null}
                    unused={t('manga.health.checking')}
                    testId="manga-health-server"
                    info={server}
                    result={results.server}
                    extra={
                        <>
                            {server?.restartNeeded && <span className="field__warning">{t('manga.updates.restartNeeded')}</span>}
                            {downloading && (
                                <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(download.percent)} aria-label={t('manga.updates.downloading')}>
                                    <div className="progress__bar" style={{ width: `${String(download.percent)}%` }} />
                                </div>
                            )}
                        </>
                    }
                >
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
                </HealthRow>
                <HealthRow
                    name="FlareSolverr"
                    health={health?.helper ?? null}
                    unused={health === null ? t('manga.health.checking') : t('manga.health.unused')}
                    testId="manga-health-helper"
                    info={helper}
                    result={results.helper}
                >
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
                </HealthRow>
            </ul>
            <div className="job__actions">
                <button
                    type="button"
                    className="btn btn--small btn--primary"
                    disabled={checking}
                    onClick={() => {
                        void checkHealth(true);
                    }}
                >
                    {checking ? t('manga.health.working') : t('manga.health.check')}
                </button>
                <button
                    type="button"
                    className="btn btn--small"
                    disabled={toolsChecking}
                    onClick={() => {
                        void checkToolUpdates();
                    }}
                >
                    {toolsChecking ? t('manga.updates.checking') : t('manga.updates.check')}
                </button>
            </div>
            <p className="field__hint">{t('manga.health.hint')}</p>
            <p className="field__hint">{t('manga.updates.hint')}</p>
        </fieldset>
    );
}
