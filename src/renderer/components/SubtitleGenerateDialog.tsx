import { useEffect, useState } from 'react';
import {
    DEFAULT_TRANSCRIPTION_LANGUAGE,
    generatePlanOf,
    TRANSCRIPTION_LANGUAGES,
    TRANSLATION_LANGUAGES,
    type AnimeSubtitleTrack,
    type SubtitleGenerateEstimateResponse,
    type SubtitleGenerateResponse,
    type SubtitleGenerationJob,
    type TranscriptionLanguage,
    type TranslationLanguage
} from '@shared/anime';
import type { Translator } from '@shared/i18n';
import { speechTranslatesTo } from '@shared/llm';
import type { Settings } from '@shared/types';
import { useModalDialog } from '../hooks/useModalDialog';
import { useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { SelectField } from './fields';
import { GenerateProgressPanel } from './GenerateProgressPanel';
import { formatBytes } from './jobStatus';
import { generateEstimateFailureText, generateFailureText, providerName, speechProviderName } from './translateText';

interface SubtitleGenerateDialogProps {
    episodeId: number;
    // The subtitle was made and saved: the subtitles the episode has now, and the new one.
    onGenerated: (tracks: AnimeSubtitleTrack[], generated: AnimeSubtitleTrack) => void;
    onClose: () => void;
}

interface FactsProps {
    estimate: SubtitleGenerateEstimateResponse | null;
    translating: boolean;
    settings: Settings;
    t: Translator;
}

// What will leave the computer and where it goes: only the audio (never the video), how much of it, to which service and, when the text has to
// be translated afterwards, to which other one.
function SentFacts({ estimate, translating, settings, t }: FactsProps) {
    return (
        <section className="generate__card" aria-label={t('anime.generate.sent.title')}>
            <span className="section-label">{t('anime.generate.sent.title')}</span>
            <p className="generate__privacy">{t('anime.generate.sent.privacy')}</p>
            <dl className="generate__facts">
                <dt>{t('anime.generate.sent.audio')}</dt>
                <dd data-testid="generate-estimate">
                    {estimate === null && t('anime.generate.estimating')}
                    {estimate?.ok === true &&
                        t('anime.generate.sent.audioValue', {
                            minutes: Math.max(1, Math.round(estimate.seconds / 60)),
                            size: formatBytes(estimate.approxBytes),
                            parts: estimate.parts
                        })}
                    {estimate?.ok === false && generateEstimateFailureText(estimate.reason, t)}
                </dd>
                <dt>{t('anime.generate.sent.speech')}</dt>
                <dd>{t('anime.generate.sent.service', { provider: speechProviderName(settings.transcribeProvider, t), model: settings.transcribeModel.length > 0 ? settings.transcribeModel : '—' })}</dd>
                {translating && (
                    <>
                        <dt>{t('anime.generate.sent.translation')}</dt>
                        <dd>{t('anime.generate.sent.service', { provider: providerName(settings.translateProvider, t), model: settings.translateModel.length > 0 ? settings.translateModel : '—' })}</dd>
                    </>
                )}
            </dl>
            <p className="modal__hint">{t('anime.generate.sent.cost')}</p>
        </section>
    );
}

// Before the token of the user is spent: the language spoken in the episode and the one of the subtitle, how it will be made, what leaves the
// computer and where it goes, with the way to confirm and, once it started, to follow it step by step and to stop it.
export function SubtitleGenerateDialog({ episodeId, onGenerated, onClose }: SubtitleGenerateDialogProps) {
    const t = useTranslator();
    const settings = useAppStore((state) => {
        return state.settings;
    });
    const [audioLanguage, setAudioLanguage] = useState<TranscriptionLanguage>(DEFAULT_TRANSCRIPTION_LANGUAGE);
    const [language, setLanguage] = useState<TranslationLanguage>(settings.translateLanguage);
    const [estimate, setEstimate] = useState<SubtitleGenerateEstimateResponse | null>(null);
    const [job, setJob] = useState<SubtitleGenerationJob | null>(null);
    const [failure, setFailure] = useState<Extract<SubtitleGenerateResponse, { ok: false }> | null>(null);
    const [running, setRunning] = useState(false);
    const { dialogRef, handleKeyDown } = useModalDialog(onClose, !running);
    const chosenPlan = generatePlanOf(audioLanguage, language, speechTranslatesTo(settings.transcribeProvider));
    const plan = job?.plan ?? chosenPlan;

    useEffect(() => {
        let current = true;
        void window.api.estimateAnimeSubtitleGeneration(episodeId).then((response) => {
            if (current) {
                setEstimate(response);
            }
        });
        return () => {
            current = false;
        };
    }, [episodeId]);

    useEffect(() => {
        return window.api.onSubtitleGenerationUpdate((update) => {
            if (update.episodeId === episodeId) {
                setJob(update);
            }
        });
    }, [episodeId]);

    async function start(): Promise<void> {
        setFailure(null);
        setRunning(true);
        try {
            const response = await window.api.generateAnimeSubtitle({ episodeId, audioLanguage, language });
            if (response.ok) {
                onGenerated(response.tracks, response.generated);
            } else if (response.reason !== 'cancelled') {
                setFailure(response);
            }
        } finally {
            setRunning(false);
            setJob(null);
        }
    }

    return (
        <div className="modal-backdrop">
            <div ref={dialogRef} className="modal modal--wide generate" role="dialog" aria-modal="true" aria-labelledby="generate-subtitle-title" onKeyDown={handleKeyDown}>
                <h2 id="generate-subtitle-title" className="modal__title">
                    {t('anime.generate.title')}
                </h2>
                <p className="modal__hint">{t('anime.generate.intro')}</p>
                <div className="generate__languages">
                    <SelectField label={t('anime.generate.audioLanguage')} value={audioLanguage} options={TRANSCRIPTION_LANGUAGES} disabled={running} onChange={setAudioLanguage} />
                    <span className="generate__arrow" aria-hidden="true">
                        →
                    </span>
                    <SelectField label={t('anime.generate.targetLanguage')} value={language} options={TRANSLATION_LANGUAGES} disabled={running} onChange={setLanguage} />
                </div>
                <p className="generate__plan" data-testid="generate-plan">
                    {t(`anime.generate.plan.${chosenPlan}`, { audio: audioLanguage, target: language })}
                </p>
                <SentFacts estimate={estimate} translating={plan === 'transcribe-translate'} settings={settings} t={t} />
                {running && (
                    <>
                        {job?.plan !== undefined && job.plan !== chosenPlan && <p className="generate__plan generate__plan--notice">{t('anime.generate.fallback')}</p>}
                        <GenerateProgressPanel plan={plan} job={job} language={language} parts={estimate?.ok === true ? estimate.parts : 1} approxBytes={estimate?.ok === true ? estimate.approxBytes : 0} />
                    </>
                )}
                {failure !== null && (
                    <p className="field__warning" role="alert">
                        {generateFailureText(failure, t)}
                    </p>
                )}
                <div className="modal__actions">
                    {running ? (
                        <button
                            type="button"
                            className="btn btn--small"
                            onClick={() => {
                                void window.api.cancelAnimeSubtitleGeneration(episodeId);
                            }}
                        >
                            {t('anime.generate.cancel')}
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="btn btn--small btn--primary"
                            disabled={estimate?.ok !== true}
                            onClick={() => {
                                void start();
                            }}
                        >
                            {t('anime.generate.start')}
                        </button>
                    )}
                    <button type="button" className="btn btn--small btn--ghost" disabled={running} onClick={onClose}>
                        {t('anime.generate.close')}
                    </button>
                </div>
            </div>
        </div>
    );
}
