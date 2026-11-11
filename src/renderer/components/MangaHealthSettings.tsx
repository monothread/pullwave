import { useEffect } from 'react';
import type { MessageKey } from '@shared/i18n';
import type { ComponentHealth, HealthState, MangaToolUpdateResult, ToolVersionInfo } from '@shared/manga';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { ConfirmButton } from './ConfirmButton';
import { ErrorNotice } from './ErrorNotice';
import { plainErrorReport } from './errorReport';

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
}

function HealthRow({ name, health, unused, testId, info, result, children }: HealthRowProps) {
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
                {result && (
                    <span className={`history__meta${result.ok ? '' : ' field__warning'}`} role={result.ok ? undefined : 'alert'}>
                        {result.ok ? t(resultKey(result), { version: result.version }) : <ErrorNotice report={plainErrorReport(t(resultKey(result), { version: '' }), result.message ?? '')} />}
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

// Whether the server and the helper for Cloudflare are up, and the button that moves the helper to the latest release of its project (the
// server stays at the version the app ships with). It looks when the settings open (without starting anything that is stopped); CHECK NOW
// starts what is stopped and asks it, and CHECK FOR UPDATES (only when the app runs the helper) looks for the latest one, which is what makes
// its update button appear.
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
    const checkToolUpdates = useMangaStore((state) => {
        return state.checkToolUpdates;
    });
    const updateHelper = useMangaStore((state) => {
        return state.updateHelper;
    });
    const restarting = useMangaStore((state) => {
        return state.programsRestarting;
    });
    const restartPrograms = useMangaStore((state) => {
        return state.restartPrograms;
    });
    const helper = versions?.flaresolverr ?? null;
    // Only the helper the app runs can be updated from here (the server stays at the version of the app, and a FlareSolverr of the user's own
    // is theirs): without one there is nothing to look for.
    const updatable = health !== null && health.helper !== null && !health.helper.external;

    useEffect(() => {
        void checkHealth(false);
    }, [checkHealth]);

    return (
        <fieldset className="panel" aria-label={t('manga.health.title')}>
            <legend>{t('manga.health.title')}</legend>
            <ul className="history__list">
                <HealthRow name="Suwayomi-Server" health={health?.server ?? null} unused={t('manga.health.checking')} testId="manga-health-server" info={null} result={null} />
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
                {updatable && (
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
                )}
                <ConfirmButton
                    className="btn btn--small btn--hot"
                    disabled={restarting || health?.server.state === 'not-installed'}
                    dialog={{ title: t('confirm.programsRestart.title'), message: t('confirm.programsRestart.message'), confirmLabel: t('manga.health.restart'), cancelLabel: t('confirm.back') }}
                    onConfirm={() => {
                        void restartPrograms();
                    }}
                >
                    {restarting ? t('manga.health.restarting') : t('manga.health.restart')}
                </ConfirmButton>
            </div>
            <p className="field__hint">{t('manga.health.hint')}</p>
            {updatable && <p className="field__hint">{t('manga.updates.hint')}</p>}
        </fieldset>
    );
}
