import { IncrementalItems } from './IncrementalItems';
import { useEffect } from 'react';
import { useMangaLanguage } from '../hooks/useMangaLanguage';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { UPDATE_ALL_KEY, useMangaStore } from '../store/mangaStore';
import { ConfirmButton } from './ConfirmButton';
import { MangaExtensionsAbout } from './MangaExtensionsAbout';
import { TextField, ToggleField } from './fields';
import { extensionLanguages, filterExtensions, isListed } from './mangaText';
import { MangaErrorNotice } from './MangaErrorNotice';

// The stores the extensions come from, and the extensions to install, update or remove.
export function MangaExtensions() {
    const t = useTranslator();
    const extensions = useMangaStore((state) => {
        return state.extensions;
    });
    const loadExtensions = useMangaStore((state) => {
        return state.loadExtensions;
    });
    const updateAllExtensions = useMangaStore((state) => {
        return state.updateAllExtensions;
    });
    const setView = useMangaStore((state) => {
        return state.setView;
    });
    const changeExtension = useMangaStore((state) => {
        return state.changeExtension;
    });
    const setExtensionFilter = useMangaStore((state) => {
        return state.setExtensionFilter;
    });
    const showAdult = useAppStore((state) => {
        return state.settings.mangaShowAdult;
    });
    const { stores, status, error, busy, filter } = extensions;

    useEffect(() => {
        if (status === 'idle') {
            void loadExtensions(false);
        }
    }, [status, loadExtensions]);

    const listedExtensions = extensions.extensions.filter((extension) => {
        return isListed(extension.contentWarning, showAdult);
    });
    // The language is the one of the settings (every language when no extension is in it).
    const lang = useMangaLanguage(extensionLanguages(listedExtensions));
    const shown = filterExtensions(extensions.extensions, { ...filter, lang }, showAdult);
    const updatable = listedExtensions.filter((extension) => {
        return extension.isInstalled && extension.hasUpdate;
    }).length;

    // Nothing is installed yet, so the switch is what hides the extensions that are there to be installed.
    const onlyInstalledHidesAll =
        filter.onlyInstalled &&
        filter.query.trim().length === 0 &&
        listedExtensions.length > 0 &&
        filterExtensions(listedExtensions, { ...filter, lang, onlyInstalled: false }, showAdult).length > 0;

    return (
        <section className="manga__extensions" aria-label={t('manga.nav.extensions')}>
            <MangaExtensionsAbout />
            {stores.length === 0 && status !== 'loading' && (
                <div className="panel">
                    <p className="empty">{t('manga.ext.noStores')}</p>
                    <div className="job__actions">
                        <button
                            type="button"
                            className="btn btn--small btn--primary"
                            onClick={() => {
                                setView('settings');
                            }}
                        >
                            {t('manga.ext.openSettings')}
                        </button>
                    </div>
                </div>
            )}
            {error && (
                <MangaErrorNotice error={error} />
            )}
            {status === 'loading' && <p className="empty">{t('manga.ext.loading')}</p>}
            {stores.length > 0 && (
                <>
                    <div className="field-row">
                        <TextField
                            search
                            label={t('manga.ext.filter')}
                            value={filter.query}
                            onChange={(query) => {
                                setExtensionFilter({ query });
                            }}
                        />
                        <ToggleField
                            label={t('manga.ext.onlyInstalled')}
                            checked={filter.onlyInstalled}
                            onChange={(onlyInstalled) => {
                                setExtensionFilter({ onlyInstalled });
                            }}
                        />
                        <button
                            type="button"
                            className="btn btn--small"
                            disabled={status === 'loading'}
                            onClick={() => {
                                void loadExtensions(true);
                            }}
                        >
                            {t('manga.ext.refresh')}
                        </button>
                        {updatable > 0 && (
                            <button
                                type="button"
                                className="btn btn--small btn--primary"
                                disabled={busy.includes(UPDATE_ALL_KEY)}
                                onClick={() => {
                                    void updateAllExtensions();
                                }}
                            >
                                {busy.includes(UPDATE_ALL_KEY) ? t('manga.ext.updatingAll') : t('manga.ext.updateAll', { count: updatable })}
                            </button>
                        )}
                    </div>
                    {status === 'ready' && shown.length === 0 && <p className="empty">{t(onlyInstalledHidesAll ? 'manga.ext.noneInstalled' : 'manga.ext.none')}</p>}
                    <ul className="history__list">
                        <IncrementalItems items={shown} listKey="manga-extensions" end="li" renderItem={(extension) => {
                            const working = busy.includes(extension.pkgName);
                            return (
                                <li key={extension.pkgName} className="history__item" data-testid="manga-extension">
                                    <div className="history__main">
                                        <span className="history__title">{extension.name}</span>
                                        <span className="history__meta">{`${extension.lang} · ${extension.versionName}`}</span>
                                    </div>
                                    {extension.contentWarning === 'NSFW' && <span className="badge badge--error">{t('manga.ext.nsfw')}</span>}
                                    {!extension.isCompatible && (
                                        <span className="badge badge--error" title={t('manga.ext.incompatibleHint', { lib: extension.extensionLib ?? '?' })}>
                                            {t('manga.ext.incompatible')}
                                        </span>
                                    )}
                                    {extension.isObsolete && <span className="badge badge--cancelled">{t('manga.ext.obsolete')}</span>}
                                    {extension.isInstalled && <span className="badge badge--done">{t('manga.ext.installed')}</span>}
                                    <span className="anime__actions">
                                        {!extension.isInstalled && extension.isCompatible && (
                                            <button
                                                type="button"
                                                className="btn btn--small btn--primary"
                                                disabled={working}
                                                aria-label={`${t('manga.ext.install')}: ${extension.name}`}
                                                onClick={() => {
                                                    void changeExtension(extension.pkgName, 'install');
                                                }}
                                            >
                                                {working ? t('manga.ext.working') : t('manga.ext.install')}
                                            </button>
                                        )}
                                        {extension.isInstalled && extension.hasUpdate && (
                                            <button
                                                type="button"
                                                className="btn btn--small btn--primary"
                                                disabled={working}
                                                aria-label={`${t('manga.ext.update')}: ${extension.name}`}
                                                onClick={() => {
                                                    void changeExtension(extension.pkgName, 'update');
                                                }}
                                            >
                                                {working ? t('manga.ext.working') : t('manga.ext.update')}
                                            </button>
                                        )}
                                        {extension.isInstalled && (
                                            <ConfirmButton
                                                className="btn btn--small btn--hot"
                                                disabled={working}
                                                ariaLabel={`${t('manga.ext.uninstall')}: ${extension.name}`}
                                                dialog={{ title: t('confirm.uninstallExtension.title', { name: extension.name }), message: t('confirm.uninstallExtension.message'), confirmLabel: t('manga.ext.uninstall') }}
                                                onConfirm={() => {
                                                    void changeExtension(extension.pkgName, 'uninstall');
                                                }}
                                            >
                                                {t('manga.ext.uninstall')}
                                            </ConfirmButton>
                                        )}
                                    </span>
                                </li>
                            );
                        }} />
                    </ul>
                </>
            )}
        </section>
    );
}
