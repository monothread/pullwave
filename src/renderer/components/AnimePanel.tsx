import { Fragment } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore, type AnimeBrowseView } from '../store/animeStore';
import { activeJobCount } from './animeText';
import { AnimeHistory } from './AnimeHistory';
import { AnimeJobs } from './AnimeJobs';
import { AnimeLibrary } from './AnimeLibrary';
import { AnimePlayer } from './AnimePlayer';
import { AnimeSchedule } from './AnimeSchedule';
import { AnimeSearch } from './AnimeSearch';
import { AnimeStreamPlayer } from './AnimeStreamPlayer';
import { SettingsPanel } from './SettingsPanel';
import { SETTINGS_ICON, TabButton } from './TabButton';
import { TabMenu } from './TabMenu';

const VIEWS: ReadonlyArray<{ id: AnimeBrowseView; label: 'anime.nav.schedule' | 'anime.nav.search' | 'anime.nav.library' | 'anime.nav.history' | 'anime.nav.settings'; icon?: string }> = [
    { id: 'schedule', label: 'anime.nav.schedule' },
    { id: 'search', label: 'anime.nav.search' },
    { id: 'library', label: 'anime.nav.library' },
    { id: 'history', label: 'anime.nav.history' },
    { id: 'settings', label: 'anime.nav.settings', icon: SETTINGS_ICON }
];

export function AnimePanel() {
    const t = useTranslator();
    const status = useAnimeStore((state) => {
        return state.status;
    });
    const view = useAnimeStore((state) => {
        return state.view;
    });
    const setView = useAnimeStore((state) => {
        return state.setView;
    });
    const openDownloads = useAnimeStore((state) => {
        return state.openDownloads;
    });
    const closeDownloads = useAnimeStore((state) => {
        return state.closeDownloads;
    });
    const active = useAnimeStore((state) => {
        return activeJobCount(state.jobs);
    });

    if (!status.available) {
        return (
            <section className="panel" aria-label={t('anime.aria')}>
                <p className="field__warning" role="alert">
                    {t('anime.unavailable.title')}
                </p>
                <p className="field__hint">{t('anime.unavailable.hint')}</p>
            </section>
        );
    }
    if (view === 'downloads') {
        return (
            <section className="anime" aria-label={t('anime.aria')}>
                <div className="queue__toolbar">
                    <button type="button" className="btn btn--small btn--ghost" onClick={closeDownloads}>
                        {t('anime.back')}
                    </button>
                </div>
                <AnimeJobs />
                <AnimePlayer />
                <AnimeStreamPlayer />
            </section>
        );
    }
    return (
        <section className="anime" aria-label={t('anime.aria')}>
            <div className="anime__bar">
                <nav className="tabs" aria-label={t('anime.aria')}>
                    <TabMenu
                        label={t('anime.aria')}
                        tabs={VIEWS.filter((item) => {
                            return item.icon === undefined;
                        }).map((item) => {
                            return { id: item.id, label: t(item.label) };
                        })}
                        active={view}
                        onSelect={(id) => {
                            setView(id as AnimeBrowseView);
                        }}
                    />
                    {VIEWS.map((item) => {
                        return (
                            <Fragment key={item.id}>
                                {item.icon !== undefined && (
                                    <button type="button" className={`btn btn--small${active > 0 ? ' btn--primary' : ''}`} onClick={openDownloads}>
                                        {t('anime.jobs.label', { count: active })}
                                    </button>
                                )}
                                <TabButton
                                    label={t(item.label)}
                                    icon={item.icon}
                                    active={view === item.id}
                                    onClick={() => {
                                        setView(item.id);
                                    }}
                                />
                            </Fragment>
                        );
                    })}
                </nav>
            </div>
            {view === 'schedule' && <AnimeSchedule />}
            {view === 'search' && <AnimeSearch />}
            {view === 'library' && <AnimeLibrary />}
            {view === 'history' && <AnimeHistory />}
            {view === 'settings' && <SettingsPanel scope="anime" />}
            <AnimePlayer />
            <AnimeStreamPlayer />
        </section>
    );
}
