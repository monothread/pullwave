import type { SubtitleGenerationJob, SubtitleJobs, SubtitleTranslationJob } from '@shared/anime';

export type SubtitleActivity = { kind: 'translation'; job: SubtitleTranslationJob } | { kind: 'generation'; job: SubtitleGenerationJob };

export type SubtitleActivityKind = SubtitleActivity['kind'];

export function isActiveSubtitleJob(job: Pick<SubtitleTranslationJob, 'status'>): boolean {
    return job.status === 'queued' || job.status === 'running';
}

function sameActivity(first: SubtitleActivity, second: SubtitleActivity): boolean {
    return first.kind === second.kind && first.job.episodeId === second.job.episodeId;
}

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

export function updatesOf(translations: readonly SubtitleTranslationJob[]): Record<number, SubtitleTranslationJob> {
    return Object.fromEntries(
        translations.map((job) => {
            return [job.episodeId, job];
        })
    );
}
