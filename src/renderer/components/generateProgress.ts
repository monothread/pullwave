import type { SubtitleGeneratePlan, SubtitleGenerationJob, SubtitleGenerationPhase } from '@shared/anime';

// The steps the user sees while a subtitle is made, in the order they happen. Which ones there are depends on the plan: transcribing and
// translating the audio into English at once have no step of translating the text.
export type GenerateStepId = 'extract' | 'send' | 'translate' | 'save';
export type GenerateStepState = 'pending' | 'active' | 'done';

const STEPS: Record<SubtitleGeneratePlan, readonly GenerateStepId[]> = {
    transcribe: ['extract', 'send', 'save'],
    direct: ['extract', 'send', 'save'],
    'transcribe-translate': ['extract', 'send', 'translate', 'save']
};

// How much of the bar each step is worth (they add up to 100): sending the audio takes most of the time; so does the translation, when there is one.
const WEIGHTS: Record<SubtitleGeneratePlan, Record<GenerateStepId, number>> = {
    transcribe: { extract: 10, send: 80, translate: 0, save: 10 },
    direct: { extract: 10, send: 80, translate: 0, save: 10 },
    'transcribe-translate': { extract: 5, send: 50, translate: 40, save: 5 }
};

const PHASE_STEPS: Record<SubtitleGenerationPhase, GenerateStepId> = {
    extracting: 'extract',
    sending: 'send',
    translating: 'translate',
    saving: 'save'
};

export function stepsOf(plan: SubtitleGeneratePlan): readonly GenerateStepId[] {
    return STEPS[plan];
}

// The state of each step: the ones before the phase the job is in are done, that one is going on and the others wait. Before the job
// reports its first phase (it is waiting for its turn) all of them wait.
export function stepStatesOf(plan: SubtitleGeneratePlan, phase: SubtitleGenerationPhase | undefined): Array<{ id: GenerateStepId; state: GenerateStepState }> {
    const steps = STEPS[plan];
    const active = phase === undefined ? -1 : steps.indexOf(PHASE_STEPS[phase]);
    return steps.map((id, index) => {
        if (active === -1 || index > active) {
            return { id, state: 'pending' };
        }
        return { id, state: index === active ? 'active' : 'done' };
    });
}

// How far the whole thing is, from 0 to 100: the steps that are done count in full, the one that is going on by how much of it is done.
export function overallPercent(plan: SubtitleGeneratePlan, job: Pick<SubtitleGenerationJob, 'phase' | 'done' | 'total'>): number {
    const weights = WEIGHTS[plan];
    let percent = 0;
    stepStatesOf(plan, job.phase).forEach((step) => {
        if (step.state === 'done') {
            percent += weights[step.id];
        } else if (step.state === 'active' && job.total > 0) {
            percent += weights[step.id] * Math.min(1, job.done / job.total);
        }
    });
    return Math.round(percent);
}
