import type { LibraryAnime } from '@shared/anime';
import type { MessageKey, Translator } from '@shared/i18n';
import { useTranslator } from '../i18n/useTranslator';
import { useAnimeStore } from '../store/animeStore';
import type { SubtitleActivity, SubtitleActivityKind } from '../store/subtitleActivity';
import { ConfirmButton } from './ConfirmButton';
import { overallPercent, stepOfPhase } from './generateProgress';
import { stepLabel } from './GenerateProgressPanel';
import { formatPercent } from './jobStatus';

const KIND_KEYS: Record<SubtitleActivityKind, MessageKey> = {
    translation: 'anime.subtitleJobs.kind.translation',
    generation: 'anime.subtitleJobs.kind.generation'
};

const STATUS_KEYS: Record<'queued' | 'running', MessageKey> = {
    queued: 'anime.subtitleJobs.status.queued',
    running: 'anime.subtitleJobs.status.running'
};

// The anime and the number of the episode of a job, from the library (null when the episode is not in it any more).
export function episodeOf(library: readonly LibraryAnime[], episodeId: number): { title: string; episode: string } | null {
    for (const anime of library) {
        const episode = anime.episodes.find((candidate) => {
            return candidate.id === episodeId;
        });
        if (episode !== undefined) {
            return { title: anime.title, episode: episode.number };
        }
    }
    return null;
}

// How far the job is, from 0 to 100: the lines translated out of all of them, or, for a subtitle made from the audio, the steps it went through.
export function activityPercent(activity: SubtitleActivity): number {
    const { job } = activity;
    if (activity.kind === 'generation') {
        return activity.job.plan === undefined ? 0 : overallPercent(activity.job.plan, activity.job);
    }
    return job.total > 0 ? Math.round((Math.min(job.done, job.total) / job.total) * 100) : 0;
}

// What the job is doing now: the language it translates into, or the step of the subtitle made from the audio (only the language before the
// first step).
export function activityDetail(activity: SubtitleActivity, t: Translator): string {
    const into = t('anime.subtitleJobs.into', { language: activity.job.language });
    if (activity.kind === 'translation' || activity.job.phase === undefined || activity.job.plan === undefined) {
        return into;
    }
    return stepLabel(stepOfPhase(activity.job.phase), activity.job.plan, activity.job.language, t);
}

function statusOf(activity: SubtitleActivity): 'queued' | 'running' {
    return activity.job.status === 'running' ? 'running' : 'queued';
}

// The screen of the subtitles the app is translating or making from the audio, or that wait for their turn, whoever asked for them (the player,
// a whole season, the automatic translation of the new episodes): one card for each, with its bar and the button that cancels it, and a button
// that stops all of them.
export function AnimeSubtitleJobs() {
    const t = useTranslator();
    const activities = useAnimeStore((state) => {
        return state.subtitleJobs;
    });
    const library = useAnimeStore((state) => {
        return state.library;
    });
    const cancelSubtitleJob = useAnimeStore((state) => {
        return state.cancelSubtitleJob;
    });
    const cancelAllSubtitleJobs = useAnimeStore((state) => {
        return state.cancelAllSubtitleJobs;
    });

    if (activities.length === 0) {
        return <p className="empty">{t('anime.subtitleJobs.empty')}</p>;
    }
    return (
        <section className="anime__jobs queue" aria-label={t('anime.subtitleJobs.label', { count: activities.length })}>
            <div className="queue__toolbar">
                <span className="section-label">{t('anime.subtitleJobs.label', { count: activities.length })}</span>
                <ConfirmButton
                    className="btn btn--small btn--hot"
                    dialog={{
                        title: t('confirm.subtitleJobsCancelAll.title'),
                        message: t('confirm.subtitleJobsCancelAll.message'),
                        confirmLabel: t('anime.subtitleJobs.cancelAll'),
                        cancelLabel: t('confirm.back')
                    }}
                    onConfirm={() => {
                        void cancelAllSubtitleJobs();
                    }}
                >
                    {t('anime.subtitleJobs.cancelAll')}
                </ConfirmButton>
            </div>
            {activities.map((activity) => {
                const found = episodeOf(library, activity.job.episodeId);
                const title = found === null ? t('anime.subtitleJobs.unknown') : t('anime.job.title', { title: found.title, episode: found.episode });
                const percent = activityPercent(activity);
                const status = statusOf(activity);
                return (
                    <article key={`${activity.kind}-${String(activity.job.episodeId)}`} className={`job job--${status}`} data-testid="anime-subtitle-job">
                        <header className="job__head">
                            <h3 className="job__title" title={title}>
                                {title}
                            </h3>
                            <span className="job__badges">
                                <span className="badge">{t(KIND_KEYS[activity.kind])}</span>
                                <span className={`badge badge--${status}`}>{t(STATUS_KEYS[status])}</span>
                            </span>
                        </header>
                        <div
                            className="progress"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={percent}
                            aria-label={t('anime.subtitleJobs.progress', { title })}
                        >
                            <div className="progress__bar" style={{ width: `${percent}%` }} />
                        </div>
                        <div className="job__meta">
                            <span>{formatPercent(percent)}</span>
                            <span>{activityDetail(activity, t)}</span>
                        </div>
                        <div className="job__actions">
                            <ConfirmButton
                                className="btn btn--small btn--hot"
                                ariaLabel={t('anime.subtitleJobs.cancelAria', { title })}
                                dialog={{ title: t('confirm.subtitleJobCancel.title'), message: t('confirm.subtitleJobCancel.message'), confirmLabel: t('anime.job.cancel'), cancelLabel: t('confirm.back') }}
                                onConfirm={() => {
                                    void cancelSubtitleJob(activity);
                                }}
                            >
                                {t('anime.job.cancel')}
                            </ConfirmButton>
                        </div>
                    </article>
                );
            })}
        </section>
    );
}
