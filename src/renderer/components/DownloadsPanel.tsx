import type { MessageKey } from '@shared/i18n';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore, type DownloadsView } from '../store/appStore';
import { ConvertPanel } from './ConvertPanel';
import { CutPanel } from './CutPanel';
import { ExplorerPanel } from './ExplorerPanel';
import { HistoryList } from './HistoryList';
import { ProgramsGate } from './ProgramsSetup';
import { QueueList } from './QueueList';
import { SettingsPanel } from './SettingsPanel';
import { SETTINGS_ICON, TabButton } from './TabButton';
import { UrlInput } from './UrlInput';

const VIEWS: ReadonlyArray<{ id: DownloadsView; label: MessageKey; icon?: string }> = [
    { id: 'queue', label: 'downloads.nav.queue' },
    { id: 'history', label: 'downloads.nav.history' },
    { id: 'explorer', label: 'downloads.nav.explorer' },
    { id: 'cut', label: 'downloads.nav.cut' },
    { id: 'convert', label: 'downloads.nav.convert' },
    { id: 'settings', label: 'downloads.nav.settings', icon: SETTINGS_ICON }
];

export const DOWNLOADS_TAB_IDS: readonly DownloadsView[] = VIEWS.map((item) => {
    return item.id;
});

export function DownloadsPanel() {
    const t = useTranslator();
    const view = useAppStore((state) => {
        return state.downloadsView;
    });
    const setView = useAppStore((state) => {
        return state.setDownloadsView;
    });

    return (
        <section className="downloads" aria-label={t('downloads.aria')}>
            <nav className="tabs" aria-label={t('downloads.aria')}>
                {VIEWS.map((item) => {
                    return (
                        <TabButton
                            key={item.id}
                            label={t(item.label)}
                            icon={item.icon}
                            active={view === item.id}
                            pillId="downloads-tab-pill"
                            onClick={() => {
                                setView(item.id);
                            }}
                        />
                    );
                })}
            </nav>
            {view === 'queue' && (
                <ProgramsGate area="downloads">
                    <UrlInput />
                    <QueueList />
                </ProgramsGate>
            )}
            {view === 'cut' && (
                <ProgramsGate area="downloads">
                    <CutPanel />
                </ProgramsGate>
            )}
            {view === 'convert' && (
                <ProgramsGate area="downloads">
                    <ConvertPanel />
                </ProgramsGate>
            )}
            {view === 'explorer' && <ExplorerPanel />}
            {view === 'history' && <HistoryList />}
            {view === 'settings' && <SettingsPanel scope="downloads" />}
        </section>
    );
}
