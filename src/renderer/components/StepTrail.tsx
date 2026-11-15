import type { Translator } from '@shared/i18n';
import type { JobStatus } from '@shared/types';
import { Drawn } from './Drawn';
import { stepItems } from './jobStatus';

interface StepTrailProps {
    steps: readonly string[];
    status: JobStatus;
    t: Translator;
    drawn?: boolean;
}

function StepName({ text, drawn }: { text: string; drawn: boolean }) {
    if (drawn) {
        return <Drawn className="steps__name" text={text} />;
    }
    return <span className="steps__name">{text}</span>;
}

export function StepTrail({ steps, status, t, drawn = false }: StepTrailProps) {
    const items = stepItems(steps, status === 'running');
    if (items.length === 0 || (status !== 'running' && status !== 'done')) {
        return null;
    }
    return (
        <ol className="steps" aria-label={t('job.steps.label')} data-testid="job-steps">
            <li className="steps__item steps__item--done" data-state="done">
                <StepName text={t('job.step.download')} drawn={drawn} />
            </li>
            {items.map((item, index) => {
                return (
                    <li className={`steps__item steps__item--${item.state}`} data-state={item.state} key={`${item.key}-${String(index)}`} aria-current={item.state === 'now' ? 'step' : undefined}>
                        <StepName text={t(item.key)} drawn={drawn} />
                    </li>
                );
            })}
        </ol>
    );
}
