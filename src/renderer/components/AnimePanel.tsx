import { Fragment } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore, type AnimeBrowseView } from '../store/animeStore';
import { activeJobCount } from './animeText';
import { AnimeHistory } from './AnimeHistory';
import { AnimeJobs } from './AnimeJobs';
import { AnimeSubtitleJobs } from './AnimeSubtitleJobs';
import { AnimeLibrary } from './AnimeLibrary';
import { AnimePlayer } from './AnimePlayer';
import { AnimeSchedule } from './AnimeSchedule';
import { AnimeSearch } from './AnimeSearch';
import { LazyAnimeStreamPlayer } from './LazyAnimeStreamPlayer';
import { AnimeUpdates } from './AnimeUpdates';
import { AudioReportDialog } from './AudioReportDialog';
import { ProgramsGate } from './ProgramsSetup';
import { SettingsPanel } from './SettingsPanel';
import { SETTINGS_ICON, TabButton } from './TabButton';
import { TabMenu } from './TabMenu';

const VIEWS: ReadonlyArray<{ id: AnimeBrowseView; label: 'anime.nav.schedule' | 'anime.nav.search' | 'anime.nav.library' | 'anime.nav.updates' | 'anime.nav.history' | 'anime.nav.settings'; icon?: string }> = [
    { id: 'schedule', label: 'anime.nav.schedule' },
    { id: 'updates', label: 'anime.nav.updates' },
    { id: 'search', label: 'anime.nav.search' },
    { id: 'library', label: 'anime.nav.library' },
    { id: 'history', label: 'anime.nav.history' },
    { id: 'settings', label: 'anime.nav.settings', icon: SETTINGS_ICON }
];

// The tabs of the section, in the order of the bar (the gear last): what Ctrl+Page Up and Ctrl+Page Down move through.
export const ANIME_TAB_IDS: readonly AnimeBrowseView[] = VIEWS.map((item) => {
    return item.id;
});

export function AnimePanel() {
    const t = useTranslator();
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
    const closeSubtitleJobs = useAnimeStore((state) => {
        return state.closeSubtitleJobs;
    });
    const active = useAnimeStore((state) => {
        return activeJobCount(state.jobs);
    });

    if (view === 'subtitles') {
        return (
            <section className="anime" aria-label={t('anime.aria')}>
                <div className="queue__toolbar">
                    <button type="button" className="btn btn--small btn--ghost" onClick={closeSubtitleJobs}>
                        {t('anime.back')}
                    </button>
                </div>
                <AnimeSubtitleJobs />
                <AnimePlayer />
                <LazyAnimeStreamPlayer />
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
                <LazyAnimeStreamPlayer />
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
                                    pillId="anime-tab-pill"
                                    onClick={() => {
                                        setView(item.id);
                                    }}
                                />
                            </Fragment>
                        );
                    })}
                </nav>
            </div>
            {view !== 'settings' && (
                <ProgramsGate area="anime">
                    {view === 'schedule' && <AnimeSchedule />}
                    {view === 'search' && <AnimeSearch />}
                    {view === 'library' && <AnimeLibrary />}
                    {view === 'updates' && <AnimeUpdates />}
                    {view === 'history' && <AnimeHistory />}
                </ProgramsGate>
            )}
            {view === 'settings' && <SettingsPanel scope="anime" />}
            <AnimePlayer />
            <LazyAnimeStreamPlayer />
            <AudioReportDialog />
        </section>
    );
}
