import { useState } from 'react';
import type { MangaSourcePreference } from '@shared/manga';
import { useTranslator } from '../i18n/useTranslator';
import { useMangaStore } from '../store/mangaStore';
import { FieldShell, SelectField, ToggleField } from './fields';
import { mangaErrorKey } from './mangaText';

interface PreferenceFieldProps {
    preference: MangaSourcePreference;
    disabled: boolean;
    onChange: (value: MangaSourcePreference['value']) => void;
}

// A text setting is saved when the user leaves the field or presses Enter, not at every key.
function TextPreference({ preference, disabled, onChange }: PreferenceFieldProps & { preference: Extract<MangaSourcePreference, { type: 'text' }> }) {
    const [draft, setDraft] = useState(preference.value);
    const commit = (): void => {
        if (draft !== preference.value) {
            onChange(draft);
        }
    };
    return (
        <FieldShell label={preference.title} hint={preference.summary.length > 0 ? preference.summary : undefined}>
            <input
                className="input"
                type="text"
                aria-label={preference.title}
                value={draft}
                disabled={disabled}
                onChange={(event) => {
                    setDraft(event.target.value);
                }}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        commit();
                    }
                }}
            />
        </FieldShell>
    );
}

function MultiSelectPreference({ preference, disabled, onChange }: PreferenceFieldProps & { preference: Extract<MangaSourcePreference, { type: 'multiselect' }> }) {
    return (
        <fieldset className="field" disabled={disabled}>
            <legend className="field__label">{preference.title}</legend>
            {preference.entryValues.map((entryValue, index) => {
                const label = preference.entries[index] ?? entryValue;
                const checked = preference.value.includes(entryValue);
                return (
                    <label key={entryValue} className="toggle">
                        <input
                            type="checkbox"
                            aria-label={`${preference.title}: ${label}`}
                            checked={checked}
                            onChange={() => {
                                onChange(
                                    checked
                                        ? preference.value.filter((item) => {
                                              return item !== entryValue;
                                          })
                                        : [...preference.value, entryValue]
                                );
                            }}
                        />
                        <span>{label}</span>
                    </label>
                );
            })}
            {preference.summary.length > 0 && <span className="field__hint">{preference.summary}</span>}
        </fieldset>
    );
}

function PreferenceField({ preference, disabled, onChange }: PreferenceFieldProps) {
    const hint = preference.summary.length > 0 ? preference.summary : undefined;
    switch (preference.type) {
        case 'text':
            // The key makes the field start over from what the server says when the setting changes.
            return <TextPreference key={`${preference.key}:${preference.value}`} preference={preference} disabled={disabled} onChange={onChange} />;
        case 'list':
            return (
                <SelectField
                    label={preference.title}
                    value={preference.value}
                    options={preference.entryValues}
                    hint={hint}
                    disabled={disabled}
                    formatOption={(entryValue) => {
                        return preference.entries[preference.entryValues.indexOf(entryValue)] ?? entryValue;
                    }}
                    onChange={onChange}
                />
            );
        case 'switch':
        case 'checkbox':
            return <ToggleField label={preference.title} checked={preference.value} hint={hint} onChange={onChange} />;
        case 'multiselect':
            return <MultiSelectPreference preference={preference} disabled={disabled} onChange={onChange} />;
    }
}

// The settings of the source being browsed. Some sources (the ones that read another server, for instance) do nothing until they are set.
export function MangaSourceSettings() {
    const t = useTranslator();
    const settings = useMangaStore((state) => {
        return state.sourceSettings;
    });
    const sourceName = useMangaStore((state) => {
        return (
            state.browse.sources.find((source) => {
                return source.id === state.browse.sourceId;
            })?.name ?? ''
        );
    });
    const closeSourceSettings = useMangaStore((state) => {
        return state.closeSourceSettings;
    });
    const changePreference = useMangaStore((state) => {
        return state.changePreference;
    });
    if (!settings.open) {
        return null;
    }
    return (
        <fieldset className="panel manga__source-settings" aria-label={t('manga.source.settings.title', { name: sourceName })}>
            <legend>{t('manga.source.settings.title', { name: sourceName })}</legend>
            <p className="field__hint">{t('manga.source.settings.hint')}</p>
            {settings.status === 'loading' && <p className="empty">{t('manga.source.settings.loading')}</p>}
            {settings.status === 'ready' && settings.preferences.length === 0 && <p className="empty">{t('manga.source.settings.none')}</p>}
            {settings.error && (
                <p className="field__warning" role="alert" title={settings.error.message}>
                    {t(mangaErrorKey(settings.error.code))}
                </p>
            )}
            {settings.preferences.map((preference) => {
                return (
                    <PreferenceField
                        key={preference.position}
                        preference={preference}
                        disabled={settings.saving || !preference.enabled}
                        onChange={(value) => {
                            void changePreference(preference, value);
                        }}
                    />
                );
            })}
            <div className="job__actions">
                <button type="button" className="btn btn--small" onClick={closeSourceSettings}>
                    {t('manga.source.settings.close')}
                </button>
            </div>
        </fieldset>
    );
}
