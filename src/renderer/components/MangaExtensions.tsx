import { useEffect, useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { SelectField, TextField, ToggleField } from './fields';
import { ALL_LANGUAGES, extensionLanguages, filterExtensions, mangaErrorKey, STORE_PLACEHOLDER } from './mangaText';

// The stores the extensions come from, and the extensions to install, update or remove.
export function MangaExtensions() {
    const t = useTranslator();
    const extensions = useMangaStore((state) => {
        return state.extensions;
    });
    const loadExtensions = useMangaStore((state) => {
        return state.loadExtensions;
    });
    const addStore = useMangaStore((state) => {
        return state.addStore;
    });
    const removeStore = useMangaStore((state) => {
        return state.removeStore;
    });
    const changeExtension = useMangaStore((state) => {
        return state.changeExtension;
    });
    const setExtensionFilter = useMangaStore((state) => {
        return state.setExtensionFilter;
    });
    const [address, setAddress] = useState('');
    const { stores, status, error, busy, filter } = extensions;

    useEffect(() => {
        if (status === 'idle') {
            void loadExtensions(false);
        }
    }, [status, loadExtensions]);

    const shown = filterExtensions(extensions.extensions, filter);
    const languages = [ALL_LANGUAGES, ...extensionLanguages(extensions.extensions)];

    async function handleAdd(indexUrl: string): Promise<void> {
        if (await addStore(indexUrl)) {
            setAddress('');
        }
    }

    return (
        <section className="manga__extensions" aria-label={t('manga.nav.extensions')}>
            <p className="field__hint">{t('manga.ext.hint')}</p>
            <fieldset className="panel">
                <legend>{t('manga.ext.stores')}</legend>
                {stores.length === 0 && status !== 'loading' && <p className="empty">{t('manga.ext.noStores')}</p>}
                <ul className="history__list">
                    {stores.map((store) => {
                        return (
                            <li key={store.indexUrl} className="history__item">
                                <div className="history__main">
                                    <span className="history__title">{store.name}</span>
                                    <span className="history__meta">{store.indexUrl}</span>
                                </div>
                                <button
                                    type="button"
                                    className="btn btn--small btn--hot"
                                    disabled={busy.includes(store.indexUrl)}
                                    aria-label={`${t('manga.ext.removeStore')}: ${store.name}`}
                                    onClick={() => {
                                        void removeStore(store.indexUrl);
                                    }}
                                >
                                    {t('manga.ext.removeStore')}
                                </button>
                            </li>
                        );
                    })}
                </ul>
                <form
                    className="field-row"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void handleAdd(address.trim());
                    }}
                >
                    <TextField label={t('manga.ext.storeUrl')} value={address} placeholder={STORE_PLACEHOLDER} onChange={setAddress} />
                    <button type="submit" className="btn btn--primary" disabled={address.trim().length === 0 || busy.includes(address.trim())}>
                        {t('manga.ext.addStore')}
                    </button>
                </form>
            </fieldset>
            {error && (
                <p className="field__warning" role="alert" title={error.message}>
                    {t(mangaErrorKey(error.code))}
                </p>
            )}
            {status === 'loading' && <p className="empty">{t('manga.ext.loading')}</p>}
            {stores.length > 0 && (
                <>
                    <div className="field-row">
                        <TextField
                            label={t('manga.ext.filter')}
                            value={filter.query}
                            onChange={(query) => {
                                setExtensionFilter({ query });
                            }}
                        />
                        <SelectField
                            label={t('manga.ext.lang')}
                            value={filter.lang}
                            options={languages}
                            formatOption={(lang) => {
                                return lang === ALL_LANGUAGES ? t('manga.ext.allLangs') : lang;
                            }}
                            onChange={(lang) => {
                                setExtensionFilter({ lang });
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
                    </div>
                    {status === 'ready' && shown.length === 0 && <p className="empty">{t('manga.ext.none')}</p>}
                    <ul className="history__list">
                        {shown.map((extension) => {
                            const working = busy.includes(extension.pkgName);
                            return (
                                <li key={extension.pkgName} className="history__item" data-testid="manga-extension">
                                    <div className="history__main">
                                        <span className="history__title">{extension.name}</span>
                                        <span className="history__meta">{`${extension.lang} · ${extension.versionName}`}</span>
                                    </div>
                                    {extension.contentWarning === 'NSFW' && <span className="badge badge--error">{t('manga.ext.nsfw')}</span>}
                                    {extension.isObsolete && <span className="badge badge--cancelled">{t('manga.ext.obsolete')}</span>}
                                    {extension.isInstalled && <span className="badge badge--done">{t('manga.ext.installed')}</span>}
                                    <span className="anime__actions">
                                        {!extension.isInstalled && (
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
                                            <button
                                                type="button"
                                                className="btn btn--small btn--hot"
                                                disabled={working}
                                                aria-label={`${t('manga.ext.uninstall')}: ${extension.name}`}
                                                onClick={() => {
                                                    void changeExtension(extension.pkgName, 'uninstall');
                                                }}
                                            >
                                                {t('manga.ext.uninstall')}
                                            </button>
                                        )}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
        </section>
    );
}
