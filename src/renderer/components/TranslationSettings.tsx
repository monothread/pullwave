import { useEffect, useState } from 'react';
import { TRANSLATION_LANGUAGES } from '@shared/anime';
import { LLM_PROVIDER_IDS, LLM_PROVIDERS, SPEECH_PROVIDER_IDS, SPEECH_PROVIDERS, speechTokenSlot, type LlmStatus, type LlmTokenSlot, type SpeechProviderId } from '@shared/llm';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { Settings } from '@shared/types';
import { useTranslator } from '../i18n/useTranslator';
import { SelectField, TextField } from './fields';
import { providerName, speechProviderName } from './translateText';

interface TranslationSettingsProps {
    draft: Settings;
    change: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
    edit: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
    changeMany: (patch: Partial<Settings>) => void;
}

interface TokenTexts {
    label: string;
    saved: string;
    none: string;
    save: string;
    clear: string;
}

interface TokenFieldProps {
    slot: LlmTokenSlot;
    inputId: string;
    texts: TokenTexts;
    status: LlmStatus;
    onChanged: () => Promise<void>;
}

// The token of one slot (a provider, or a service of speech to text): it is created again for each slot (see `key` below), so what was typed
// for one never carries over.
function TokenField({ slot, inputId, texts, status, onChanged }: TokenFieldProps) {
    const t = useTranslator();
    const [token, setToken] = useState('');
    const [failed, setFailed] = useState(false);
    const hasToken = status.providers.includes(slot);

    async function saveToken(): Promise<void> {
        const saved = await window.api.setLlmToken(slot, token);
        setFailed(!saved);
        if (saved) {
            setToken('');
            await onChanged();
        }
    }

    async function clearToken(): Promise<void> {
        await window.api.clearLlmToken(slot);
        await onChanged();
    }

    return (
        <div className="field">
            <label className="field__label" htmlFor={inputId}>
                {texts.label}
            </label>
            <p className="update-status" aria-live="polite">
                {hasToken ? texts.saved : texts.none}
            </p>
            <div className="field-row">
                <input
                    id={inputId}
                    className="input"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={token}
                    disabled={!status.canStore}
                    onChange={(event) => {
                        setToken(event.target.value);
                    }}
                />
                <button
                    type="button"
                    className="btn btn--small btn--primary"
                    disabled={!status.canStore || token.trim().length === 0}
                    onClick={() => {
                        void saveToken();
                    }}
                >
                    {texts.save}
                </button>
                {hasToken && (
                    <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => {
                            void clearToken();
                        }}
                    >
                        {texts.clear}
                    </button>
                )}
            </div>
            {failed && (
                <p className="field__warning" role="alert">
                    {t('settings.translate.token.failed')}
                </p>
            )}
        </div>
    );
}

// The language models that translate subtitles and the service of speech to text that makes them: the provider, the model, the address and
// the token of each. The tokens are only sent to the main process, which keeps them encrypted; this screen learns whether there is one,
// never what it is.
export function TranslationSettings({ draft, change, edit, changeMany }: TranslationSettingsProps) {
    const t = useTranslator();
    const [status, setStatus] = useState<LlmStatus>({ canStore: true, providers: [] });
    const provider = draft.translateProvider;
    const speech = draft.transcribeProvider;

    // The model of one service means nothing to another: the one of OpenAI that is there by default is taken away when Gemini is chosen (its
    // models have other names), and put back when the field is empty and a service of the protocol of OpenAI is chosen again.
    function chooseSpeech(next: SpeechProviderId): void {
        const patch: Partial<Settings> = { transcribeProvider: next };
        if (next === 'gemini' && draft.transcribeModel === DEFAULT_SETTINGS.transcribeModel) {
            patch.transcribeModel = '';
        } else if (next !== 'gemini' && draft.transcribeModel.length === 0) {
            patch.transcribeModel = DEFAULT_SETTINGS.transcribeModel;
        }
        changeMany(patch);
    }

    async function refreshStatus(): Promise<void> {
        setStatus(await window.api.getLlmStatus());
    }

    useEffect(() => {
        let current = true;
        void window.api.getLlmStatus().then((found) => {
            if (current) {
                setStatus(found);
            }
        });
        return () => {
            current = false;
        };
    }, []);

    return (
        <>
            <span className="section-label">{t('settings.translate')}</span>
            <p className="field__hint">{t('settings.translate.hint')}</p>
            {!status.canStore && (
                <p className="field__warning" role="alert">
                    {t('settings.translate.token.unavailable')}
                </p>
            )}
            <SelectField
                label={t('settings.translate.provider')}
                value={provider}
                options={LLM_PROVIDER_IDS}
                formatOption={(option) => {
                    return providerName(option, t);
                }}
                onChange={(value) => {
                    change('translateProvider', value);
                }}
            />
            <TextField
                label={t('settings.translate.model')}
                value={draft.translateModel}
                hint={t('settings.translate.model.hint')}
                onChange={(value) => {
                    edit('translateModel', value);
                }}
            />
            <TextField
                label={t('settings.translate.baseUrl')}
                value={draft.translateBaseUrl}
                placeholder={LLM_PROVIDERS[provider].defaultBaseUrl}
                hint={t('settings.translate.baseUrl.hint')}
                onChange={(value) => {
                    edit('translateBaseUrl', value);
                }}
            />
            <SelectField
                label={t('settings.translate.language')}
                value={draft.translateLanguage}
                options={TRANSLATION_LANGUAGES}
                onChange={(value) => {
                    change('translateLanguage', value);
                }}
            />
            <TokenField
                key={provider}
                slot={provider}
                inputId="llm-token"
                texts={{
                    label: t('settings.translate.token'),
                    saved: t('settings.translate.token.saved'),
                    none: t('settings.translate.token.none'),
                    save: t('settings.translate.token.save'),
                    clear: t('settings.translate.token.clear')
                }}
                status={status}
                onChanged={refreshStatus}
            />
            <span className="section-label">{t('settings.speech')}</span>
            <p className="field__hint">{t('settings.speech.hint')}</p>
            <SelectField
                label={t('settings.speech.provider')}
                value={speech}
                options={SPEECH_PROVIDER_IDS}
                formatOption={(option) => {
                    return speechProviderName(option, t);
                }}
                onChange={chooseSpeech}
            />
            <TextField
                label={t('settings.speech.model')}
                value={draft.transcribeModel}
                hint={t('settings.speech.model.hint')}
                onChange={(value) => {
                    edit('transcribeModel', value);
                }}
            />
            <TextField
                label={t('settings.speech.baseUrl')}
                value={draft.transcribeBaseUrl}
                placeholder={SPEECH_PROVIDERS[speech].defaultBaseUrl}
                hint={t('settings.speech.baseUrl.hint')}
                onChange={(value) => {
                    edit('transcribeBaseUrl', value);
                }}
            />
            <TokenField
                key={speechTokenSlot(speech)}
                slot={speechTokenSlot(speech)}
                inputId="speech-token"
                texts={{
                    label: t('settings.speech.token'),
                    saved: t('settings.speech.token.saved'),
                    none: t('settings.speech.token.none'),
                    save: t('settings.speech.token.save'),
                    clear: t('settings.speech.token.clear')
                }}
                status={status}
                onChanged={refreshStatus}
            />
        </>
    );
}
