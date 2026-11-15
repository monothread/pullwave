import { AUDIO_FORMATS, MAX_LIVE_END_CHECK_SECONDS, MIN_LIVE_END_CHECK_SECONDS, RESOLUTIONS, VIDEO_CONTAINERS } from '@shared/constants';
import type { Translator } from '@shared/i18n';
import type { DownloadOptions, Settings } from '@shared/types';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslator } from '../i18n/useTranslator';
import { clampCheckSeconds, FOLLOW_SETTING, hasOptions, SWITCH_OFF, SWITCH_ON, switchChoice, switchValue, withOption, type SwitchChoice } from './downloadOptions';
import { SelectField } from './fields';
import { formatResolution, formatSwitch } from './settingsFormat';

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), input:not([disabled])';

interface DownloadOptionsDialogProps {
    linkNumber: number;
    options: DownloadOptions;
    settings: Settings;
    onApply: (options: DownloadOptions) => void;
    onClose: () => void;
}

interface SwitchOptionProps {
    label: string;
    hint?: string;
    value: boolean | undefined;
    fallback: boolean;
    t: Translator;
    onChange: (value: boolean | undefined) => void;
}

function SwitchOption({ label, hint, value, fallback, t, onChange }: SwitchOptionProps) {
    return (
        <SelectField<SwitchChoice>
            label={label}
            hint={hint}
            value={switchChoice(value)}
            options={[FOLLOW_SETTING, SWITCH_ON, SWITCH_OFF]}
            formatOption={(choice) => {
                return choice === FOLLOW_SETTING ? t('options.useDefault', { value: formatSwitch(fallback, t) }) : formatSwitch(choice === SWITCH_ON, t);
            }}
            onChange={(choice) => {
                onChange(switchValue(choice));
            }}
        />
    );
}

export function DownloadOptionsDialog({ linkNumber, options, settings, onApply, onClose }: DownloadOptionsDialogProps) {
    const t = useTranslator();
    const [draft, setDraft] = useState<DownloadOptions>(options);
    const dialogRef = useRef<HTMLDivElement>(null);
    const checksEnd = draft.verifyLiveEnd ?? settings.verifyLiveEnd;

    useEffect(() => {
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
        return () => {
            opener?.focus();
        };
    }, []);

    function change<K extends keyof DownloadOptions>(key: K, value: DownloadOptions[K] | undefined): void {
        setDraft((previous) => {
            return withOption(previous, key, value);
        });
    }

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
        if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
        }
        if (event.key !== 'Tab') {
            return;
        }
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        }
    }

    return (
        <div
            className="modal-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="download-options-title" onKeyDown={handleKeyDown}>
                <h2 id="download-options-title" className="modal__title">
                    {t('options.title', { n: linkNumber })}
                </h2>
                <p className="modal__hint">{t('options.hint')}</p>

                <fieldset className="panel">
                    <legend>{t('settings.quality')}</legend>
                    <SelectField<'' | (typeof RESOLUTIONS)[number]>
                        label={t('settings.maxResolution')}
                        value={draft.maxResolution ?? FOLLOW_SETTING}
                        options={[FOLLOW_SETTING, ...RESOLUTIONS]}
                        formatOption={(resolution) => {
                            return resolution === FOLLOW_SETTING
                                ? t('options.useDefault', { value: formatResolution(settings.maxResolution, t) })
                                : formatResolution(resolution, t);
                        }}
                        onChange={(resolution) => {
                            change('maxResolution', resolution === FOLLOW_SETTING ? undefined : resolution);
                        }}
                    />
                    <SelectField<'' | (typeof VIDEO_CONTAINERS)[number]>
                        label={t('settings.videoContainer')}
                        value={draft.videoContainer ?? FOLLOW_SETTING}
                        options={[FOLLOW_SETTING, ...VIDEO_CONTAINERS]}
                        formatOption={(container) => {
                            return container === FOLLOW_SETTING ? t('options.useDefault', { value: settings.videoContainer }) : container;
                        }}
                        onChange={(container) => {
                            change('videoContainer', container === FOLLOW_SETTING ? undefined : container);
                        }}
                    />
                    <SwitchOption label={t('settings.audioOnly')} value={draft.audioOnly} fallback={settings.audioOnly} t={t} onChange={(value) => {
                        change('audioOnly', value);
                    }} />
                    <SelectField<'' | (typeof AUDIO_FORMATS)[number]>
                        label={t('settings.audioFormat')}
                        value={draft.audioFormat ?? FOLLOW_SETTING}
                        options={[FOLLOW_SETTING, ...AUDIO_FORMATS]}
                        formatOption={(format) => {
                            return format === FOLLOW_SETTING ? t('options.useDefault', { value: settings.audioFormat }) : format;
                        }}
                        onChange={(format) => {
                            change('audioFormat', format === FOLLOW_SETTING ? undefined : format);
                        }}
                    />
                </fieldset>

                <fieldset className="panel">
                    <legend>{t('settings.live')}</legend>
                    <SwitchOption label={t('settings.liveFromStart')} value={draft.liveFromStart} fallback={settings.liveFromStart} t={t} onChange={(value) => {
                        change('liveFromStart', value);
                    }} />
                    <SwitchOption label={t('settings.waitForLive')} value={draft.waitForLive} fallback={settings.waitForLive} t={t} onChange={(value) => {
                        change('waitForLive', value);
                    }} />
                    <SwitchOption label={t('settings.verifyLiveEnd')} value={draft.verifyLiveEnd} fallback={settings.verifyLiveEnd} t={t} onChange={(value) => {
                        change('verifyLiveEnd', value);
                    }} />
                    <label className="field">
                        <span className="field__label">{t('settings.verifyLiveEndSeconds')}</span>
                        <input
                            className="input"
                            type="number"
                            aria-label={t('settings.verifyLiveEndSeconds')}
                            min={MIN_LIVE_END_CHECK_SECONDS}
                            max={MAX_LIVE_END_CHECK_SECONDS}
                            value={draft.verifyLiveEndSeconds ?? ''}
                            placeholder={t('options.useDefault', { value: settings.verifyLiveEndSeconds })}
                            disabled={!checksEnd}
                            onChange={(event) => {
                                const parsed = event.target.value === '' ? undefined : Number(event.target.value);
                                change('verifyLiveEndSeconds', parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined);
                            }}
                        />
                    </label>
                </fieldset>

                <div className="modal__actions">
                    <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        disabled={!hasOptions(draft)}
                        onClick={() => {
                            setDraft({});
                        }}
                    >
                        {t('options.reset')}
                    </button>
                    <button type="button" className="btn btn--small" onClick={onClose}>
                        {t('options.cancel')}
                    </button>
                    <button
                        type="button"
                        className="btn btn--small btn--primary"
                        onClick={() => {
                            const seconds = draft.verifyLiveEndSeconds;
                            onApply(seconds === undefined ? draft : { ...draft, verifyLiveEndSeconds: clampCheckSeconds(seconds) });
                        }}
                    >
                        {t('options.apply')}
                    </button>
                </div>
            </div>
        </div>
    );
}
