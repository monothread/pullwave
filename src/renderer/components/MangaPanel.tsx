import { useEffect } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore, type MangaBrowseView } from '../store/mangaStore';
import { MangaBrowse } from './MangaBrowse';
import { MangaCloudflareNotice } from './MangaCloudflareNotice';
import { MangaExtensions } from './MangaExtensions';
import { MangaHelperNotice } from './MangaHelperNotice';
import { MangaJobs } from './MangaJobs';
import { MangaLibrary } from './MangaLibrary';
import { MangaReader } from './MangaReader';
import { activeJobCount } from './mangaText';
import { MangaSetup } from './MangaSetup';
import { SettingsPanel } from './SettingsPanel';
import { SETTINGS_ICON, TabButton } from './TabButton';

const VIEWS: ReadonlyArray<{ id: MangaBrowseView; label: 'manga.nav.browse' | 'manga.nav.library' | 'manga.nav.extensions' | 'manga.nav.settings'; icon?: string }> = [
    { id: 'browse', label: 'manga.nav.browse' },
    { id: 'library', label: 'manga.nav.library' },
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
                    {VIEWS.map((item) => {
                        return (
                            <TabButton
                                key={item.id}
                                label={t(item.label)}
                                icon={item.icon}
                                active={view === item.id}
                                onClick={() => {
                                    setView(item.id);
                                }}
                            />
                        );
                    })}
                </nav>
                <button type="button" className={`btn btn--small${active > 0 ? ' btn--primary' : ''}`} onClick={openDownloads}>
                    {t('manga.jobs.label', { count: active })}
                </button>
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
            {view === 'library' && <MangaLibrary />}
            {view === 'extensions' && <MangaExtensions />}
            {view === 'settings' && <SettingsPanel scope="manga" />}
        </section>
    );
}

