import { useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { ConfirmButton } from './ConfirmButton';
import { toolErrorKey } from './mangaText';

interface MangaHelperSettingsProps {
    // Whether the user installed the helper, and whether they gave the address of a FlareSolverr of their own (the helper is not needed then).
    enabled: boolean;
    external: boolean;
    onEnabledChange: (enabled: boolean) => void;
}

// FlareSolverr, the helper for the sites protected by Cloudflare, is installed here and not by itself: it needs Docker.
export function MangaHelperSettings({ enabled, external, onEnabledChange }: MangaHelperSettingsProps) {
    const t = useTranslator();
    const helper = useMangaStore((state) => {
        return state.status.helper;
    });
    const installHelper = useMangaStore((state) => {
        return state.installHelper;
    });
    const removeHelper = useMangaStore((state) => {
        return state.removeHelper;
    });
    const [working, setWorking] = useState(false);
    const installing = helper !== null && (helper.status === 'downloading' || helper.status === 'verifying' || helper.status === 'extracting');
    const ready = enabled && helper?.status === 'ready';

    async function handleInstall(): Promise<void> {
        setWorking(true);
        onEnabledChange(true);
        await installHelper();
        setWorking(false);
    }

    async function handleRemove(): Promise<void> {
        setWorking(true);
        onEnabledChange(false);
        await removeHelper();
        setWorking(false);
    }

    return (
        <fieldset className="panel" aria-label={t('settings.mangaHelper')}>
            <legend>{t('settings.mangaHelper')}</legend>
            <p className="field__warning" data-testid="manga-helper-docker">
                {t('settings.mangaHelper.docker')}
            </p>
            {external ? (
                <p className="field__hint">{t('settings.mangaHelper.external')}</p>
            ) : (
                <>
                    <p className="field__hint">{t(ready ? 'settings.mangaHelper.installed' : 'settings.mangaHelper.notInstalled')}</p>
                    {enabled && helper?.status === 'error' && helper.error && (
                        <p className="field__warning" role="alert" title={helper.error.message}>
                            {t(toolErrorKey(helper.error.code))}
                        </p>
                    )}
                    {installing && (
                        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(helper.percent)} aria-label={t('settings.mangaHelper')}>
                            <div className="progress__bar" style={{ width: `${helper.percent}%` }} />
                        </div>
                    )}
                    <div className="job__actions">
                        {!enabled || helper?.status === 'error' ? (
                            <button
                                type="button"
                                className="btn btn--small btn--primary"
                                disabled={working || installing}
                                onClick={() => {
                                    void handleInstall();
                                }}
                            >
                                {working || installing ? t('settings.mangaHelper.working') : t('settings.mangaHelper.install')}
                            </button>
                        ) : null}
                        {enabled && (
                            <ConfirmButton
                                className="btn btn--small btn--hot"
                                disabled={working || installing}
                                dialog={{ title: t('confirm.helperRemove.title'), message: t('confirm.helperRemove.message'), confirmLabel: t('settings.mangaHelper.remove') }}
                                onConfirm={() => {
                                    void handleRemove();
                                }}
                            >
                                {t('settings.mangaHelper.remove')}
                            </ConfirmButton>
                        )}
                    </div>
                </>
            )}
        </fieldset>
    );
}
