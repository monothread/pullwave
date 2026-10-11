import { useEffect, useState } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { TextField } from './fields';
import { mangaErrorKey, STORE_PLACEHOLDER } from './mangaText';

// The stores the extensions come from: adding and removing them is a setting of the manga section.
export function MangaStoreSettings() {
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
    const [address, setAddress] = useState('');
    const { stores, status, error, busy } = extensions;

    useEffect(() => {
        if (status === 'idle') {
            void loadExtensions(false);
        }
    }, [status, loadExtensions]);

    async function handleAdd(indexUrl: string): Promise<void> {
        if (await addStore(indexUrl)) {
            setAddress('');
        }
    }

    return (
        <fieldset className="panel">
            <legend>{t('settings.mangaStores')}</legend>
            <p className="field__hint">{t('settings.mangaStores.hint')}</p>
            {stores.length === 0 && status !== 'loading' && <p className="empty">{t('manga.ext.noStores')}</p>}
            <ul className="history__list">
                {stores.map((store) => {
                    return (
                        <li key={store.indexUrl} className="history__item" data-testid="manga-store">
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
            {error && (
                <p className="field__warning" role="alert" title={error.message}>
                    {t(mangaErrorKey(error.code))}
                </p>
            )}
        </fieldset>
    );
}
