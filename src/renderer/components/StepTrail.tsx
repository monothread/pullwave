import type { Translator } from '@shared/i18n';
import type { JobStatus } from '@shared/types';
import { Drawn } from './Drawn';
import { stepItems } from './jobStatus';

interface StepTrailProps {
    // The steps after the download that started (the post-processors of yt-dlp, or the joining of an episode), in their order.
    steps: readonly string[];
    // How the download is: its last step is the one going on while it runs, every step is done once it is complete, and a download that
    // failed, was cancelled or waits shows no steps (the step it stopped at was not done).
    status: JobStatus;
    t: Translator;
    // The words repeat a card that says them already (the banner of the download): they are drawn instead of written.
    drawn?: boolean;
}

function StepName({ text, drawn }: { text: string; drawn: boolean }) {
    if (drawn) {
        return <Drawn className="steps__name" text={text} />;
    }
    return <span className="steps__name">{text}</span>;
}

// The steps of a download once the file is downloaded: the download (done), then each step as it starts, the one going on lit and the ones
// before it ticked. Only the steps that started are shown: which ones come next is not known before they start.
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
