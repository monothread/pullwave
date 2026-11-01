import { useTranslator } from '../i18n/useTranslator';

// The banner of the home screen when there is nothing to highlight yet: a welcome. The ways into the sections are the blocks under it.
export function HomeWelcome() {
    const t = useTranslator();
    return (
        <section className="hero hero--welcome" aria-label={t('home.hero.welcome')}>
            <div className="hero__body">
                <h2 className="hero__title">{t('home.hero.welcome')}</h2>
                <p className="hero__hint">{t('home.hero.welcomeHint')}</p>
            </div>
        </section>
    );
}
