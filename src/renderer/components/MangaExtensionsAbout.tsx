import { useTranslator } from '../i18n/useTranslator';

export function MangaExtensionsAbout() {
    const t = useTranslator();
    return (
        <section className="panel manga__about" aria-label={t('manga.ext.about.title')}>
            <span className="section-label">{t('manga.ext.about.title')}</span>
            <p className="field__hint">{t('manga.ext.about.what')}</p>
            <p className="field__hint">{t('manga.ext.about.responsibility')}</p>
        </section>
    );
}
