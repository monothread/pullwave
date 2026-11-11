import type { SubtitleGenerationJob, SubtitleTranslationJob } from '@shared/anime';
import { activitiesOf, isActiveSubtitleJob, upsertSubtitleActivity, type SubtitleActivity } from '@renderer/store/subtitleActivity';

function translation(episodeId: number, change: Partial<SubtitleTranslationJob> = {}): SubtitleActivity {
    return { kind: 'translation', job: { episodeId, language: 'Spanish', status: 'running', done: 1, total: 4, reason: null, ...change } };
}

function generation(episodeId: number, change: Partial<SubtitleGenerationJob> = {}): SubtitleActivity {
    return { kind: 'generation', job: { episodeId, language: 'Korean', status: 'running', done: 0, total: 3, reason: null, phase: 'sending', plan: 'transcribe-translate', ...change } };
}

describe('isActiveSubtitleJob', () => {
    it.each(['queued', 'running'] as const)('takes a job that is %s as one that goes on', (status) => {
        expect(isActiveSubtitleJob({ status })).toBe(true);
    });

    it.each(['done', 'error', 'cancelled', 'skipped'] as const)('takes a job that is %s as one that ended', (status) => {
        expect(isActiveSubtitleJob({ status })).toBe(false);
    });
});

describe('upsertSubtitleActivity', () => {
    it('adds a new job that goes on at the end', () => {
        expect(upsertSubtitleActivity([translation(1)], generation(2))).toEqual([translation(1), generation(2)]);
    });

    it('does not add a job it did not know that ended already', () => {
        expect(upsertSubtitleActivity([translation(1)], translation(2, { status: 'done' }))).toEqual([translation(1)]);
    });

    it('puts the new state of a job in its place', () => {
        const list = [translation(1), translation(2), generation(3)];
        expect(upsertSubtitleActivity(list, translation(2, { done: 3 }))).toEqual([translation(1), translation(2, { done: 3 }), generation(3)]);
    });

    it.each(['done', 'error', 'cancelled', 'skipped'] as const)('takes a job out when it is %s', (status) => {
        expect(upsertSubtitleActivity([translation(1), generation(1)], translation(1, { status }))).toEqual([generation(1)]);
    });

    it('tells apart the translation and the making of the subtitle of the same episode', () => {
        expect(upsertSubtitleActivity([translation(1)], generation(1))).toEqual([translation(1), generation(1)]);
        expect(upsertSubtitleActivity([translation(1), generation(1)], generation(1, { phase: 'saving' }))).toEqual([translation(1), generation(1, { phase: 'saving' })]);
    });

    it('does not change the list it was given', () => {
        const list = [translation(1)];
        upsertSubtitleActivity(list, translation(1, { status: 'done' }));
        upsertSubtitleActivity(list, generation(2));
        expect(list).toEqual([translation(1)]);
    });
});

describe('activitiesOf', () => {
    it('keeps the translations first, then the subtitles made from the audio', () => {
        expect(
            activitiesOf({
                translations: [translation(1).job as SubtitleTranslationJob, translation(2, { status: 'queued' }).job as SubtitleTranslationJob],
                generations: [generation(3).job as SubtitleGenerationJob]
            })
        ).toEqual([translation(1), translation(2, { status: 'queued' }), generation(3)]);
    });

    it('leaves out the jobs that ended', () => {
        expect(
            activitiesOf({
                translations: [translation(1, { status: 'done' }).job as SubtitleTranslationJob],
                generations: [generation(3, { status: 'cancelled' }).job as SubtitleGenerationJob]
            })
        ).toEqual([]);
    });

    it('is empty when nothing goes on', () => {
        expect(activitiesOf({ translations: [], generations: [] })).toEqual([]);
    });
});
