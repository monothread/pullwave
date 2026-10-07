import type { SubtitleGeneratePlan, SubtitleGenerationJob, TranslationLanguage } from '@shared/anime';
import type { MessageKey, Translator } from '@shared/i18n';
import { useElapsedSeconds } from '../hooks/useElapsedSeconds';
import { useTranslator } from '../i18n/useTranslator';
import { overallPercent, stepStatesOf, type GenerateStepId, type GenerateStepState } from './generateProgress';
import { formatBytes, formatDuration } from './jobStatus';

const STATE_KEYS: Record<GenerateStepState, MessageKey> = {
    pending: 'anime.generate.state.pending',
    active: 'anime.generate.state.active',
    done: 'anime.generate.state.done'
};

interface PanelProps {
    // What the subtitle goes through, as the job says (it can differ from what was chosen), and what it is for.
    plan: SubtitleGeneratePlan;
    job: SubtitleGenerationJob | null;
    language: TranslationLanguage;
    // What the measure of the audio said: how many parts it goes in and how many bytes that is about.
    parts: number;
    approxBytes: number;
}

function stepLabel(id: GenerateStepId, plan: SubtitleGeneratePlan, language: TranslationLanguage, t: Translator): string {
    switch (id) {
        case 'extract':
            return t('anime.generate.step.extract');
        case 'send':
            return plan === 'direct' ? t('anime.generate.step.sendDirect', { target: language }) : t('anime.generate.step.send');
        case 'translate':
            return t('anime.generate.step.translate', { target: language });
        default:
            return t('anime.generate.step.save');
    }
}

// What a step says about itself while it goes on or after it is done: the audio that is ready, the parts that were sent and answered with how
// many bytes of audio left the computer, the lines that were translated. A step that waits, or has nothing to add, says nothing.
function stepDetail(id: GenerateStepId, state: GenerateStepState, props: PanelProps, t: Translator): string | null {
    const { job, parts, approxBytes } = props;
    const totalBytes = job?.totalBytes ?? approxBytes;
    if (id === 'extract') {
        if (state === 'active') {
            return t('anime.generate.detail.extracting');
        }
        return state === 'done' ? t('anime.generate.detail.extracted', { parts, size: formatBytes(totalBytes) }) : null;
    }
    if (id === 'send') {
        if (state === 'active' && job !== null) {
            return t('anime.generate.detail.sending', { done: job.done, total: job.total, sent: formatBytes(job.sentBytes ?? 0), all: formatBytes(totalBytes) });
        }
        return state === 'done' ? t('anime.generate.detail.sending', { done: parts, total: parts, sent: formatBytes(totalBytes), all: formatBytes(totalBytes) }) : null;
    }
    if (id === 'translate' && state === 'active' && job !== null) {
        return t('anime.generate.detail.translating', { done: job.done, total: job.total });
    }
    return null;
}

// The progress of a subtitle that is being made: a bar for the whole, the steps it goes through with what each one is doing right now (the
// audio taken out of the video, the parts sent and answered, the translation, the saving) and how long it has been going on.
export function GenerateProgressPanel(props: PanelProps) {
    const t = useTranslator();
    const elapsed = useElapsedSeconds(true);
    const { plan, job, language } = props;
    const percent = overallPercent(plan, { phase: job?.phase, done: job?.done ?? 0, total: job?.total ?? 0 });
    const waiting = job === null || job.status === 'queued';

    return (
        <section className="generate__progress" aria-label={t('anime.generate.progress.title')}>
            <div className="progress" role="progressbar" aria-label={t('anime.generate.progressLabel')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                <div className="progress__bar" style={{ width: `${percent}%` }} />
            </div>
            <p className="generate__elapsed" data-testid="generate-elapsed">
                {waiting ? t('anime.translate.queued') : t('anime.generate.elapsed', { time: formatDuration(elapsed) })}
            </p>
            <ol className="generate__steps">
                {stepStatesOf(plan, job?.phase).map((step) => {
                    const detail = stepDetail(step.id, step.state, props, t);
                    return (
                        <li key={step.id} className={`generate__step generate__step--${step.state}`} aria-current={step.state === 'active' ? 'step' : undefined}>
                            <span className="generate__icon" aria-hidden="true">
                                {step.state === 'done' && '✓'}
                                {step.state === 'active' && <span className="generate__spinner" />}
                            </span>
                            <span className="generate__step-label">
                                {stepLabel(step.id, plan, language, t)}
                                <span className="generate__sr"> ({t(STATE_KEYS[step.state])})</span>
                            </span>
                            {detail !== null && <span className="generate__detail">{detail}</span>}
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}
