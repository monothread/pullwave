import type { SubtitleGeneratePlan, SubtitleGenerationJob, SubtitleGenerationPhase } from '@shared/anime';

export type GenerateStepId = 'extract' | 'send' | 'translate' | 'save';
export type GenerateStepState = 'pending' | 'active' | 'done';

const STEPS: Record<SubtitleGeneratePlan, readonly GenerateStepId[]> = {
    transcribe: ['extract', 'send', 'save'],
    direct: ['extract', 'send', 'save'],
    'transcribe-translate': ['extract', 'send', 'translate', 'save']
};

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

export function stepOfPhase(phase: SubtitleGenerationPhase): GenerateStepId {
    return PHASE_STEPS[phase];
}

export function stepsOf(plan: SubtitleGeneratePlan): readonly GenerateStepId[] {
    return STEPS[plan];
}

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
