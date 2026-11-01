import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import type { StartTab } from '@shared/types';

interface HomeWelcomeProps {
    sectionName: string;
    startTab: StartTab;
}

// The banner of the home screen when there is nothing to highlight yet: a welcome, and the way to the section of "Open on".
export function HomeWelcome({ sectionName, startTab }: HomeWelcomeProps) {
    const t = useTranslator();
    const setTab = useAppStore((state) => {
        return state.setTab;
    });
    return (
        <section className="hero hero--welcome" aria-label={t('home.hero.welcome')}>
            <div className="hero__body">
                <h2 className="hero__title">{t('home.hero.welcome')}</h2>
                <p className="hero__hint">{t('home.hero.welcomeHint')}</p>
                <div className="hero__actions">
                    <button
                        type="button"
                        className="btn btn--primary hero__play"
                        onClick={() => {
                            setTab(startTab);
                        }}
                    >
                        {t('home.hero.go', { section: sectionName })}
                    </button>
                </div>
            </div>
        </section>
    );
}
