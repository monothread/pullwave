import { useTranslator } from '../i18n/useTranslator';

export function BridgeMissing() {
    const t = useTranslator();
    return (
        <div className="app">
            <h1 className="logo" data-text="PULLWAVE">
                PULLWAVE
            </h1>
            <div className="error-banner" role="alert">
                <p className="error-banner__title">{t('bridge.title')}</p>
                <p className="error-banner__hint">{t('bridge.hint')}</p>
            </div>
        </div>
    );
}
