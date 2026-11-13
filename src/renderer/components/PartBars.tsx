import type { CSSProperties } from 'react';
import type { Translator } from '@shared/i18n';
import type { DownloadPart } from '@shared/types';
import { Drawn } from './Drawn';
import { formatPercent } from './jobStatus';

// Whether a download comes in parts that each have a bar of their own (the video and the audio that are downloaded apart).
export function hasParts(parts: DownloadPart[] | null): parts is DownloadPart[] {
    return parts !== null && parts.length > 1;
}

// The name of a part as its bar shows it: what it holds, or its place (from 1) when that is not known.
export function partName(part: DownloadPart, position: number, t: Translator): string {
    if (part.kind === 'video') {
        return t('job.part.video');
    }
    if (part.kind === 'audio') {
        return t('job.part.audio');
    }
    return t('job.part.other', { number: position + 1 });
}

interface PartBarsProps {
    parts: DownloadPart[];
    t: Translator;
    // A class added to the bar of each part (the banner of the download has bars of its own look).
    barClassName?: string;
    // How long a round of the flow of the bars takes ("" keeps the one of the theme).
    flowDuration?: string;
    // The words repeat a card that says them already (the banner of the download): they are drawn instead of written.
    drawn?: boolean;
}

function barStyle(percent: number, flowDuration: string): CSSProperties {
    const width = `${String(percent)}%`;
    return flowDuration.length > 0 ? { width, animationDuration: flowDuration } : { width };
}

function PartText({ className, text, drawn }: { className: string; text: string; drawn: boolean }) {
    if (drawn) {
        return <Drawn className={className} text={text} />;
    }
    return <span className={className}>{text}</span>;
}

// One bar for each part of a download that comes in parts, one under the other and all in sight from the start: the name of the part, its bar
// and how far it is. The parts are downloaded one after the other, so the ones before the part going on are full and the ones after it empty.
export function PartBars({ parts, t, barClassName = '', flowDuration = '', drawn = false }: PartBarsProps) {
    return (
        <div className="job-parts" data-testid="job-parts">
            {parts.map((part, position) => {
                const name = partName(part, position, t);
                return (
                    <div className={`job-part job-part--${part.kind}`} key={`${part.kind}-${String(position)}`} data-testid="job-part">
                        <PartText className="job-part__name" text={name} drawn={drawn} />
                        <div
                            className={barClassName.length > 0 ? `progress ${barClassName}` : 'progress'}
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(part.percent)}
                            aria-label={t('job.partLabel', { part: name })}
                        >
                            <div className="progress__bar" style={barStyle(part.percent, flowDuration)} />
                        </div>
                        <PartText className="job-part__percent" text={formatPercent(part.percent)} drawn={drawn} />
                    </div>
                );
            })}
        </div>
    );
}
