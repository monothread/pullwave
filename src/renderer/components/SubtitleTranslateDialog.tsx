import { useEffect, useState } from 'react';
import {
    TRANSLATION_LANGUAGES,
    type AnimeSubtitleTrack,
    type SubtitleEstimateResponse,
    type SubtitleTranslateResponse,
    type SubtitleTranslationJob,
    type TranslationLanguage
} from '@shared/anime';
import { useModalDialog } from '../hooks/useModalDialog';
import { useAppLanguage, useTranslator } from '../i18n/useTranslator';
import { useAppStore } from '../store/appStore';
import { SelectField } from './fields';
import { optionIdOf, optionsOf } from './subtitleChoice';
import { estimateFailureText, providerName, translateFailureText } from './translateText';

const AUTOMATIC = 'auto';

interface SubtitleTranslateDialogProps {
    episodeId: number;
    tracks: readonly AnimeSubtitleTrack[];
    // The translation was saved: the subtitles the episode has now, and the new one.
    onTranslated: (tracks: AnimeSubtitleTrack[], translated: AnimeSubtitleTrack) => void;
    onClose: () => void;
}

// Before the token of the user is spent: which subtitle to start from, which language, about what it takes and who is paid, with the
// way to confirm and, once it started, to follow it and to stop it.
export function SubtitleTranslateDialog({ episodeId, tracks, onTranslated, onClose }: SubtitleTranslateDialogProps) {
    const t = useTranslator();
    const language = useAppLanguage();
    const settings = useAppStore((state) => {
        return state.settings;
    });
    const [source, setSource] = useState(AUTOMATIC);
    const [target, setTarget] = useState<TranslationLanguage>(settings.translateLanguage);
    // The estimate with the subtitle it is for: while the one chosen has none yet it is counting.
    const [counted, setCounted] = useState<{ trackId: string | null; response: SubtitleEstimateResponse } | null>(null);
    const [job, setJob] = useState<SubtitleTranslationJob | null>(null);
    const [failure, setFailure] = useState<Extract<SubtitleTranslateResponse, { ok: false }> | null>(null);
    const [running, setRunning] = useState(false);
    const { dialogRef, handleKeyDown } = useModalDialog(onClose, !running);
    const trackId = source === AUTOMATIC ? null : (tracks.find((track) => {
        return optionIdOf(track) === source;
    })?.id ?? null);

    useEffect(() => {
        let current = true;
        void window.api.estimateAnimeSubtitleTranslation({ episodeId, trackId }).then((response) => {
            if (current) {
                setCounted({ trackId, response });
            }
        });
        return () => {
            current = false;
        };
    }, [episodeId, trackId]);

    useEffect(() => {
        return window.api.onSubtitleTranslationUpdate((update) => {
            if (update.episodeId === episodeId) {
                setJob(update);
            }
        });
    }, [episodeId]);

    async function start(): Promise<void> {
        setFailure(null);
        setRunning(true);
        try {
            const response = await window.api.translateAnimeSubtitle({ episodeId, trackId, language: target });
            if (response.ok) {
                onTranslated(response.tracks, response.translated);
            } else if (response.reason !== 'cancelled') {
                setFailure(response);
            }
        } finally {
            setRunning(false);
            setJob(null);
        }
    }

    const options = [AUTOMATIC, ...optionsOf(tracks, language).map((option) => {
        return option.id;
    })];
    const labels = new Map(optionsOf(tracks, language).map((option) => {
        return [option.id, option.label];
    }));
    const estimate = counted !== null && counted.trackId === trackId ? counted.response : null;
    const ready = estimate?.ok === true;

    return (
        <div className="modal-backdrop">
            <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="translate-subtitle-title" onKeyDown={handleKeyDown}>
                <h2 id="translate-subtitle-title" className="modal__title">
                    {t('anime.translate.title')}
                </h2>
                <p className="modal__hint">{t('anime.translate.intro')}</p>
                <p className="modal__hint">
                    {t('anime.translate.using', { provider: providerName(settings.translateProvider, t), model: settings.translateModel.length > 0 ? settings.translateModel : '—' })}
                </p>
                <SelectField
                    label={t('anime.translate.source')}
                    value={source}
                    options={options}
                    formatOption={(option) => {
                        return option === AUTOMATIC ? t('anime.translate.sourceAuto') : (labels.get(option) ?? option);
                    }}
                    onChange={setSource}
                />
                <SelectField label={t('anime.translate.language')} value={target} options={TRANSLATION_LANGUAGES} onChange={setTarget} />
                <p className="field__hint" aria-live="polite" data-testid="translate-estimate">
                    {estimate === null && t('anime.translate.estimating')}
                    {estimate?.ok === true && t('anime.translate.estimate', { cues: estimate.cues, batches: estimate.batches, tokens: estimate.approxTokens })}
                    {estimate?.ok === false && estimateFailureText(estimate.reason, t)}
                </p>
                {running && (
                    <p className="field__hint" aria-live="polite" data-testid="translate-progress">
                        {job === null || job.status === 'queued' ? t('anime.translate.queued') : t('anime.translate.progress', { done: job.done, total: job.total })}
                    </p>
                )}
                {failure !== null && (
                    <p className="field__warning" role="alert">
                        {translateFailureText(failure, t)}
                    </p>
                )}
                <div className="modal__actions">
                    {running ? (
                        <button
                            type="button"
                            className="btn btn--small"
                            onClick={() => {
                                void window.api.cancelAnimeSubtitleTranslation(episodeId);
                            }}
                        >
                            {t('anime.translate.cancel')}
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="btn btn--small btn--primary"
                            disabled={!ready}
                            onClick={() => {
                                void start();
                            }}
                        >
                            {t('anime.translate.start')}
                        </button>
                    )}
                    <button type="button" className="btn btn--small btn--ghost" disabled={running} onClick={onClose}>
                        {t('anime.translate.close')}
                    </button>
                </div>
            </div>
        </div>
    );
}
