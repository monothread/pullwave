import { useEffect } from 'react';
import type { ComponentHealth, HealthState } from '@shared/manga';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';

const BADGES: Record<HealthState, string> = {
    healthy: 'badge--done',
    starting: 'badge--waiting',
    stopped: 'badge--cancelled',
    unhealthy: 'badge--error',
    'not-installed': 'badge--cancelled'
};

interface HealthRowProps {
    name: string;
    health: ComponentHealth | null;
    // What is said when there is nothing to look at.
    unused: string;
    testId: string;
}

function HealthRow({ name, health, unused, testId }: HealthRowProps) {
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
            </div>
            {health !== null && <span className={`badge ${BADGES[health.state]}`}>{t(`manga.health.${health.state}`)}</span>}
        </li>
    );
}

// Whether the server and the helper for Cloudflare are up. It looks when the settings open (without starting anything that is stopped),
// and CHECK NOW starts what is stopped and asks it.
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

    useEffect(() => {
        void checkHealth(false);
    }, [checkHealth]);

    return (
        <fieldset className="panel" aria-label={t('manga.health.title')}>
            <legend>{t('manga.health.title')}</legend>
            <ul className="history__list">
                <HealthRow name="Suwayomi-Server" health={health?.server ?? null} unused={t('manga.health.checking')} testId="manga-health-server" />
                <HealthRow name="FlareSolverr" health={health?.helper ?? null} unused={health === null ? t('manga.health.checking') : t('manga.health.unused')} testId="manga-health-helper" />
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
            </div>
            <p className="field__hint">{t('manga.health.hint')}</p>
        </fieldset>
    );
}
