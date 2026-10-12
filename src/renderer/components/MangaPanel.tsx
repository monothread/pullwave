import { Fragment, useEffect } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore, type MangaBrowseView } from '../store/mangaStore';
import { MangaBrowse } from './MangaBrowse';
import { MangaCloudflareNotice } from './MangaCloudflareNotice';
import { MangaExtensions } from './MangaExtensions';
import { MangaHelperNotice } from './MangaHelperNotice';
import { MangaJobs } from './MangaJobs';
import { MangaHistory } from './MangaHistory';
import { MangaLibrary } from './MangaLibrary';
import { MangaReader } from './MangaReader';
import { activeJobCount } from './mangaText';
import { MangaSearch } from './MangaSearch';
import { MangaSetup } from './MangaSetup';
import { MangaUpdates } from './MangaUpdates';
import { SettingsPanel } from './SettingsPanel';
import { SETTINGS_ICON, TabButton } from './TabButton';
import { TabMenu } from './TabMenu';

const VIEWS: ReadonlyArray<{ id: MangaBrowseView; label: 'manga.nav.browse' | 'manga.nav.search' | 'manga.nav.updates' | 'manga.nav.library' | 'manga.nav.history' | 'manga.nav.extensions' | 'manga.nav.settings'; icon?: string }> = [
    { id: 'browse', label: 'manga.nav.browse' },
    { id: 'search', label: 'manga.nav.search' },
    { id: 'updates', label: 'manga.nav.updates' },
    { id: 'library', label: 'manga.nav.library' },
    { id: 'history', label: 'manga.nav.history' },
    { id: 'extensions', label: 'manga.nav.extensions' },
    { id: 'settings', label: 'manga.nav.settings', icon: SETTINGS_ICON }
];

export function MangaPanel() {
    const t = useTranslator();
    const status = useMangaStore((state) => {
        return state.status;
    });
    const view = useMangaStore((state) => {
        return state.view;
    });
    const reading = useMangaStore((state) => {
        return state.reader.status !== 'closed';
    });
    const setView = useMangaStore((state) => {
        return state.setView;
    });
    const openDownloads = useMangaStore((state) => {
        return state.openDownloads;
    });
    const closeDownloads = useMangaStore((state) => {
        return state.closeDownloads;
    });
    const refreshStatus = useMangaStore((state) => {
        return state.refreshStatus;
    });
    const loadSources = useMangaStore((state) => {
        return state.loadSources;
    });
    const active = useMangaStore((state) => {
        return activeJobCount(state.jobs);
    });
    // Whatever page of the section is opened (a screen, a source, a manga, a series, the reader) starts at the top.
    const page = useMangaStore((state) => {
        return [state.view, state.browse.sourceId ?? '', state.browse.mode, state.sourceSettings.open, state.selection?.manga.remoteId ?? '', state.librarySeries ?? '', state.libraryGroup ?? '', state.reader.status === 'closed'].join('|');
    });

    useEffect(() => {
        const area = document.querySelector<HTMLElement>('.app__main');
        if (area !== null) {
            area.scrollTop = 0;
        }
    }, [page]);

    if (!status.supported) {
        return (
            <section className="panel" aria-label={t('manga.aria')}>
                <p className="field__warning" role="alert">
                    {t('manga.unsupported')}
                </p>
            </section>
        );
    }
    if (status.tool !== null && status.tool.status !== 'ready') {
        return (
            <section className="manga" aria-label={t('manga.aria')}>
                <MangaSetup />
            </section>
        );
    }
    if (reading) {
        return <MangaReader />;
    }
    if (view === 'downloads') {
        return (
            <section className="manga" aria-label={t('manga.aria')}>
                <div className="queue__toolbar">
                    <button type="button" className="btn btn--small btn--ghost" onClick={closeDownloads}>
                        {t('manga.back')}
                    </button>
                </div>
                <MangaCloudflareNotice />
                <MangaJobs />
            </section>
        );
    }
    return (
        <section className="manga" aria-label={t('manga.aria')}>
            <div className="anime__bar">
                <nav className="tabs" aria-label={t('manga.aria')}>
                    <TabMenu
                        label={t('manga.aria')}
                        tabs={VIEWS.filter((item) => {
                            return item.icon === undefined;
                        }).map((item) => {
                            return { id: item.id, label: t(item.label) };
                        })}
                        active={view}
                        onSelect={(id) => {
                            setView(id as MangaBrowseView);
                        }}
                    />
                    {VIEWS.map((item) => {
                        return (
                            <Fragment key={item.id}>
                                {item.icon !== undefined && (
                                    <button type="button" className={`btn btn--small${active > 0 ? ' btn--primary' : ''}`} onClick={openDownloads}>
                                        {t('manga.jobs.label', { count: active })}
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
            {status.server === 'error' && (
                <div className="panel">
                    <p className="field__warning" role="alert" title={status.serverError ?? undefined}>
                        {t('manga.server.error')}
                    </p>
                    <div className="job__actions">
                        <button
                            type="button"
                            className="btn btn--small btn--primary"
                            onClick={() => {
                                void refreshStatus();
                                void loadSources();
                            }}
                        >
                            {t('manga.server.retry')}
                        </button>
                    </div>
                </div>
            )}
            <MangaHelperNotice />
            <MangaCloudflareNotice />
            {status.server === 'starting' && <p className="empty">{t('manga.server.starting')}</p>}
            {view === 'browse' && <MangaBrowse />}
            {view === 'search' && <MangaSearch />}
            {view === 'updates' && <MangaUpdates />}
            {view === 'library' && <MangaLibrary />}
            {view === 'history' && <MangaHistory />}
            {view === 'extensions' && <MangaExtensions />}
            {view === 'settings' && <SettingsPanel scope="manga" />}
        </section>
    );
}

