import { useState } from 'react';
import type { LogSource } from '@shared/logs';
import { useTranslator } from '../i18n/useTranslator';
import { LogsDialog } from './LogsDialog';
import type { SettingsScope } from './SettingsPanel';

// The programs each place of the settings shows the logs of: the manga server and its helper, ani-cli, yt-dlp, and ffmpeg (used by every
// section) in the settings of the whole app.
export const LOG_SOURCES_BY_SCOPE: Record<SettingsScope, readonly LogSource[]> = {
    global: ['ffmpeg'],
    downloads: ['yt-dlp'],
    anime: ['ani-cli'],
    manga: ['suwayomi', 'flaresolverr']
};

interface LogsSettingsProps {
    scope: SettingsScope;
}

// The block of the settings that opens the window of the logs of the programs of the place.
export function LogsSettings({ scope }: LogsSettingsProps) {
    const t = useTranslator();
    const [open, setOpen] = useState(false);
    return (
        <fieldset className="panel">
            <legend>{t('logs.legend')}</legend>
            <div className="field">
                <div className="field-row">
                    <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => {
                            setOpen(true);
                        }}
                    >
                        {t('logs.open')}
                    </button>
                </div>
                <span className="field__hint">{t('logs.hint')}</span>
            </div>
            {open && (
                <LogsDialog
                    sources={LOG_SOURCES_BY_SCOPE[scope]}
                    onClose={() => {
                        setOpen(false);
                    }}
                />
            )}
        </fieldset>
    );
}
