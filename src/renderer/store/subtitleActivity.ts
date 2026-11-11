import type { SubtitleGenerationJob, SubtitleJobs, SubtitleTranslationJob } from '@shared/anime';

// A subtitle the app is working on: the translation of one, or one made from the audio of the episode.
export type SubtitleActivity = { kind: 'translation'; job: SubtitleTranslationJob } | { kind: 'generation'; job: SubtitleGenerationJob };

export type SubtitleActivityKind = SubtitleActivity['kind'];

// Whether a job still waits or goes on (the screen shows only those).
export function isActiveSubtitleJob(job: Pick<SubtitleTranslationJob, 'status'>): boolean {
    return job.status === 'queued' || job.status === 'running';
}

function sameActivity(first: SubtitleActivity, second: SubtitleActivity): boolean {
    return first.kind === second.kind && first.job.episodeId === second.job.episodeId;
}

// The list once a job told how it goes: it takes the place of the one of the same kind and episode, it is added at the end when it is new,
// and it leaves the list when it ended (done, failed, cancelled or skipped).
export function upsertSubtitleActivity(list: readonly SubtitleActivity[], activity: SubtitleActivity): SubtitleActivity[] {
    const active = isActiveSubtitleJob(activity.job);
    const known = list.some((candidate) => {
        return sameActivity(candidate, activity);
    });
    if (!known) {
        return active ? [...list, activity] : [...list];
    }
    if (!active) {
        return list.filter((candidate) => {
            return !sameActivity(candidate, activity);
        });
    }
    return list.map((candidate) => {
        return sameActivity(candidate, activity) ? activity : candidate;
    });
}

// The jobs the main process listed, as the screen keeps them (the translations first).
export function activitiesOf(jobs: SubtitleJobs): SubtitleActivity[] {
    const translations = jobs.translations.map((job): SubtitleActivity => {
        return { kind: 'translation', job };
    });
    const generations = jobs.generations.map((job): SubtitleActivity => {
        return { kind: 'generation', job };
    });
    return [...translations, ...generations].filter((activity) => {
        return isActiveSubtitleJob(activity.job);
    });
}

// The translations the main process listed, by the id of their episode.
export function updatesOf(translations: readonly SubtitleTranslationJob[]): Record<number, SubtitleTranslationJob> {
    return Object.fromEntries(
        translations.map((job) => {
            return [job.episodeId, job];
        })
    );
}
