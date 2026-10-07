import type { SubtitleGeneratePlan, SubtitleGenerationPhase } from '@shared/anime';
import { overallPercent, stepsOf, stepStatesOf } from '@renderer/components/generateProgress';

describe('stepsOf', () => {
    it.each(['transcribe', 'direct'] as const)('has no step of translating the text when the plan is %s', (plan) => {
        expect(stepsOf(plan)).toEqual(['extract', 'send', 'save']);
    });

    it('has a step of translating the text between sending and saving when the text is translated afterwards', () => {
        expect(stepsOf('transcribe-translate')).toEqual(['extract', 'send', 'translate', 'save']);
    });
});

describe('stepStatesOf', () => {
    it.each(['transcribe', 'direct', 'transcribe-translate'] as const)('makes every step wait before the job reports its first phase (plan %s)', (plan) => {
        expect(
            stepStatesOf(plan, undefined).map((step) => {
                return step.state;
            })
        ).toEqual(stepsOf(plan).map(() => {
            return 'pending';
        }));
    });

    it('marks the steps before the phase as done, the one of the phase as going on and the others as waiting', () => {
        expect(stepStatesOf('transcribe-translate', 'sending')).toEqual([
            { id: 'extract', state: 'done' },
            { id: 'send', state: 'active' },
            { id: 'translate', state: 'pending' },
            { id: 'save', state: 'pending' }
        ]);
        expect(stepStatesOf('transcribe-translate', 'translating')).toEqual([
            { id: 'extract', state: 'done' },
            { id: 'send', state: 'done' },
            { id: 'translate', state: 'active' },
            { id: 'save', state: 'pending' }
        ]);
    });

    it.each([
        ['extracting', ['active', 'pending', 'pending']],
        ['sending', ['done', 'active', 'pending']],
        ['saving', ['done', 'done', 'active']]
    ] as const)('goes through the steps of a plan with no translation: %s', (phase, states) => {
        expect(
            stepStatesOf('transcribe', phase).map((step) => {
                return step.state;
            })
        ).toEqual(states);
    });

    it('ignores a phase the plan does not have', () => {
        expect(
            stepStatesOf('direct', 'translating').map((step) => {
                return step.state;
            })
        ).toEqual(['pending', 'pending', 'pending']);
    });
});

describe('overallPercent', () => {
    function percent(plan: SubtitleGeneratePlan, phase: SubtitleGenerationPhase | undefined, done: number, total: number): number {
        return overallPercent(plan, { phase, done, total });
    }

    it('is zero before the job reports a phase, and while the first one has done nothing', () => {
        expect(percent('transcribe', undefined, 0, 0)).toBe(0);
        expect(percent('transcribe', 'extracting', 0, 1)).toBe(0);
    });

    it.each(['transcribe', 'direct'] as const)('gives ten to the audio, eighty to the parts that are sent and ten to the saving when the plan is %s', (plan) => {
        expect(percent(plan, 'sending', 0, 4)).toBe(10);
        expect(percent(plan, 'sending', 1, 4)).toBe(30);
        expect(percent(plan, 'sending', 2, 4)).toBe(50);
        expect(percent(plan, 'sending', 4, 4)).toBe(90);
        expect(percent(plan, 'saving', 0, 1)).toBe(90);
    });

    it('gives five to the audio, fifty to the parts, forty to the translation and five to the saving when the text is translated afterwards', () => {
        const plan = 'transcribe-translate';
        expect(percent(plan, 'extracting', 0, 1)).toBe(0);
        expect(percent(plan, 'sending', 0, 2)).toBe(5);
        expect(percent(plan, 'sending', 1, 2)).toBe(30);
        expect(percent(plan, 'translating', 0, 100)).toBe(55);
        expect(percent(plan, 'translating', 50, 100)).toBe(75);
        expect(percent(plan, 'translating', 100, 100)).toBe(95);
        expect(percent(plan, 'saving', 0, 1)).toBe(95);
    });

    it('rounds to a whole number', () => {
        expect(percent('transcribe', 'sending', 1, 3)).toBe(37);
    });

    it('does not count what the step that is going on has done when it does not know how much there is, and never counts more than all of it', () => {
        expect(percent('transcribe', 'sending', 5, 0)).toBe(10);
        expect(percent('transcribe', 'sending', 9, 3)).toBe(90);
    });
});
