import type { MessageKey } from '@shared/i18n';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore, type DownloadsView } from '../store/appStore';
import { HistoryList } from './HistoryList';
import { ProgramsGate } from './ProgramsSetup';
import { QueueList } from './QueueList';
import { SettingsPanel } from './SettingsPanel';
import { SETTINGS_ICON, TabButton } from './TabButton';
import { UrlInput } from './UrlInput';

const VIEWS: ReadonlyArray<{ id: DownloadsView; label: MessageKey; icon?: string }> = [
    { id: 'queue', label: 'downloads.nav.queue' },
    { id: 'history', label: 'downloads.nav.history' },
    { id: 'settings', label: 'downloads.nav.settings', icon: SETTINGS_ICON }
];

// The video downloader: the queue (with the field for links), the history of what was downloaded and its settings.
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
            {view === 'history' && <HistoryList />}
            {view === 'settings' && <SettingsPanel scope="downloads" />}
        </section>
    );
}
